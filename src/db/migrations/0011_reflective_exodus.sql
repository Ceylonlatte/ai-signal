ALTER TABLE "rss_items" ADD COLUMN "title_zh" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rss_items" ADD COLUMN "summary_en" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rss_items" ADD COLUMN "summary_zh" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rss_items" ADD COLUMN "full_text_fetched" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rss_items" ADD COLUMN "summary_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rss_items" ADD COLUMN "summary_error" text;