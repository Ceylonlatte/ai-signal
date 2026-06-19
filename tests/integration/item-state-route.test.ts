import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { items, kbEntries } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";

// Override the app db client with a connection to the TEST database.
// Use importOriginal (not an import of setup/db.js) to avoid a circular
// mock-factory deadlock, and spread ...actual so makeDb/schema stay exported.
vi.mock("../../src/db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/client.js")>();
  const { db, pool } = actual.makeDb(process.env.TEST_DATABASE_URL!);
  return { ...actual, db, pool };
});

let id: number;
beforeEach(async () => {
  await truncateAll();
  const [it] = await db.insert(items).values({ rawItemId: 1, source: "hn", title: "x", contentHash: "h1", createdAt: new Date() }).returning();
  id = it!.id;
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("toggles favorite", async () => {
  const { PATCH } = await import("../../src/app/api/items/[id]/route.js");
  const res = await PATCH(
    new Request(`http://x/api/items/${id}`, { method: "PATCH", body: JSON.stringify({ isFavorited: true }) }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  expect(res.status).toBe(200);
  const [row] = await db.select().from(items).where(eq(items.id, id));
  expect(row!.isFavorited).toBe(true);
});

it("sets favorited_at when favoriting and clears it when unfavoriting", async () => {
  const { PATCH } = await import("../../src/app/api/items/[id]/route.js");
  const on = await PATCH(
    new Request(`http://x/api/items/${id}`, { method: "PATCH", body: JSON.stringify({ isFavorited: true }) }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  expect(on.status).toBe(200);
  const [a] = await db.select().from(items).where(eq(items.id, id));
  expect(a!.favoritedAt).toBeInstanceOf(Date);

  const off = await PATCH(
    new Request(`http://x/api/items/${id}`, { method: "PATCH", body: JSON.stringify({ isFavorited: false }) }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  expect(off.status).toBe(200);
  const [b] = await db.select().from(items).where(eq(items.id, id));
  expect(b!.favoritedAt).toBeNull();
});

it("deletes the kb_entry when unfavoriting (so re-favoriting reprocesses fresh)", async () => {
  const { PATCH } = await import("../../src/app/api/items/[id]/route.js");
  await db.insert(kbEntries).values({ itemId: id, status: "failed", attempts: 3 });
  const res = await PATCH(
    new Request(`http://x/api/items/${id}`, { method: "PATCH", body: JSON.stringify({ isFavorited: false }) }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  expect(res.status).toBe(200);
  const rows = await db.select().from(kbEntries).where(eq(kbEntries.itemId, id));
  expect(rows).toHaveLength(0);
});
