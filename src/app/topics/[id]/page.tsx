import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "../../../db/client.js";
import { getTopic } from "../trend-queries.js";
import { getTopicFeed } from "../../feed-queries.js";
import { toFeedData } from "../../feed-item-data.js";
import { FeedList } from "../../feed-list.js";

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
  const { items, rMin, rMax } = await getTopicFeed(db, topicId);
  const now = new Date();
  const data = items.map((it) => toFeedData(it, now, rMin, rMax));

  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">{topic.label}</h1>
        <div className="page__tools">
          {data.length > 0 && <span className="page__count">{data.length} 条</span>}
        </div>
      </div>
      <p className="page__lead">
        归入「{topic.label}」话题的条目。<Link href="/topics">← 返回话题趋势</Link>
      </p>

      {data.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">这个话题还没有条目</p>
          <p className="placeholder__body">条目入库并完成聚类后会出现在这里。</p>
        </div>
      ) : (
        <FeedList initialItems={data} total={data.length} totalPages={1} sort="time" source="all" />
      )}
    </main>
  );
}
