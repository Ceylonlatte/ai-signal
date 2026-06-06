import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { sources, rawItems, ingestRuns } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { ingest } from "../../src/ingest/ingest.js";
import type { RawPayload } from "../../src/types.js";

let sourceId: number;
beforeEach(async () => {
  await truncateAll();
  const [s] = await db.insert(sources).values({ kind: "hn" }).returning();
  sourceId = s!.id;
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

const payload = (id: string): RawPayload => ({
  source: "hn", externalId: id, url: `https://x.com/${id}`, author: "a",
  title: `T${id}`, text: "", createdAt: "2026-05-30T10:00:00Z",
  metrics: { points: 1, comments: 0 }, raw: {},
});

it("upserts raw_items and returns the inserted count", async () => {
  const inserted = await ingest({ db, sourceId, payloads: [payload("1"), payload("2")] });
  expect(inserted).toBe(2);
  expect(await db.select().from(rawItems)).toHaveLength(2);
});

it("is idempotent on re-ingest of the same external_id", async () => {
  await ingest({ db, sourceId, payloads: [payload("1")] });
  const second = await ingest({ db, sourceId, payloads: [payload("1")] });
  expect(second).toBe(0);
  expect(await db.select().from(rawItems)).toHaveLength(1);
});

it("records an ingest_runs accounting row per call (attempted vs inserted)", async () => {
  const feedPayload = (id: string): RawPayload => ({ ...payload(id), source: "twitter", feed: "following" });
  await ingest({ db, sourceId, payloads: [feedPayload("1"), feedPayload("2")] });
  await ingest({ db, sourceId, payloads: [feedPayload("1"), feedPayload("3")] }); // 1 dup
  const runs = await db.select().from(ingestRuns).orderBy(ingestRuns.id);
  expect(runs).toHaveLength(2);
  expect({ source: runs[0]!.source, feed: runs[0]!.feed, attempted: runs[0]!.attempted, inserted: runs[0]!.inserted })
    .toEqual({ source: "twitter", feed: "following", attempted: 2, inserted: 2 });
  expect({ attempted: runs[1]!.attempted, inserted: runs[1]!.inserted }).toEqual({ attempted: 2, inserted: 1 });
});

it("does not record a run for an empty batch", async () => {
  await ingest({ db, sourceId, payloads: [] });
  expect(await db.select().from(ingestRuns)).toHaveLength(0);
});
