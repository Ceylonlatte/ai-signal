import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { rawItems, items, scores, itemEmbeddings, feedback } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";

// embeddings are vector(2048); orthogonal basis vector with 1 at index i.
const e = (i: number) => Array.from({ length: 2048 }, (_, k) => (k === i ? 1 : 0));

// Borderline LLM value (50/100 -> llmValue 0.5). With ~2 keyword hits (relevance ~0.667)
// and trust 0.5, Q ≈ 0.525 -> below the 0.55 gate but inside the rescue band [0.45,0.55).
vi.mock("../../src/lib/scoring/llm.js", () => ({
  scoreBatch: vi.fn(async (cands: { id: number }[]) =>
    new Map(cands.map((c) => [c.id, { id: c.id, value: 50, topics: [], reason: "r" }]))),
}));
// The borderline candidate embeds identical to the liked reference (e(0)).
vi.mock("../../src/lib/embeddings.js", () => ({
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => e(0))),
}));

beforeEach(async () => {
  await truncateAll();
  // an already-liked item with embedding e(0) + an up vote
  const [liked] = await db.insert(items).values({
    rawItemId: 1, source: "hn", title: "liked", text: "", createdAt: new Date(), metrics: {}, contentHash: "liked",
  }).returning();
  await db.execute(sql`INSERT INTO item_embeddings (item_id, embedding) VALUES (${liked!.id}, ${JSON.stringify(e(0))}::vector)`);
  await db.insert(feedback).values({ itemId: liked!.id, signal: "up" });

  // a borderline candidate raw_item: "Agent" + "agentic" => 2 keyword hits => relevance ~0.667
  await db.insert(rawItems).values({
    sourceId: 1, externalId: "cand",
    payload: {
      source: "hn", externalId: "cand", url: "https://h/c", author: "a",
      title: "Agent borderline", text: "agentic body", createdAt: new Date().toISOString(),
      metrics: { points: 50 }, raw: {},
    },
  });
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("rescues a borderline candidate similar to a liked item", async () => {
  const { runTriageStage } = await import("../../src/pipeline/triage.js");
  await runTriageStage(db);
  const kept = await db.select().from(items).where(sql`title = 'Agent borderline'`);
  expect(kept).toHaveLength(1);
  // its embedding should have been persisted during rescue
  const emb = await db.execute(sql`SELECT count(*)::int n FROM item_embeddings em JOIN items i ON i.id=em.item_id WHERE i.title='Agent borderline'`);
  expect(Number((emb.rows ?? emb)[0]!.n)).toBe(1);
});

it("does NOT rescue a borderline candidate dissimilar to liked items", async () => {
  const emb = await import("../../src/lib/embeddings.js");
  (emb.embedTexts as any).mockResolvedValueOnce([e(7)]); // orthogonal to liked e(0) -> sim 0
  const { runTriageStage } = await import("../../src/pipeline/triage.js");
  await runTriageStage(db);
  const kept = await db.select().from(items).where(sql`title = 'Agent borderline'`);
  expect(kept).toHaveLength(0); // not similar enough -> not rescued -> dropped
});
