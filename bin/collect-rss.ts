import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";
import { sources } from "../src/db/schema.js";
import { fetchRss } from "../src/collectors/rss.js";
import { ingest } from "../src/ingest/ingest.js";

const FEEDS = [
  "https://openai.com/news/rss.xml",
  "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml",
  "https://research.google/blog/rss/",
  "https://deepmind.google/blog/rss.xml",
  "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_cursor.xml",
  "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_claude.xml",
];

// Only ingest RSS items from the last 7 days. RSS feeds (esp. the mirrored
// ones) can return long archives; keeping the window tight avoids pumping old
// posts through the (paid) embed/score pipeline and keeps the feed recent.
const RSS_WINDOW_DAYS = 7;

async function main() {
  let [src] = await db.select().from(sources).where(eq(sources.kind, "rss"));
  if (!src) [src] = await db.insert(sources).values({ kind: "rss" }).returning();

  const cutoff = Date.now() - RSS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let total = 0;
  for (const url of FEEDS) {
    try {
      const recent = (await fetchRss({ url })).filter(
        (p) => Date.parse(p.createdAt) >= cutoff,
      );
      total += await ingest({ db, sourceId: src!.id, payloads: recent });
    } catch (err) {
      console.error(`RSS ${url} failed:`, err);
    }
  }
  await db.update(sources).set({ lastRunAt: new Date() }).where(eq(sources.id, src!.id));
  console.log(`RSS: ${total} new items (<= ${RSS_WINDOW_DAYS}d) across ${FEEDS.length} feeds`);
  await pool.end();
}

main();
