import { db } from "../../db/client.js";
import { getLiked } from "../feed-queries.js";
import { FeedbackButtons } from "../feedback-buttons.js";
import { sourceLabel, relativeTime } from "../format.js";
import { hostOf } from "../feed-item-data.js";

export const dynamic = "force-dynamic";

export default async function Liked() {
  const rows = await getLiked(db, { limit: 200 });
  const now = new Date();

  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">收藏</h1>
        <div className="page__tools">
          {rows.length > 0 && <span className="page__count">{rows.length} 条</span>}
        </div>
      </div>
      <p className="page__lead">
        这里收录你点过 👍 的内容，按最近点赞时间排列，方便长期回看。取消 👍 后会从这里移除。
      </p>

      {rows.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">还没有收藏</p>
          <p className="placeholder__body">在信号流里点 👍 的内容会收录到这里，方便长期回看。</p>
        </div>
      ) : (
        <div className="results">
          {rows.map((item: any) => {
            const title = item.titleZh || item.title || "(无标题)";
            const host = hostOf(item.url ?? null);
            return (
              <article key={item.id} className="item">
                <div className="item__top">
                  <a className="item__title" href={item.url ?? "#"} target="_blank" rel="noreferrer">
                    {title}
                    {host && <span className="item__ext">{host} ↗</span>}
                  </a>
                </div>
                {item.summaryZh && <p className="item__summary">{item.summaryZh}</p>}
                <div className="item__meta">
                  <span className="item__source">{sourceLabel(item.source)}</span>
                  {item.createdAt && (
                    <>
                      <span className="meta-dot">·</span>
                      <span>{relativeTime(item.createdAt, now)}</span>
                    </>
                  )}
                  <FeedbackButtons itemId={item.id} initialSignal="up" />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
