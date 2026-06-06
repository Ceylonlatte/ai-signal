import { desc } from "drizzle-orm";
import { rssItems } from "../../db/schema.js";

type Db = any;

export interface RssRow {
  id: number;
  feedUrl: string;
  url: string | null;
  title: string;
  titleZh: string;
  author: string | null;
  summary: string;
  summaryZh: string;
  publishedAt: string;
}

export async function getRssItems(db: Db, opts: { limit?: number } = {}): Promise<RssRow[]> {
  const limit = Math.max(1, opts.limit ?? 300);
  const rows = await db
    .select({
      id: rssItems.id,
      feedUrl: rssItems.feedUrl,
      url: rssItems.url,
      title: rssItems.title,
      titleZh: rssItems.titleZh,
      author: rssItems.author,
      summary: rssItems.summary,
      summaryZh: rssItems.summaryZh,
      publishedAt: rssItems.publishedAt,
    })
    .from(rssItems)
    .orderBy(desc(rssItems.publishedAt))
    .limit(limit);
  return rows.map((r: any) => ({ ...r, publishedAt: new Date(r.publishedAt).toISOString() }));
}
