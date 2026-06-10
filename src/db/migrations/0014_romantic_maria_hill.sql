CREATE TABLE "topic_merge_decisions" (
	"a_id" bigint NOT NULL,
	"b_id" bigint NOT NULL,
	"merged" boolean NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "topic_merge_decisions_uq" ON "topic_merge_decisions" USING btree ("a_id","b_id");