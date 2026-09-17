import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { itemEmbeddings, items, rawItems, rssItems, scores, topics, topicTrends } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { cleanupOldItems } from "../../src/lib/cleanup.js";

const OLD = () => new Date(Date.now() - 40 * 864e5);
const NEW = () => new Date();
const payload = (title: string) => ({ source: "hn", title, text: "t", url: "u", createdAt: OLD().toISOString(), raw: { big: "x".repeat(200) } });
const vec = () => Array.from({ length: 2048 }, () => 0);

beforeEach(async () => {
  await truncateAll();
  await db.insert(items).values([
    { rawItemId: 1, source: "hn", title: "old normal", contentHash: "h1", createdAt: OLD() },
    { rawItemId: 2, source: "hn", title: "old favorite", contentHash: "h2", isFavorited: true, createdAt: OLD() },
    { rawItemId: 3, source: "hn", title: "recent", contentHash: "h3", createdAt: NEW() },
  ]);
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("deletes items older than 30 days except favorites", async () => {
  const s = await cleanupOldItems(db, { days: 30 });
  expect(s.items).toBe(1);
  const titles = (await db.select().from(items)).map((r) => r.title).sort();
  expect(titles).toEqual(["old favorite", "recent"]);
});

it("strips payload->'raw' from expired raw_items but keeps the row and its display fields", async () => {
  await db.insert(rawItems).values([
    { sourceId: 1, externalId: "e-old", payload: payload("old raw"), fetchedAt: OLD() },
    { sourceId: 1, externalId: "e-new", payload: payload("new raw"), fetchedAt: NEW() },
  ]);

  const s = await cleanupOldItems(db, { days: 30 });
  expect(s.rawPayloadsSlimmed).toBe(1);

  const rows = (await db.select().from(rawItems)) as any[];
  expect(rows).toHaveLength(2); // the dedupe ledger must survive
  const old_ = rows.find((r) => r.externalId === "e-old")!;
  const new_ = rows.find((r) => r.externalId === "e-new")!;
  expect(old_.payload.raw).toBeUndefined();
  expect(old_.payload.title).toBe("old raw"); // /raw + search still render it
  expect(old_.payload.url).toBe("u");
  expect(new_.payload.raw).toBeDefined(); // still inside the window

  // Idempotent: a second nightly run must not rewrite the same rows again.
  expect((await cleanupOldItems(db, { days: 30 })).rawPayloadsSlimmed).toBe(0);
});

it("deletes expired rss_items", async () => {
  await db.insert(rssItems).values([
    { feedUrl: "f", externalId: "r-old", title: "old rss", publishedAt: OLD() },
    { feedUrl: "f", externalId: "r-new", title: "new rss", publishedAt: NEW() },
  ]);
  const s = await cleanupOldItems(db, { days: 30 });
  expect(s.rssItems).toBe(1);
  expect((await db.select().from(rssItems)).map((r) => r.title)).toEqual(["new rss"]);
});

it("sweeps child rows whose item no longer exists", async () => {
  const live = (await db.select().from(items).where(sql`title = 'recent'`))[0]!;
  await db.insert(scores).values([
    { itemId: live.id, rubricVersion: "v1" },
    { itemId: 999_999, rubricVersion: "v1" },
  ]);
  await db.insert(itemEmbeddings).values([{ itemId: 999_999, embedding: vec() }]);

  const s = await cleanupOldItems(db, { days: 30 });
  expect(s.orphanChildren).toBe(2);
  expect((await db.select().from(scores)).map((r) => r.itemId)).toEqual([live.id]);
  expect(await db.select().from(itemEmbeddings)).toHaveLength(0);
});

it("deletes stale memberless topics but spares fresh and populated ones", async () => {
  const [stale] = await db.insert(topics).values({ label: "stale orphan", centroid: vec(), lastSeen: OLD() }).returning();
  await db.insert(topics).values({ label: "fresh orphan", centroid: vec(), lastSeen: NEW() });
  await db.insert(topicTrends).values({ topicId: stale!.id, bucketDate: "2026-01-01" });

  const s = await cleanupOldItems(db, { days: 30 });
  expect(s.orphanTopics).toBe(1);
  // A topic the cluster stage just created (last_seen = now()) is never caught
  // in the gap between its INSERT and its first item_topics row.
  expect((await db.select().from(topics)).map((r) => r.label)).toEqual(["fresh orphan"]);
  expect(await db.select().from(topicTrends)).toHaveLength(0);
});
