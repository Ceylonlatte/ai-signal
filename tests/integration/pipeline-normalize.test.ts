import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sources, rawItems, items, jobs } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { runPendingJobs } from "../../src/pipeline/stages.js";
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

const payload: RawPayload = {
  source: "hn", externalId: "1", url: "https://www.example.com/a/?utm_source=x",
  author: "pg", title: " Hello ", text: "Body", createdAt: "2026-05-30T10:00:00Z",
  metrics: { points: 10, comments: 2 }, raw: {},
};

it("normalize job creates one item and marks the job done", async () => {
  await ingest({ db, sourceId, payloads: [payload] });
  const processed = await runPendingJobs(db, { max: 10 });
  expect(processed).toBe(1);

  const rows = await db.select().from(items);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.title).toBe("Hello");
  expect(rows[0]!.canonicalUrl).toBe("https://example.com/a");

  const j = await db.select().from(jobs).where(eq(jobs.stage, "normalize"));
  expect(j[0]!.status).toBe("done");
});

it("duplicate content_hash does not create a second item", async () => {
  await ingest({ db, sourceId, payloads: [payload, { ...payload, externalId: "2" }] });
  await runPendingJobs(db, { max: 10 });
  expect(await db.select().from(items)).toHaveLength(1);
});
