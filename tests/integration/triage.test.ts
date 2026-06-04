import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { rawItems, items, scores } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";

vi.mock("../../src/lib/scoring/llm.js", () => ({
  scoreBatch: vi.fn(async (cands: { id: number; title: string }[]) =>
    new Map(cands.map((c) => [c.id, {
      id: c.id,
      value: c.title.includes("KEEP") ? 95 : 5,
      topics: ["agents"], reason: "r",
    }]))),
}));

function rawPayload(over: Partial<any>) {
  return {
    source: "hn", externalId: over.externalId ?? "x", url: "https://h.com/a",
    author: "a", title: over.title ?? "t", text: "body",
    createdAt: new Date().toISOString(), metrics: { points: 200 }, raw: {},
    ...over,
  };
}

beforeEach(async () => {
  await truncateAll();
  await db.insert(rawItems).values([
    { sourceId: 1, externalId: "k1", payload: rawPayload({ externalId: "k1", title: "KEEP Claude agents" }) },
    { sourceId: 1, externalId: "d1", payload: rawPayload({ externalId: "d1", title: "DROP random marketing", metrics: { points: 1 } }) },
  ]);
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("keeps high-Q items (writes item + score) and drops low ones", async () => {
  const { runTriageStage } = await import("../../src/pipeline/triage.js");
  const n = await runTriageStage(db);
  expect(n).toBeGreaterThan(0);

  const keptItems = await db.select().from(items);
  expect(keptItems).toHaveLength(1);
  expect(keptItems[0]!.title).toContain("KEEP");

  const keptScores = await db.select().from(scores);
  expect(keptScores).toHaveLength(1);
  expect(keptScores[0]!.composite).toBeGreaterThanOrEqual(0.55);

  const unprocessed = await db.execute(sql`SELECT count(*)::int n FROM raw_items WHERE processed_at IS NULL`);
  expect(Number((unprocessed.rows ?? unprocessed)[0]!.n)).toBe(0);
});

it("is idempotent: a second run processes nothing", async () => {
  const { runTriageStage } = await import("../../src/pipeline/triage.js");
  await runTriageStage(db);
  const n2 = await runTriageStage(db);
  expect(n2).toBe(0);
  expect(await db.select().from(items)).toHaveLength(1);
});
