import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { items, itemEmbeddings } from "../../src/db/schema.js";
import { embedTexts } from "../../src/lib/embeddings.js";
import { db, pool, truncateAll } from "../setup/db.js";

vi.mock("../../src/lib/embeddings.js", () => ({
  embedTexts: vi.fn(async () => [Array(2048).fill(0.01)]),
}));

// Unit basis vector on dimension `seed`: distinct seeds are orthogonal (cosine
// sim 0, distance 1), the same seed is identical (sim 1, distance 0).
function vec(seed: number) { return Array(2048).fill(0).map((_, i) => (i === seed ? 1 : 0)); }

beforeEach(async () => {
  await truncateAll();
  const ins = await db.insert(items).values([
    { rawItemId: 1, source: "hn", title: "Agent frameworks compared", text: "langgraph", createdAt: new Date(), contentHash: "h1" },
    { rawItemId: 2, source: "hn", title: "Cooking recipes", text: "pasta", createdAt: new Date(), contentHash: "h2" },
  ]).returning();
  await db.insert(itemEmbeddings).values([
    { itemId: ins[0]!.id, embedding: vec(0) },
    { itemId: ins[1]!.id, embedding: vec(7) },
  ]);
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("keyword search matches title text", async () => {
  const { keywordSearch } = await import("../../src/app/search/search-queries.js");
  const out = await keywordSearch(db, "agent");
  expect(out.map((r: any) => r.title)).toContain("Agent frameworks compared");
  expect(out.map((r: any) => r.title)).not.toContain("Cooking recipes");
});

it("semantic search drops items below the similarity threshold", async () => {
  // Query vector aligns with item 1 (sim 1) and is orthogonal to item 2 (sim 0,
  // well under RELEVANCE_SIM_THRESHOLD), so the cooking item must be filtered out.
  vi.mocked(embedTexts).mockResolvedValueOnce([vec(0)]);
  const { semanticSearch } = await import("../../src/app/search/search-queries.js");
  const out = await semanticSearch(db, "agent");
  expect(out.map((r: any) => r.title)).toEqual(["Agent frameworks compared"]);
});
