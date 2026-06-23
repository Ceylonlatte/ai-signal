import type { CSSProperties } from "react";
import Link from "next/link";
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
  const maxScore =
    top.length > 0 ? Math.max(...top.map((t: any) => Number(t.scoreSum) || 0)) : 0;
  const totalHeat = top.reduce(
    (sum: number, t: any) => sum + (Number(t.scoreSum) || 0),
    0,
  );
  const pctOf = (score: number) =>
    maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

  const leader = top[0];

  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">话题趋势</h1>
        <div className="page__tools">
          {top.length > 0 && <span className="page__count">{top.length} 个话题</span>}
        </div>
      </div>
      <p className="page__lead">
        {formatDate(today)} · AI 圈正在讨论的话题，按当日热度排序。点击任一话题，查看归入的条目。
      </p>

      {!leader ? (
        <div className="placeholder">
          <p className="placeholder__title">今天还没有话题</p>
          <p className="placeholder__body">
            话题在条目入库并完成聚类后生成。<Link href="/status">查看流水线状态 →</Link>
          </p>
        </div>
      ) : (
        <>
          <div className="dash">
            <div className="stat">
              <div className="stat__label">今日话题</div>
              <div className="stat__value">{top.length}</div>
            </div>
            <div className="stat">
              <div className="stat__label">总热度</div>
              <div className="stat__value">{totalHeat.toFixed(1)}</div>
            </div>
            <Link className="stat stat--lead" href={`/topics/${leader.id}`}>
              <div className="stat__label">最热话题</div>
              <div className="stat__value">{leader.label}</div>
            </Link>
          </div>

          <div className="lite-shell">
            <ol className="lite">
              {top.map((t: any, idx: number) => {
                const rank = idx + 1;
                const score = Number(t.scoreSum) || 0;
                return (
                  <li key={t.id}>
                    <Link
                      className={`lite-row${rank <= 3 ? " lite-row--top" : ""}${rank === 1 ? " lite-row--lead" : ""}`}
                      href={`/topics/${t.id}`}
                      style={{ "--i": idx } as CSSProperties}
                    >
                      <span className="lite-row__rank">
                        {String(rank).padStart(2, "0")}
                      </span>
                      <span className="lite-row__label">{t.label}</span>
                      <span className="lite-row__bar" aria-hidden="true">
                        <span
                          className="lite-row__bar-fill"
                          style={{ "--w": `${pctOf(score)}%` } as CSSProperties}
                        />
                      </span>
                      <span className="lite-row__metrics">
                        <span className="lite-row__score">{score.toFixed(1)}</span>
                        <span className="lite-row__count">{t.itemCount} 条</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
        </>
      )}
    </main>
  );
}
