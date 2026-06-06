import { notFound } from "next/navigation";
import { db } from "../../../db/client.js";
import { getTopic, topicItems } from "../trend-queries.js";
import { sourceLabel, relativeTime } from "../../format.js";
import { hostOf } from "../../feed-item-data.js";

export const dynamic = "force-dynamic";

export default async function TopicDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const topicId = Number(id);
  if (!Number.isInteger(topicId)) notFound();
  const topic = await getTopic(db, topicId);
  if (!topic) notFound();
  const results = await topicItems(db, topicId);
  const now = new Date();

  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">{topic.label}</h1>
        <div className="page__tools">
          <span className="page__count">{results.length} 条</span>
        </div>
      </div>
      <p className="page__lead">
        归入「{topic.label}」话题的条目。<a href="/topics">← 返回话题趋势</a>
      </p>

      {results.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">这个话题还没有条目</p>
          <p className="placeholder__body">条目入库并完成聚类后会出现在这里。</p>
        </div>
      ) : (
        <div className="results">
          {results.map((r: any) => {
            const host = hostOf(r.url ?? null);
            return (
              <a
                key={r.id}
                className="result"
                href={r.url ?? "#"}
                target="_blank"
                rel="noreferrer"
              >
                <span className="result__title">{r.title}</span>
                <span className="result__meta">
                  <span className="item__source">{sourceLabel(r.source)}</span>
                  {host && (
                    <>
                      <span className="meta-dot">·</span>
                      <span>{host}</span>
                    </>
                  )}
                  {r.createdAt && (
                    <>
                      <span className="meta-dot">·</span>
                      <span>{relativeTime(r.createdAt, now)}</span>
                    </>
                  )}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </main>
  );
}
