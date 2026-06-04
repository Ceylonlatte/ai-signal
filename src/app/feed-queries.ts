import { sql } from "drizzle-orm";
import { platformHeat, hoursSince } from "../lib/scoring/platform-heat.js";
import { sourceTrust } from "../lib/sources/trust.js";
import { computeRanking } from "../lib/scoring/ranking.js";

type Db = any;

interface Row {
  id: number; title: string; titleZh: string; url: string | null; source: string;
  createdAt: string; metrics: Record<string, number>;
  q: number; novelty: number; summaryZh: string; summaryEn: string;
  topicTags: unknown; reason: string;
  maxLikeSim: number | null; maxDislikeSim: number | null; nUp: number;
}

// Pull recent kept items. M1: feedback similarities are 0/null (wired in a later task).
export async function getFeedCandidates(db: Db, opts: { limit: number }): Promise<Row[]> {
  const res = await db.execute(sql`
    SELECT i.id, i.title, s.title_zh AS "titleZh", i.url, i.source,
           i.created_at AS "createdAt", i.metrics,
           s.composite AS q, s.novelty, s.summary_zh AS "summaryZh", s.summary_en AS "summaryEn",
           s.topic_tags AS "topicTags", s.reason,
           NULL::float8 AS "maxLikeSim", NULL::float8 AS "maxDislikeSim", 0::int AS "nUp"
    FROM items i
    JOIN scores s ON s.item_id = i.id
    WHERE i.is_archived = false
    ORDER BY i.created_at DESC
    LIMIT ${Math.max(opts.limit * 6, 300)}
  `);
  return (res.rows ?? res) as Row[];
}

function rank(rows: Row[]): Array<Row & { r: number }> {
  const now = new Date();
  return rows.map((row) => {
    const hours = hoursSince(new Date(row.createdAt), now);
    const heat = platformHeat({
      source: row.source, metrics: row.metrics ?? {}, hours,
      trust: sourceTrust(row.source, row.url),
    });
    const r = computeRanking({ q: row.q ?? 0, platformHeat: heat, novelty: row.novelty ?? 0, likeAffinity: 0 });
    return { ...row, r };
  }).sort((a, b) => b.r - a.r);
}

export async function getFeed(db: Db, opts: { limit: number }) {
  const rows = await getFeedCandidates(db, opts);
  return rank(rows).slice(0, opts.limit);
}
