import { afterAll, afterEach, expect, it } from "vitest";
import { items } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { getFeed } from "../../src/app/feed-queries.js";

afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("returns items newest-first", async () => {
  await db.insert(items).values([
    { rawItemId: 1, source: "hn", title: "old", contentHash: "h1", createdAt: new Date("2026-05-01T00:00:00Z") },
    { rawItemId: 2, source: "hn", title: "new", contentHash: "h2", createdAt: new Date("2026-05-30T00:00:00Z") },
  ]);
  const feed = await getFeed(db, { limit: 10 });
  expect(feed.map((f) => f.title)).toEqual(["new", "old"]);
});
