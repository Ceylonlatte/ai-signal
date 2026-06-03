CREATE TABLE "items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"raw_item_id" bigserial NOT NULL,
	"source" text NOT NULL,
	"url" text,
	"canonical_url" text,
	"author" text,
	"title" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"stage" text NOT NULL,
	"ref" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigserial NOT NULL,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "items_content_hash_uq" ON "items" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_stage_ref_uq" ON "jobs" USING btree ("stage","ref");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_items_source_external_uq" ON "raw_items" USING btree ("source_id","external_id");