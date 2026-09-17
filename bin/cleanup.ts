import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";
import { cleanupOldItems } from "../src/lib/cleanup.js";

async function main() {
  const s = await cleanupOldItems(db, { days: 30 });
  console.log(
    `cleanup: deleted ${s.items} items (favorites preserved), ` +
      `${s.orphanChildren} orphan child rows, ${s.rssItems} rss items, ` +
      `${s.orphanTopics} dead topics; slimmed ${s.rawPayloadsSlimmed} raw payloads`,
  );

  // The payload strip is an UPDATE, so every slimmed row leaves a dead tuple
  // behind and raw_items briefly gets BIGGER, not smaller. Steady state is a few
  // hundred rows a night and autovacuum would catch up on its own, but this box
  // has 1 GB of RAM and autovacuum only fires past a dead-row ratio — so ask
  // explicitly and keep the behaviour deterministic. Plain VACUUM takes no
  // exclusive lock; it makes the space reusable rather than returning it to the
  // OS, which is what stops the table from growing. Reclaiming the existing
  // bloat on disk is a one-off `VACUUM FULL` (see deploy/README.md).
  if (s.rawPayloadsSlimmed > 0) {
    await db.execute(sql`VACUUM (ANALYZE) raw_items`).catch((e) => console.error("vacuum failed", e));
  }
  await pool.end();
}
main();
