import { db } from "../db/client.js";
import { getFeed } from "./feed-queries.js";
import { getSourceStatus } from "./source-status.js";
import { FeedbackButtons } from "./feedback-buttons.js";

export const dynamic = "force-dynamic";

export default async function Home() {
  const feed = await getFeed(db, { limit: 50 });
  const status = await getSourceStatus(db);
  const stale = status.filter((s: any) => s.stale);
  return (
    <main style={{ maxWidth: 760, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>AI Signal</h1>
      <p><a href="/suppressed">查看已压制（被点踩相似）的内容 →</a></p>
      {stale.length > 0 && (
        <div style={{ background: "#fff4e5", border: "1px solid #ffce99", padding: 8, borderRadius: 6, marginBottom: 12 }}>
          ⚠️ Stale sources: {stale.map((s: any) => `${s.kind} (since ${s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : "never"})`).join(", ")}
        </div>
      )}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {feed.map((item: any) => (
          <li key={item.id} style={{ padding: "0.9rem 0", borderBottom: "1px solid #eee" }}>
            <a href={item.url ?? "#"} target="_blank" rel="noreferrer"><strong>{item.titleZh || item.title}</strong></a>
            <FeedbackButtons itemId={item.id} />
            {item.summaryZh && <div style={{ margin: "4px 0" }}>{item.summaryZh}</div>}
            {item.summaryEn && <div style={{ margin: "4px 0", color: "#555", fontSize: 13 }}>{item.summaryEn}</div>}
            <div style={{ fontSize: 12, color: "#888" }}>
              {item.source} · R {item.r?.toFixed?.(2) ?? "—"}
              {Array.isArray(item.topicTags) && item.topicTags.length > 0 && ` · ${item.topicTags.join(", ")}`}
              {item.reason && ` · ${item.reason}`}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
