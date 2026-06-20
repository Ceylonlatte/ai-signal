ALTER TABLE "rss_items" ADD COLUMN "kb_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "rss_items" ADD COLUMN "body_md" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rss_items" ADD COLUMN "body_zh_md" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rss_items" ADD COLUMN "note" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rss_items" ADD COLUMN "body_source" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rss_items" ADD COLUMN "kb_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rss_items" ADD COLUMN "kb_error" text;