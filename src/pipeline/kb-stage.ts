import { eq, sql as dsql } from "drizzle-orm";
import { kbEntries } from "../db/schema.js";
import { config } from "../config.js";
import { fetchArticle } from "../lib/kb/reader.js";
import { localizeImages, type StoredImage } from "../lib/kb/images.js";
import { synthesizeNotes } from "../lib/kb/notes.js";
import { buildRedditKbBody, type RedditDoc } from "../lib/kb/reddit.js";
import { needsTranslation, translateToZh } from "../lib/kb/translate.js";

type Db = any;

interface ItemRow {
  id: number; source: string; title: string; url: string | null; text: string;
  rawItemId: number;
}

interface BuiltBody {
  bodyMd: string;
  commentsMd: string;
  noteInput: string;
  bodySource: string;
  images: StoredImage[];
}

async function loadRawDoc(db: Db, rawItemId: number): Promise<RedditDoc | null> {
  const res = await db.execute(dsql`SELECT payload FROM raw_items WHERE id = ${rawItemId} LIMIT 1`);
  const row = (res.rows ?? res)[0] as { payload?: { raw?: unknown } } | undefined;
  return (row?.payload?.raw ?? null) as RedditDoc | null;
}

// Per-source body assembly. Twitter uses the ingested tweet text verbatim (no
// fetch). Reddit builds from the digest's embedded comment tree (no fetch).
// HN/RSS fetch + localize the linked article (markdown.new preferred via reader).
async function buildBody(db: Db, row: ItemRow): Promise<BuiltBody> {
  if (row.source === "twitter") {
    const body = row.text ?? "";
    return { bodyMd: body, commentsMd: "", noteInput: body, bodySource: "source", images: [] };
  }
  if (row.source === "reddit") {
    const doc = await loadRawDoc(db, row.rawItemId);
    const { bodyMd, commentsMd, noteInput } = buildRedditKbBody(doc, row.text ?? "");
    return { bodyMd, commentsMd, noteInput, bodySource: "reddit", images: [] };
  }
  const article = await fetchArticle(row.url, row.text ?? "");
  const { markdown, images } = await localizeImages(row.id, article.markdown, article.images);
  return { bodyMd: markdown, commentsMd: "", noteInput: markdown, bodySource: article.source, images };
}

// State-poll stage: pick any ingested item without a finished kb_entry and build
// its knowledge-base detail page. Highest composite first so valuable items get
// processed before the long tail. Per-source: twitter/reddit are pure local
// transforms; hn/rss fetch the article. Bodies (and full reddit comments) are
// translated to Chinese for display when the original isn't already Chinese.
export async function runKbStage(db: Db): Promise<number> {
  const rows = await db.execute(dsql`
    SELECT i.id, i.source, i.title, i.url, i.text, i.raw_item_id AS "rawItemId"
    FROM items i
    LEFT JOIN scores s ON s.item_id = i.id
    LEFT JOIN kb_entries k ON k.item_id = i.id
    WHERE k.item_id IS NULL OR (k.status NOT IN ('ready','skipped') AND k.attempts < ${config.KB_MAX_ATTEMPTS})
    ORDER BY s.composite DESC NULLS LAST
    LIMIT ${config.KB_FETCH_LIMIT}
  `);
  const list = (rows.rows ?? rows) as ItemRow[];
  if (list.length === 0) return 0;

  let done = 0;
  for (const row of list) {
    const itemId = Number(row.id);
    try {
      await db.insert(kbEntries).values({ itemId, status: "pending" })
        .onConflictDoNothing({ target: kbEntries.itemId });

      const built = await buildBody(db, row);
      const enoughBody = built.noteInput.trim().length >= config.KB_MIN_BODY_CHARS;
      const note = enoughBody ? await synthesizeNotes({ title: row.title, markdown: built.noteInput }) : {};

      // Translate body + full comments to Chinese for display (skip when the
      // original is already Chinese). Comments rendered/translated in full.
      const bodyZhMd = needsTranslation(built.bodyMd) ? await translateToZh(built.bodyMd) : "";
      const commentsZhMd = built.commentsMd && needsTranslation(built.commentsMd)
        ? await translateToZh(built.commentsMd) : "";

      await db.update(kbEntries).set({
        bodyMd: built.bodyMd,
        bodyZhMd,
        commentsMd: built.commentsMd,
        commentsZhMd,
        bodySource: built.bodySource,
        images: built.images,
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
