import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";

// One-off: wipe the curated corpus and the raw ingestion ledger so collectors
// re-pull fresh under the new rules. DESTRUCTIVE — also clears every 👍/👎 in
// `feedback` (its item_ids would dangle after RESTART IDENTITY). Guarded so an
// accidental `pnpm reset-corpus` against the live DB can't silently nuke data.
function targetDbName(): string {
  try {
    const name = new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "");
    return name || "<unknown>";
  } catch {
    return "<unknown>";
  }
}

async function main() {
  const target = targetDbName();
  if (process.env.RESET_CONFIRM !== "yes") {
    console.error(
      `reset-corpus: REFUSING to wipe database "${target}".\n` +
        `This TRUNCATEs items / scores / embeddings / topics / feedback (all 👍/👎) / raw_items.\n` +
        `Re-run with explicit confirmation:\n` +
        `  RESET_CONFIRM=yes pnpm reset-corpus`,
    );
    await pool.end();
    process.exit(1);
  }
  console.log(`reset-corpus: wiping database "${target}" ...`);
  await db.execute(sql`TRUNCATE TABLE
    item_topics, topic_trends, topics, item_embeddings, scores, feedback, items, jobs, raw_items
    RESTART IDENTITY CASCADE`);
  console.log("reset-corpus: corpus + raw_items cleared");
  await pool.end();
}
main();
