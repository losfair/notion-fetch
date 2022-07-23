# notion-fetch

A Cloudflare Workers service that fetches and renders Notion pages as HTML, Markdown, or JSON. Powered by Durable Objects and R2.

## Usage

```
https://notion-fetch.univalent.net/[page-id].md
https://notion-fetch.univalent.net/[page-id].html
https://notion-fetch.univalent.net/[page-id].json
```

## Example

This example is from [react-notion-x's demo](https://react-notion-x-demo.transitivebullsh.it/0be6efce9daf42688f65c76b89f8eb27):

[Markdown](https://notion-fetch.univalent.net/0be6efce9daf42688f65c76b89f8eb27.md)
[HTML](https://notion-fetch.univalent.net/0be6efce9daf42688f65c76b89f8eb27.html)

## Image URL rewriting

Notion images are loaded from S3 with presigned URLs that have a time limit. So notion-fetch fetches all images on the page, uploads them to Cloudflare R2, and rewrites image URLs in your Notion pages to the one from the service's own domain.
