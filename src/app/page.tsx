import { db } from "../db/client.js";
import { getFeed, type FeedSort } from "./feed-queries.js";
import { getSourceStatus } from "./source-status.js";
import { FeedList } from "./feed-list.js";
import { toFeedData } from "./feed-item-data.js";
import { sourceLabel } from "./format.js";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

export default async function Home({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const sp = await searchParams;
  const sort: FeedSort = sp.sort === "score" ? "score" : "time";
  const { items: feed, total, totalPages, rMin, rMax } = await getFeed(db, { page: 1, pageSize: PAGE_SIZE, sort });
  const status = await getSourceStatus(db);
  const stale = status.filter((s: any) => s.stale);
  const now = new Date();
  const data = feed.map((item: any) => toFeedData(item, now, rMin, rMax));

  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">今日信号</h1>
        <div className="page__tools">
          <div className="sort" role="group" aria-label="排序方式">
            <a className="sort__btn" data-active={sort === "time"} href="/?sort=time">
              最新
            </a>
            <a className="sort__btn" data-active={sort === "score"} href="/?sort=score">
              按分数
            </a>
          </div>
          {total > 0 && <span className="page__count">共 {total} 条</span>}
        </div>
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
        <FeedList key={sort} initialItems={data} total={total} totalPages={totalPages} sort={sort} />
      )}
    </main>
  );
}
