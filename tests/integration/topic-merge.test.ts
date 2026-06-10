import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { items, itemEmbeddings, topics, itemTopics, topicTrends } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { judgeSameTopic } from "../../src/lib/scoring/llm.js";

vi.mock("../../src/lib/scoring/llm.js", async (orig) => ({
  ...(await orig() as object),
  labelTopic: vi.fn(async () => "merged label"),
  judgeSameTopic: vi.fn(async () => true),
}));

// Two near-identical centroids (cosine dist ~0.005, well under the 0.28
// candidate band) pointing at the same story split across two topics.
function vec(second: number) {
  const v = Array(2048).fill(0);
  v[0] = 1;
  v[1] = second;
  return v;
}

let aId: number;
let bId: number;

beforeEach(async () => {
  vi.mocked(judgeSameTopic).mockClear();
  await truncateAll();
  const ins = await db.insert(items).values([
    { rawItemId: 1, source: "hn", title: "fable launch 1", createdAt: new Date(), contentHash: "m1" },
    { rawItemId: 2, source: "hn", title: "fable launch 2", createdAt: new Date(), contentHash: "m2" },
    { rawItemId: 3, source: "hn", title: "fable usage reset", createdAt: new Date(), contentHash: "m3" },
    { rawItemId: 4, source: "hn", title: "fable shared", createdAt: new Date(), contentHash: "m4" },
  ]).returning();
  await db.insert(itemEmbeddings).values(ins.map((r) => ({ itemId: r.id, embedding: vec(0.05) })));

  const [a] = await db.insert(topics).values({ label: "Fable 5 发布", centroid: vec(0), labelN: 3 }).returning();
  const [b] = await db.insert(topics).values({ label: "Claude 用量重置", centroid: vec(0.1), labelN: 2 }).returning();
  aId = a!.id; bId = b!.id;

  // A: 3 members (incl. shared), B: 2 members (incl. shared) -> A is keeper.
  await db.insert(itemTopics).values([
    { itemId: ins[0]!.id, topicId: aId },
    { itemId: ins[1]!.id, topicId: aId },
    { itemId: ins[3]!.id, topicId: aId },
    { itemId: ins[2]!.id, topicId: bId },
    { itemId: ins[3]!.id, topicId: bId },
  ]);
  await db.insert(topicTrends).values([
    { topicId: aId, bucketDate: "2026-06-10", itemCount: 3, scoreSum: 2.0 },
    { topicId: bId, bucketDate: "2026-06-10", itemCount: 2, scoreSum: 1.0 },
    { topicId: bId, bucketDate: "2026-06-09", itemCount: 1, scoreSum: 0.5 },
  ]);
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("merges a confirmed same-story pair into the larger topic", async () => {
  const { runTopicMergeStage } = await import("../../src/lib/cluster.js");
  const merged = await runTopicMergeStage(db);
  expect(merged).toBe(1);

  const remaining = await db.select().from(topics);
  expect(remaining).toHaveLength(1);
  expect(remaining[0]!.id).toBe(aId);
  expect(remaining[0]!.labelN).toBe(0); // queued for relabel

  // memberships re-pointed, shared item not duplicated
  const links = await db.select().from(itemTopics);
  expect(links).toHaveLength(4);
  expect(links.every((l) => l.topicId === aId)).toBe(true);

  // trend buckets folded: same-day summed, other days carried over
  const trends = await db.execute(sql`
    SELECT bucket_date, item_count, score_sum FROM topic_trends
    WHERE topic_id = ${aId} ORDER BY bucket_date
  `);
  const rows = (trends.rows ?? trends) as any[];
  expect(rows).toEqual([
    expect.objectContaining({ bucket_date: "2026-06-09", item_count: 1, score_sum: 0.5 }),
    expect.objectContaining({ bucket_date: "2026-06-10", item_count: 5, score_sum: 3.0 }),
  ]);
});

it("remembers a rejected pair and never re-judges it", async () => {
  vi.mocked(judgeSameTopic).mockResolvedValue(false);
  const { runTopicMergeStage } = await import("../../src/lib/cluster.js");

  expect(await runTopicMergeStage(db)).toBe(0);
  expect(await runTopicMergeStage(db)).toBe(0);

  expect(vi.mocked(judgeSameTopic)).toHaveBeenCalledTimes(1);
  const remaining = await db.select().from(topics);
  expect(remaining).toHaveLength(2);
});
