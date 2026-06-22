import { eq, sql as dsql } from "drizzle-orm";
import { scores } from "../db/schema.js";
import { fetchFullText } from "../lib/fulltext.js";
import { summarizeBilingual } from "../lib/scoring/summarize.js";
import { config } from "../config.js";

type Db = any;
const LIMIT = 25;

export async function runSummarizeStage(db: Db): Promise<number> {
  // Only pick un-summarized items that haven't exhausted their attempts, so a
  // permanently-failing item is dead-lettered instead of being re-picked every
  // poll loop forever (the old jobs.attempts retry chain no longer runs here).
  const rows = await db.execute(dsql`
    SELECT i.id, i.source, i.title, i.url, i.text
    FROM items i JOIN scores s ON s.item_id = i.id
    WHERE s.summary_en = '' AND s.summary_attempts < ${config.SUMMARY_MAX_ATTEMPTS}
    ORDER BY s.composite DESC
    LIMIT ${LIMIT}
  `);
  const list = (rows.rows ?? rows) as Array<{ id: number; source: string; title: string; url: string | null; text: string }>;
  if (list.length === 0) return 0;

  let done = 0;
  for (const row of list) {
    try {
      // Twitter is the tweet itself: fetching x.com via the article extractor only
      // yields page chrome or nothing useful (and would falsely set full_text_fetched),
      // so summarize the ingested tweet text verbatim — mirroring the KB stage's
      // per-source body build, where twitter never fetches.
      const ft = row.source === "twitter"
        ? { text: row.text ?? "", fetched: false }
        : await fetchFullText(row.url, row.text ?? "");
      const sum = await summarizeBilingual({ title: row.title, text: ft.text });
      await db.update(scores).set({
        // " " sentinel: a successful-but-empty summary still leaves summary_en
        // non-empty so it is not re-selected on the next loop.
        titleZh: sum.titleZh, summaryEn: sum.summaryEn || " ", summaryZh: sum.summaryZh,
        fullTextFetched: ft.fetched,
      }).where(eq(scores.itemId, Number(row.id)));
      done++;
    } catch (err) {
      await db.update(scores).set({
        summaryAttempts: dsql`${scores.summaryAttempts} + 1`,
        summaryError: String(err).slice(0, 500),
      }).where(eq(scores.itemId, Number(row.id)));
      console.error("summarize error", row.id, err);
    }
  }
  return done;
}
