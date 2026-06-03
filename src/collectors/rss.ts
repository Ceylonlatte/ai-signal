import Parser from "rss-parser";
import type { RawPayload } from "../types.js";

const parser = new Parser();

export async function fetchRss(args: { url: string }): Promise<RawPayload[]> {
  const res = await fetch(args.url);
  if (!res.ok) throw new Error(`RSS ${args.url} ${res.status}`);
  const feed = await parser.parseString(await res.text());

  return (feed.items ?? [])
    .filter((i) => i.title && (i.guid || i.link))
    .map((i) => ({
      source: "rss" as const,
      externalId: i.guid ?? i.link!,
      url: i.link ?? null,
      author: i.creator ?? feed.title ?? null,
      title: i.title!,
      text: (i.contentSnippet ?? i.content ?? "").toString(),
      createdAt: new Date(i.isoDate ?? i.pubDate ?? Date.now()).toISOString(),
      metrics: {},
      raw: i,
    }));
}
