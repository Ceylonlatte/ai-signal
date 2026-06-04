import { sql } from "drizzle-orm";
import { config } from "../config.js";

type Db = any;

export interface PipelineStatus {
  rawTotal: number; rawPending: number;
  items: number; scored: number;
  summarized: number; summaryPending: number; summaryFailed: number;
  embeddings: number; embedPending: number;
  topics: number; unclustered: number;
}

// One round-trip snapshot of where every pipeline stage stands. Counts come back
// from pg as bigint strings, so coerce to number.
export async function getPipelineStatus(db: Db): Promise<PipelineStatus> {
  const res = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM raw_items) AS "rawTotal",
      (SELECT count(*) FROM raw_items WHERE processed_at IS NULL) AS "rawPending",
      (SELECT count(*) FROM items) AS "items",
      (SELECT count(*) FROM scores) AS "scored",
      (SELECT count(*) FROM scores WHERE summary_en <> '') AS "summarized",
      (SELECT count(*) FROM scores WHERE summary_en = '' AND summary_attempts < ${config.SUMMARY_MAX_ATTEMPTS}) AS "summaryPending",
      (SELECT count(*) FROM scores WHERE summary_en = '' AND summary_attempts >= ${config.SUMMARY_MAX_ATTEMPTS}) AS "summaryFailed",
      (SELECT count(*) FROM item_embeddings) AS "embeddings",
      (SELECT count(*) FROM items i LEFT JOIN item_embeddings e ON e.item_id = i.id WHERE e.item_id IS NULL) AS "embedPending",
      (SELECT count(*) FROM topics) AS "topics",
      (SELECT count(*) FROM items i LEFT JOIN item_topics it ON it.item_id = i.id WHERE it.item_id IS NULL) AS "unclustered"
  `);
  const row = (res.rows ?? res)[0] as Record<string, unknown>;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    rawTotal: n(row.rawTotal), rawPending: n(row.rawPending),
    items: n(row.items), scored: n(row.scored),
    summarized: n(row.summarized), summaryPending: n(row.summaryPending), summaryFailed: n(row.summaryFailed),
    embeddings: n(row.embeddings), embedPending: n(row.embedPending),
    topics: n(row.topics), unclustered: n(row.unclustered),
  };
}
