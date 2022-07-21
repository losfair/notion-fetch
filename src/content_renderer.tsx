import { Block, Decoration, ExtendedRecordMap } from "notion-types";
import React from "react";
import { defaultMapImageUrl } from "react-notion-x";

export function ContentRenderer({ content }: { content: ExtendedRecordMap }) {
  return (
    <BlockRenderer content={content} block={Object.values(content.block)[0].value} />
  )
}

function BlockRenderer({ content, block }: { content: ExtendedRecordMap, block: Block }) {
  switch (block.type) {
    case "page": return <div>{genChildren(content, block.content)}</div>
    case "text": return <p>{genTitle(block.properties?.title)}</p>
    case "sub_header": return <h2>{genTitle(block.properties?.title)}</h2>
    case "sub_sub_header": return <h3>{genTitle(block.properties?.title)}</h3>
    case "bulleted_list":
    case "numbered_list":
      return <li>{genTitle(block.properties?.title)}{genChildren(content, block.content)}</li>
    case "code": return <pre>{genTitle(block.properties?.title)}</pre>
    case "image": return <img
      src={defaultMapImageUrl(block.properties.source[0][0], block) || block.properties.source[0][0]}
      alt={block.properties.caption?.map(x => x[0]).join("") || undefined}
      width={block.format?.block_width}
      height={block.format ? block.format.block_width * block.format.block_aspect_ratio : undefined} />
    default: return <pre>{JSON.stringify(block)}</pre>;
  }
}

function genTitle(title: Decoration[] | undefined): React.ReactNode[] {
  return (title || []).map(([text, props], i) => props ? React.createElement(transformTagName(props[0][0]), { key: "title-" + i, children: text }) : <span key={"title-" + i}>{text}</span>);
}

function transformTagName(tagName: string): string {
  if (tagName == "c") return "code";
  return tagName;
}

function genChildren(content: ExtendedRecordMap, children: string[] | undefined) {
  children = children || [];
  const ulMerge = mergeList(content, children, "bulleted_list", "ul");
  const olMerge = mergeList(content, ulMerge, "numbered_list", "ol");
  const merged = olMerge;
  return merged.map((x, i) => typeof x === "object" ? <ListEntryRenderer key={"child-" + i} content={content} entry={x} /> : <BlockRenderer key={"child-" + i} content={content} block={content.block[x].value} />);
}

function ListEntryRenderer({ content, entry }: {
  content: ExtendedRecordMap, entry: {
    tag: string,
    children: string[],
  }
}) {
  return React.createElement(entry.tag, {
    children: entry.children.map((x, i) => <BlockRenderer key={"child-" + i} content={content} block={content.block[x].value} />)
  });
}

type ListEntry = {
  tag: string,
  children: string[],
} | string;

function mergeList(content: ExtendedRecordMap, children: ListEntry[], blockType: string, outerTag: string): ListEntry[] {
  let currentList: string[] = [];
  let outputList: ListEntry[] = [];

  for (const child of children) {
    const childIsString = typeof child === "string";
    const block = childIsString ? content.block[child].value : null;
    if (childIsString && block?.type === blockType) {
      currentList.push(child);
    } else {
      if (currentList.length) outputList.push({ tag: outerTag, children: currentList });
      currentList = [];
      outputList.push(child);
    }
  }

  if (currentList.length) outputList.push({ tag: outerTag, children: currentList });
  return outputList;
}