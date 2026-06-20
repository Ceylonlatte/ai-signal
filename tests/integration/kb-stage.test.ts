import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { items, kbEntries, rawItems } from "../../src/db/schema.js";
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
// Keep real needsTranslation; only stub the network translate call.
vi.mock("../../src/lib/kb/translate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/kb/translate.js")>();
  return { ...actual, translateToZh: vi.fn(async () => "译文") };
});

async function makeItem(over: Partial<typeof items.$inferInsert> = {}) {
  const [row] = await db.insert(items).values({
    rawItemId: 1, source: "hn", title: "t", text: "x".repeat(600),
    contentHash: `h${Math.random()}`, createdAt: new Date(), isFavorited: false,
    ...over,
  }).returning();
  return row!.id;
}

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); vi.clearAllMocks(); });
afterAll(async () => { await pool.end(); });

it("processes any ingested item into a ready kb_entry (no favorite required)", async () => {
  const id = await makeItem();
  const { runKbStage } = await import("../../src/pipeline/kb-stage.js");
  const n = await runKbStage(db);
  expect(n).toBe(1);
  const [k] = await db.select().from(kbEntries).where(eq(kbEntries.itemId, id));
  expect(k!.status).toBe("ready");
  expect((k!.note as any).overview).toBe("ov");
  expect(k!.bodyZhMd).toBe("译文"); // English body translated for display
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

it("twitter uses source text without fetching, translating the body", async () => {
  const id = await makeItem({ source: "twitter", text: "a short english tweet" });
  const { fetchArticle } = await import("../../src/lib/kb/reader.js");
  const { runKbStage } = await import("../../src/pipeline/kb-stage.js");
  await runKbStage(db);
  expect(fetchArticle).not.toHaveBeenCalled();
  const [k] = await db.select().from(kbEntries).where(eq(kbEntries.itemId, id));
  expect(k!.bodySource).toBe("source");
  expect(k!.bodyMd).toBe("a short english tweet");
  expect(k!.bodyZhMd).toBe("译文");
});

it("reddit builds body + full comments from the digest doc, no fetch", async () => {
  const [raw] = await db.insert(rawItems).values({
    sourceId: 1, externalId: "abc123",
    payload: { raw: { discussion: { fetch: { status: "success" }, comments: [
      { author: "alice", body: "great point about agents", score: 99, replies: [] },
    ] } } },
  }).returning();
  const id = await makeItem({ source: "reddit", rawItemId: raw!.id, text: "the reddit post body ".padEnd(500, "z") });
  const { fetchArticle } = await import("../../src/lib/kb/reader.js");
  const { runKbStage } = await import("../../src/pipeline/kb-stage.js");
  await runKbStage(db);
  expect(fetchArticle).not.toHaveBeenCalled();
  const [k] = await db.select().from(kbEntries).where(eq(kbEntries.itemId, id));
  expect(k!.status).toBe("ready");
  expect(k!.bodySource).toBe("reddit");
  expect(k!.commentsMd).toContain("alice");
  expect(k!.commentsZhMd).toBe("译文"); // comments translated too
});

it("retries on error then dead-letters to failed at KB_MAX_ATTEMPTS", async () => {
  const id = await makeItem();
  const { synthesizeNotes } = await import("../../src/lib/kb/notes.js");
  const { runKbStage } = await import("../../src/pipeline/kb-stage.js");
  (synthesizeNotes as any).mockRejectedValue(new Error("boom"));
  try {
    await runKbStage(db); // attempt 1
    let [k] = await db.select().from(kbEntries).where(eq(kbEntries.itemId, id));
    expect(k!.status).toBe("pending");
    expect(k!.attempts).toBe(1);

    await runKbStage(db); // attempt 2
    await runKbStage(db); // attempt 3 -> dead-letter
    [k] = await db.select().from(kbEntries).where(eq(kbEntries.itemId, id));
    expect(k!.status).toBe("failed");
    expect(k!.attempts).toBe(3);

    expect(await runKbStage(db)).toBe(0); // dead-lettered rows excluded
  } finally {
    (synthesizeNotes as any).mockResolvedValue({ overview: "ov", keypoints: ["k"], facts: [], why: "w", terms: [] });
  }
});

it("does not re-select an already-ready item", async () => {
  await makeItem();
  const { runKbStage } = await import("../../src/pipeline/kb-stage.js");
  expect(await runKbStage(db)).toBe(1); // processed once -> ready
  expect(await runKbStage(db)).toBe(0); // ready rows excluded
});
