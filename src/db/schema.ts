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
});

export const itemTopics = pgTable("item_topics", {
  itemId: bigint("item_id", { mode: "number" }).notNull(),
  topicId: bigint("topic_id", { mode: "number" }).notNull(),
  weight: real("weight").notNull().default(1),
}, (t) => ({ uq: uniqueIndex("item_topics_uq").on(t.itemId, t.topicId) }));

export const topicTrends = pgTable("topic_trends", {
  topicId: bigint("topic_id", { mode: "number" }).notNull(),
  bucketDate: text("bucket_date").notNull(), // YYYY-MM-DD
  itemCount: integer("item_count").notNull().default(0),
  scoreSum: doublePrecision("score_sum").notNull().default(0),
}, (t) => ({ uq: uniqueIndex("topic_trends_uq").on(t.topicId, t.bucketDate) }));
