import { db } from "../../db/client.js";
import { getSuppressed } from "../feed-queries.js";
import { FeedbackButtons } from "../feedback-buttons.js";
import { sourceLabel, relativeTime } from "../format.js";
import { hostOf } from "../feed-item-data.js";

export const dynamic = "force-dynamic";

export default async function Suppressed() {
  const rows = await getSuppressed(db, { limit: 50 });
  const now = new Date();

  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">已压制</h1>
        <div className="page__tools">
          {rows.length > 0 && <span className="page__count">{rows.length} 条</span>}
        </div>
      </div>
      <p className="page__lead">
        这些条目因与你点踩过的内容相似而从信号流隐藏，但仍永久留存、可搜索。撤销点踩即恢复。
      </p>

      {rows.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">没有被压制的内容</p>
          <p className="placeholder__body">点踩内容后，相似条目会出现在这里，而不会污染你的信号流。</p>
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
                  <FeedbackButtons itemId={item.id} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
