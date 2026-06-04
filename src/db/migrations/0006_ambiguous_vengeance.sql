ALTER TABLE "scores" ADD COLUMN "summary_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN "summary_error" text;--> statement-breakpoint
--> backfill: mark pre-existing raw_items as already processed so historical rows
--> are NOT re-triaged (re-scored through the LLM) if reset-corpus is skipped.
UPDATE "raw_items" SET "processed_at" = now() WHERE "processed_at" IS NULL;