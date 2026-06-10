import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { topics, topicTrends } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { getTopTopics } from "../../src/app/topics/trend-queries.js";

beforeEach(async () => {
  await truncateAll();
  const [t1] = await db.insert(topics).values({ label: "Agents", centroid: Array(2048).fill(0) }).returning();
  const [t2] = await db.insert(topics).values({ label: "Hardware", centroid: Array(2048).fill(0) }).returning();
  await db.insert(topicTrends).values([
    { topicId: t1!.id, bucketDate: "2026-06-03", itemCount: 10, scoreSum: 7.5 },
    { topicId: t2!.id, bucketDate: "2026-06-03", itemCount: 3, scoreSum: 1.2 },
  ]);
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("returns topics for a day ordered by score sum desc", async () => {
  const top = await getTopTopics(db, { date: "2026-06-03" });
  expect(top.map((t: any) => t.label)).toEqual(["Agents", "Hardware"]);
  expect(top[0]!.itemCount).toBe(10);
});

it("merges same-day topics with near-identical centroids", async () => {
  // Two clusters of the same event: identical centroids, different labels.
  const vec = Array(2048).fill(0).map((_, i) => (i === 0 ? 1 : 0));
  const [a] = await db.insert(topics).values({ label: "Claude Fable 5 发布", centroid: vec }).returning();
  const [b] = await db.insert(topics).values({ label: "Anthropic", centroid: vec }).returning();
  await db.insert(topicTrends).values([
    { topicId: a!.id, bucketDate: "2026-06-04", itemCount: 12, scoreSum: 7.8 },
    { topicId: b!.id, bucketDate: "2026-06-04", itemCount: 4, scoreSum: 2.5 },
  ]);

  const top = await getTopTopics(db, { date: "2026-06-04" });
  expect(top).toHaveLength(1);
  expect(top[0]!.label).toBe("Claude Fable 5 发布"); // 分高的聚类做代表
  expect(top[0]!.itemCount).toBe(16);
  expect(top[0]!.scoreSum).toBeCloseTo(10.3);
});

it("merges same-day topics with colliding labels", async () => {
  // Distant centroids but the same label — still one row to the reader.
  const v1 = Array(2048).fill(0).map((_, i) => (i === 0 ? 1 : 0));
  const v2 = Array(2048).fill(0).map((_, i) => (i === 1 ? 1 : 0));
  const [a] = await db.insert(topics).values({ label: "Agentic Coding", centroid: v1 }).returning();
  const [b] = await db.insert(topics).values({ label: "agentic coding", centroid: v2 }).returning();
  await db.insert(topicTrends).values([
    { topicId: a!.id, bucketDate: "2026-06-05", itemCount: 3, scoreSum: 2.5 },
    { topicId: b!.id, bucketDate: "2026-06-05", itemCount: 1, scoreSum: 0.7 },
  ]);

  const top = await getTopTopics(db, { date: "2026-06-05" });
  expect(top).toHaveLength(1);
  expect(top[0]!.itemCount).toBe(4);
});
