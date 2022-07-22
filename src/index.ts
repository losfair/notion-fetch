import { ExtendedRecordMap } from "notion-types";
import { NotionAPI } from "./notion_client/notion-api";
import * as ReactDOMServer from 'react-dom/server';
import { ContentRenderer } from "./content_renderer";
import React from "react";
import * as blake from "blakejs";
import { html2md } from "./libsupport";

interface AppEnv {
  NOTION_PAGE: DurableObjectNamespace,
  DATA_BUCKET: R2Bucket,
  PRIMARY_ORIGIN?: string,
}

interface PageData {
  id: string,
  r2Path: string,
  r2JsonPath?: string,
  title?: string,
}

const mdRegex = /^\/([0-9a-z-]{1,100})\.md$/
const htmlRegex = /^\/([0-9a-z-]{1,100})\.html$/
const jsonRegex = /^\/([0-9a-z-]{1,100})\.json$/
const imageRegex = /^\/image\/([0-9a-z-]{1,100})\/([0-9a-z.-]{1,200})$/;

interface FetchedPage {
  data: PageData,
  body: R2ObjectBody,
}

async function fetchPage(pageId: string, env: AppEnv, originalUrl: URL, opts: { json?: boolean } = {}): Promise<FetchedPage | Response> {
  const objId = env.NOTION_PAGE.idFromName(pageId);
  const obj = env.NOTION_PAGE.get(objId);

  const outUrl = new URL(`https://[100::]/page/${pageId}`);
  if (originalUrl.searchParams.get("refresh") === "1") {
    outUrl.searchParams.set("refresh", "1");
  }

  const objFetch = await obj.fetch(outUrl.toString());
  if (objFetch.status !== 200) return objFetch;
  const data = await objFetch.json<PageData>();
  const path = opts.json ? data.r2JsonPath : data.r2Path;
  if (!path) return new Response("missing resource", { status: 404 });
  const body = await env.DATA_BUCKET.get(path);
  if (!body) return new Response("missing data in bucket", { status: 404 });
  return {
    data,
    body,
  }
}

export default {
  async fetch(request: Request, env: AppEnv, context: ExecutionContext): Promise<Response> {
    await ensureWasmInit();
    const url = new URL(request.url);

    let match: RegExpExecArray | null = null;
    if ((match = htmlRegex.exec(url.pathname)) !== null) {
      const pageId = match[1];
      const page = await fetchPage(pageId, env, url);
      if (page instanceof Response) return page;

      const headers = new Headers();
      headers.set("content-type", "text/html; charset=utf-8");
      headers.set("access-control-allow-origin", "*");

      return new Response(page.body.body, {
        status: 200,
        headers,
      })
    } else if ((match = mdRegex.exec(url.pathname)) !== null) {
      const pageId = match[1];
      const page = await fetchPage(pageId, env, url);
      if (page instanceof Response) return page;

      const md = (page.data.title ? `# ${page.data.title}\n\n` : "") + html2md(await page.body.text());

      const headers = new Headers();
      headers.set("content-type", "text/plain; charset=utf-8");
      headers.set("access-control-allow-origin", "*");

      return new Response(md, {
        status: 200,
        headers,
      })
    } else if ((match = jsonRegex.exec(url.pathname)) !== null) {
      const pageId = match[1];
      const page = await fetchPage(pageId, env, url, { json: true });
      if (page instanceof Response) return page;

      const headers = new Headers();
      headers.set("content-type", "application/json");
      headers.set("access-control-allow-origin", "*");

      return new Response(page.body.body, {
        status: 200,
        headers,
      })
    } else if ((match = imageRegex.exec(url.pathname)) !== null) {
      const cacheKey = url.origin + url.pathname;
      const cacheMatch = await caches.default.match(cacheKey);
      if (cacheMatch) return cacheMatch;

      const pageId = match[1];
      const filename = match[2];
      const objId = env.NOTION_PAGE.idFromName(pageId);
      const obj = env.NOTION_PAGE.get(objId);

      for (let i = 0; i < 3; i++) {
        const object = await env.DATA_BUCKET.get(`image/${pageId}/${filename}`)
        if (object !== null) {
          const headers = new Headers()
          object.writeHttpMetadata(headers)
          headers.set("cache-control", "public, max-age=2592000");
          const response = new Response(object.body, {
            headers,
          });
          context.waitUntil(caches.default.put(cacheKey, response.clone()));
          return response;
        }

        const objFetch = await obj.fetch(`https://[100::]/image/${pageId}/${filename}`);
        if (!objFetch.ok) {
          return objFetch;
        }
        await objFetch.text();
        await new Promise(resolve => setTimeout(() => resolve(undefined), 1000 * (i + 1)));
      }

      return new Response("image load timeout", { status: 500 });
    } else {
      return mkJsonResponse({ error: "routing failed" }, 404);
    }
  }
}

export class NotionPage {
  private notion: NotionAPI;
  private pageRegex = /^\/page\/(.+)$/;
  private imageRegex = /^\/image\/([^\/]+)\/([^\/]+)$/;

  constructor(public state: DurableObjectState, private env: AppEnv) {
    this.notion = new NotionAPI();
  }

  async alarm() {
    const page = await this.state.storage.get<PageData>("page");
    const imageQueue = await this.state.storage.get<Map<string, string>>("imageQueue");
    if (!page || !imageQueue || !imageQueue.size) return;

    for (const [filename, url] of imageQueue) {
      if (url === "") continue;
      imageQueue.set(filename, "");

      try {
        const response = await fetch(url, {
          redirect: "follow",
        });
        if (!response.ok) throw new Error("error " + response.status + ": " + await response.text());

        const body = await response.arrayBuffer();

        const httpMetadata = new Headers();
        httpMetadata.set(
          "content-type",
          filename.endsWith(".png") ? "image/png" :
            filename.endsWith(".jpg") ? "image/jpeg" :
              filename.endsWith(".webp") ? "image/webp" :
                "application/octet-stream");

        await this.env.DATA_BUCKET.put(`image/${page.id}/${filename}`, body, {
          httpMetadata,
        })
      } catch (e) {
        console.log(`image fetch failed: ${e} ` + JSON.stringify({ pageId: page.id, filename, url }));
      }
      break;
    }

    if ([...imageQueue.values()].findIndex(x => x !== "") != -1) {
      this.state.storage.setAlarm(1);
    }
    await this.state.storage.put("imageQueue", imageQueue);
  }

  private async preparePage(pageId: string): Promise<PageData> {
    const recordMap = await this.notion.getPage(pageId);
    let rendered: string;
    try {
      /*rendered = "<pre>" + JSON.stringify(recordMap, null, 2)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;") + "</pre>";*/
      rendered = ReactDOMServer.renderToString(React.createElement(ContentRenderer, { content: recordMap }));
    } catch (e) {
      console.log((e as any).stack);
      rendered = "";
    }

    const imageQueue = new Map<string, string>();
    const imgSrcReplaceRegex = / src="([^\"]+)"/g;

    const newHtml = rendered.replace(imgSrcReplaceRegex, (match, escapedSrc) => {
      const src = escapedSrc.replaceAll("&amp;", '&');
      let url: URL;
      try {
        url = new URL(src);
      } catch (e) {
        return match;
      }

      const key = (url.origin + url.pathname).toLowerCase();
      let fileType: string;

      if (key.endsWith(".png")) {
        fileType = "png";
      } else if (key.endsWith(".jpg") || key.endsWith(".jpeg")) {
        fileType = "jpg";
      } else if (key.endsWith(".webp")) {
        fileType = "webp";
      } else {
        return match;
      }

      const hash = blake.blake2bHex(key, undefined, 32);
      const filename = `${hash}.${fileType}`;

      if (!imageQueue.has(filename)) {
        imageQueue.set(filename, src);
      }
      return ` src="${this.env.PRIMARY_ORIGIN || ""}/image/${pageId}/${filename}"`
    })

    const r2Path = `page/${pageId}.html`;
    const r2JsonPath = `page/${pageId}.json`;
    await this.env.DATA_BUCKET.put(r2Path, newHtml);
    await this.env.DATA_BUCKET.put(r2JsonPath, JSON.stringify(recordMap));

    const page: PageData = {
      id: pageId,
      r2Path,
      r2JsonPath,
      title: extractPageTitle(recordMap),
    };
    if (imageQueue.size) {
      this.state.storage.put("imageQueue", imageQueue);
      this.state.storage.setAlarm(1);
    }
    await this.state.storage.put("page", page); // atomically
    return page;
  }

  private async loadContent(pageId: string, refresh: boolean): Promise<PageData> {
    const existingPage = await this.state.storage.get<PageData>("page");
    if (existingPage) {
      if (refresh) await this.state.storage.deleteAlarm();
      else return existingPage;
    }

    // Load data
    const page = await this.state.blockConcurrencyWhile(() => this.preparePage(pageId));
    return page;
  }

  // Handle HTTP requests from clients.
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let match: RegExpExecArray | null = null;
    if ((match = this.pageRegex.exec(url.pathname)) !== null) {
      const pageId = match[1];
      const page = await this.loadContent(pageId, url.searchParams.get("refresh") === "1");
      return mkJsonResponse(page);
    } else if ((match = this.imageRegex.exec(url.pathname)) !== null) {
      const pageId = match[1];
      const filename = match[2];
      const q = await this.state.storage.get<Map<string, string>>("imageQueue");
      const entry = q ? q.get(filename) : undefined;
      if (entry === undefined) return new Response("image not found", { status: 404 });
      return new Response(null, { status: 200 });
    } else {
      return mkJsonResponse({ error: "dobj routing failed" }, 404);
    }
  }
}

function mkJsonResponse(x: unknown, status: number = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(x), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    }
  });
}

function extractPageTitle(recordMap: ExtendedRecordMap): string | undefined {
  for (const block of Object.values(recordMap.block)) {
    const v = block.value;
    if (v.type === "page") {
      const title = v.properties?.title || [];
      return title.map(x => x[0]).join("");
    }
  }
  return undefined;
}