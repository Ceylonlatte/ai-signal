import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { RawPayload, SourceKind } from "../types.js";

interface RedditRaw {
  id: string; title: string; subreddit: string; author: string;
  score: number; comments: number; url: string; created_utc: number; selftext: string;
}
interface TwitterRaw {
  id: string; text: string; author: string; url: string;
  created_at: string; likes?: number; retweets?: number;
}

function jobTs(dirName: string): number {
  const m = dirName.match(/-(\d+)$/);
  return m ? Number(m[1]) : 0;
}

function mapReddit(r: RedditRaw): RawPayload {
  return {
    source: "reddit", externalId: r.id, url: r.url, author: r.author,
    title: r.title, text: r.selftext ?? "",
    createdAt: new Date(r.created_utc * 1000).toISOString(),
    metrics: { score: r.score, comments: r.comments }, raw: r,
  };
}
function mapTwitter(t: TwitterRaw): RawPayload {
  return {
    source: "twitter", externalId: t.id, url: t.url, author: t.author,
    title: t.text.slice(0, 120), text: t.text,
    createdAt: new Date(t.created_at).toISOString(),
    metrics: { likes: t.likes ?? 0, retweets: t.retweets ?? 0 }, raw: t,
  };
}

interface Args { root: string; source: SourceKind; subdir: string; sinceTs: number; }

export function readDigestSince(args: Args): { payloads: RawPayload[]; cursor: number } {
  const jobs = existsSync(args.root)
    ? readdirSync(args.root).filter((d) => jobTs(d) > args.sinceTs).sort((a, b) => jobTs(a) - jobTs(b))
    : [];
  const payloads: RawPayload[] = [];
  let cursor = args.sinceTs;
  for (const job of jobs) {
    const file = join(args.root, job, "raw", args.subdir, "items.json");
    if (!existsSync(file)) continue;
    const arr = JSON.parse(readFileSync(file, "utf8")) as unknown[];
    for (const raw of arr) {
      payloads.push(args.source === "reddit" ? mapReddit(raw as RedditRaw) : mapTwitter(raw as TwitterRaw));
    }
    cursor = Math.max(cursor, jobTs(job));
  }
  return { payloads, cursor };
}
