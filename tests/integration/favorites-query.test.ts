import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { items, kbEntries } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";

vi.mock("../../src/db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/client.js")>();
  const { db, pool } = actual.makeDb(process.env.TEST_DATABASE_URL!);
  return { ...actual, db, pool };
});

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("returns favorited items newest-favorite-first with kb note + status", async () => {
  const base = { rawItemId: 1, source: "hn", title: "t", createdAt: new Date() };
  const [older] = await db.insert(items).values({ ...base, contentHash: "a", isFavorited: true, favoritedAt: new Date("2026-06-01") }).returning();
  const [newer] = await db.insert(items).values({ ...base, contentHash: "b", isFavorited: true, favoritedAt: new Date("2026-06-10") }).returning();
  await db.insert(items).values({ ...base, contentHash: "c", isFavorited: false }).returning();
  await db.insert(kbEntries).values({ itemId: newer!.id, status: "ready", note: { overview: "ov" } });

  const { getFavorites } = await import("../../src/app/feed-queries.js");
  const rows = await getFavorites(db, { limit: 50 });
  expect(rows.map((r) => r.id)).toEqual([newer!.id, older!.id]);
  expect(rows[0]!.status).toBe("ready");
  expect((rows[0]!.note as any).overview).toBe("ov");
});
