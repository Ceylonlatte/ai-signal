import { eq, sql as dsql } from "drizzle-orm";
import { rssItems } from "../db/schema.js";
import { fetchFullText } from "../lib/fulltext.js";
import { summarizeBilingual } from "../lib/scoring/summarize.js";
import { config } from "../config.js";

type Db = any;
const LIMIT = 25;

// Summarize + translate RSS items. They never enter the scoring pipeline, but
// each still gets a Chinese title and a bilingual summary so the /rss tab reads
// like the rest of the app. Mirrors runSummarizeStage: summary_en = '' selects
// un-summarized rows, and summary_attempts dead-letters a permanently-failing
// item instead of re-picking it every poll loop.
export async function runRssSummarizeStage(db: Db): Promise<number> {
  const rows = await db.execute(dsql`
    SELECT id, title, url, summary
    FROM rss_items
    WHERE summary_en = '' AND summary_attempts < ${config.SUMMARY_MAX_ATTEMPTS}
    ORDER BY published_at DESC
    LIMIT ${LIMIT}
  `);
  const list = (rows.rows ?? rows) as Array<{ id: number; title: string; url: string | null; summary: string }>;
  if (list.length === 0) return 0;

  let done = 0;
  for (const row of list) {
    try {
      const ft = await fetchFullText(row.url, row.summary ?? "");
      const sum = await summarizeBilingual({ title: row.title, text: ft.text });
      await db.update(rssItems).set({
        // " " sentinel: a successful-but-empty summary still leaves summary_en
        // non-empty so it is not re-selected on the next loop.
        titleZh: sum.titleZh, summaryEn: sum.summaryEn || " ", summaryZh: sum.summaryZh,
        fullTextFetched: ft.fetched,
      }).where(eq(rssItems.id, Number(row.id)));
      done++;
    } catch (err) {
      await db.update(rssItems).set({
        summaryAttempts: dsql`${rssItems.summaryAttempts} + 1`,
        summaryError: String(err).slice(0, 500),
      }).where(eq(rssItems.id, Number(row.id)));
      console.error("rss summarize error", row.id, err);
    }
  }
  return done;
}
