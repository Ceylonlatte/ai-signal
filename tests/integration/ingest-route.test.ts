import { afterAll, afterEach, expect, it, vi } from "vitest";
import { db, pool, truncateAll } from "../setup/db.js";
import { rawItems } from "../../src/db/schema.js";

vi.mock("../../src/db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/client.js")>();
  const { db, pool } = actual.makeDb(process.env.TEST_DATABASE_URL!);
  return { ...actual, db, pool };
});

afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

async function importRoute() { return import("../../src/app/api/ingest/route.js"); }

const body = JSON.stringify({
  source: "reddit",
  items: [{
    source: "reddit", externalId: "abc", url: "https://reddit.com/abc", author: "u",
    title: "Post", text: "", createdAt: "2026-05-30T10:00:00Z",
    metrics: { score: 5, comments: 1 }, raw: {},
  }],
});

it("rejects without bearer token", async () => {
  const { POST } = await importRoute();
  const res = await POST(new Request("http://x/api/ingest", { method: "POST", body }));
  expect(res.status).toBe(401);
});

it("accepts with valid token and stores raw items", async () => {
  process.env.INGEST_TOKEN = "dev-token";
  const { POST } = await importRoute();
  const res = await POST(new Request("http://x/api/ingest", {
    method: "POST",
    headers: { authorization: "Bearer dev-token" },
    body,
  }));
  expect(res.status).toBe(200);
  expect(await db.select().from(rawItems)).toHaveLength(1);
});
