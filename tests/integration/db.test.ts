import { afterEach, afterAll, expect, it } from "vitest";
import { sources } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";

afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("inserts and reads a source", async () => {
  await db.insert(sources).values({ kind: "hn" });
  const rows = await db.select().from(sources);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.kind).toBe("hn");
});
