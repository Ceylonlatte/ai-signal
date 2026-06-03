import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { sources } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { getSourceStatus } from "../../src/app/source-status.js";

beforeEach(async () => {
  await truncateAll();
  await db.insert(sources).values([
    { kind: "twitter", lastRunAt: new Date(Date.now() - 10 * 3600e3) },
    { kind: "hn", lastRunAt: new Date(Date.now() - 1 * 3600e3) },
  ]);
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("flags sources stale beyond their threshold", async () => {
  const status = await getSourceStatus(db);
  const tw = status.find((s: any) => s.kind === "twitter");
  const hn = status.find((s: any) => s.kind === "hn");
  expect(tw.stale).toBe(true);
  expect(hn.stale).toBe(false);
});
