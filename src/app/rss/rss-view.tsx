import { rssFeedLabel } from "../../lib/sources/rss-feeds.js";
import { relativeTime } from "../format.js";
import { hostOf } from "../feed-item-data.js";
import type { RssRow } from "./rss-queries.js";
import { groupByDay } from "./rss-group.js";

const SUMMARY_MAX = 240;

function clamp(text: string): string {
  const t = text.trim();
  return t.length > SUMMARY_MAX ? `${t.slice(0, SUMMARY_MAX)}…` : t;
}

export function RssView({ rows }: { rows: RssRow[] }) {
  const groups = groupByDay(rows);
  const now = new Date();

  return (
    <>
      <p className="page__lead">
        来自各家官方博客 / 发布说明的 RSS 源，每 24 小时全量抓取一次、仅保留近两天发布的条目；自动生成摘要与中文翻译，但不参与打分与排序。
      </p>

      {rows.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">还没有 RSS 内容</p>
          <p className="placeholder__body">
            下一次每日抓取后，当天发布的官方文章会出现在这里。<a href="/status">查看采集状态 →</a>
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section className="section" key={g.day}>
            <div className="section__head">
              <h2 className="section__title">{g.day}</h2>
              <span className="page__count">{g.items.length} 条</span>
            </div>
            <div className="results">
              {g.items.map((item) => {
                const host = hostOf(item.url);
                const title = item.titleZh || item.title;
                const summary = item.summaryZh || item.summary;
                return (
                  <article key={item.id} className="item">
                    <div className="item__top">
                      <a
                        className="item__title"
                        href={item.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {title}
                        {host && <span className="item__ext">{host} ↗</span>}
                      </a>
                    </div>
                    {item.titleZh && item.title && item.titleZh !== item.title && (
                      <p className="item__orig">{item.title}</p>
                    )}
                    {summary && <p className="item__summary">{clamp(summary)}</p>}
                    <div className="item__meta">
                      <span className="item__source">{rssFeedLabel(item.feedUrl)}</span>
                      <span className="meta-dot">·</span>
                      <span>{relativeTime(item.publishedAt, now)}</span>
                      {item.author && (
                        <>
                          <span className="meta-dot">·</span>
                          <span className="item__author">{item.author}</span>
                        </>
                      )}
                      <span className="meta-dot">·</span>
                      <a className="item__detail" href={`/rss/${item.id}`}>详情 →</a>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </>
  );
}
