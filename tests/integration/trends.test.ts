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
  expect(top[0].itemCount).toBe(10);
});
