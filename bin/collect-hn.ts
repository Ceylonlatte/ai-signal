import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";
import { sources } from "../src/db/schema.js";
import { fetchHackerNews } from "../src/collectors/hn.js";
import { ingest } from "../src/ingest/ingest.js";

const QUERY = "AI OR LLM OR agent OR Anthropic OR OpenAI";

async function main() {
  let [src] = await db.select().from(sources).where(eq(sources.kind, "hn"));
  if (!src) [src] = await db.insert(sources).values({ kind: "hn" }).returning();

  const payloads = await fetchHackerNews({ query: QUERY, sinceHours: 24 });
  const inserted = await ingest({ db, sourceId: src!.id, payloads });
  await db.update(sources).set({ lastRunAt: new Date() }).where(eq(sources.id, src!.id));
  console.log(`HN: fetched ${payloads.length}, new ${inserted}`);
  await pool.end();
}

main();
