CREATE TABLE "feedback" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item_id" bigint NOT NULL,
	"signal" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"item_id" bigint PRIMARY KEY NOT NULL,
	"heat" real DEFAULT 0 NOT NULL,
	"relevance" real DEFAULT 0 NOT NULL,
	"novelty" real DEFAULT 0 NOT NULL,
	"llm_value" real DEFAULT 0 NOT NULL,
	"composite" double precision DEFAULT 0 NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"topic_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rubric_version" text NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
