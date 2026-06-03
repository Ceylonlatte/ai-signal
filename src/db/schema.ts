import {
  bigint, bigserial, boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex,
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
