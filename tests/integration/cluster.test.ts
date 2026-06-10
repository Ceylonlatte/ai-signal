import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { items, itemEmbeddings, topics, itemTopics, scores } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";

// Creation labels see one title; relabels see the member titles, so the
// return value distinguishes the two paths.
vi.mock("../../src/lib/scoring/llm.js", async (orig) => ({
  ...(await orig() as object),
  labelTopic: vi.fn(async (titles: string[]) =>
    titles.length > 1 ? "Claude Fable 5 发布" : "Agentic coding"),
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

it("folds new members into the topic centroid (running mean)", async () => {
  await truncateAll();
  const ins = await db.insert(items).values([
    { rawItemId: 10, source: "hn", title: "a", createdAt: new Date(), contentHash: "c10" },
    { rawItemId: 11, source: "hn", title: "b", createdAt: new Date(), contentHash: "c11" },
  ]).returning();
  // Two vectors close enough to cluster together (cosine dist ~0.02 < 0.2) but
  // differing on dim 1, so a working running-mean must move the centroid there.
  const a = Array(2048).fill(0); a[0] = 1;
  const b = Array(2048).fill(0); b[0] = 1; b[1] = 0.2;
  await db.insert(itemEmbeddings).values([
    { itemId: ins[0]!.id, embedding: a },
    { itemId: ins[1]!.id, embedding: b },
  ]);

  const { runClusterStage } = await import("../../src/lib/cluster.js");
  await runClusterStage(db, { threshold: 0.2 });

  const t = await db.select().from(topics);
  expect(t.length).toBe(1);
  const res = await db.execute(sql`SELECT centroid FROM topics LIMIT 1`);
  const centroid = JSON.parse(((res.rows ?? res)[0] as { centroid: string }).centroid) as number[];
  // Frozen-centroid behaviour would leave dim 1 at 0; the running mean lifts it.
  expect(centroid[1]).toBeGreaterThan(0.05);
});

it("relabels a topic from member titles once membership grows", async () => {
  await truncateAll();
  const ins = await db.insert(items).values([
    { rawItemId: 20, source: "hn", title: "Anthropic ships Claude Fable 5", createdAt: new Date(), contentHash: "c20" },
    { rawItemId: 21, source: "hn", title: "Claude Fable 5 first impressions", createdAt: new Date(), contentHash: "c21" },
    { rawItemId: 22, source: "hn", title: "Fable 5 pricing breakdown", createdAt: new Date(), contentHash: "c22" },
  ]).returning();
  await db.insert(itemEmbeddings).values(ins.map((row) => ({ itemId: row.id, embedding: vec(0) })));
  await db.insert(scores).values([
    { itemId: ins[0]!.id, composite: 0.7, rubricVersion: "test" },
    { itemId: ins[1]!.id, composite: 0.6, rubricVersion: "test" },
    { itemId: ins[2]!.id, composite: 0.6, rubricVersion: "test" },
  ]);

  const { runClusterStage } = await import("../../src/lib/cluster.js");
  await runClusterStage(db, { threshold: 0.2 });

  // Created with the single-title label, then relabeled from 3 member titles
  // (3 >= label_n(1) * 2), recording the member count at labeling time.
  const [topic] = await db.select().from(topics);
  expect(topic!.label).toBe("Claude Fable 5 发布");
  expect(topic!.labelN).toBe(3);
});
