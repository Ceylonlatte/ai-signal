import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { items, itemEmbeddings, rawItems } from "../../src/db/schema.js";
import { embedTexts } from "../../src/lib/embeddings.js";
import { db, pool, truncateAll } from "../setup/db.js";

vi.mock("../../src/lib/embeddings.js", () => ({
  embedTexts: vi.fn(async () => [Array(2048).fill(0.01)]),
}));

// Unit basis vector on dimension `seed`: distinct seeds are orthogonal (cosine
// sim 0, distance 1), the same seed is identical (sim 1, distance 0).
function vec(seed: number) { return Array(2048).fill(0).map((_, i) => (i === seed ? 1 : 0)); }

function payload(title: string, text: string, source = "hn") {
  return { source, title, text, url: null, author: null, createdAt: new Date().toISOString() };
}

beforeEach(async () => {
  await truncateAll();
  // Keyword search covers the full raw corpus: row 1 + 3 accepted into the
  // feed (items row references them), row 2 triaged but dropped.
  const raw = await db.insert(rawItems).values([
    { sourceId: 1, externalId: "r1", payload: payload("Agent frameworks compared", "langgraph"), processedAt: new Date() },
    { sourceId: 1, externalId: "r2", payload: payload("Cooking recipes", "pasta"), processedAt: new Date() },
    { sourceId: 2, externalId: "r3", payload: payload("微信小程序可以被微信 AI 推荐了", "随用随走", "twitter"), processedAt: new Date() },
  ]).returning();
  const ins = await db.insert(items).values([
    { rawItemId: raw[0]!.id, source: "hn", title: "Agent frameworks compared", text: "langgraph", createdAt: new Date(), contentHash: "h1" },
    { rawItemId: raw[2]!.id, source: "twitter", title: "微信小程序可以被微信 AI 推荐了", text: "随用随走", createdAt: new Date(), contentHash: "h3" },
  ]).returning();
  await db.insert(itemEmbeddings).values([
    { itemId: ins[0]!.id, embedding: vec(0) },
    { itemId: ins[1]!.id, embedding: vec(3) },
  ]);
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("keyword search matches title text and flags accepted rows", async () => {
  const { keywordSearch } = await import("../../src/app/search/search-queries.js");
  const out = await keywordSearch(db, "agent");
  expect(out.map((r: any) => r.title)).toContain("Agent frameworks compared");
  expect(out.map((r: any) => r.title)).not.toContain("Cooking recipes");
  expect(out.find((r: any) => r.title === "Agent frameworks compared")?.accepted).toBe(true);
});

it("keyword search surfaces triaged-but-dropped raw items as not accepted", async () => {
  const { keywordSearch } = await import("../../src/app/search/search-queries.js");
  const out = await keywordSearch(db, "pasta");
  const row = out.find((r: any) => r.title === "Cooking recipes");
  expect(row).toBeDefined();
  expect(row.accepted).toBe(false);
  expect(row.processed).toBe(true);
});

it("keyword search matches a CJK substring the FTS parser can't segment", async () => {
  const { keywordSearch } = await import("../../src/app/search/search-queries.js");
  const out = await keywordSearch(db, "小程序");
  expect(out.map((r: any) => r.title)).toContain("微信小程序可以被微信 AI 推荐了");
  expect(out.map((r: any) => r.title)).not.toContain("Cooking recipes");
});

it("semantic search drops items below the similarity threshold", async () => {
  // Query vector aligns with item 1 (sim 1) and is orthogonal to the other
  // (sim 0, well under RELEVANCE_SIM_THRESHOLD), so it must be filtered out.
  vi.mocked(embedTexts).mockResolvedValueOnce([vec(0)]);
  const { semanticSearch } = await import("../../src/app/search/search-queries.js");
  const out = await semanticSearch(db, "agent");
  expect(out.map((r: any) => r.title)).toEqual(["Agent frameworks compared"]);
  expect(out[0].accepted).toBe(true);
});
