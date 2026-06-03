import { migrate } from "drizzle-orm/node-postgres/migrator";
import { makeDb } from "../../src/db/client.js";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required for tests");
  const { db, pool } = makeDb(url);
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  await pool.end();
}
