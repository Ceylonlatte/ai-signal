import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { items, kbEntries } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";

vi.mock("../../src/db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/client.js")>();
  const { db, pool } = actual.makeDb(process.env.TEST_DATABASE_URL!);
  return { ...actual, db, pool };
});

// Stub the heavy lib modules so the stage test stays deterministic + offline.
vi.mock("../../src/lib/kb/reader.js", () => ({
  fetchArticle: vi.fn(async (_url: string | null, fallback: string) => ({
    markdown: fallback || "# Long body ".padEnd(600, "x"),
    images: [],
    source: "firecrawl",
  })),
}));
vi.mock("../../src/lib/kb/images.js", () => ({
  localizeImages: vi.fn(async (_id: number, md: string) => ({ markdown: md, images: [] })),
}));
vi.mock("../../src/lib/kb/notes.js", () => ({
  synthesizeNotes: vi.fn(async () => ({ overview: "ov", keypoints: ["k"], facts: [], why: "w", terms: [] })),
}));

async function makeItem(over: Partial<typeof items.$inferInsert> = {}) {
  const [row] = await db.insert(items).values({
    rawItemId: 1, source: "hn", title: "t", text: "x".repeat(600),
    contentHash: `h${Math.random()}`, createdAt: new Date(), isFavorited: true,
    favoritedAt: new Date(), ...over,
  }).returning();
  return row!.id;
}

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); vi.clearAllMocks(); });
afterAll(async () => { await pool.end(); });

it("processes a favorited item into a ready kb_entry", async () => {
  const id = await makeItem();
  const { runKbStage } = await import("../../src/pipeline/kb-stage.js");
  const n = await runKbStage(db);
  expect(n).toBe(1);
  const [k] = await db.select().from(kbEntries).where(eq(kbEntries.itemId, id));
  expect(k!.status).toBe("ready");
  expect((k!.note as any).overview).toBe("ov");
});

it("marks skipped when body is too short", async () => {
  const id = await makeItem({ text: "短" });
  const { fetchArticle } = await import("../../src/lib/kb/reader.js");
  (fetchArticle as any).mockResolvedValueOnce({ markdown: "短", images: [], source: "fallback" });
  const { runKbStage } = await import("../../src/pipeline/kb-stage.js");
  await runKbStage(db);
  const [k] = await db.select().from(kbEntries).where(eq(kbEntries.itemId, id));
  expect(k!.status).toBe("skipped");
});

it("does not pick non-favorited items", async () => {
  await makeItem({ isFavorited: false, favoritedAt: null });
  const { runKbStage } = await import("../../src/pipeline/kb-stage.js");
  expect(await runKbStage(db)).toBe(0);
});

it("retries on error then dead-letters to failed at KB_MAX_ATTEMPTS", async () => {
  const id = await makeItem();
  const { synthesizeNotes } = await import("../../src/lib/kb/notes.js");
  const { runKbStage } = await import("../../src/pipeline/kb-stage.js");
  (synthesizeNotes as any).mockRejectedValue(new Error("boom"));
  try {
    // KB_MAX_ATTEMPTS defaults to 3.
    await runKbStage(db); // attempt 1
    let [k] = await db.select().from(kbEntries).where(eq(kbEntries.itemId, id));
    expect(k!.status).toBe("pending");
    expect(k!.attempts).toBe(1);

    await runKbStage(db); // attempt 2
    await runKbStage(db); // attempt 3 -> dead-letter
    [k] = await db.select().from(kbEntries).where(eq(kbEntries.itemId, id));
    expect(k!.status).toBe("failed");
    expect(k!.attempts).toBe(3);

    // Dead-lettered rows are no longer selected.
    expect(await runKbStage(db)).toBe(0);
  } finally {
    // Restore the default resolving impl so this rejection doesn't leak to other tests.
    (synthesizeNotes as any).mockResolvedValue({ overview: "ov", keypoints: ["k"], facts: [], why: "w", terms: [] });
  }
});

it("does not re-select an already-ready item", async () => {
  await makeItem();
  const { runKbStage } = await import("../../src/pipeline/kb-stage.js");
  expect(await runKbStage(db)).toBe(1); // processed once -> ready
  expect(await runKbStage(db)).toBe(0); // ready rows excluded
});
