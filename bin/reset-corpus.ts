import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";

// One-off: wipe the curated corpus and the raw ingestion ledger so collectors
// re-pull fresh under the new rules. Destructive — run intentionally.
async function main() {
  await db.execute(sql`TRUNCATE TABLE
    item_topics, topic_trends, topics, item_embeddings, scores, feedback, items, jobs, raw_items
    RESTART IDENTITY CASCADE`);
  console.log("reset-corpus: corpus + raw_items cleared");
  await pool.end();
}
main();
