import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { rssItems } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";

vi.mock("../../src/db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/client.js")>();
  const { db, pool } = actual.makeDb(process.env.TEST_DATABASE_URL!);
  return { ...actual, db, pool };
});

vi.mock("../../src/lib/kb/reader.js", () => ({
  fetchArticle: vi.fn(async (_url: string | null, fallback: string) => ({
    markdown: fallback || "# Long body ".padEnd(600, "x"),
    images: [],
    source: "markdownnew",
  })),
}));
vi.mock("../../src/lib/kb/notes.js", () => ({
  synthesizeNotes: vi.fn(async () => ({ overview: "ov", keypoints: ["k"], facts: [], why: "w", terms: [] })),
}));
vi.mock("../../src/lib/kb/translate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/kb/translate.js")>();
  return { ...actual, translateToZh: vi.fn(async () => "译文") };
});

async function makeRss(over: Partial<typeof rssItems.$inferInsert> = {}) {
  const [row] = await db.insert(rssItems).values({
    feedUrl: "https://openai.com/news/rss.xml", externalId: `e${Math.random()}`,
    url: "https://openai.com/post", title: "An English RSS title",
    summary: "english summary ".padEnd(600, "x"), publishedAt: new Date(), ...over,
  }).returning();
  return row!.id;
}

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); vi.clearAllMocks(); });
afterAll(async () => { await pool.end(); });

it("builds a ready KB body + translated body for an RSS item", async () => {
  const id = await makeRss();
  const { runRssKbStage } = await import("../../src/pipeline/rss-kb-stage.js");
  expect(await runRssKbStage(db)).toBe(1);
  const [r] = await db.select().from(rssItems).where(eq(rssItems.id, id));
  expect(r!.kbStatus).toBe("ready");
  expect(r!.bodySource).toBe("markdownnew");
  expect((r!.note as any).overview).toBe("ov");
  expect(r!.bodyZhMd).toBe("译文");
});

it("marks skipped when the body is too short", async () => {
  const id = await makeRss({ summary: "短" });
  const { fetchArticle } = await import("../../src/lib/kb/reader.js");
  (fetchArticle as any).mockResolvedValueOnce({ markdown: "短", images: [], source: "fallback" });
  const { runRssKbStage } = await import("../../src/pipeline/rss-kb-stage.js");
  await runRssKbStage(db);
  const [r] = await db.select().from(rssItems).where(eq(rssItems.id, id));
  expect(r!.kbStatus).toBe("skipped");
});

it("does not re-select an already-ready item", async () => {
  await makeRss();
  const { runRssKbStage } = await import("../../src/pipeline/rss-kb-stage.js");
  expect(await runRssKbStage(db)).toBe(1);
  expect(await runRssKbStage(db)).toBe(0);
});
