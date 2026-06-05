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
  feed: "hot",
  items: [{
    id: "abc", title: "Post", author: "u",
    url: "https://reddit.com/abc", created_utc: 1780000000,
    score: 5, comments: 1, selftext: "",
  }],
});

it("rejects without bearer token", async () => {
  const { POST } = await importRoute();
  const res = await POST(new Request("http://x/api/ingest", { method: "POST", body }));
  expect(res.status).toBe(401);
});

it("maps raw reddit items and stores them", async () => {
  process.env.INGEST_TOKEN = "dev-token";
  const { POST } = await importRoute();
  const res = await POST(new Request("http://x/api/ingest", {
    method: "POST",
    headers: { authorization: "Bearer dev-token" },
    body,
  }));
  expect(res.status).toBe(200);
  const rows = await db.select().from(rawItems);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.payload).toMatchObject({
    source: "reddit", externalId: "abc", feed: "hot",
    metrics: { score: 5, comments: 1 },
  });
  expect(await res.json()).toEqual({ inserted: 1, mapped: 1 });
});

it("maps raw twitter items with feed + replies", async () => {
  process.env.INGEST_TOKEN = "dev-token";
  const { POST } = await importRoute();
  const res = await POST(new Request("http://x/api/ingest", {
    method: "POST",
    headers: { authorization: "Bearer dev-token" },
    body: JSON.stringify({
      source: "twitter",
      feed: "following",
      items: [{
        id: "t1", author: "alice", text: "hi there",
        likes: 4, retweets: 2, replies: 1,
        created_at: "Thu Jun 04 12:54:33 +0000 2026",
        url: "https://x.com/alice/status/t1",
      }],
    }),
  }));
  expect(res.status).toBe(200);
  const rows = await db.select().from(rawItems);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.payload).toMatchObject({
    source: "twitter", externalId: "t1", feed: "following",
    title: "hi there", metrics: { likes: 4, retweets: 2, replies: 1 },
  });
});
