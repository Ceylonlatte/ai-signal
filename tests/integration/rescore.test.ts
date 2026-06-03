import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { items, scores } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { enqueueRescore } from "../../src/lib/rescore.js";

beforeEach(async () => {
  await truncateAll();
  const ins = await db.insert(items).values([
    { rawItemId: 1, source: "hn", title: "a", contentHash: "h1", createdAt: new Date() },
    { rawItemId: 2, source: "hn", title: "b", contentHash: "h2", createdAt: new Date() },
  ]).returning();
  await db.insert(scores).values(ins.map((i) => ({ itemId: i.id, composite: 0.5, rubricVersion: "old" })));
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("deletes scores not matching the current rubric so they re-score", async () => {
  const cleared = await enqueueRescore(db, { currentRubric: "new" });
  expect(cleared).toBe(2);
  expect(await db.select().from(scores)).toHaveLength(0);
});
