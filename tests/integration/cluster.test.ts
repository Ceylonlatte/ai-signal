import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { items, itemEmbeddings, topics, itemTopics } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";

vi.mock("../../src/lib/scoring/llm.js", async (orig) => ({
  ...(await orig() as object),
  labelTopic: vi.fn(async () => "Agentic coding"),
}));

function vec(seed: number) { return Array(2048).fill(0).map((_, i) => (i === seed ? 1 : 0)); }

beforeEach(async () => {
  await truncateAll();
  const ins = await db.insert(items).values([
    { rawItemId: 1, source: "hn", title: "agent post 1", createdAt: new Date(), contentHash: "h1" },
    { rawItemId: 2, source: "hn", title: "agent post 2", createdAt: new Date(), contentHash: "h2" },
    { rawItemId: 3, source: "hn", title: "unrelated", createdAt: new Date(), contentHash: "h3" },
  ]).returning();
  await db.insert(itemEmbeddings).values([
    { itemId: ins[0]!.id, embedding: vec(0) },
    { itemId: ins[1]!.id, embedding: vec(0) },
    { itemId: ins[2]!.id, embedding: vec(7) },
  ]);
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("groups similar items into one topic and a dissimilar item into another", async () => {
  const { runClusterStage } = await import("../../src/lib/cluster.js");
  await runClusterStage(db, { threshold: 0.2 });
  const t = await db.select().from(topics);
  expect(t.length).toBe(2);
  const links = await db.select().from(itemTopics);
  expect(links.length).toBe(3);
});
