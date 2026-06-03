import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { items, scores } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";

vi.mock("../../src/lib/scoring/llm.js", () => ({
  scoreBatch: vi.fn(async (cands: { id: number }[]) =>
    new Map(cands.map((c) => [c.id, { id: c.id, value: 90, topics: ["agents"], reason: "r", summary: "s" }]))),
}));

let itemId: number;
beforeEach(async () => {
  await truncateAll();
  const [it] = await db.insert(items).values({
    rawItemId: 1, source: "hn", title: "Claude Code agentic release",
    text: "details", createdAt: new Date(), metrics: { points: 100, comments: 50 },
    contentHash: "h1",
  }).returning();
  itemId = it!.id;
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("scores candidate items and stores composite", async () => {
  const { runScoreStage } = await import("../../src/pipeline/stages.js");
  await runScoreStage(db);
  const [s] = await db.select().from(scores);
  expect(s!.itemId).toBe(itemId);
  expect(s!.llmValue).toBeCloseTo(0.9, 5);
  expect(s!.composite).toBeGreaterThan(0);
  expect(s!.summary).toBe("s");
  expect(s!.topicTags).toEqual(["agents"]);
});
