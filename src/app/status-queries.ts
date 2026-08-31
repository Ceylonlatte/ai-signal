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
  favorited: number;
  feedbackDown: number; keywords: number;
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
    favorited: n(row.favorited),
    feedbackDown: n(row.feedbackDown), keywords: n(row.keywords),
  };
}

export interface IngestStatRow {
  source: string;
  attempted: number; inserted: number;
  attempted24h: number; inserted24h: number;
  lastRunAt: string | null;
}

// Per-platform collect/push accounting. Counts come from ingest_runs (how many
// items each source attempted to bring in vs. how many were actually new rows —
// the gap is repeat/dup volume). `lastRunAt` is the source's last collect/push
// timestamp from sources.last_run_at, which is the authoritative "last fetched"
// signal (updated on every run, even empty ones, with real history). Anchored on
// `sources` so every platform shows up even before its first accounting row.
export async function getIngestStats(db: Db): Promise<IngestStatRow[]> {
  const n = (v: unknown) => Number(v ?? 0);
  const res = await db.execute(sql`
    SELECT s.kind AS source,
      COALESCE(sum(r.attempted), 0)::int AS "attempted",
      COALESCE(sum(r.inserted), 0)::int AS "inserted",
      COALESCE(sum(r.attempted) FILTER (WHERE r.at > now() - interval '24 hours'), 0)::int AS "attempted24h",
      COALESCE(sum(r.inserted) FILTER (WHERE r.at > now() - interval '24 hours'), 0)::int AS "inserted24h",
      max(s.last_run_at) AS "lastRunAt"
    FROM sources s
    LEFT JOIN ingest_runs r ON r.source = s.kind
    GROUP BY s.kind
    ORDER BY "attempted" DESC, s.kind
  `);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return ((res.rows ?? res) as Array<Record<string, unknown>>).map((r) => ({
    source: String(r.source),
    attempted: n(r.attempted), inserted: n(r.inserted),
    attempted24h: n(r.attempted24h), inserted24h: n(r.inserted24h),
    lastRunAt: iso(r.lastRunAt),
  }));
}

export interface ModelUsageRow {
  kind: string; model: string; calls: number;
  promptTokens: number; completionTokens: number; totalTokens: number; cost: number;
}
export interface ModelUsageSummary {
  rows: ModelUsageRow[];
  totalCalls: number; totalTokens: number; totalCost: number;
  calls24h: number; cost24h: number;
  // Timestamp of the most recent model call — the pipeline's heartbeat. A
  // backlog with a cold heartbeat is what "stalled" means (see assessHealth).
  lastCallAt: string | null;
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
      COALESCE(sum(cost) FILTER (WHERE created_at > now() - interval '24 hours'), 0) AS "cost24h",
      max(created_at) AS "lastCallAt"
    FROM model_usage
  `);
  const t = (totRes.rows ?? totRes)[0] as Record<string, unknown>;
  return {
    rows,
    totalCalls: n(t.totalCalls), totalTokens: n(t.totalTokens), totalCost: n(t.totalCost),
    calls24h: n(t.calls24h), cost24h: n(t.cost24h),
    lastCallAt: t.lastCallAt ? new Date(t.lastCallAt as string).toISOString() : null,
  };
}

export interface KeyBudget {
  // `ok: false` means the probe itself failed (no network, bad key, OpenRouter
  // down) — that's "unknown budget", not "budget fine", so the UI stays quiet
  // about spend but still says the probe didn't land.
  ok: boolean;
  limit: number | null; // null = uncapped key
  usage: number;
  remaining: number | null; // null = uncapped
  // OpenRouter's own reset cadence for a capped key ("weekly"/"monthly"/null).
  reset: string | null;
  error: string | null;
}

const BUDGET_TTL_MS = 60_000;
const BUDGET_TIMEOUT_MS = 5_000;
let budgetCache: { at: number; value: KeyBudget } | null = null;

// Live credit headroom on the OpenRouter key, straight from their `/key`
// endpoint. This is the one failure that silently freezes the whole pipeline
// (the worker keeps looping on 403s and nothing reaches the feed), so the
// status page reads it rather than leaving it to be inferred from a flat spend
// chart. The status page auto-refreshes every 5s; this is cached for a minute
// so it stays one probe per minute, not one per render.
export async function getKeyBudget(): Promise<KeyBudget> {
  const now = Date.now();
  if (budgetCache && now - budgetCache.at < BUDGET_TTL_MS) return budgetCache.value;

  const fail = (error: string): KeyBudget => ({
    ok: false, limit: null, usage: 0, remaining: null, reset: null, error,
  });

  let value: KeyBudget;
  try {
    if (!config.OPENROUTER_API_KEY) {
      value = fail("未配置 OPENROUTER_API_KEY");
    } else {
      const res = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { authorization: `Bearer ${config.OPENROUTER_API_KEY}` },
        signal: AbortSignal.timeout(BUDGET_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) {
        value = fail(`OpenRouter ${res.status}`);
      } else {
        const d = (await res.json()).data as Record<string, unknown>;
        const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
        const limit = num(d?.limit);
        const usage = num(d?.usage) ?? 0;
        // `limit_remaining` is authoritative when present (it accounts for the
        // key's reset window); fall back to limit - usage for older payloads.
        const remaining = num(d?.limit_remaining) ?? (limit === null ? null : limit - usage);
        value = {
          ok: true,
          limit,
          usage,
          remaining,
          reset: typeof d?.limit_reset === "string" ? d.limit_reset : null,
          error: null,
        };
      }
    }
  } catch (err) {
    value = fail(err instanceof Error ? err.message : String(err));
  }

  budgetCache = { at: now, value };
  return value;
}

// A backlog is only alarming if nothing is being spent on it: the worker calls
// the LLM on every triage batch, so "items waiting + no model call in a while"
// is the signature of a stuck pipeline (crashed worker, 403 on the key, model
// outage) rather than a slow one.
export const STALL_MINUTES = 20;
// Past this, the feed's newest card is old enough that the user notices.
export const FEED_STALE_HOURS = 12;

export interface PipelineHealth {
  stalled: boolean;
  stalledMinutes: number | null; // null = no model call on record at all
  pending: number;
  budgetExhausted: boolean;
  budgetLow: boolean;
  feedStale: boolean;
  feedAgeHours: number | null;
}

// Turns the raw counters into the handful of "something is wrong" verdicts the
// status page banners render. Kept here (not in the page) so the thresholds are
// testable and live next to the queries they read.
export function assessHealth(input: {
  rawPending: number;
  lastCallAt: string | null;
  latestItemAt: string | null;
  budget: KeyBudget;
  now?: Date;
}): PipelineHealth {
  const now = input.now ?? new Date();
  const minsSince = (iso: string | null) =>
    iso ? (now.getTime() - new Date(iso).getTime()) / 60000 : null;

  const stalledMinutes = minsSince(input.lastCallAt);
  const pending = input.rawPending;
  const stalled = pending > 0 && (stalledMinutes === null || stalledMinutes > STALL_MINUTES);

  const { remaining, limit } = input.budget;
  const budgetExhausted = input.budget.ok && remaining !== null && remaining <= 0;
  const budgetLow =
    input.budget.ok &&
    !budgetExhausted &&
    remaining !== null &&
    limit !== null &&
    limit > 0 &&
    remaining / limit < 0.1;

  const feedAgeMins = minsSince(input.latestItemAt);
  const feedAgeHours = feedAgeMins === null ? null : feedAgeMins / 60;
  const feedStale = feedAgeHours !== null && feedAgeHours > FEED_STALE_HOURS;

  return {
    stalled,
    stalledMinutes: stalledMinutes === null ? null : Math.round(stalledMinutes),
    pending,
    budgetExhausted,
    budgetLow,
    feedStale,
    feedAgeHours,
  };
}
