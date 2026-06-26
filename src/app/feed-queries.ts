import { sql, type SQL } from "drizzle-orm";
import { config } from "../config.js";
import { platformHeat, hoursSince } from "../lib/scoring/platform-heat.js";
import { sourceTrust } from "../lib/sources/trust.js";
import { computeRanking } from "../lib/scoring/ranking.js";
import {
  likeAffinity,
  dislikeAffinity,
  isSuppressed,
} from "../lib/feedback/profile.js";

type Db = any;

interface Row {
  id: number;
  title: string;
  titleZh: string;
  url: string | null;
  source: string;
  externalId: string | null;
  author: string | null;
  createdAt: string;
  metrics: Record<string, number>;
  q: number;
  novelty: number;
  summaryZh: string;
  summaryEn: string;
  topicTags: unknown;
  reason: string;
  signal: "up" | "down" | null;
  isFavorited: boolean;
  maxLikeSim: number | null;
  maxDislikeSim: number | null;
  nUp: number;
  nDown: number;
}

// Personal-scale safety cap: rank at most this many rows in-app before paging.
const MAX_CANDIDATES = 2000;

// Main feed platforms. RSS keeps its separate surface and is excluded from `all`.
const MAIN_FEED_SOURCES = ["hn", "reddit", "twitter"] as const;

export type FeedSort = "time" | "score";
export type FeedSource = "all" | (typeof MAIN_FEED_SOURCES)[number];

export function normalizeFeedSource(
  source: string | null | undefined,
): FeedSource {
  return source === "hn" || source === "reddit" || source === "twitter"
    ? source
    : "all";
}

function sourceFilter(source: FeedSource) {
  return source === "all"
    ? sql`i.source IN ('hn', 'reddit', 'twitter')`
    : sql`i.source = ${source}`;
}

async function candidates(db: Db, cap: number, where: SQL): Promise<Row[]> {
  const win = `${config.PROFILE_WINDOW_DAYS} days`;
  const res = await db.execute(sql`
    WITH up AS (
      SELECT count(*)::int AS n FROM feedback
      WHERE signal = 'up' AND created_at > now() - ${win}::interval
    ), down AS (
      SELECT count(*)::int AS n FROM feedback
      WHERE signal = 'down' AND created_at > now() - ${win}::interval
    )
    SELECT i.id, i.title, s.title_zh AS "titleZh", i.url, i.source, ri.external_id AS "externalId",
           i.author AS "author",
           i.is_favorited AS "isFavorited",
           i.created_at AS "createdAt", i.metrics,
           s.composite AS q, s.novelty, s.summary_zh AS "summaryZh", s.summary_en AS "summaryEn",
           s.topic_tags AS "topicTags", s.reason,
           (SELECT f.signal FROM feedback f WHERE f.item_id = i.id
              ORDER BY f.created_at DESC LIMIT 1) AS "signal",
           (SELECT 1 - MIN(le.embedding <=> e.embedding)
              FROM item_embeddings le JOIN feedback f ON f.item_id = le.item_id
              WHERE f.signal = 'up' AND f.created_at > now() - ${win}::interval) AS "maxLikeSim",
           (SELECT 1 - MIN(de.embedding <=> e.embedding)
              FROM item_embeddings de JOIN feedback f ON f.item_id = de.item_id
              WHERE f.signal = 'down' AND f.created_at > now() - ${win}::interval) AS "maxDislikeSim",
           (SELECT n FROM up) AS "nUp",
           (SELECT n FROM down) AS "nDown"
    FROM items i
    JOIN scores s ON s.item_id = i.id
    LEFT JOIN raw_items ri ON ri.id = i.raw_item_id
    LEFT JOIN item_embeddings e ON e.item_id = i.id
    WHERE ${where}
    ORDER BY i.created_at DESC
    LIMIT ${cap}
  `);
  return (res.rows ?? res) as Row[];
}

type Ranked = Row & { r: number };

// Attach the live ranking score `r` to each row (imposes no ordering itself).
function withRanking(rows: Row[]): Ranked[] {
  const now = new Date();
  return rows.map((row) => {
    const hours = hoursSince(new Date(row.createdAt), now);
    const heat = platformHeat({
      source: row.source,
      metrics: row.metrics ?? {},
      hours,
      trust: sourceTrust(row.source, row.url),
    });
    const aff = likeAffinity(row.maxLikeSim, Number(row.nUp ?? 0));
    const disaff = dislikeAffinity(row.maxDislikeSim, Number(row.nDown ?? 0));
    const r = computeRanking({
      q: row.q ?? 0,
      platformHeat: heat,
      novelty: row.novelty ?? 0,
      likeAffinity: aff,
      dislikeAffinity: disaff,
    });
    return { ...row, r };
  });
}

const byScore = (a: Ranked, b: Ranked): number => b.r - a.r;
const byTime = (a: Ranked, b: Ranked): number =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

function ranked(rows: Row[]): Ranked[] {
  return withRanking(rows).sort(byScore);
}

export interface FeedPage {
  items: Ranked[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sort: FeedSort;
  source: FeedSource;
  // Ranking-score bounds across the whole visible set (not just this page), so
  // strength tiers stay stable and comparable as infinite scroll appends pages.
  rMin: number;
  rMax: number;
}

// Ranks the whole (non-suppressed) candidate set, orders it by the requested
// sort (recency by default, ranking score on demand), and returns one page.
export async function getFeed(
  db: Db,
  opts: { page?: number; pageSize?: number; sort?: FeedSort; source?: string },
): Promise<FeedPage> {
  const sort: FeedSort = opts.sort === "score" ? "score" : "time";
  const source = normalizeFeedSource(opts.source);
  const pageSize = Math.max(1, opts.pageSize ?? 30);
  const rows = await candidates(db, MAX_CANDIDATES, sourceFilter(source));
  const visible = rows.filter((row) => !isSuppressed(row.maxDislikeSim));
  const all = withRanking(visible).sort(sort === "score" ? byScore : byTime);
  const total = all.length;
  const rs = all.map((row) => row.r);
  const rMin = rs.length ? Math.min(...rs) : 0;
  const rMax = rs.length ? Math.max(...rs) : 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, opts.page ?? 1), totalPages);
  const start = (page - 1) * pageSize;
  return {
    items: all.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages,
    sort,
    source,
    rMin,
    rMax,
  };
}

// Per-platform item volumes for the feed toolbar's filter chips. A light
// grouped count over scored items (pre-suppression — these are headline volumes,
// not the exact post-filter total the feed renders), with `all` as the sum of
// the three main sources. RSS lives on its own surface and isn't counted here.
export async function getSourceCounts(
  db: Db,
): Promise<Record<FeedSource, number>> {
  const res = await db.execute(sql`
    SELECT i.source AS source, count(*)::int AS n
    FROM items i JOIN scores s ON s.item_id = i.id
    WHERE i.source IN ('hn', 'reddit', 'twitter')
    GROUP BY i.source
  `);
  const rows = (res.rows ?? res) as { source: string; n: number }[];
  const counts: Record<FeedSource, number> = { all: 0, hn: 0, reddit: 0, twitter: 0 };
  for (const row of rows) {
    if (row.source === "hn" || row.source === "reddit" || row.source === "twitter") {
      counts[row.source] = Number(row.n);
    }
  }
  counts.all = counts.hn + counts.reddit + counts.twitter;
  return counts;
}

// Items clustered into a topic, ranked like the main feed so the topic page can
// reuse the signal-flow cards (score, summary, vote). Newest-first to match the
// feed's default; rMin/rMax bound the topic's own items so strength reads stable.
export async function getTopicFeed(
  db: Db,
  topicId: number,
): Promise<{ items: Ranked[]; rMin: number; rMax: number }> {
  const rows = await candidates(
    db,
    100,
    sql`i.id IN (SELECT item_id FROM item_topics WHERE topic_id = ${topicId})`,
  );
  const all = withRanking(rows).sort(byTime);
  const rs = all.map((row) => row.r);
  const rMin = rs.length ? Math.min(...rs) : 0;
  const rMax = rs.length ? Math.max(...rs) : 0;
  return { items: all, rMin, rMax };
}

export async function getSuppressed(db: Db, opts: { limit: number }) {
  const rows = await candidates(
    db,
    Math.max(opts.limit * 6, 300),
    sourceFilter("all"),
  );
  const hidden = rows.filter((row) => isSuppressed(row.maxDislikeSim));
  return ranked(hidden).slice(0, opts.limit);
}

export interface FavoriteRow {
  id: number;
  title: string;
  titleZh: string;
  url: string | null;
  source: string;
  author: string | null;
  createdAt: string;
  favoritedAt: string | null;
  summaryZh: string;
  status: string | null;
  note: unknown;
}

// Items the user ⭐ saved to the knowledge base, newest-favorite first. Joins the
// kb_entry (may be null while the worker is still processing) for card preview.
export async function getFavorites(
  db: Db,
  opts: { limit: number },
): Promise<FavoriteRow[]> {
  const res = await db.execute(sql`
    SELECT i.id::int AS id, i.title, s.title_zh AS "titleZh", i.url, i.source, i.author AS "author",
           i.created_at AS "createdAt", i.favorited_at AS "favoritedAt",
           s.summary_zh AS "summaryZh",
           k.status AS "status", k.note AS "note"
    FROM items i
    LEFT JOIN scores s ON s.item_id = i.id
    LEFT JOIN kb_entries k ON k.item_id = i.id
    WHERE i.is_favorited = true
    ORDER BY i.favorited_at DESC NULLS LAST
    LIMIT ${opts.limit}
  `);
  return (res.rows ?? res) as FavoriteRow[];
}
