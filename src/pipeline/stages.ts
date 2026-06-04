import { eq, sql as dsql } from "drizzle-orm";
import { itemEmbeddings, scores } from "../db/schema.js";
import { embedTexts } from "../lib/embeddings.js";
import { computeNovelty } from "../lib/novelty.js";

type Db = any;

export async function runEmbedStage(db: Db): Promise<number> {
  const rows = await db.execute(dsql`
    SELECT i.id, i.title, i.text FROM items i
    LEFT JOIN item_embeddings e ON e.item_id = i.id
    WHERE e.item_id IS NULL
    LIMIT 100
  `);
  const items_ = (rows.rows ?? rows) as Array<{ id: number; title: string; text: string }>;
  if (items_.length === 0) return 0;

  const vectors = await embedTexts(items_.map((r) => `${r.title}\n${r.text ?? ""}`.slice(0, 2000)));
  for (let i = 0; i < items_.length; i++) {
    const itemId = Number(items_[i]!.id);
    await db.insert(itemEmbeddings)
      .values({ itemId, embedding: vectors[i]! })
      .onConflictDoNothing({ target: itemEmbeddings.itemId });
    // Backfill novelty now that this item's embedding exists.
    const novelty = await computeNovelty(db, itemId, { days: 7 });
    await db.update(scores).set({ novelty }).where(eq(scores.itemId, itemId));
  }
  return items_.length;
}
