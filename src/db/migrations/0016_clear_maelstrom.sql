CREATE TABLE "kb_entries" (
	"item_id" bigint PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"body_md" text DEFAULT '' NOT NULL,
	"body_source" text DEFAULT '' NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "favorited_at" timestamp with time zone;
--> statement-breakpoint
UPDATE items SET is_favorited = true, favorited_at = now()
WHERE id IN (SELECT DISTINCT item_id FROM feedback WHERE signal = 'up');