import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { items } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { cleanupOldItems } from "../../src/lib/cleanup.js";

beforeEach(async () => {
  await truncateAll();
  await db.insert(items).values([
    { rawItemId: 1, source: "hn", title: "old normal", contentHash: "h1", createdAt: new Date(Date.now() - 40 * 864e5) },
    { rawItemId: 2, source: "hn", title: "old favorite", contentHash: "h2", isFavorited: true, createdAt: new Date(Date.now() - 40 * 864e5) },
    { rawItemId: 3, source: "hn", title: "recent", contentHash: "h3", createdAt: new Date() },
  ]);
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("deletes items older than 30 days except favorites", async () => {
  const deleted = await cleanupOldItems(db, { days: 30 });
  expect(deleted).toBe(1);
  const titles = (await db.select().from(items)).map((r) => r.title).sort();
  expect(titles).toEqual(["old favorite", "recent"]);
});
