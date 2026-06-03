import { sql } from "drizzle-orm";
import { makeDb } from "../../src/db/client.js";

const { db, pool } = makeDb(process.env.TEST_DATABASE_URL!);

export { db, pool };

// Truncate every app table (public schema) so tests stay isolated as the
// schema grows (scores/feedback/embeddings/topics added in later milestones).
export async function truncateAll() {
  const { rows } = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
}
