import { afterAll, afterEach, expect, it } from "vitest";
import { items, scores } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { getFeed } from "../../src/app/feed-queries.js";

afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("returns scored items ordered by composite desc with summary", async () => {
  const [a] = await db.insert(items).values({ rawItemId: 1, source: "hn", title: "low", contentHash: "h1", createdAt: new Date() }).returning();
  const [b] = await db.insert(items).values({ rawItemId: 2, source: "hn", title: "high", contentHash: "h2", createdAt: new Date() }).returning();
  await db.insert(scores).values([
    { itemId: a!.id, composite: 0.2, summary: "low sum", rubricVersion: "t" },
    { itemId: b!.id, composite: 0.9, summary: "high sum", rubricVersion: "t" },
  ]);
  const feed = await getFeed(db, { limit: 10 });
  expect(feed.map((f: any) => f.title)).toEqual(["high", "low"]);
  expect(feed[0].summary).toBe("high sum");
});
