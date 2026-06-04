import type { RawPayload, SourceKind } from "../../types.js";

interface RedditRaw {
  id?: string; postId?: string; title?: string; author?: string | null;
  score?: number; ups?: number; comments?: number; num_comments?: number;
  url?: string | null; created_utc?: number; selftext?: string;
}
interface TwitterRaw {
  id?: string; text?: string; author?: string | null; url?: string | null;
  created_at?: string; likes?: number; retweets?: number; replies?: number;
}

// Tweets have no title, but items.title is NOT NULL — synthesize a short
// headline. Collapse whitespace, cap at ~120 code points on a word boundary,
// add an ellipsis, and never split an emoji (surrogate pair).
export function tweetTitle(text: string): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  const chars = Array.from(s); // code points → never splits a surrogate pair
  if (chars.length <= 120) return s;
  let cut = chars.slice(0, 120).join("");
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace >= 80) cut = cut.slice(0, lastSpace);
  return cut.trimEnd() + "…";
}

function mapRedditItem(r: RedditRaw, feed?: string): RawPayload | null {
  const externalId = r.id ?? r.postId;
  const title = (r.title ?? "").trim();
  if (!externalId || !title) return null;
  return {
    source: "reddit",
    externalId,
    url: r.url ?? null,
    author: r.author ?? null,
    title,
    text: r.selftext ?? "",
    createdAt: new Date((r.created_utc ?? 0) * 1000).toISOString(),
    metrics: { score: r.score ?? r.ups ?? 0, comments: r.comments ?? r.num_comments ?? 0 },
    ...(feed ? { feed } : {}),
    raw: r,
  };
}

function mapTwitterItem(t: TwitterRaw, feed?: string): RawPayload | null {
  const externalId = t.id;
  const text = (t.text ?? "").trim();
  if (!externalId || !text) return null;
  const d = t.created_at ? new Date(t.created_at) : new Date(NaN);
  return {
    source: "twitter",
    externalId,
    url: t.url ?? null,
    author: t.author ?? null,
    title: tweetTitle(text),
    text,
    createdAt: isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(),
    metrics: { likes: t.likes ?? 0, retweets: t.retweets ?? 0, replies: t.replies ?? 0 },
    ...(feed ? { feed } : {}),
    raw: t,
  };
}

export function mapDigestItems(
  source: SourceKind,
  feed: string | undefined,
  items: unknown[],
): RawPayload[] {
  const out: RawPayload[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const mapped =
      source === "reddit" ? mapRedditItem(raw as RedditRaw, feed)
      : source === "twitter" ? mapTwitterItem(raw as TwitterRaw, feed)
      : null;
    if (mapped) out.push(mapped);
  }
  return out;
}
