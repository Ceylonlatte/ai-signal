import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { items, itemEmbeddings } from "../../src/db/schema.js";
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
