CREATE TABLE "keywords" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"term" text NOT NULL,
	"case_sensitive" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"embedding" vector(2048),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "keywords_term_uq" ON "keywords" USING btree ("term");--> statement-breakpoint
--> seed a SMALL curated default set (embeddings backfilled lazily by the worker).
INSERT INTO "keywords" ("term", "case_sensitive") VALUES
  ('Agentic', false),
  ('Harness', false)
ON CONFLICT ("term") DO NOTHING;