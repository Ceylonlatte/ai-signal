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

async function main() {
  let [src] = await db.select().from(sources).where(eq(sources.kind, "rss"));
  if (!src) [src] = await db.insert(sources).values({ kind: "rss" }).returning();

  let total = 0;
  for (const url of FEEDS) {
    try {
      const payloads = await fetchRss({ url });
      total += await ingest({ db, sourceId: src!.id, payloads });
    } catch (err) {
      console.error(`RSS ${url} failed:`, err);
    }
  }
  await db.update(sources).set({ lastRunAt: new Date() }).where(eq(sources.id, src!.id));
  console.log(`RSS: ${total} new items across ${FEEDS.length} feeds`);
  await pool.end();
}

main();
