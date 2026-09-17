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

  // Created with the single-title label, then relabeled from the 3 titles that
  // landed today (3 >= label_n(1) + RELABEL_STEP), stamped with today's day.
  const [topic] = await db.select().from(topics);
  expect(topic!.label).toBe("Claude Fable 5 发布");
  expect(topic!.labelN).toBe(3);
  expect(topic!.labelDate).toBe(new Date().toISOString().slice(0, 10));
});

// The bug this guards: labels used to be debounced on TOTAL membership
// (`count >= label_n + 3 OR count >= label_n * 2`), but the 30-day cleanup
// makes membership shrink. A topic labeled at 40 members and cleaned down to a
// handful satisfied neither branch, so its label froze on an event whose items
// were already deleted — the board showed a title nothing in the list matched.
it("relabels a shrunken topic whose membership fell below the last labeling", async () => {
  await truncateAll();
  const day = new Date().toISOString().slice(0, 10);
  const [stale] = await db.insert(topics).values({
    label: "Archify 与 show-me：AI 图表生成技能集",
    centroid: vec(0),
    labelN: 40,           // labeled back when the topic was big
    labelDate: "2020-01-01",
  }).returning();

  const ins = await db.insert(items).values([
    { rawItemId: 30, source: "hn", title: "Anthropic ships Claude Fable 5", createdAt: new Date(), contentHash: "c30" },
    { rawItemId: 31, source: "hn", title: "Claude Fable 5 first impressions", createdAt: new Date(), contentHash: "c31" },
  ]).returning();
  await db.insert(itemEmbeddings).values(ins.map((row) => ({ itemId: row.id, embedding: vec(0) })));
  await db.insert(scores).values(ins.map((row) => ({ itemId: row.id, composite: 0.6, rubricVersion: "test" })));
  await db.insert(itemTopics).values(ins.map((row) => ({ itemId: row.id, topicId: stale!.id })));
  await db.execute(sql`
    INSERT INTO topic_trends (topic_id, bucket_date, item_count, score_sum)
    VALUES (${stale!.id}, ${day}, 2, 1.2)
  `);

  const { runClusterStage } = await import("../../src/lib/cluster.js");
  await runClusterStage(db, { threshold: 0.2 });

  const [topic] = await db.select().from(topics);
  expect(topic!.label).toBe("Claude Fable 5 发布");
  expect(topic!.labelN).toBe(2);        // today's count, not the old 40
  expect(topic!.labelDate).toBe(day);
});

// The board buckets by day, so today's members lead the titles the labeler
// sees — otherwise a high-scoring item from last week keeps naming the topic.
it("puts today's members in front of older ones when labeling", async () => {
  await truncateAll();
  const day = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [t] = await db.insert(topics).values({
    label: "seed", centroid: vec(0), labelN: 0, labelDate: null,
  }).returning();

  const ins = await db.insert(items).values([
    { rawItemId: 40, source: "hn", title: "OLD high-scoring story", createdAt: yesterday, contentHash: "c40" },
    { rawItemId: 41, source: "hn", title: "Claude Fable 5 first impressions", createdAt: new Date(), contentHash: "c41" },
    { rawItemId: 42, source: "hn", title: "Fable 5 pricing breakdown", createdAt: new Date(), contentHash: "c42" },
  ]).returning();
  await db.insert(itemEmbeddings).values(ins.map((row) => ({ itemId: row.id, embedding: vec(0) })));
  await db.insert(scores).values([
    { itemId: ins[0]!.id, composite: 0.99, rubricVersion: "test" },  // would win an all-time sort
    { itemId: ins[1]!.id, composite: 0.5, rubricVersion: "test" },
    { itemId: ins[2]!.id, composite: 0.4, rubricVersion: "test" },
  ]);
  await db.insert(itemTopics).values([
    { itemId: ins[0]!.id, topicId: t!.id, linkedAt: yesterday },  // joined yesterday
    { itemId: ins[1]!.id, topicId: t!.id },
    { itemId: ins[2]!.id, topicId: t!.id },
  ]);
  await db.execute(sql`
    INSERT INTO topic_trends (topic_id, bucket_date, item_count, score_sum)
    VALUES (${t!.id}, ${day}, 2, 0.9)
  `);

  const { labelTopic } = await import("../../src/lib/scoring/llm.js");
  vi.mocked(labelTopic).mockClear();
  const { runClusterStage } = await import("../../src/lib/cluster.js");
  await runClusterStage(db, { threshold: 0.2 });

  const seen = vi.mocked(labelTopic).mock.calls.at(-1)![0];
  expect(seen.slice(0, 2)).toEqual(["Claude Fable 5 first impressions", "Fable 5 pricing breakdown"]);
  expect(seen.indexOf("OLD high-scoring story")).toBe(2);  // present, but last
});

// A topic can reach today's board with nothing stamped linked_at today — rows
// backfilled by the linked_at migration are the live case. Skipping those left
// 67 of 92 topics on the prod board wearing labels built from items the 30-day
// cleanup had deleted, which is the bug in the first place. Being on the board
// is the whole condition; the newest members supply the title.
it("relabels a topic on today's board even with no member linked today", async () => {
  await truncateAll();
  const day = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [stale] = await db.insert(topics).values({
    label: "Archify 与 show-me：AI 图表生成技能集",
    centroid: vec(0), labelN: 11, labelDate: null,
  }).returning();

  const ins = await db.insert(items).values([
    { rawItemId: 60, source: "hn", title: "Anthropic ships Claude Fable 5", createdAt: yesterday, contentHash: "c60" },
    { rawItemId: 61, source: "hn", title: "Claude Fable 5 first impressions", createdAt: yesterday, contentHash: "c61" },
  ]).returning();
  await db.insert(itemEmbeddings).values(ins.map((row) => ({ itemId: row.id, embedding: vec(0) })));
  await db.insert(scores).values(ins.map((row) => ({ itemId: row.id, composite: 0.5, rubricVersion: "test" })));
  await db.insert(itemTopics).values(ins.map((row) => ({
    itemId: row.id, topicId: stale!.id, linkedAt: yesterday,   // nothing linked today
  })));
  await db.execute(sql`
    INSERT INTO topic_trends (topic_id, bucket_date, item_count, score_sum)
    VALUES (${stale!.id}, ${day}, 2, 1.0)
  `);

  const { runClusterStage } = await import("../../src/lib/cluster.js");
  await runClusterStage(db, { threshold: 0.2 });

  const [topic] = await db.select().from(topics);
  expect(topic!.label).toBe("Claude Fable 5 发布");
  expect(topic!.labelDate).toBe(day);
  expect(topic!.labelN).toBe(0);   // no member linked today; the day still got labeled
});

// The backlog clusters most items a day or more after they land, so "today's
// items" has to mean the day they JOINED the topic. Keying off items.created_at
// left the majority of the board unlabelable: on 2026-09-17 prod bucketed 126
// items into today's trends while only 30 of them were created that day, so 67
// of 92 topics on the board could never be relabeled.
it("counts an item clustered today even if it was ingested earlier", async () => {
  await truncateAll();
  const day = new Date().toISOString().slice(0, 10);
  const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [t] = await db.insert(topics).values({
    label: "seed", centroid: vec(0), labelN: 0, labelDate: null,
  }).returning();

  const ins = await db.insert(items).values([
    { rawItemId: 50, source: "hn", title: "Claude Fable 5 first impressions", createdAt: lastWeek, contentHash: "c50" },
    { rawItemId: 51, source: "hn", title: "Fable 5 pricing breakdown", createdAt: lastWeek, contentHash: "c51" },
  ]).returning();
  await db.insert(itemEmbeddings).values(ins.map((row) => ({ itemId: row.id, embedding: vec(0) })));
  await db.insert(scores).values(ins.map((row) => ({ itemId: row.id, composite: 0.5, rubricVersion: "test" })));
  // Ingested a week ago, drained out of the backlog and clustered just now.
  await db.insert(itemTopics).values(ins.map((row) => ({ itemId: row.id, topicId: t!.id })));
  await db.execute(sql`
    INSERT INTO topic_trends (topic_id, bucket_date, item_count, score_sum)
    VALUES (${t!.id}, ${day}, 2, 1.0)
  `);

  const { runClusterStage } = await import("../../src/lib/cluster.js");
  await runClusterStage(db, { threshold: 0.2 });

  const [topic] = await db.select().from(topics);
  expect(topic!.label).toBe("Claude Fable 5 发布");
  expect(topic!.labelDate).toBe(day);
  expect(topic!.labelN).toBe(2);
});
