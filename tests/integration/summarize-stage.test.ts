import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { items, scores } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";
import { db, pool, truncateAll } from "../setup/db.js";

vi.mock("../../src/lib/fulltext.js", () => ({
  fetchFullText: vi.fn(async () => ({ text: "full article body", fetched: true })),
}));
vi.mock("../../src/lib/scoring/summarize.js", () => ({
  summarizeBilingual: vi.fn(async () => ({ titleZh: "标题", summaryEn: "EN", summaryZh: "中文" })),
}));

let itemId: number;
beforeEach(async () => {
  await truncateAll();
  const [it] = await db.insert(items).values({
    rawItemId: 1, source: "hn", url: "https://x.com/a", title: "T", text: "body",
    createdAt: new Date(), metrics: { points: 100 }, contentHash: "h",
  }).returning();
  itemId = it!.id;
  await db.insert(scores).values({ itemId, composite: 0.7, rubricVersion: "t" });
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("writes bilingual summary for un-summarized kept items", async () => {
  const { runSummarizeStage } = await import("../../src/pipeline/summarize-stage.js");
  const n = await runSummarizeStage(db);
  expect(n).toBe(1);
  const [s] = await db.select().from(scores).where(eq(scores.itemId, itemId));
  expect(s!.titleZh).toBe("标题");
  expect(s!.summaryEn).toBe("EN");
  expect(s!.summaryZh).toBe("中文");
  expect(s!.fullTextFetched).toBe(true);
});

it("is idempotent (already-summarized items are skipped)", async () => {
  const { runSummarizeStage } = await import("../../src/pipeline/summarize-stage.js");
  await runSummarizeStage(db);
  const n2 = await runSummarizeStage(db);
  expect(n2).toBe(0);
});
