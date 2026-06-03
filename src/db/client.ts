import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export function makeDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}

const { db, pool } = makeDb(process.env.DATABASE_URL!);
export { db, pool, schema };
