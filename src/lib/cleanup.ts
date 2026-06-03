import { sql } from "drizzle-orm";

type Db = any;

// decision: rolling 30-day retention, but is_favorited rows are kept forever.
export async function cleanupOldItems(db: Db, opts: { days: number }): Promise<number> {
  const cond = sql`i.is_favorited = false AND i.created_at < now() - (${opts.days} || ' days')::interval`;
  await db.execute(sql`DELETE FROM item_embeddings e USING items i WHERE e.item_id = i.id AND ${cond}`);
  await db.execute(sql`DELETE FROM scores s USING items i WHERE s.item_id = i.id AND ${cond}`);
  await db.execute(sql`DELETE FROM item_topics it USING items i WHERE it.item_id = i.id AND ${cond}`);
  const res = await db.execute(sql`
    DELETE FROM items i
    WHERE i.is_favorited = false AND i.created_at < now() - (${opts.days} || ' days')::interval
  `);
  return res.rowCount ?? 0;
}
