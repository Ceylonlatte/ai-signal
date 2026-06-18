import { eq, sql as dsql } from "drizzle-orm";
import { kbEntries } from "../db/schema.js";
import { config } from "../config.js";
import { fetchArticle } from "../lib/kb/reader.js";
import { localizeImages } from "../lib/kb/images.js";
import { synthesizeNotes } from "../lib/kb/notes.js";

type Db = any;

// State-poll stage (same shape as embed/summarize): pick favorited items that
// have no finished kb_entry yet and process them. Only ⭐ items reach here.
export async function runKbStage(db: Db): Promise<number> {
  const rows = await db.execute(dsql`
    SELECT i.id, i.title, i.url, i.text
    FROM items i
    LEFT JOIN kb_entries k ON k.item_id = i.id
    WHERE i.is_favorited = true
      AND (k.item_id IS NULL OR (k.status NOT IN ('ready','skipped') AND k.attempts < ${config.KB_MAX_ATTEMPTS}))
    ORDER BY i.favorited_at DESC NULLS LAST
    LIMIT ${config.KB_FETCH_LIMIT}
  `);
  const list = (rows.rows ?? rows) as Array<{ id: number; title: string; url: string | null; text: string }>;
  if (list.length === 0) return 0;

  let done = 0;
  for (const row of list) {
    const itemId = Number(row.id);
    try {
      await db.insert(kbEntries).values({ itemId, status: "pending" })
        .onConflictDoNothing({ target: kbEntries.itemId });

      const article = await fetchArticle(row.url, row.text ?? "");
      const { markdown, images } = await localizeImages(itemId, article.markdown, article.images);
      const enoughBody = markdown.trim().length >= config.KB_MIN_BODY_CHARS;
      const note = enoughBody ? await synthesizeNotes({ title: row.title, markdown }) : {};

      await db.update(kbEntries).set({
        bodyMd: markdown,
        bodySource: article.source,
        images,
        note,
        status: enoughBody ? "ready" : "skipped",
        processedAt: new Date(),
        error: null,
      }).where(eq(kbEntries.itemId, itemId));
      done++;
    } catch (err) {
      await db.update(kbEntries).set({
        attempts: dsql`${kbEntries.attempts} + 1`,
        status: dsql`CASE WHEN ${kbEntries.attempts} + 1 >= ${config.KB_MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END`,
        error: String(err).slice(0, 500),
      }).where(eq(kbEntries.itemId, itemId));
      console.error("kb stage error", itemId, err);
    }
  }
  return done;
}
