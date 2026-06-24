import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "../../../db/client.js";
import { getTopic } from "../trend-queries.js";
import { getTopicFeed } from "../../feed-queries.js";
import { toFeedData } from "../../feed-item-data.js";
import { FeedList } from "../../feed-list.js";
import { relativeTime, sourceLabel } from "../../format.js";

export const dynamic = "force-dynamic";

const SHORT_SOURCE: Record<string, string> = {
  hn: "HN",
  reddit: "Reddit",
  twitter: "X",
  rss: "RSS",
};

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
  const { items, rMin, rMax } = await getTopicFeed(db, topicId);
  const now = new Date();
  const data = items.map((it) => toFeedData(it, now, rMin, rMax));

  // 话题概览：从已取回的条目直接算出规模、活跃度与来源，给详情页一个能定位的头部，
  // 取代过去那句只是重复标题的导语。items 已按时间倒序，[0] 即最新一条。
  const count = data.length;
  const freshness = items[0]?.createdAt ? relativeTime(items[0].createdAt, now) : "";
  const sourceCounts = new Map<string, number>();
  for (const it of items) {
    sourceCounts.set(it.source, (sourceCounts.get(it.source) ?? 0) + 1);
  }
  const sources = [...sourceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => SHORT_SOURCE[s] ?? sourceLabel(s));
  const sourcesText = sources.slice(0, 3).join(" · ") + (sources.length > 3 ? " 等" : "");

  return (
    <main className="page topic-detail">
      <p className="kb-detail__back">
        <Link className="kb-detail__back-btn" href="/topics">
          ← 话题趋势
        </Link>
      </p>

      <header className="topic-head">
        <h1 className="topic-head__title">{topic.label}</h1>
        {count > 0 && (
          <div className="topic-readout" role="group" aria-label="话题概览">
            <div className="topic-readout__cell">
              <span className="topic-readout__val">{count}</span>
              <span className="topic-readout__lab">条目</span>
            </div>
            {freshness && (
              <div className="topic-readout__cell">
                <span className="topic-readout__val">{freshness}</span>
                <span className="topic-readout__lab">最近活跃</span>
              </div>
            )}
            {sourcesText && (
              <div className="topic-readout__cell">
                <span className="topic-readout__val topic-readout__val--text">{sourcesText}</span>
                <span className="topic-readout__lab">来源</span>
              </div>
            )}
          </div>
        )}
      </header>

      {count === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">这个话题还没有条目</p>
          <p className="placeholder__body">条目入库并完成聚类后会出现在这里。</p>
        </div>
      ) : (
        <FeedList initialItems={data} total={count} totalPages={1} sort="time" source="all" />
      )}
    </main>
  );
}
