import { sql } from "drizzle-orm";
import { topics, itemTopics } from "../db/schema.js";
import { labelTopic, judgeSameTopic, type TopicSample } from "./scoring/llm.js";

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

// ─── Topic merge stage ───────────────────────────────────────────────────
// Online clustering is greedy and never revisits: items assigned while a
// centroid was young can leave one event fragmented across several topics
// ("Claude 重置用量" alone next to the Fable launch topic). This stage finds
// active near-centroid pairs, asks the LLM whether they cover the same story,
// and permanently merges confirmed pairs. Verdicts are remembered so each
// pair costs at most one judge call.

// Slightly above the 0.25 assignment threshold: fragments drift back within
// reach as centroids stabilize, and the LLM judge guards against bad merges.
const MERGE_CAND_DIST = 0.28;
const MERGE_PAIRS_PER_RUN = 3;

async function topicSample(db: Db, topicId: number): Promise<TopicSample | null> {
  const lab = await db.execute(sql`SELECT label FROM topics WHERE id = ${topicId}`);
  const labelRow = (lab.rows ?? lab)[0] as { label: string } | undefined;
  if (!labelRow) return null;
  const res = await db.execute(sql`
    SELECT coalesce(nullif(s.title_zh, ''), i.title) AS title
    FROM item_topics it
    JOIN items i ON i.id = it.item_id
    LEFT JOIN scores s ON s.item_id = i.id
    WHERE it.topic_id = ${topicId}
    ORDER BY s.composite DESC NULLS LAST
    LIMIT 5
  `);
  const titles = ((res.rows ?? res) as Array<{ title: string }>).map((r) => r.title);
  if (titles.length === 0) return null;
  return { label: labelRow.label, titles };
}

// Fold `dropId` into `keepId`: memberships, daily trend buckets, centroid
// (recomputed from actual members), then delete the dropped topic. Decisions
// involving either id are cleared — the keeper's centroid moved, so old
// rejects no longer apply.
async function mergeTopics(db: Db, keepId: number, dropId: number): Promise<void> {
  await db.execute(sql`
    UPDATE item_topics SET topic_id = ${keepId}
    WHERE topic_id = ${dropId}
      AND item_id NOT IN (SELECT item_id FROM item_topics WHERE topic_id = ${keepId})
  `);
  await db.execute(sql`DELETE FROM item_topics WHERE topic_id = ${dropId}`);
  await db.execute(sql`
    INSERT INTO topic_trends (topic_id, bucket_date, item_count, score_sum)
    SELECT ${keepId}, bucket_date, item_count, score_sum FROM topic_trends WHERE topic_id = ${dropId}
    ON CONFLICT (topic_id, bucket_date)
    DO UPDATE SET item_count = topic_trends.item_count + EXCLUDED.item_count,
                  score_sum = topic_trends.score_sum + EXCLUDED.score_sum
  `);
  await db.execute(sql`DELETE FROM topic_trends WHERE topic_id = ${dropId}`);
  await db.execute(sql`
    UPDATE topics SET
      centroid = COALESCE((
        SELECT avg(e.embedding) FROM item_embeddings e
        JOIN item_topics it ON it.item_id = e.item_id
        WHERE it.topic_id = ${keepId}
      ), centroid),
      label_n = 0,
      last_seen = now()
    WHERE id = ${keepId}
  `);
  await db.execute(sql`DELETE FROM topics WHERE id = ${dropId}`);
  await db.execute(sql`
    DELETE FROM topic_merge_decisions
    WHERE a_id IN (${keepId}, ${dropId}) OR b_id IN (${keepId}, ${dropId})
  `);
}

export async function runTopicMergeStage(db: Db): Promise<number> {
  const cand = await db.execute(sql`
    SELECT a.id AS a_id, b.id AS b_id,
           (SELECT count(*)::int FROM item_topics WHERE topic_id = a.id) AS a_n,
           (SELECT count(*)::int FROM item_topics WHERE topic_id = b.id) AS b_n
    FROM topics a
    JOIN topics b ON a.id < b.id
    WHERE a.last_seen > now() - interval '7 days'
      AND b.last_seen > now() - interval '7 days'
      AND (a.centroid <=> b.centroid) < ${MERGE_CAND_DIST}
      AND NOT EXISTS (
        SELECT 1 FROM topic_merge_decisions d WHERE d.a_id = a.id AND d.b_id = b.id
      )
    ORDER BY a.centroid <=> b.centroid ASC
    LIMIT ${MERGE_PAIRS_PER_RUN}
  `);
  const pairs = (cand.rows ?? cand) as Array<{ a_id: number; b_id: number; a_n: number; b_n: number }>;
  const gone = new Set<number>();
  let merged = 0;

  for (const p of pairs) {
    const aId = Number(p.a_id), bId = Number(p.b_id);
    if (gone.has(aId) || gone.has(bId)) continue;
    const [sa, sb] = await Promise.all([topicSample(db, aId), topicSample(db, bId)]);
    if (!sa || !sb) continue;
    try {
      const same = await judgeSameTopic(sa, sb);
      if (!same) {
        await db.execute(sql`
          INSERT INTO topic_merge_decisions (a_id, b_id, merged) VALUES (${aId}, ${bId}, false)
          ON CONFLICT DO NOTHING
        `);
        continue;
      }
      const keepId = Number(p.a_n) >= Number(p.b_n) ? aId : bId;
      const dropId = keepId === aId ? bId : aId;
      await mergeTopics(db, keepId, dropId);
      gone.add(dropId);
      merged++;
    } catch (err) {
      console.error(`topic merge judge ${aId}/${bId} failed`, err);
    }
  }
  return merged;
}
