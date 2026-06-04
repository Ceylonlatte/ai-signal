import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { items, scores } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { getFeed } from "../../src/app/feed-queries.js";

beforeEach(async () => {
  await truncateAll();
  const now = new Date();
  // "热门": older (5h) but very high engagement -> high platformHeat.
  const [hot] = await db.insert(items).values({
    rawItemId: 1, source: "hn", title: "hot", text: "",
    createdAt: new Date(now.getTime() - 5 * 3600_000),
    metrics: { points: 5000 }, contentHash: "hot",
  }).returning();
  // "新但冷": freshest but tiny engagement -> low platformHeat.
  const [cold] = await db.insert(items).values({
    rawItemId: 2, source: "hn", title: "cold", text: "", createdAt: now,
    metrics: { points: 2 }, contentHash: "cold",
  }).returning();
  await db.insert(scores).values([
    { itemId: hot!.id, composite: 0.7, novelty: 0.2, summaryZh: "中文热", titleZh: "热门", rubricVersion: "t" },
    { itemId: cold!.id, composite: 0.7, novelty: 0.2, summaryZh: "中文冷", titleZh: "新但冷", rubricVersion: "t" },
  ]);
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("ranks by live R: heat beats recency (older+hot first, fresher+cold second)", async () => {
  // composites are tied (0.7) and the cold item is the freshest, so only a
  // heat-aware ranker puts the older "热门" first. Rules out recency-only / composite-only.
  const feed = await getFeed(db, { limit: 50 });
  expect(feed.map((r: any) => r.titleZh)).toEqual(["热门", "新但冷"]);
});
