import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { items, itemEmbeddings, scores } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";

vi.mock("../../src/lib/embeddings.js", () => ({
  embedTexts: vi.fn(async (texts: string[]) => texts.map((_, i) => Array(2048).fill(i === 0 ? 0.01 : 0.02))),
}));

beforeEach(async () => {
  await truncateAll();
  await db.insert(items).values([
    { rawItemId: 1, source: "hn", title: "A", text: "x", createdAt: new Date(), contentHash: "h1" },
    { rawItemId: 2, source: "hn", title: "B", text: "y", createdAt: new Date(), contentHash: "h2" },
  ]);
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("embeds items lacking embeddings", async () => {
  const { runEmbedStage } = await import("../../src/pipeline/stages.js");
  const n = await runEmbedStage(db);
  expect(n).toBe(2);
  expect(await db.select().from(itemEmbeddings)).toHaveLength(2);
  expect(await runEmbedStage(db)).toBe(0);
});

it("backfills novelty after embedding a lone item", async () => {
  await truncateAll();
  const [item] = await db
    .insert(items)
    .values({ rawItemId: 1, source: "hn", title: "Solo", text: "z", createdAt: new Date(), contentHash: "h-solo" })
    .returning({ id: items.id });
  await db.insert(scores).values({ itemId: item!.id, novelty: 0, rubricVersion: "test" });

  const { runEmbedStage } = await import("../../src/pipeline/stages.js");
  const n = await runEmbedStage(db);
  expect(n).toBe(1);
  expect(await db.select().from(itemEmbeddings)).toHaveLength(1);

  // A lone item has no other embeddings to compare against, so novelty == 1.
  const [row] = await db.select().from(scores).where(eq(scores.itemId, item!.id));
  expect(row!.novelty).toBe(1);
});
