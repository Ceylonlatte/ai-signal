import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";
import { sources, rssItems, ingestRuns } from "../src/db/schema.js";
import { fetchRss } from "../src/collectors/rss.js";
import { RSS_FEEDS } from "../src/lib/sources/rss-feeds.js";

// RSS feeds can only be fetched in FULL (no incremental cursor), so this job —
// which runs once every 24h — keeps ONLY recently-published items and drops the
// rest of the archive. The window is 48h (not 24h) as a deliberate 1-day safety
// margin over the daily cadence: several feeds stamp items with a date-only
// pubDate (00:00:00 UTC), so a tight 24h window + any cron jitter would silently
// miss them. The (feed_url, external_id) unique index makes the overlap free —
// re-seen items are de-duped, never re-inserted. Kept rows go straight into
// `rss_items` and are shown verbatim in the /rss tab: they NEVER enter
// raw_items / triage / the LLM pipeline.
const RSS_WINDOW_MS = 48 * 60 * 60 * 1000;

async function main() {
  let [src] = await db.select().from(sources).where(eq(sources.kind, "rss"));
  if (!src) [src] = await db.insert(sources).values({ kind: "rss" }).returning();

  const cutoff = Date.now() - RSS_WINDOW_MS;
  let attempted = 0;
  let inserted = 0;
  for (const { url } of RSS_FEEDS) {
    try {
      const recent = (await fetchRss({ url })).filter(
        (p) => Date.parse(p.createdAt) >= cutoff,
      );
      attempted += recent.length;
      if (recent.length === 0) continue;
      const rows = await db
        .insert(rssItems)
        .values(
          recent.map((p) => ({
            feedUrl: url,
            externalId: p.externalId,
            url: p.url,
            title: p.title,
            author: p.author,
            summary: p.text,
            publishedAt: new Date(p.createdAt),
          })),
        )
        .onConflictDoNothing({ target: [rssItems.feedUrl, rssItems.externalId] })
        .returning({ id: rssItems.id });
      inserted += rows.length;
    } catch (err) {
      console.error(`RSS ${url} failed:`, err);
    }
  }

  // Accounting row so the status page surfaces RSS collection alongside other
  // sources (attempted = today's items across feeds, inserted = new after dedupe).
  await db.insert(ingestRuns).values({ source: "rss", attempted, inserted });
  await db.update(sources).set({ lastRunAt: new Date() }).where(eq(sources.id, src!.id));
  console.log(`RSS: ${inserted} new items (<= 48h) across ${RSS_FEEDS.length} feeds`);
  await pool.end();
}

main();
