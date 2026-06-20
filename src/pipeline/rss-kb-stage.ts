import { eq, sql as dsql } from "drizzle-orm";
import { rssItems } from "../db/schema.js";
import { config } from "../config.js";
import { fetchArticle } from "../lib/kb/reader.js";
import { synthesizeNotes } from "../lib/kb/notes.js";
import { needsTranslation, translateToZh } from "../lib/kb/translate.js";

type Db = any;

// KB detail-page stage for RSS items. RSS rows live in their own table (no
// items/kb_entries row), so the KB content is stored inline on rss_items. Mirrors
// runKbStage's per-item shape: fetch the article (markdown.new preferred via the
// reader chain), synthesize a note, and translate the body to Chinese. RSS has no
// comments. Images are left as remote URLs (no R2 localization for this low-volume
// surface). kb_attempts dead-letters a permanently-failing row.
export async function runRssKbStage(db: Db): Promise<number> {
  const rows = await db.execute(dsql`
    SELECT id, title, url, summary
    FROM rss_items
    WHERE kb_status NOT IN ('ready','skipped') AND kb_attempts < ${config.KB_MAX_ATTEMPTS}
    ORDER BY published_at DESC
    LIMIT ${config.KB_FETCH_LIMIT}
  `);
  const list = (rows.rows ?? rows) as Array<{ id: number; title: string; url: string | null; summary: string }>;
  if (list.length === 0) return 0;

  let done = 0;
  for (const row of list) {
    const id = Number(row.id);
    try {
      const article = await fetchArticle(row.url, row.summary ?? "");
      const bodyMd = article.markdown;
      const enoughBody = bodyMd.trim().length >= config.KB_MIN_BODY_CHARS;
      const note = enoughBody ? await synthesizeNotes({ title: row.title, markdown: bodyMd }) : {};
      const bodyZhMd = needsTranslation(bodyMd) ? await translateToZh(bodyMd) : "";

      await db.update(rssItems).set({
        bodyMd,
        bodyZhMd,
        bodySource: article.source,
        note,
        kbStatus: enoughBody ? "ready" : "skipped",
        kbError: null,
      }).where(eq(rssItems.id, id));
      done++;
    } catch (err) {
      await db.update(rssItems).set({
        kbAttempts: dsql`${rssItems.kbAttempts} + 1`,
        kbStatus: dsql`CASE WHEN ${rssItems.kbAttempts} + 1 >= ${config.KB_MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END`,
        kbError: String(err).slice(0, 500),
      }).where(eq(rssItems.id, id));
      console.error("rss kb stage error", id, err);
    }
  }
  return done;
}
