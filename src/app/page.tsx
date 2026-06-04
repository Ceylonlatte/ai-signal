import { db } from "../db/client.js";
import { getFeed } from "./feed-queries.js";
import { getSourceStatus } from "./source-status.js";
import { FeedList, type FeedItemData } from "./feed-list.js";
import { relativeStrength, relativeTime, sourceLabel } from "./format.js";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

function hostOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function toFeedData(item: any, now: Date, rMin: number, rMax: number): FeedItemData {
  return {
    id: item.id,
    url: item.url ?? null,
    host: hostOf(item.url ?? null),
    title: item.titleZh || item.title || "(无标题)",
    reason: item.reason ?? "",
    summaryZh: item.summaryZh ?? "",
    summaryEn: item.summaryEn ?? "",
    sourceLabel: sourceLabel(item.source),
    tags: Array.isArray(item.topicTags) ? item.topicTags.map(String) : [],
    strength: relativeStrength(item.r, rMin, rMax),
    rText: typeof item.r === "number" ? item.r.toFixed(2) : "—",
    timeText: item.createdAt ? relativeTime(item.createdAt, now) : "",
  };
}

export default async function Home({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const requestedPage = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const { items: feed, total, page, totalPages } = await getFeed(db, { page: requestedPage, pageSize: PAGE_SIZE });
  const status = await getSourceStatus(db);
  const stale = status.filter((s: any) => s.stale);
  const now = new Date();
  const rs = feed.map((item: any) => (typeof item.r === "number" ? item.r : 0));
  const rMin = rs.length ? Math.min(...rs) : 0;
  const rMax = rs.length ? Math.max(...rs) : 0;
  const data = feed.map((item: any) => toFeedData(item, now, rMin, rMax));

  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">今日信号</h1>
        {total > 0 && (
          <span className="page__count">
            第 {page}/{totalPages} 页 · 共 {total} 条
          </span>
        )}
      </div>

      {stale.length > 0 && (
        <div className="notice" role="status">
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
          <p className="placeholder__title">还没有信号</p>
          <p className="placeholder__body">
            采集与打分管道可能还在运行。<a href="/status">查看流水线状态 →</a>
          </p>
        </div>
      ) : (
        <FeedList items={data} />
      )}

      {data.length > 0 && <Pagination page={page} totalPages={totalPages} />}
    </main>
  );
}

function Pagination({ page, totalPages }: { page: number; totalPages: number }) {
  return (
    <nav className="pager" aria-label="分页">
      {page > 1 ? <a href={`/?page=${page - 1}`}>← 上一页</a> : <span className="pager__disabled">← 上一页</span>}
      <span>第 {page} / {totalPages} 页</span>
      {page < totalPages ? <a href={`/?page=${page + 1}`}>下一页 →</a> : <span className="pager__disabled">下一页 →</span>}
    </nav>
  );
}
