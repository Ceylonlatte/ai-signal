ALTER TABLE "kb_entries" ADD COLUMN "body_zh_md" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_entries" ADD COLUMN "comments_md" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_entries" ADD COLUMN "comments_zh_md" text DEFAULT '' NOT NULL;