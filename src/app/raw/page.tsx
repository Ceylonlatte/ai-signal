import { db } from "../../db/client.js";
import { getRawFeed, normalizeRawSource, type RawSource } from "./raw-queries.js";
import { RawList } from "./raw-list.js";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
const SOURCE_TABS: { source: RawSource; label: string }[] = [
  { source: "all", label: "全部" },
  { source: "hn", label: "Hacker News" },
  { source: "reddit", label: "Reddit" },
  { source: "twitter", label: "X" },
];

function rawHref(source: RawSource): string {
  return source === "all" ? "/raw" : `/raw?source=${source}`;
}

export default async function RawPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const sp = await searchParams;
  const source = normalizeRawSource(sp.source);
  const { items, total, totalPages } = await getRawFeed(db, { page: 1, pageSize: PAGE_SIZE, source });

  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">原始采集</h1>
        <div className="page__tools">
          <div className="sort" role="group" aria-label="平台过滤">
            {SOURCE_TABS.map((tab) => (
              <a
                key={tab.source}
                className="sort__btn"
                data-active={source === tab.source}
                href={rawHref(tab.source)}
              >
                {tab.label}
              </a>
            ))}
          </div>
          {total > 0 && <span className="page__count">共 {total} 条</span>}
        </div>
      </div>
      <p className="page__lead">
        去重后入库的原始条目（raw_items），按平台分类、原文直出，不参与打分与排序。这是 triage 之前/之后的全量留存，与信号流的「入库 items」不同。
      </p>

      {items.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">
            {source === "all" ? "还没有原始内容" : "当前平台还没有原始内容"}
          </p>
          <p className="placeholder__body">
            采集管道可能还在运行。<a href="/status">查看流水线状态 →</a>
          </p>
        </div>
      ) : (
        <RawList
          key={source}
          initialItems={items}
          total={total}
          totalPages={totalPages}
          source={source}
        />
      )}
    </main>
  );
}
