-- item_topics.linked_at: the day an item joined a topic, written by the same
-- cluster pass that writes the topic_trends row.
--
-- Backfilled from items.created_at rather than defaulted to now(): a plain
-- DEFAULT now() would stamp every existing row with the deploy timestamp, so
-- all ~1k topics would look like they gained members today and the cluster
-- stage would queue a label call for every one of them. created_at is the best
-- available approximation for rows that predate the column.
ALTER TABLE "item_topics" ADD COLUMN "linked_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "item_topics" it SET "linked_at" = i.created_at
  FROM "items" i WHERE i.id = it.item_id;
--> statement-breakpoint
UPDATE "item_topics" SET "linked_at" = now() WHERE "linked_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "item_topics" ALTER COLUMN "linked_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "item_topics" ALTER COLUMN "linked_at" SET NOT NULL;
