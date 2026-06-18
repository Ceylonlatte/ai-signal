import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { items, scores } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { getFeed, normalizeFeedSource } from "../../src/app/feed-queries.js";

async function insertScoredItem(opts: {
  rawItemId: number;
  source: string;
  title: string;
  titleZh: string;
  createdAt: Date;
  metrics: Record<string, number>;
  contentHash: string;
  composite?: number;
  novelty?: number;
}) {
  const [item] = await db.insert(items).values({
    rawItemId: opts.rawItemId,
    source: opts.source,
    title: opts.title,
    text: "",
    createdAt: opts.createdAt,
    metrics: opts.metrics,
    contentHash: opts.contentHash,
  }).returning();
  await db.insert(scores).values({
    itemId: item!.id,
    composite: opts.composite ?? 0.7,
    novelty: opts.novelty ?? 0.2,
    summaryZh: `中文${opts.titleZh}`,
    titleZh: opts.titleZh,
    rubricVersion: "t",
  });
  return item!;
}

beforeEach(async () => {
  await truncateAll();
  const now = new Date();
  // "热门": older (5h) but very high engagement -> high platformHeat.
  await insertScoredItem({
    rawItemId: 1,
    source: "hn",
    title: "hot",
    titleZh: "热门",
    createdAt: new Date(now.getTime() - 5 * 3600_000),
    metrics: { points: 5000 },
    contentHash: "hot",
  });
  // "新但冷": freshest but tiny engagement -> low platformHeat.
  await insertScoredItem({
    rawItemId: 2,
    source: "hn",
    title: "cold",
    titleZh: "新但冷",
    createdAt: now,
    metrics: { points: 2 },
    contentHash: "cold",
  });
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("ranks by live R: heat beats recency (older+hot first, fresher+cold second)", async () => {
  // composites are tied (0.7) and the cold item is the freshest, so only a
  // heat-aware ranker puts the older "热门" first. Rules out recency-only / composite-only.
  const feed = await getFeed(db, { page: 1, pageSize: 50, sort: "score" });
  expect(feed.items.map((r: any) => r.titleZh)).toEqual(["热门", "新但冷"]);
  expect(feed.total).toBe(2);
});

it("paginates the ranked list without a hard cap (pageSize splits across pages)", async () => {
  const p1 = await getFeed(db, { page: 1, pageSize: 1, sort: "score" });
  const p2 = await getFeed(db, { page: 2, pageSize: 1, sort: "score" });
  expect(p1.total).toBe(2);
  expect(p1.totalPages).toBe(2);
  // ranking order is preserved across pages: hot on p1, cold on p2.
  expect(p1.items.map((r: any) => r.titleZh)).toEqual(["热门"]);
  expect(p2.items.map((r: any) => r.titleZh)).toEqual(["新但冷"]);
});

it("clamps an out-of-range page to the last page", async () => {
  const p = await getFeed(db, { page: 99, pageSize: 1, sort: "score" });
  expect(p.page).toBe(2);
  expect(p.items.map((r: any) => r.titleZh)).toEqual(["新但冷"]);
});

it("normalizes unknown source values to all", () => {
  expect(normalizeFeedSource(undefined)).toBe("all");
  expect(normalizeFeedSource("")).toBe("all");
  expect(normalizeFeedSource("rss")).toBe("all");
  expect(normalizeFeedSource("twitter")).toBe("twitter");
});

it("defaults to main feed sources and excludes rss from all", async () => {
  await insertScoredItem({
    rawItemId: 3,
    source: "rss",
    title: "rss",
    titleZh: "RSS",
    createdAt: new Date(),
    metrics: {},
    contentHash: "rss",
  });

  const feed = await getFeed(db, { page: 1, pageSize: 50 });
  expect(feed.source).toBe("all");
  expect(feed.total).toBe(2);
  expect(feed.items.map((r: any) => r.source)).toEqual(["hn", "hn"]);
});

it("filters to a requested platform before paging", async () => {
  const now = new Date();
  await insertScoredItem({
    rawItemId: 3,
    source: "reddit",
    title: "reddit",
    titleZh: "Reddit",
    createdAt: now,
    metrics: { score: 100, comments: 5 },
    contentHash: "reddit",
  });
  await insertScoredItem({
    rawItemId: 4,
    source: "twitter",
    title: "twitter",
    titleZh: "X",
    createdAt: now,
    metrics: { likes: 100, retweets: 10, replies: 3 },
    contentHash: "twitter",
  });

  const feed = await getFeed(db, { page: 1, pageSize: 1, source: "twitter" });
  expect(feed.source).toBe("twitter");
  expect(feed.total).toBe(1);
  expect(feed.totalPages).toBe(1);
  expect(feed.items.map((r: any) => r.source)).toEqual(["twitter"]);
});
