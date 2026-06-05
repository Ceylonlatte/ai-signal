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

export interface DataStats {
  sourcesTotal: number; sourcesEnabled: number;
  bySource: { source: string; count: number }[];
  earliest: string | null; latest: string | null;
  favorited: number; archived: number; read: number;
  feedbackUp: number; feedbackDown: number; keywords: number;
}

// Dataset-level snapshot (distinct from pipeline progress): how much content
// the system holds, where it came from, and how the user has engaged with it.
export async function getDataStats(db: Db): Promise<DataStats> {
  const res = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM sources) AS "sourcesTotal",
      (SELECT count(*) FROM sources WHERE enabled) AS "sourcesEnabled",
      (SELECT min(created_at) FROM items) AS "earliest",
      (SELECT max(created_at) FROM items) AS "latest",
      (SELECT count(*) FROM items WHERE is_favorited) AS "favorited",
      (SELECT count(*) FROM items WHERE is_archived) AS "archived",
      (SELECT count(*) FROM items WHERE read_at IS NOT NULL) AS "read",
      (SELECT count(*) FROM feedback WHERE signal = 'up') AS "feedbackUp",
      (SELECT count(*) FROM feedback WHERE signal = 'down') AS "feedbackDown",
      (SELECT count(*) FROM keywords) AS "keywords"
  `);
  const row = (res.rows ?? res)[0] as Record<string, unknown>;
  const n = (v: unknown) => Number(v ?? 0);

  const bySourceRes = await db.execute(sql`
    SELECT source, count(*)::int AS count FROM items GROUP BY source ORDER BY count DESC
  `);
  const bySource = ((bySourceRes.rows ?? bySourceRes) as Array<{ source: string; count: unknown }>)
    .map((r) => ({ source: r.source, count: n(r.count) }));

  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    sourcesTotal: n(row.sourcesTotal), sourcesEnabled: n(row.sourcesEnabled),
    bySource,
    earliest: iso(row.earliest), latest: iso(row.latest),
    favorited: n(row.favorited), archived: n(row.archived), read: n(row.read),
    feedbackUp: n(row.feedbackUp), feedbackDown: n(row.feedbackDown), keywords: n(row.keywords),
  };
}

export interface ModelUsageRow {
  kind: string; model: string; calls: number;
  promptTokens: number; completionTokens: number; totalTokens: number; cost: number;
}
export interface ModelUsageSummary {
  rows: ModelUsageRow[];
  totalCalls: number; totalTokens: number; totalCost: number;
  calls24h: number; cost24h: number;
}

// Aggregated model spend, grouped by (kind, model). Token counts and cost come
// from the model_usage rows the worker writes off OpenRouter's usage payload.
export async function getModelUsage(db: Db): Promise<ModelUsageSummary> {
  const n = (v: unknown) => Number(v ?? 0);
  const byRes = await db.execute(sql`
    SELECT kind, model,
      count(*)::int AS calls,
      COALESCE(sum(prompt_tokens), 0) AS "promptTokens",
      COALESCE(sum(completion_tokens), 0) AS "completionTokens",
      COALESCE(sum(total_tokens), 0) AS "totalTokens",
      COALESCE(sum(cost), 0) AS cost
    FROM model_usage
    GROUP BY kind, model
    ORDER BY cost DESC, "totalTokens" DESC
  `);
  const rows = ((byRes.rows ?? byRes) as Array<Record<string, unknown>>).map((r) => ({
    kind: String(r.kind), model: String(r.model), calls: n(r.calls),
    promptTokens: n(r.promptTokens), completionTokens: n(r.completionTokens),
    totalTokens: n(r.totalTokens), cost: n(r.cost),
  }));

  const totRes = await db.execute(sql`
    SELECT
      count(*)::int AS "totalCalls",
      COALESCE(sum(total_tokens), 0) AS "totalTokens",
      COALESCE(sum(cost), 0) AS "totalCost",
      count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS "calls24h",
      COALESCE(sum(cost) FILTER (WHERE created_at > now() - interval '24 hours'), 0) AS "cost24h"
    FROM model_usage
  `);
  const t = (totRes.rows ?? totRes)[0] as Record<string, unknown>;
  return {
    rows,
    totalCalls: n(t.totalCalls), totalTokens: n(t.totalTokens), totalCost: n(t.totalCost),
    calls24h: n(t.calls24h), cost24h: n(t.cost24h),
  };
}
