import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";
import { sources } from "../src/db/schema.js";
import { fetchHackerNews } from "../src/collectors/hn.js";
import { ingest } from "../src/ingest/ingest.js";
import type { RawPayload } from "../src/types.js";

// Algolia full-text search does NOT treat "OR" as a boolean operator, so a
// single "AI OR LLM OR ..." query matches almost nothing. Query each term
// separately and merge (dedupe by externalId). Relevance is refined later by
// the prefilter + LLM scoring, so broad recall here is fine.
const QUERIES = ["AI", "LLM", "AI agent", "agentic", "Anthropic", "OpenAI", "Claude", "GPT", "RAG"];

async function main() {
  let [src] = await db.select().from(sources).where(eq(sources.kind, "hn"));
  if (!src) [src] = await db.insert(sources).values({ kind: "hn" }).returning();

  const seen = new Set<string>();
  const payloads: RawPayload[] = [];
  for (const q of QUERIES) {
    try {
      for (const item of await fetchHackerNews({ query: q, sinceHours: 24 })) {
        if (!seen.has(item.externalId)) { seen.add(item.externalId); payloads.push(item); }
      }
    } catch (err) {
      console.error(`HN query "${q}" failed:`, err);
    }
  }
  const inserted = await ingest({ db, sourceId: src!.id, payloads });
  await db.update(sources).set({ lastRunAt: new Date() }).where(eq(sources.id, src!.id));
  console.log(`HN: fetched ${payloads.length} (deduped across ${QUERIES.length} queries), new ${inserted}`);
  await pool.end();
}

main();
