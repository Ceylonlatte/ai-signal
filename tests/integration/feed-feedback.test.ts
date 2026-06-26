import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { items, scores, feedback } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { getFeed, getSuppressed } from "../../src/app/feed-queries.js";

// embeddings are vector(2048); build an orthogonal basis vector with 1 at index i.
const e = (i: number) => Array.from({ length: 2048 }, (_, k) => (k === i ? 1 : 0));

beforeEach(async () => {
  await truncateAll();
  const now = new Date();
  const mk = async (hash: string, emb: number[], withScore: boolean) => {
    const [it] = await db.insert(items).values({
      rawItemId: 1, source: "hn", title: hash, text: "", createdAt: now,
      metrics: { points: 100 }, contentHash: hash,
    }).returning();
    if (withScore) {
      await db.insert(scores).values({ itemId: it!.id, composite: 0.7, novelty: 0.2, rubricVersion: "t", summaryEn: "x" });
    }
    await db.execute(sql`INSERT INTO item_embeddings (item_id, embedding) VALUES (${it!.id}, ${JSON.stringify(emb)}::vector)`);
    return it!.id;
  };

  // feed candidates (have scores)
  await mk("liked", e(0), true);
  await mk("simdown", e(1), true);
  await mk("neutral", e(2), true);

  // reference items (no scores -> not in feed themselves): one ⭐ favorited
  // (the positive signal that drives like-affinity), one down-voted (negative).
  const favRef = await mk("favref", e(0), false);
  await db.update(items).set({ isFavorited: true, favoritedAt: now }).where(eq(items.id, favRef));
  const downRef = await mk("downref", e(1), false);
  await db.insert(feedback).values({ itemId: downRef, signal: "down" });
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("hides items similar to a downvoted one from the feed", async () => {
  const feed = await getFeed(db, { page: 1, pageSize: 50 });
  expect(feed.items.map((r: any) => r.title)).not.toContain("simdown");
});

it("surfaces suppressed items in the suppressed view", async () => {
  const sup = await getSuppressed(db, { limit: 50 });
  expect(sup.map((r: any) => r.title)).toContain("simdown");
});

it("ranks liked-similar item above neutral", async () => {
  const feed = await getFeed(db, { page: 1, pageSize: 50 });
  const titles = feed.items.map((r: any) => r.title).filter((t: string) => ["liked", "neutral"].includes(t));
  expect(titles[0]).toBe("liked");
});
