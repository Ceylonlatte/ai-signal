import { sql } from "drizzle-orm";
import { makeDb } from "../../src/db/client.js";

const { db, pool } = makeDb(process.env.TEST_DATABASE_URL!);

export { db, pool };

export async function truncateAll() {
  await db.execute(
    sql`TRUNCATE TABLE jobs, items, raw_items, sources RESTART IDENTITY CASCADE`,
  );
}
