import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { items, scores, rawItems } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { getPipelineStatus } from "../../src/app/status-queries.js";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("reports per-stage pipeline counts", async () => {
  await db.insert(rawItems).values([
    { sourceId: 1, externalId: "a", payload: {}, processedAt: new Date() },
    { sourceId: 1, externalId: "b", payload: {} }, // pending (processed_at null)
  ]);
  const [it1] = await db.insert(items).values({
    rawItemId: 1, source: "hn", title: "t1", createdAt: new Date(), contentHash: "h1",
  }).returning();
  await db.insert(items).values({
    rawItemId: 1, source: "hn", title: "t2", createdAt: new Date(), contentHash: "h2",
  });
  await db.insert(scores).values({ itemId: it1!.id, rubricVersion: "t", summaryEn: "done" });

  const s = await getPipelineStatus(db);
  expect(s.rawTotal).toBe(2);
  expect(s.rawPending).toBe(1);
  expect(s.items).toBe(2);
  expect(s.scored).toBe(1);
  expect(s.summarized).toBe(1);
  expect(s.embeddings).toBe(0);
  expect(s.embedPending).toBe(2);
  expect(s.unclustered).toBe(2);
});
