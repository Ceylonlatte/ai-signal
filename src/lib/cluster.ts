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

// Bound LLM label calls per cluster run; catch-up over old topics happens
// across runs instead of stalling one run on hundreds of calls.
const RELABEL_BATCH = 10;

// Re-label topics whose membership clearly outgrew the last labeling
// (label_n = 0 means never labeled from members). The LLM sees the topic's
// top-scored member titles, so the label names the shared event ("Claude
// Fable 5 发布") instead of the most frequent generic tag ("Anthropic").
async function relabelGrownTopics(db: Db): Promise<number> {
  const due = await db.execute(sql`
    SELECT t.id, count(it.item_id)::int AS n
    FROM topics t
    JOIN item_topics it ON it.topic_id = t.id
    GROUP BY t.id
    HAVING count(it.item_id) >= t.label_n + 3 OR count(it.item_id) >= t.label_n * 2
    ORDER BY max(t.last_seen) DESC
    LIMIT ${RELABEL_BATCH}
  `);
  const list = (due.rows ?? due) as Array<{ id: number; n: number }>;
  let relabeled = 0;

  for (const topic of list) {
    const res = await db.execute(sql`
      SELECT coalesce(nullif(s.title_zh, ''), i.title) AS title
      FROM item_topics it
      JOIN items i ON i.id = it.item_id
      LEFT JOIN scores s ON s.item_id = i.id
      WHERE it.topic_id = ${Number(topic.id)}
      ORDER BY s.composite DESC NULLS LAST
      LIMIT 8
    `);
    const titles = ((res.rows ?? res) as Array<{ title: string }>).map((r) => r.title);
    if (titles.length === 0) continue;
    try {
      const label = await labelTopic(titles);
      await db.execute(sql`
        UPDATE topics SET label = ${label}, label_n = ${Number(topic.n)}
        WHERE id = ${Number(topic.id)}
      `);
      relabeled++;
    } catch (err) {
      console.error(`relabel topic ${topic.id} failed`, err);
    }
  }
  return relabeled;
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
        INSERT INTO topics (label, centroid, label_n) VALUES (${label}, ${row.embedding}::vector, 1) RETURNING id
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
  const relabeled = await relabelGrownTopics(db);
  return assigned + relabeled;
}
