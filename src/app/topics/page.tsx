import { db } from "../../db/client.js";
import { getTopTopics } from "./trend-queries.js";

export const dynamic = "force-dynamic";

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

export default async function Topics() {
  const today = new Date().toISOString().slice(0, 10);
  const top = await getTopTopics(db, { date: today });
  const maxScore = top.length > 0 ? Math.max(...top.map((t: any) => Number(t.scoreSum) || 0)) : 0;

  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">话题趋势</h1>
        <div className="page__tools">
          {top.length > 0 && <span className="page__count">{top.length} 个话题</span>}
        </div>
      </div>
      <p className="page__lead">
        {formatDate(today)}，AI 圈正在聊的话题，按合成分排序。条形长度代表当日热度，点击任一话题做语义检索。
      </p>

      {top.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">今天还没有话题</p>
          <p className="placeholder__body">
            话题在条目入库并完成聚类后生成。<a href="/status">查看流水线状态 →</a>
          </p>
        </div>
      ) : (
        <div className="topics">
          {top.map((t: any, i: number) => {
            const score = Number(t.scoreSum) || 0;
            const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
            return (
              <a
                key={t.id}
                className={`topic${i < 3 ? " topic--top" : ""}`}
                href={`/search?q=${encodeURIComponent(t.label)}&mode=semantic`}
              >
                <span className="topic__rank">{i + 1}</span>
                <span className="topic__body">
                  <span className="topic__label">{t.label}</span>
                  <span className="topic__bar" aria-hidden="true">
                    <span className="topic__bar-fill" style={{ width: `${pct}%` }} />
                  </span>
                </span>
                <span className="topic__meta">
                  {t.itemCount} 条 · {score.toFixed(1)}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </main>
  );
}
