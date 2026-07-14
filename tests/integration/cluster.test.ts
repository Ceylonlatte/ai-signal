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

it("reabsorbs a stale singleton into the topic that now accepts it", async () => {
  await truncateAll();
  const ins = await db.insert(items).values([
    { rawItemId: 30, source: "hn", title: "orphan", createdAt: new Date(), contentHash: "c30" },
    { rawItemId: 31, source: "hn", title: "member 1", createdAt: new Date(), contentHash: "c31" },
    { rawItemId: 32, source: "hn", title: "member 2", createdAt: new Date(), contentHash: "c32" },
    { rawItemId: 33, source: "hn", title: "far orphan", createdAt: new Date(), contentHash: "c33" },
  ]).returning();
  // orphan sits ~0.04 cosine dist from the target centroid; far orphan is
  // orthogonal to everything and must be left alone.
  const nearOrphan = Array(2048).fill(0); nearOrphan[0] = 1; nearOrphan[1] = 0.3;
  const member = Array(2048).fill(0); member[0] = 1;
  const farAway = Array(2048).fill(0); farAway[7] = 1;
  await db.insert(itemEmbeddings).values([
    { itemId: ins[0]!.id, embedding: nearOrphan },
    { itemId: ins[1]!.id, embedding: member },
    { itemId: ins[2]!.id, embedding: member },
    { itemId: ins[3]!.id, embedding: farAway },
  ]);
  const staleDate = new Date(Date.now() - 8 * 86400_000);
  const [orphan] = await db.insert(topics).values(
    { label: "stale orphan", centroid: nearOrphan, labelN: 1, lastSeen: staleDate }).returning();
  const [target] = await db.insert(topics).values(
    { label: "target", centroid: member, labelN: 2 }).returning();
  const [farOrphan] = await db.insert(topics).values(
    { label: "far orphan", centroid: farAway, labelN: 1, lastSeen: staleDate }).returning();
  await db.insert(itemTopics).values([
    { itemId: ins[0]!.id, topicId: orphan!.id },
    { itemId: ins[1]!.id, topicId: target!.id },
    { itemId: ins[2]!.id, topicId: target!.id },
    { itemId: ins[3]!.id, topicId: farOrphan!.id },
  ]);

  const { reabsorbOrphanTopics } = await import("../../src/lib/cluster.js");
  expect(await reabsorbOrphanTopics(db, { threshold: 0.2 })).toBe(1);

  const remaining = await db.select().from(topics);
  expect(remaining.map((t) => t.id).sort()).toEqual([target!.id, farOrphan!.id].sort());
  const links = await db.select().from(itemTopics);
  expect(links.filter((l) => l.topicId === target!.id)).toHaveLength(3);
  // second run: nothing left to absorb
  expect(await reabsorbOrphanTopics(db, { threshold: 0.2 })).toBe(0);
});

it("leaves fresh singletons alone — merge stage still owns the active window", async () => {
  await truncateAll();
  const ins = await db.insert(items).values([
    { rawItemId: 40, source: "hn", title: "fresh orphan", createdAt: new Date(), contentHash: "c40" },
    { rawItemId: 41, source: "hn", title: "member", createdAt: new Date(), contentHash: "c41" },
  ]).returning();
  const near = Array(2048).fill(0); near[0] = 1; near[1] = 0.3;
  const member = Array(2048).fill(0); member[0] = 1;
  await db.insert(itemEmbeddings).values([
    { itemId: ins[0]!.id, embedding: near },
    { itemId: ins[1]!.id, embedding: member },
  ]);
  const [orphan] = await db.insert(topics).values(
    { label: "fresh orphan", centroid: near, labelN: 1 }).returning(); // last_seen = now
  const [target] = await db.insert(topics).values(
    { label: "target", centroid: member, labelN: 1 }).returning();
  await db.insert(itemTopics).values([
    { itemId: ins[0]!.id, topicId: orphan!.id },
    { itemId: ins[1]!.id, topicId: target!.id },
  ]);

  const { reabsorbOrphanTopics } = await import("../../src/lib/cluster.js");
  expect(await reabsorbOrphanTopics(db, { threshold: 0.2 })).toBe(0);
  expect(await db.select().from(topics)).toHaveLength(2);
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
