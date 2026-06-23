import Link from "next/link";
import { db } from "../../db/client.js";
import { getRawFeed, normalizeRawSource, normalizeRawState, type RawSource, type RawState } from "./raw-queries.js";
import { RawList } from "./raw-list.js";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
const SOURCE_TABS: { source: RawSource; label: string }[] = [
  { source: "all", label: "全部" },
  { source: "hn", label: "Hacker News" },
  { source: "reddit", label: "Reddit" },
  { source: "twitter", label: "X" },
];
const STATE_TABS: { state: RawState; label: string }[] = [
  { state: "all", label: "全部状态" },
  { state: "accepted", label: "已收录" },
  { state: "dropped", label: "已过滤" },
  { state: "pending", label: "待处理" },
];

function rawHref(source: RawSource, state: RawState): string {
  const params = new URLSearchParams();
  if (source !== "all") params.set("source", source);
  if (state !== "all") params.set("state", state);
  const qs = params.toString();
  return qs ? `/raw?${qs}` : "/raw";
}

export default async function RawPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; state?: string }>;
}) {
  const sp = await searchParams;
  const source = normalizeRawSource(sp.source);
  const state = normalizeRawState(sp.state);
  const { items, total, accepted, totalPages } = await getRawFeed(db, { page: 1, pageSize: PAGE_SIZE, source, state });

  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">原始采集</h1>
        <div className="page__tools">
          <div className="sort" role="group" aria-label="平台过滤">
            {SOURCE_TABS.map((tab) => (
              <Link
                key={tab.source}
                className="sort__btn"
                data-active={source === tab.source}
                href={rawHref(tab.source, state)}
              >
                {tab.label}
              </Link>
            ))}
          </div>
          <div className="sort" role="group" aria-label="收录状态过滤">
            {STATE_TABS.map((tab) => (
              <Link
                key={tab.state}
                className="sort__btn"
                data-active={state === tab.state}
                href={rawHref(source, tab.state)}
              >
                {tab.label}
              </Link>
            ))}
          </div>
          {total > 0 && (
            <span className="page__count">
              {state === "all"
                ? `共 ${total} 条 · 已收录 ${accepted} 条（${Math.round((accepted / total) * 100)}%）`
                : `共 ${total} 条`}
            </span>
          )}
        </div>
      </div>
      <p className="page__lead">
        去重后入库的原始条目（raw_items），按平台分类、原文直出，不参与打分与排序。每条标注 triage 结果：「已收录」进入信号流、「已过滤」被质量门挡下（含与已收录内容重复的条目）、「待处理」尚未 triage。
      </p>

      {items.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">
            {source === "all" && state === "all" ? "还没有原始内容" : "当前筛选条件下没有内容"}
          </p>
          <p className="placeholder__body">
            采集管道可能还在运行。<Link href="/status">查看流水线状态 →</Link>
          </p>
        </div>
      ) : (
        <RawList
          key={`${source}:${state}`}
          initialItems={items}
          total={total}
          totalPages={totalPages}
          source={source}
          state={state}
        />
      )}
    </main>
  );
}
