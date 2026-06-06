import { db } from "../../db/client.js";
import { getRssItems, type RssRow } from "./rss-queries.js";
import { rssFeedLabel } from "../../lib/sources/rss-feeds.js";
import { relativeTime } from "../format.js";
import { hostOf } from "../feed-item-data.js";

export const dynamic = "force-dynamic";

const SUMMARY_MAX = 240;

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function clamp(text: string): string {
  const t = text.trim();
  return t.length > SUMMARY_MAX ? `${t.slice(0, SUMMARY_MAX)}…` : t;
}

// Items already arrive newest-first, so a single linear pass produces
// date-ordered groups without re-sorting.
function groupByDay(rows: RssRow[]): { day: string; items: RssRow[] }[] {
  const groups: { day: string; items: RssRow[] }[] = [];
  for (const r of rows) {
    const day = dayLabel(r.publishedAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(r);
    else groups.push({ day, items: [r] });
  }
  return groups;
}

export default async function RssPage() {
  const rows = await getRssItems(db, { limit: 300 });
  const groups = groupByDay(rows);
  const now = new Date();

  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">RSS 订阅</h1>
        <div className="page__tools">
          {rows.length > 0 && <span className="page__count">共 {rows.length} 条</span>}
        </div>
      </div>
      <p className="page__lead">
        来自各家官方博客 / 发布说明的 RSS 源，每 24 小时全量抓取一次、仅保留近两天发布的条目，不参与打分与 LLM 处理，原文直出。
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
                return (
                  <article key={item.id} className="item">
                    <div className="item__top">
                      <a
                        className="item__title"
                        href={item.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {item.title}
                        {host && <span className="item__ext">{host} ↗</span>}
                      </a>
                    </div>
                    {item.summary && <p className="item__summary">{clamp(item.summary)}</p>}
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
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
