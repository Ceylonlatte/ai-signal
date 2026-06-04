import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { items, scores } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { getFeed } from "../../src/app/feed-queries.js";

beforeEach(async () => {
  await truncateAll();
  const now = new Date();
  const [a] = await db.insert(items).values({
    rawItemId: 1, source: "hn", title: "fresh hot", text: "", createdAt: now,
    metrics: { points: 500 }, contentHash: "a",
  }).returning();
  const [b] = await db.insert(items).values({
    rawItemId: 2, source: "hn", title: "old cold", text: "",
    createdAt: new Date(now.getTime() - 72 * 3600_000),
    metrics: { points: 5 }, contentHash: "b",
  }).returning();
  await db.insert(scores).values([
    { itemId: a!.id, composite: 0.7, novelty: 0.2, summaryZh: "中文A", titleZh: "标题A", rubricVersion: "t" },
    { itemId: b!.id, composite: 0.7, novelty: 0.2, summaryZh: "中文B", titleZh: "标题B", rubricVersion: "t" },
  ]);
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("orders by live ranking R (fresh+hot first)", async () => {
  const feed = await getFeed(db, { limit: 50 });
  expect(feed[0]!.titleZh).toBe("标题A");
  expect(feed.map((r: any) => r.titleZh)).toEqual(["标题A", "标题B"]);
});
