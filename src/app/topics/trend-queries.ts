import { sql } from "drizzle-orm";

type Db = any;

// Online clustering splits one event into several nearby clusters, which used
// to show up as duplicate rows ("Anthropic" twice). Greedily merge today's
// topics whose centroids are within MERGE_DIST (tighter than the 0.25
// assignment threshold) or whose labels collide, then rank the merged groups.
const MERGE_DIST = 0.2;
const FETCH_LIMIT = 40;
const RETURN_LIMIT = 20;

function cosineDist(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 1;
  return 1 - dot / Math.sqrt(na * nb);
}

export type TopTopic = {
  id: number;
  label: string;
  itemCount: number;
  scoreSum: number;
  topTitle: string | null;
};

export async function getTopTopics(db: Db, opts: { date: string }): Promise<TopTopic[]> {
  const res = await db.execute(sql`
    SELECT t.id, t.label, t.centroid,
           tt.item_count AS "itemCount", tt.score_sum AS "scoreSum",
           rep.title AS "topTitle"
    FROM topic_trends tt
    JOIN topics t ON t.id = tt.topic_id
    LEFT JOIN LATERAL (
      SELECT coalesce(nullif(s.title_zh, ''), i.title) AS title
      FROM item_topics it
      JOIN items i ON i.id = it.item_id
      LEFT JOIN scores s ON s.item_id = i.id
      WHERE it.topic_id = t.id
      ORDER BY s.composite DESC NULLS LAST
      LIMIT 1
    ) rep ON true
    WHERE tt.bucket_date = ${opts.date}
    ORDER BY tt.score_sum DESC LIMIT ${FETCH_LIMIT}
  `);
  const rows = (res.rows ?? res) as any[];

  type Group = TopTopic & { vec: number[]; labelKey: string };
  const groups: Group[] = [];
  for (const r of rows) {
    const vec = JSON.parse(r.centroid) as number[];
    const labelKey = String(r.label).trim().toLowerCase();
    const itemCount = Number(r.itemCount) || 0;
    const scoreSum = Number(r.scoreSum) || 0;
    // Rows arrive score-desc, so the group keeper is always its hottest topic.
    const hit = groups.find((g) => g.labelKey === labelKey || cosineDist(g.vec, vec) < MERGE_DIST);
    if (hit) {
      hit.itemCount += itemCount;
      hit.scoreSum += scoreSum;
    } else {
      groups.push({
        id: Number(r.id), label: r.label, itemCount, scoreSum,
        topTitle: r.topTitle ?? null, vec, labelKey,
      });
    }
  }
  return groups.slice(0, RETURN_LIMIT).map(({ vec: _v, labelKey: _k, ...rest }) => rest);
}

export async function getTopic(db: Db, id: number) {
  const res = await db.execute(sql`SELECT id, label FROM topics WHERE id = ${id}`);
  return ((res.rows ?? res)[0] ?? null) as { id: number; label: string } | null;
}

// Items actually clustered into this topic (via item_topics), newest first.
// Uses the precise membership table — no re-embedding the label, no language gap.
export async function topicItems(db: Db, id: number) {
  const res = await db.execute(sql`
    SELECT i.id, coalesce(nullif(s.title_zh, ''), i.title) AS title,
           i.url, i.source, i.created_at AS "createdAt"
    FROM item_topics it
    JOIN items i ON i.id = it.item_id
    LEFT JOIN scores s ON s.item_id = i.id
    WHERE it.topic_id = ${id}
    ORDER BY i.created_at DESC LIMIT 100
  `);
  return (res.rows ?? res) as any[];
}
