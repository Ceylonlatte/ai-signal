import {
  bigint, bigserial, boolean, doublePrecision, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, vector,
} from "drizzle-orm/pg-core";

export const sources = pgTable("sources", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  kind: text("kind").notNull(),
  config: jsonb("config").notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
});

export const rawItems = pgTable("raw_items", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sourceId: bigint("source_id", { mode: "number" }).notNull(),
  externalId: text("external_id").notNull(),
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  // TriageDecision (src/types.ts) written when processed; NULL for rows
  // triaged before the column existed.
  triage: jsonb("triage"),
}, (t) => ({
  uq: uniqueIndex("raw_items_source_external_uq").on(t.sourceId, t.externalId),
}));

export const items = pgTable("items", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  rawItemId: bigint("raw_item_id", { mode: "number" }).notNull(),
  source: text("source").notNull(),
  url: text("url"),
  canonicalUrl: text("canonical_url"),
  author: text("author"),
  title: text("title").notNull(),
  text: text("text").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  metrics: jsonb("metrics").notNull().default({}),
  contentHash: text("content_hash").notNull(),
  isFavorited: boolean("is_favorited").notNull().default(false),
}, (t) => ({
  hashUq: uniqueIndex("items_content_hash_uq").on(t.contentHash),
}));

export const jobs = pgTable("jobs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  stage: text("stage").notNull(),
  ref: text("ref").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("jobs_stage_ref_uq").on(t.stage, t.ref),
}));

export const scores = pgTable("scores", {
  itemId: bigint("item_id", { mode: "number" }).primaryKey(),
  heat: real("heat").notNull().default(0),
  relevance: real("relevance").notNull().default(0),
  novelty: real("novelty").notNull().default(0),
  llmValue: real("llm_value").notNull().default(0),
  composite: doublePrecision("composite").notNull().default(0),
  summary: text("summary").notNull().default(""),
  reason: text("reason").notNull().default(""),
  topicTags: jsonb("topic_tags").notNull().default([]),
  titleZh: text("title_zh").notNull().default(""),
  summaryEn: text("summary_en").notNull().default(""),
  summaryZh: text("summary_zh").notNull().default(""),
  fullTextFetched: boolean("full_text_fetched").notNull().default(false),
  summaryAttempts: integer("summary_attempts").notNull().default(0),
  summaryError: text("summary_error"),
  rubricVersion: text("rubric_version").notNull(),
  scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feedback = pgTable("feedback", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  itemId: bigint("item_id", { mode: "number" }).notNull(),
  signal: text("signal").notNull(), // "up" | "down"
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const itemEmbeddings = pgTable("item_embeddings", {
  itemId: bigint("item_id", { mode: "number" }).primaryKey(),
  embedding: vector("embedding", { dimensions: 2048 }).notNull(),
});

export const topics = pgTable("topics", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  label: text("label").notNull(),
  centroid: vector("centroid", { dimensions: 2048 }).notNull(),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  // Member count at the time the label was last generated; 0 = never labeled
  // from members. Drives relabel debounce in the cluster stage.
  labelN: integer("label_n").notNull().default(0),
});

export const itemTopics = pgTable("item_topics", {
  itemId: bigint("item_id", { mode: "number" }).notNull(),
  topicId: bigint("topic_id", { mode: "number" }).notNull(),
  weight: real("weight").notNull().default(1),
}, (t) => ({ uq: uniqueIndex("item_topics_uq").on(t.itemId, t.topicId) }));

// Remembers LLM "same story?" verdicts for near-centroid topic pairs so each
// pair costs at most one judge call. Merged pairs vanish with the dropped
// topic; rejects persist and stop the merge stage from re-asking every cycle.
// Convention: a_id < b_id.
export const topicMergeDecisions = pgTable("topic_merge_decisions", {
  aId: bigint("a_id", { mode: "number" }).notNull(),
  bId: bigint("b_id", { mode: "number" }).notNull(),
  merged: boolean("merged").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: uniqueIndex("topic_merge_decisions_uq").on(t.aId, t.bId) }));

export const topicTrends = pgTable("topic_trends", {
  topicId: bigint("topic_id", { mode: "number" }).notNull(),
  bucketDate: text("bucket_date").notNull(), // YYYY-MM-DD
  itemCount: integer("item_count").notNull().default(0),
  scoreSum: doublePrecision("score_sum").notNull().default(0),
}, (t) => ({ uq: uniqueIndex("topic_trends_uq").on(t.topicId, t.bucketDate) }));

// Per-call accounting for every paid model API request (scoring, summarize,
// topic-label, embeddings). Token counts + cost come straight from OpenRouter's
// `usage` object, which is returned automatically on every response.
export const modelUsage = pgTable("model_usage", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  kind: text("kind").notNull(), // score | summarize | label | embed
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  cost: doublePrecision("cost").notNull().default(0), // OpenRouter credits (USD)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Per-batch ingest accounting: how many items each collect/push attempt brought
// in (`attempted`) vs. how many were actually new rows in raw_items (`inserted`,
// i.e. survived the source+external_id dedupe). One row per `ingest()` call, so
// the gap surfaces how much a feed (esp. twitter for-you) repeats itself.
export const ingestRuns = pgTable("ingest_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  source: text("source").notNull(), // hn | rss | reddit | twitter
  feed: text("feed"), // reddit hot/new, twitter following/for-you; null for hn/rss
  attempted: integer("attempted").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

// Standalone RSS feed items. RSS feeds can only be fetched in full, so the
// collector keeps ONLY items published in the last 24h on each daily run and
// drops everything else — these rows NEVER enter raw_items / triage / the LLM
// pipeline. Displayed verbatim in the dedicated /rss tab.
export const rssItems = pgTable("rss_items", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  feedUrl: text("feed_url").notNull(),
  externalId: text("external_id").notNull(),
  url: text("url"),
  title: text("title").notNull(),
  author: text("author"),
  summary: text("summary").notNull().default(""), // raw feed contentSnippet
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  // LLM-generated summary + Chinese translation (mirrors the `scores` columns).
  // RSS skips scoring/ranking, but the worker still summarizes each item: a
  // Chinese title, an English summary, and its Chinese translation. summary_en
  // doubles as the "already summarized" sentinel; attempts/error dead-letter a
  // permanently-failing item instead of re-picking it forever.
  titleZh: text("title_zh").notNull().default(""),
  summaryEn: text("summary_en").notNull().default(""),
  summaryZh: text("summary_zh").notNull().default(""),
  fullTextFetched: boolean("full_text_fetched").notNull().default(false),
  summaryAttempts: integer("summary_attempts").notNull().default(0),
  summaryError: text("summary_error"),
}, (t) => ({
  uq: uniqueIndex("rss_items_feed_external_uq").on(t.feedUrl, t.externalId),
}));

// User-managed relevance keywords (replaces the hardcoded WATCHED_KEYWORDS list).
// `embedding` is the term's vector for semantic matching; nullable until embedded.
export const keywords = pgTable("keywords", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  term: text("term").notNull(),
  caseSensitive: boolean("case_sensitive").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  embedding: vector("embedding", { dimensions: 2048 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ termUq: uniqueIndex("keywords_term_uq").on(t.term) }));
