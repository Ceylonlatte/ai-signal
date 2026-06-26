import Link from "next/link";
import { db } from "../../db/client.js";
import { getFavorites, type FavoriteRow } from "../feed-queries.js";
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

// Orb hue encodes the note's processing state: ready→mint, failed→crimson,
// skipped→muted, anything else (incl. null while the worker runs)→pending blue.
function orbStatus(status: string | null): string {
  if (status === "ready") return "ready";
  if (status === "failed") return "failed";
  if (status === "skipped") return "skipped";
  return "pending";
}

type Bucket = { key: string; label: string; rows: FavoriteRow[] };

// Reading-list grouping by save date: 今天 / 本周 (last 7 days) / 更早. Empty
// buckets drop out so the panel never shows a bare label.
function groupByDate(rows: FavoriteRow[], now: Date): Bucket[] {
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const weekAgo = startOfToday - 6 * 86400000;
  const today: FavoriteRow[] = [];
  const week: FavoriteRow[] = [];
  const earlier: FavoriteRow[] = [];
  for (const r of rows) {
    const t = new Date(r.favoritedAt ?? r.createdAt).getTime();
    if (Number.isNaN(t) || t < weekAgo) earlier.push(r);
    else if (t >= startOfToday) today.push(r);
    else week.push(r);
  }
  return (
    [
      { key: "today", label: "今天", rows: today },
      { key: "week", label: "本周", rows: week },
      { key: "earlier", label: "更早", rows: earlier },
    ] as Bucket[]
  ).filter((b) => b.rows.length > 0);
}

export default async function Library() {
  const rows = await getFavorites(db, { limit: 200 });
  const now = new Date();
  const groups = groupByDate(rows, now);

  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">收藏</h1>
        <div className="page__tools">
          {rows.length > 0 && (
            <span className="page__count">{rows.length} 条</span>
          )}
        </div>
      </div>
      <p className="page__lead">
        点 ⭐ 存入的内容会在这里整理成知识库笔记，可点开看全文与结构化摘要。
      </p>

      {rows.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">知识库还是空的</p>
          <p className="placeholder__body">
            在信号流里点 ⭐ 把值得留存的内容存进来。
          </p>
        </div>
      ) : (
        <div className="lib-shell">
          <div className="lib-panel">
            {groups.map((g) => (
              <section key={g.key} className="lib-group">
                <div className="lib-group__label">
                  <b>{g.label}</b>
                  <span className="lib-group__rule" aria-hidden="true" />
                  <span className="lib-group__n">{g.rows.length}</span>
                </div>
                {g.rows.map((item) => {
                  const title = item.titleZh || item.title || "(无标题)";
                  const host = hostOf(item.url ?? null);
                  const note = (item.note ?? {}) as {
                    overview?: string;
                    keypoints?: string[];
                  };
                  const st = orbStatus(item.status);
                  const statusText = item.status
                    ? (STATUS_LABEL[item.status] ?? "")
                    : "整理中…";
                  const keypoints = Array.isArray(note.keypoints)
                    ? note.keypoints.slice(0, 3)
                    : [];
                  const overview = note.overview || item.summaryZh || "";
                  return (
                    <article key={item.id} className="lib-row">
                      <span
                        className="lib-row__orb"
                        data-st={st}
                        aria-hidden="true"
                      >
                        <i />
                      </span>
                      <div className="lib-row__body">
                        <Link
                          className="lib-row__title"
                          href={`/library/${item.id}`}
                        >
                          {title}
                          {host && <span className="lib-row__ext">{host}</span>}
                        </Link>
                        {overview ? (
                          <p className="lib-row__quote">{overview}</p>
                        ) : (
                          st === "pending" && (
                            <p className="lib-row__pending">
                              整理中，稍后生成笔记…
                            </p>
                          )
                        )}
                        {keypoints.length > 0 && (
                          <ul className="lib-row__pts">
                            {keypoints.map((k, i) => (
                              <li key={i}>{k}</li>
                            ))}
                          </ul>
                        )}
                        <div className="lib-row__meta">
                          <span className="lib-row__src">
                            {sourceLabel(item.source)}
                          </span>
                          {(item.favoritedAt || item.createdAt) && (
                            <>
                              <span className="meta-dot">·</span>
                              <span>
                                {relativeTime(
                                  item.favoritedAt ?? item.createdAt,
                                  now,
                                )}
                              </span>
                            </>
                          )}
                          {statusText && (
                            <>
                              <span className="meta-dot">·</span>
                              <span
                                className="kb-status"
                                data-status={item.status ?? "pending"}
                              >
                                {statusText}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="lib-row__aside">
                        <FavoriteButton itemId={item.id} initial={true} />
                      </div>
                    </article>
                  );
                })}
              </section>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
