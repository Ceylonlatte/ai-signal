import { sql } from "drizzle-orm";
import { deletePrefix, r2Configured } from "./kb/r2.js";

type Db = any;

// decision: rolling 30-day retention, but is_favorited rows are kept forever.
// KB now exists for every ingested item, so we also drop each expiring item's
// kb_entry and its transferred R2 images — otherwise the corpus deletes the item
// but leaks its knowledge-base row + bucket objects.
export async function cleanupOldItems(db: Db, opts: { days: number }): Promise<number> {
  const cond = sql`i.is_favorited = false AND i.created_at < now() - (${opts.days} || ' days')::interval`;

  // Collect expiring items that actually transferred images, so R2 GC only fires
  // where there's something to delete (twitter/reddit carry no images).
  let imageItemIds: number[] = [];
  if (r2Configured()) {
    const res = await db.execute(sql`
      SELECT i.id FROM items i JOIN kb_entries k ON k.item_id = i.id
      WHERE ${cond} AND k.images <> '[]'::jsonb
    `);
    imageItemIds = ((res.rows ?? res) as Array<{ id: number }>).map((r) => Number(r.id));
  }

  await db.execute(sql`DELETE FROM item_embeddings e USING items i WHERE e.item_id = i.id AND ${cond}`);
  await db.execute(sql`DELETE FROM scores s USING items i WHERE s.item_id = i.id AND ${cond}`);
  await db.execute(sql`DELETE FROM item_topics it USING items i WHERE it.item_id = i.id AND ${cond}`);
  await db.execute(sql`DELETE FROM kb_entries k USING items i WHERE k.item_id = i.id AND ${cond}`);
  const res = await db.execute(sql`
    DELETE FROM items i
    WHERE i.is_favorited = false AND i.created_at < now() - (${opts.days} || ' days')::interval
  `);

  // Best-effort R2 GC after the rows are gone; a failure must not fail cleanup.
  for (const id of imageItemIds) {
    await deletePrefix(`kb/${id}/`).catch((e) => console.error("r2 cleanup failed", id, e));
  }
  return res.rowCount ?? 0;
}
