import { sql } from "drizzle-orm";
import { topics, itemTopics } from "../db/schema.js";
import { labelTopic } from "./scoring/llm.js";

type Db = any;

// pgvector renders a stored vector as the text "[1,2,3]", which is valid JSON.
const parseVec = (s: string): number[] => JSON.parse(s) as number[];

// Fold a new member's embedding into a topic's centroid as a running mean, so
// the center tracks its members instead of staying frozen at the first item's
// vector. `n` is the member count BEFORE this item is linked.
async function foldIntoCentroid(db: Db, topicId: number, embedding: string): Promise<void> {
  const cur = await db.execute(sql`
    SELECT t.centroid, (SELECT count(*)::int FROM item_topics WHERE topic_id = t.id) AS n
    FROM topics t WHERE t.id = ${topicId}
  `);
  const row = (cur.rows ?? cur)[0] as { centroid: string; n: number } | undefined;
  if (!row) return;
  const c = parseVec(row.centroid);
  const e = parseVec(embedding);
  const n = Number(row.n);
  const merged = c.map((x, i) => (x * n + (e[i] ?? 0)) / (n + 1));
  await db.execute(sql`
    UPDATE topics SET centroid = ${JSON.stringify(merged)}::vector, last_seen = now()
    WHERE id = ${topicId}
  `);
}

// Online clustering: for each unassigned item, find nearest topic centroid;
// if cosine distance < threshold join it, else create a new topic.
export async function runClusterStage(db: Db, opts: { threshold: number }): Promise<number> {
  const rows = await db.execute(sql`
    SELECT e.item_id, e.embedding, i.title
    FROM item_embeddings e
    JOIN items i ON i.id = e.item_id
    LEFT JOIN item_topics it ON it.item_id = e.item_id
    WHERE it.item_id IS NULL
    ORDER BY i.created_at ASC
    LIMIT 200
  `);
  const list = (rows.rows ?? rows) as Array<{ item_id: number; embedding: string; title: string }>;
  let assigned = 0;

  for (const row of list) {
    const nearest = await db.execute(sql`
      SELECT id, centroid <=> ${row.embedding}::vector AS dist
      FROM topics ORDER BY dist ASC LIMIT 1
    `);
    const near = (nearest.rows ?? nearest)[0] as { id: number; dist: number } | undefined;

    let topicId: number;
    if (near && near.dist < opts.threshold) {
      topicId = Number(near.id);
      await foldIntoCentroid(db, topicId, row.embedding);
    } else {
      const label = await labelTopic([row.title]);
      const created = await db.execute(sql`
        INSERT INTO topics (label, centroid) VALUES (${label}, ${row.embedding}::vector) RETURNING id
      `);
      topicId = Number(((created.rows ?? created)[0] as { id: number }).id);
    }
    await db.insert(itemTopics)
      .values({ itemId: Number(row.item_id), topicId, weight: 1 })
      .onConflictDoNothing({ target: [itemTopics.itemId, itemTopics.topicId] });
    const day = new Date().toISOString().slice(0, 10);
    await db.execute(sql`
      INSERT INTO topic_trends (topic_id, bucket_date, item_count, score_sum)
      VALUES (${topicId}, ${day}, 1, COALESCE((SELECT composite FROM scores WHERE item_id = ${Number(row.item_id)}), 0))
      ON CONFLICT (topic_id, bucket_date)
      DO UPDATE SET item_count = topic_trends.item_count + 1,
                    score_sum = topic_trends.score_sum + EXCLUDED.score_sum
    `);
    assigned++;
  }
  return assigned;
}
