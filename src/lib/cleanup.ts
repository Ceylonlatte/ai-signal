import { sql } from "drizzle-orm";
import { deletePrefix, r2Configured } from "./kb/r2.js";

type Db = any;

export interface CleanupStats {
  /** Expired corpus rows removed (favorites never counted — they're kept forever). */
  items: number;
  /** Child rows (scores/embeddings/topics/kb) removed because their item was gone. */
  orphanChildren: number;
  /** Expired raw_items whose heavy `payload->'raw'` blob was stripped. */
  rawPayloadsSlimmed: number;
  /** Expired standalone RSS rows removed. */
  rssItems: number;
  /** Stale topics that ended up with zero members, plus their trend/decision rows. */
  orphanTopics: number;
}

// decision: rolling 30-day retention, but is_favorited rows are kept forever.
// KB now exists for every ingested item, so we also drop each expiring item's
// kb_entry and its transferred R2 images — otherwise the corpus deletes the item
// but leaks its knowledge-base row + bucket objects.
//
// Everything past the item sweep is the rest of the retention story, added after
// prod showed the corpus holding steady at 30 days while the tables around it
// grew forever. Each of those sweeps is deliberately narrower than "delete old
// rows", because three of these tables are read for their full history:
//
//   * raw_items is the dedupe ledger AND the source of /raw + keyword search
//     (both render straight out of `payload`), so the row and its display fields
//     must survive. Only `payload->'raw'` — the untouched upstream API document,
//     roughly half the table's bytes — is dropped, and only once the item is past
//     retention. kb-stage reads that blob for reddit comment trees, but only for
//     rows it is still processing, which are days old at most.
//   * model_usage is NOT swept: /status sums it for all-time spend, and the whole
//     table is ~8 MB. Deleting it would trade a real number for nothing.
//   * topics only go when they have no members left and haven't been touched in a
//     full retention window. The age gate is what makes this safe to run beside a
//     live worker: the cluster stage inserts a topic and its first item_topics row
//     in two statements, and a brand-new topic has last_seen = now(), so it can
//     never be caught in that gap.
export async function cleanupOldItems(db: Db, opts: { days: number }): Promise<CleanupStats> {
  const age = sql`(${opts.days} || ' days')::interval`;
  const cond = sql`i.is_favorited = false AND i.created_at < now() - ${age}`;

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
    WHERE i.is_favorited = false AND i.created_at < now() - ${age}
  `);

  // Child rows whose item vanished some other way (an older cleanup that predated
  // this table, a manual delete, an interrupted run). Prod had 97 such embeddings
  // — each one a 2048-dim vector — with no way to ever be reached again.
  let orphanChildren = 0;
  for (const table of ["item_embeddings", "scores", "item_topics", "kb_entries"]) {
    const r = await db.execute(sql`
      DELETE FROM ${sql.raw(table)} c
      WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.id = c.item_id)
    `);
    orphanChildren += r.rowCount ?? 0;
  }

  // Keep the row (dedupe ledger) and its display fields (/raw, search); drop only
  // the upstream blob. `jsonb_exists` makes the sweep idempotent, so each nightly
  // run rewrites just the rows that crossed the line that day instead of churning
  // the whole back catalogue through WAL.
  const slim = await db.execute(sql`
    UPDATE raw_items SET payload = payload - 'raw'
    WHERE fetched_at < now() - ${age} AND jsonb_exists(payload, 'raw')
  `);

  // rss_items never enter items/triage, so the item sweep above can't reach them.
  // The collector only bounds what it inserts (a 48h publish window), never what
  // it leaves behind, so without this the /rss tab's backing table grows forever.
  const rss = await db.execute(sql`DELETE FROM rss_items WHERE published_at < now() - ${age}`);

  const orphanTopic = sql`
    t.last_seen < now() - ${age}
    AND NOT EXISTS (SELECT 1 FROM item_topics it WHERE it.topic_id = t.id)
  `;
  await db.execute(sql`DELETE FROM topic_trends x USING topics t WHERE x.topic_id = t.id AND ${orphanTopic}`);
  await db.execute(sql`
    DELETE FROM topic_merge_decisions x USING topics t
    WHERE (x.a_id = t.id OR x.b_id = t.id) AND ${orphanTopic}
  `);
  const deadTopics = await db.execute(sql`DELETE FROM topics t WHERE ${orphanTopic}`);

  // Best-effort R2 GC after the rows are gone; a failure must not fail cleanup.
  for (const id of imageItemIds) {
    await deletePrefix(`kb/${id}/`).catch((e) => console.error("r2 cleanup failed", id, e));
  }
  return {
    items: res.rowCount ?? 0,
    orphanChildren,
    rawPayloadsSlimmed: slim.rowCount ?? 0,
    rssItems: rss.rowCount ?? 0,
    orphanTopics: deadTopics.rowCount ?? 0,
  };
}
