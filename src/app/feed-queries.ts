import { desc, eq, sql } from "drizzle-orm";
import { items, scores } from "../db/schema.js";

type Db = any;

export async function getFeed(db: Db, opts: { limit: number }) {
  const rows = await db
    .select({
      id: items.id, title: items.title, url: items.url, source: items.source,
      createdAt: items.createdAt,
      composite: scores.composite, summary: scores.summary,
      reason: scores.reason, topicTags: scores.topicTags,
    })
    .from(items)
    .leftJoin(scores, eq(scores.itemId, items.id))
    .orderBy(sql`${scores.composite} desc nulls last`, desc(items.createdAt))
    .limit(opts.limit);
  return rows;
}
