ALTER TABLE "raw_items" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN "title_zh" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN "summary_en" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN "summary_zh" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN "full_text_fetched" boolean DEFAULT false NOT NULL;