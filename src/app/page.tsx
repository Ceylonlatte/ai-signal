import Link from "next/link";
import { db } from "../db/client.js";
import {
  getFeed,
  getSourceCounts,
  normalizeFeedSource,
  type FeedSort,
} from "./feed-queries.js";
import { FeedList } from "./feed-list.js";
import { FeedConsole } from "./feed-console.js";
import { toFeedData } from "./feed-item-data.js";
import { getRssItems } from "./rss/rss-queries.js";
import { RssView } from "./rss/rss-view.js";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; source?: string }>;
}) {
  const sp = await searchParams;
  const isRss = sp.source === "rss";
  const sort: FeedSort = sp.sort === "score" ? "score" : "time";
  const source = normalizeFeedSource(sp.source);
  const counts = await getSourceCounts(db);

  // RSS branch: a separate, unscored surface rendered inside the signal-flow
  // shell. No sort control, no platform-staleness notice — RSS isn't ranked.
  if (isRss) {
    const rssRows = await getRssItems(db, { limit: 300 });
    return (
      <main className="page">
        <div className="page__head page__head--bare">
          <h1 className="sr-only">信号流</h1>
          <FeedConsole
            active="rss"
            sort={sort}
            total={rssRows.length}
            counts={counts}
            showSort={false}
          />
        </div>
        <RssView rows={rssRows} />
      </main>
    );
  }

  const {
    items: feed,
    total,
    totalPages,
    rMin,
    rMax,
  } = await getFeed(db, {
    page: 1,
    pageSize: PAGE_SIZE,
    sort,
    source,
  });
  const now = new Date();
  const data = feed.map((item: any) => toFeedData(item, now, rMin, rMax));

  return (
    <main className="page">
      <div className="page__head page__head--bare">
        <h1 className="sr-only">信号流</h1>
        <FeedConsole active={source} sort={sort} total={total} counts={counts} />
      </div>

      {data.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">
            {source === "all" ? "还没有信号" : "当前平台还没有信号"}
          </p>
          <p className="placeholder__body">
            采集与打分管道可能还在运行。
            <Link href="/status">查看流水线状态 →</Link>
          </p>
        </div>
      ) : (
        <FeedList
          key={`${source}:${sort}`}
          initialItems={data}
          total={total}
          totalPages={totalPages}
          sort={sort}
          source={source}
        />
      )}
    </main>
  );
}
