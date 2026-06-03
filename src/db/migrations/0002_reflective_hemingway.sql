CREATE TABLE "item_embeddings" (
	"item_id" bigint PRIMARY KEY NOT NULL,
	"embedding" vector(2048) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_topics" (
	"item_id" bigint NOT NULL,
	"topic_id" bigint NOT NULL,
	"weight" real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_trends" (
	"topic_id" bigint NOT NULL,
	"bucket_date" text NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"score_sum" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"centroid" vector(2048) NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "item_topics_uq" ON "item_topics" USING btree ("item_id","topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_trends_uq" ON "topic_trends" USING btree ("topic_id","bucket_date");