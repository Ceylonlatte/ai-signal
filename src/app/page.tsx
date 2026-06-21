import { db } from "../db/client.js";
import { getFeed, normalizeFeedSource, type FeedSort, type FeedSource } from "./feed-queries.js";
import { getSourceStatus } from "./source-status.js";
import { FeedList } from "./feed-list.js";
import { toFeedData } from "./feed-item-data.js";
import { sourceLabel } from "./format.js";
import { feedHref } from "./feed-nav.js";
import { getRssItems } from "./rss/rss-queries.js";
import { RssView } from "./rss/rss-view.js";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

type TabSource = FeedSource | "rss";

const SOURCE_TABS: { source: TabSource; label: string }[] = [
  { source: "all", label: "全部" },
  { source: "hn", label: "Hacker News" },
  { source: "reddit", label: "Reddit" },
  { source: "twitter", label: "X" },
  { source: "rss", label: "RSS" },
];

function tabHref(source: TabSource, sort: FeedSort): string {
  return source === "rss" ? "/?source=rss" : feedHref({ source, sort });
}

function SourceTabs({ active, sort }: { active: TabSource; sort: FeedSort }) {
  return (
    <div className="sort" role="group" aria-label="平台过滤">
      {SOURCE_TABS.map((tab) => (
        <a
          key={tab.source}
          className="sort__btn"
          data-active={active === tab.source}
          href={tabHref(tab.source, sort)}
        >
          {tab.label}
        </a>
      ))}
    </div>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; source?: string }>;
}) {
  const sp = await searchParams;
  const isRss = sp.source === "rss";
  const sort: FeedSort = sp.sort === "score" ? "score" : "time";
  const source = normalizeFeedSource(sp.source);

  // RSS branch: a separate, unscored surface rendered inside the signal-flow
  // shell. No sort control, no platform-staleness notice — RSS isn't ranked.
  if (isRss) {
    const rssRows = await getRssItems(db, { limit: 300 });
    return (
      <main className="page">
        <div className="page__head page__head--bare">
          <h1 className="sr-only">信号流</h1>
          <div className="page__tools">
            <SourceTabs active="rss" sort={sort} />
            <div className="page__tools__right">
              {rssRows.length > 0 && <span className="page__count">共 {rssRows.length} 条</span>}
            </div>
          </div>
        </div>
        <RssView rows={rssRows} />
      </main>
    );
  }

  const { items: feed, total, totalPages, rMin, rMax } = await getFeed(db, {
    page: 1,
    pageSize: PAGE_SIZE,
    sort,
    source,
  });
  const status = await getSourceStatus(db);
  const stale = status.filter((s: any) => s.stale);
  const now = new Date();
  const data = feed.map((item: any) => toFeedData(item, now, rMin, rMax));

  return (
    <main className="page">
      <div className="page__head page__head--bare">
        <h1 className="sr-only">信号流</h1>
        <div className="page__tools">
          <SourceTabs active={source} sort={sort} />
          <div className="page__tools__right">
            <div className="sort" role="group" aria-label="排序方式">
              <a className="sort__btn" data-active={sort === "time"} href={feedHref({ source, sort: "time" })}>
                最新
              </a>
              <a className="sort__btn" data-active={sort === "score"} href={feedHref({ source, sort: "score" })}>
                按分数
              </a>
            </div>
            {total > 0 && <span className="page__count">共 {total} 条</span>}
          </div>
        </div>
      </div>

      {stale.length > 0 && (
        <div className="notice notice--soft" role="status">
          <span className="notice__dot" aria-hidden="true" />
          <span>
            部分源数据已过期：
            {stale
              .map((s: any) => `${sourceLabel(s.kind)}（${s.lastRunAt ? new Date(s.lastRunAt).toLocaleString("zh-CN") : "从未"}）`)
              .join("、")}
            。其余源照常更新。
          </span>
        </div>
      )}

      {data.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">
            {source === "all" ? "还没有信号" : "当前平台还没有信号"}
          </p>
          <p className="placeholder__body">
            采集与打分管道可能还在运行。<a href="/status">查看流水线状态 →</a>
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
