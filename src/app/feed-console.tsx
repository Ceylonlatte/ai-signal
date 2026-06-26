import Link from "next/link";
import type { FeedSort, FeedSource } from "./feed-queries.js";
import { feedHref } from "./feed-nav.js";

export type TabSource = FeedSource | "rss";

const SOURCE_TABS: { source: TabSource; label: string }[] = [
  { source: "all", label: "全部来源" },
  { source: "hn", label: "Hacker News" },
  { source: "reddit", label: "Reddit" },
  { source: "twitter", label: "X" },
  { source: "rss", label: "RSS" },
];

function tabHref(source: TabSource, sort: FeedSort): string {
  return source === "rss" ? "/?source=rss" : feedHref({ source, sort });
}

// The signal console — the feed's page head, on a single slim row: platform
// filter on the left, live count + sort on the right. Server-rendered, every
// control is a <Link>, so filtering is a plain navigation with no client JS.
export function FeedConsole({
  active,
  sort,
  total,
  counts,
  showSort = true,
}: {
  active: TabSource;
  sort: FeedSort;
  total: number;
  counts: Record<FeedSource, number>;
  showSort?: boolean;
}) {
  const sortBase: FeedSource = active === "rss" ? "all" : active;
  return (
    <div className="console">
      <div className="console__filters" role="group" aria-label="平台过滤">
        {SOURCE_TABS.map((tab) => {
          const n = tab.source === "rss" ? undefined : counts[tab.source];
          return (
            <Link
              key={tab.source}
              className="platform"
              data-src={tab.source}
              data-active={active === tab.source}
              href={tabHref(tab.source, sort)}
            >
              <span className="platform__dot" aria-hidden="true" />
              {tab.label}
              {typeof n === "number" && <span className="platform__n">{n}</span>}
            </Link>
          );
        })}
      </div>

      <div className="console__right">
        <span className="console__stat" title="实时更新">
          <i aria-hidden="true" />共 <b>{total}</b> 条
        </span>
        {showSort && (
          <div className="sort" role="group" aria-label="排序方式">
            <Link
              className="sort__btn"
              data-active={sort === "time"}
              href={feedHref({ source: sortBase, sort: "time" })}
            >
              最新
            </Link>
            <Link
              className="sort__btn"
              data-active={sort === "score"}
              href={feedHref({ source: sortBase, sort: "score" })}
            >
              按分数
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
