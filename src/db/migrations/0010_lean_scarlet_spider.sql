CREATE TABLE "rss_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"feed_url" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text,
	"title" text NOT NULL,
	"author" text,
	"summary" text DEFAULT '' NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rss_items_feed_external_uq" ON "rss_items" USING btree ("feed_url","external_id");