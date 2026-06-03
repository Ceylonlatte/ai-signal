import { sql } from "drizzle-orm";
import { topics, itemTopics } from "../db/schema.js";
import { labelTopic } from "./scoring/llm.js";

type Db = any;

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
      await db.execute(sql`UPDATE topics SET last_seen = now() WHERE id = ${topicId}`);
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
    assigned++;
  }
  return assigned;
}
