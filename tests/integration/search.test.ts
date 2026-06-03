import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { items } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";

vi.mock("../../src/lib/embeddings.js", () => ({
  embedTexts: vi.fn(async () => [Array(2048).fill(0.01)]),
}));

beforeEach(async () => {
  await truncateAll();
  await db.insert(items).values([
    { rawItemId: 1, source: "hn", title: "Agent frameworks compared", text: "langgraph", createdAt: new Date(), contentHash: "h1" },
    { rawItemId: 2, source: "hn", title: "Cooking recipes", text: "pasta", createdAt: new Date(), contentHash: "h2" },
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
