import { eq, sql as dsql } from "drizzle-orm";
import { scores } from "../db/schema.js";
import { fetchFullText } from "../lib/fulltext.js";
import { summarizeBilingual } from "../lib/scoring/summarize.js";

type Db = any;
const LIMIT = 25;

export async function runSummarizeStage(db: Db): Promise<number> {
  const rows = await db.execute(dsql`
    SELECT i.id, i.title, i.url, i.text
    FROM items i JOIN scores s ON s.item_id = i.id
    WHERE s.summary_en = ''
    ORDER BY s.composite DESC
    LIMIT ${LIMIT}
  `);
  const list = (rows.rows ?? rows) as Array<{ id: number; title: string; url: string | null; text: string }>;
  if (list.length === 0) return 0;

  let done = 0;
  for (const row of list) {
    try {
      const ft = await fetchFullText(row.url, row.text ?? "");
      const sum = await summarizeBilingual({ title: row.title, text: ft.text });
      await db.update(scores).set({
        titleZh: sum.titleZh, summaryEn: sum.summaryEn || " ", summaryZh: sum.summaryZh,
        fullTextFetched: ft.fetched,
      }).where(eq(scores.itemId, Number(row.id)));
      done++;
    } catch (err) {
      console.error("summarize error", row.id, err);
    }
  }
  return done;
}
