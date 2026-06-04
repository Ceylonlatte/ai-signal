import { sql } from "drizzle-orm";

type Db = any;

// novelty = 1 - max cosine similarity to other items embedded in the last `days`.
// pgvector `<=>` is cosine DISTANCE (0 = identical). MIN(distance) = nearest neighbor;
// max_sim = 1 - MIN(distance); novelty = 1 - max_sim.
export async function computeNovelty(db: Db, itemId: number, opts: { days: number }): Promise<number> {
  const res = await db.execute(sql`
    SELECT 1 - MIN(e.embedding <=> target.embedding) AS max_sim
    FROM item_embeddings e
    JOIN items i ON i.id = e.item_id
    CROSS JOIN (SELECT embedding FROM item_embeddings WHERE item_id = ${itemId}) target
    WHERE e.item_id <> ${itemId}
      AND i.created_at > now() - (${opts.days} || ' days')::interval
  `);
  const row = (res.rows ?? res)[0] as { max_sim: number | null } | undefined;
  const maxSim = row?.max_sim ?? 0;
  return Math.max(0, Math.min(1, 1 - maxSim));
}

// Same as computeNovelty but for an in-memory vector not yet persisted as an
// item (used to backfill novelty for rescued items before their insert).
export async function computeNoveltyForVector(
  db: Db, vec: number[], opts: { days: number },
): Promise<number> {
  const res = await db.execute(sql`
    SELECT 1 - MIN(e.embedding <=> ${JSON.stringify(vec)}::vector) AS max_sim
    FROM item_embeddings e JOIN items i ON i.id = e.item_id
    WHERE i.created_at > now() - (${opts.days} || ' days')::interval
  `);
  const row = (res.rows ?? res)[0] as { max_sim: number | null } | undefined;
  const maxSim = row?.max_sim ?? 0;
  return Math.max(0, Math.min(1, 1 - maxSim));
}
