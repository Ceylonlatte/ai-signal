import type { RawPayload, SourceKind } from "../../types.js";

interface RedditRaw {
  id?: string; postId?: string; title?: string; author?: string | null;
  score?: number; ups?: number; comments?: number; num_comments?: number;
  url?: string | null; created_utc?: number; selftext?: string;
}

// New `reddit_discussion.v1` document from opencli-reddit-digest: the post body
// plus the full comment tree. We map the post into a RawPayload and keep the
// whole document under `raw`, so the comment tree survives into
// raw_items.payload.raw for the KB stage (no extra fetch needed).
interface RedditDiscussionDoc {
  schema_version?: string;
  source?: { feed?: string | null } | null;
  post?: {
    id?: string | null; title?: string | null; subreddit?: string | null;
    author?: string | null; score?: number | null; num_comments?: number | null;
    created_utc?: number | null; url?: string | null; external_url?: string | null;
    selftext?: string | null;
  } | null;
  discussion?: unknown;
}

function isDiscussionDoc(r: unknown): r is RedditDiscussionDoc {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return o.schema_version === "reddit_discussion.v1" || typeof o.post === "object";
}

function mapRedditDiscussion(doc: RedditDiscussionDoc, feed?: string): RawPayload | null {
  const post = doc.post;
  const externalId = post?.id ?? undefined;
  const title = (post?.title ?? "").trim();
  if (!externalId || !title) return null;
  const created = typeof post?.created_utc === "number" && isFinite(post.created_utc)
    ? new Date(post.created_utc * 1000)
    : new Date(NaN);
  return {
    source: "reddit",
    externalId,
    url: post?.url ?? null,
    author: post?.author ?? null,
    title,
    // Comments live in `raw.discussion`; items.text stays the post body only so
    // scoring/embedding/relevance are unaffected by the discussion.
    text: post?.selftext ?? "",
    createdAt: isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString(),
    metrics: { score: post?.score ?? 0, comments: post?.num_comments ?? 0 },
    ...(doc.source?.feed ? { feed: doc.source.feed } : feed ? { feed } : {}),
    raw: doc,
  };
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
  if (isDiscussionDoc(r)) return mapRedditDiscussion(r, feed);
  const externalId = r.id ?? r.postId;
  const title = (r.title ?? "").trim();
  if (!externalId || !title) return null;
  const created = typeof r.created_utc === "number" && isFinite(r.created_utc)
    ? new Date(r.created_utc * 1000)
    : new Date(NaN);
  return {
    source: "reddit",
    externalId,
    url: r.url ?? null,
    author: r.author ?? null,
    title,
    text: r.selftext ?? "",
    createdAt: isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString(),
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
