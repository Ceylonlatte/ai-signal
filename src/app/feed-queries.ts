import { sql } from "drizzle-orm";
import { config } from "../config.js";
import { platformHeat, hoursSince } from "../lib/scoring/platform-heat.js";
import { sourceTrust } from "../lib/sources/trust.js";
import { computeRanking } from "../lib/scoring/ranking.js";
import { likeAffinity, isSuppressed } from "../lib/feedback/profile.js";

type Db = any;

interface Row {
  id: number; title: string; titleZh: string; url: string | null; source: string;
  author: string | null;
  createdAt: string; metrics: Record<string, number>;
  q: number; novelty: number; summaryZh: string; summaryEn: string;
  topicTags: unknown; reason: string;
  maxLikeSim: number | null; maxDislikeSim: number | null; nUp: number;
}

// Personal-scale safety cap: rank at most this many rows in-app before paging.
const MAX_CANDIDATES = 2000;

async function candidates(db: Db, cap: number): Promise<Row[]> {
  const win = `${config.PROFILE_WINDOW_DAYS} days`;
  const res = await db.execute(sql`
    WITH up AS (
      SELECT count(*)::int AS n FROM feedback
      WHERE signal = 'up' AND created_at > now() - ${win}::interval
    )
    SELECT i.id, i.title, s.title_zh AS "titleZh", i.url, i.source, i.author AS "author",
           i.created_at AS "createdAt", i.metrics,
           s.composite AS q, s.novelty, s.summary_zh AS "summaryZh", s.summary_en AS "summaryEn",
           s.topic_tags AS "topicTags", s.reason,
           (SELECT 1 - MIN(le.embedding <=> e.embedding)
              FROM item_embeddings le JOIN feedback f ON f.item_id = le.item_id
              WHERE f.signal = 'up' AND f.created_at > now() - ${win}::interval) AS "maxLikeSim",
           (SELECT 1 - MIN(de.embedding <=> e.embedding)
              FROM item_embeddings de JOIN feedback f ON f.item_id = de.item_id
              WHERE f.signal = 'down' AND f.created_at > now() - ${win}::interval) AS "maxDislikeSim",
           (SELECT n FROM up) AS "nUp"
    FROM items i
    JOIN scores s ON s.item_id = i.id
    LEFT JOIN item_embeddings e ON e.item_id = i.id
    WHERE i.is_archived = false
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
      source: row.source, metrics: row.metrics ?? {}, hours, trust: sourceTrust(row.source, row.url),
    });
    const aff = likeAffinity(row.maxLikeSim, Number(row.nUp ?? 0));
    const r = computeRanking({ q: row.q ?? 0, platformHeat: heat, novelty: row.novelty ?? 0, likeAffinity: aff });
    return { ...row, r };
  });
}

const byScore = (a: Ranked, b: Ranked): number => b.r - a.r;
const byTime = (a: Ranked, b: Ranked): number =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

function ranked(rows: Row[]): Ranked[] {
  return withRanking(rows).sort(byScore);
}

export type FeedSort = "time" | "score";

export interface FeedPage {
  items: Ranked[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sort: FeedSort;
}

// Ranks the whole (non-suppressed) candidate set, orders it by the requested
// sort (recency by default, ranking score on demand), and returns one page.
export async function getFeed(
  db: Db,
  opts: { page?: number; pageSize?: number; sort?: FeedSort },
): Promise<FeedPage> {
  const sort: FeedSort = opts.sort === "score" ? "score" : "time";
  const pageSize = Math.max(1, opts.pageSize ?? 30);
  const rows = await candidates(db, MAX_CANDIDATES);
  const visible = rows.filter((row) => !isSuppressed(row.maxDislikeSim));
  const all = withRanking(visible).sort(sort === "score" ? byScore : byTime);
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, opts.page ?? 1), totalPages);
  const start = (page - 1) * pageSize;
  return { items: all.slice(start, start + pageSize), total, page, pageSize, totalPages, sort };
}

export async function getSuppressed(db: Db, opts: { limit: number }) {
  const rows = await candidates(db, Math.max(opts.limit * 6, 300));
  const hidden = rows.filter((row) => isSuppressed(row.maxDislikeSim));
  return ranked(hidden).slice(0, opts.limit);
}
