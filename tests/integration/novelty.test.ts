import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { items, itemEmbeddings } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { computeNovelty } from "../../src/lib/novelty.js";

function vec(seed: number) { return Array(2048).fill(0).map((_, i) => (i === seed ? 1 : 0)); }

let idOld: number, idNew: number, idDup: number;
beforeEach(async () => {
  await truncateAll();
  const inserted = await db.insert(items).values([
    { rawItemId: 1, source: "hn", title: "old", createdAt: new Date(Date.now() - 2 * 864e5), contentHash: "h1" },
    { rawItemId: 2, source: "hn", title: "new", createdAt: new Date(), contentHash: "h2" },
    { rawItemId: 3, source: "hn", title: "dup", createdAt: new Date(), contentHash: "h3" },
  ]).returning();
  [idOld, idNew, idDup] = [inserted[0]!.id, inserted[1]!.id, inserted[2]!.id];
  await db.insert(itemEmbeddings).values([
    { itemId: idOld, embedding: vec(0) },
    { itemId: idNew, embedding: vec(5) },
    { itemId: idDup, embedding: vec(0) },
  ]);
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("scores orthogonal item as novel and duplicate as not novel", async () => {
  const novelNew = await computeNovelty(db, idNew, { days: 7 });
  const novelDup = await computeNovelty(db, idDup, { days: 7 });
  expect(novelNew).toBeGreaterThan(0.9);
  expect(novelDup).toBeLessThan(0.1);
});
