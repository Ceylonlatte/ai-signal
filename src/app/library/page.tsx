import { db } from "../../db/client.js";
import { getFavorites } from "../feed-queries.js";
import { FavoriteButton } from "../favorite-button.js";
import { sourceLabel, relativeTime } from "../format.js";
import { hostOf } from "../feed-item-data.js";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending: "整理中…",
  ready: "",
  failed: "整理失败",
  skipped: "仅原文",
};

export default async function Library() {
  const rows = await getFavorites(db, { limit: 200 });
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
        点 ⭐ 存入的内容会在这里整理成知识库笔记，可点开看全文与结构化摘要。
      </p>

      {rows.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">知识库还是空的</p>
          <p className="placeholder__body">在信号流里点 ⭐ 把值得留存的内容存进来。</p>
        </div>
      ) : (
        <div className="results">
          {rows.map((item) => {
            const title = item.titleZh || item.title || "(无标题)";
            const host = hostOf(item.url ?? null);
            const note = (item.note ?? {}) as { overview?: string; keypoints?: string[] };
            const statusText = item.status ? STATUS_LABEL[item.status] ?? "" : "整理中…";
            const keypoints = Array.isArray(note.keypoints) ? note.keypoints.slice(0, 3) : [];
            return (
              <article key={item.id} className="item">
                <div className="item__top">
                  <a className="item__title" href={`/library/${item.id}`}>
                    {title}
                    {host && <span className="item__ext">{host}</span>}
                  </a>
                </div>
                {note.overview && <p className="item__summary">{note.overview}</p>}
                {!note.overview && item.summaryZh && <p className="item__summary">{item.summaryZh}</p>}
                {keypoints.length > 0 && (
                  <ul className="kb-card__points">
                    {keypoints.map((k, i) => (
                      <li key={i}>{k}</li>
                    ))}
                  </ul>
                )}
                <div className="item__meta">
                  <span className="item__source">{sourceLabel(item.source)}</span>
                  {item.createdAt && (
                    <>
                      <span className="meta-dot">·</span>
                      <span>{relativeTime(item.createdAt, now)}</span>
                    </>
                  )}
                  {statusText && (
                    <>
                      <span className="meta-dot">·</span>
                      <span className="kb-status" data-status={item.status ?? "pending"}>{statusText}</span>
                    </>
                  )}
                  <FavoriteButton itemId={item.id} initial={true} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
