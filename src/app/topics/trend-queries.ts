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
