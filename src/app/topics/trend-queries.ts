import { sql } from "drizzle-orm";

type Db = any;

export async function getTopTopics(db: Db, opts: { date: string }) {
  const res = await db.execute(sql`
    SELECT t.id, t.label, tt.item_count AS "itemCount", tt.score_sum AS "scoreSum"
    FROM topic_trends tt JOIN topics t ON t.id = tt.topic_id
    WHERE tt.bucket_date = ${opts.date}
    ORDER BY tt.score_sum DESC LIMIT 20
  `);
  return (res.rows ?? res) as any[];
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
    WHERE it.topic_id = ${id} AND i.is_archived = false
    ORDER BY i.created_at DESC LIMIT 100
  `);
  return (res.rows ?? res) as any[];
}
