import { desc } from "drizzle-orm";
import { items } from "../db/schema.js";

type Db = any;

export async function getFeed(
  db: Db,
  opts: { limit: number },
): Promise<(typeof items.$inferSelect)[]> {
  return db.select().from(items).orderBy(desc(items.createdAt)).limit(opts.limit);
}
