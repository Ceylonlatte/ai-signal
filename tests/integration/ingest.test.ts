import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { sources, rawItems, jobs } from "../../src/db/schema.js";
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

it("upserts raw_items and enqueues one normalize job per new item", async () => {
  const inserted = await ingest({ db, sourceId, payloads: [payload("1"), payload("2")] });
  expect(inserted).toBe(2);
  expect(await db.select().from(rawItems)).toHaveLength(2);
  const j = await db.select().from(jobs);
  expect(j).toHaveLength(2);
  expect(j.every((x) => x.stage === "normalize")).toBe(true);
});

it("is idempotent on re-ingest of the same external_id", async () => {
  await ingest({ db, sourceId, payloads: [payload("1")] });
  await ingest({ db, sourceId, payloads: [payload("1")] });
  expect(await db.select().from(rawItems)).toHaveLength(1);
  expect(await db.select().from(jobs)).toHaveLength(1);
});
