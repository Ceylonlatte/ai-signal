import { afterAll, afterEach, expect, it, vi } from "vitest";
import { db, pool, truncateAll } from "../setup/db.js";
import { feedback } from "../../src/db/schema.js";

// Override the app db client with a connection to the TEST database.
// Use importOriginal (not an import of setup/db.js) to avoid a circular
// mock-factory deadlock, and spread ...actual so makeDb/schema stay exported.
vi.mock("../../src/db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/client.js")>();
  const { db, pool } = actual.makeDb(process.env.TEST_DATABASE_URL!);
  return { ...actual, db, pool };
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("records an up signal", async () => {
  const { POST } = await import("../../src/app/api/feedback/route.js");
  const res = await POST(new Request("http://x/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId: 7, signal: "up" }),
  }));
  expect(res.status).toBe(200);
  const rows = await db.select().from(feedback);
  expect(rows[0]).toMatchObject({ itemId: 7, signal: "up" });
});

it("rejects an invalid signal", async () => {
  const { POST } = await import("../../src/app/api/feedback/route.js");
  const res = await POST(new Request("http://x/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId: 7, signal: "sideways" }),
  }));
  expect(res.status).toBe(400);
});
