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
