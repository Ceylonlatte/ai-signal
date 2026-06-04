import { db } from "../db/client.js";
import { getFeed } from "./feed-queries.js";
import { getSourceStatus } from "./source-status.js";
import { FeedbackButtons } from "./feedback-buttons.js";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

export default async function Home({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const requestedPage = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const { items: feed, total, page, totalPages } = await getFeed(db, { page: requestedPage, pageSize: PAGE_SIZE });
  const status = await getSourceStatus(db);
  const stale = status.filter((s: any) => s.stale);
  return (
    <main style={{ maxWidth: 760, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>AI Signal</h1>
      <p>
        <a href="/suppressed">查看已压制（被点踩相似）的内容 →</a>
        {"　"}
        <a href="/status">流水线进度 →</a>
      </p>
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
      <Pagination page={page} totalPages={totalPages} total={total} />
    </main>
  );
}

function Pagination({ page, totalPages, total }: { page: number; totalPages: number; total: number }) {
  return (
    <nav style={{ display: "flex", alignItems: "center", gap: 12, padding: "1rem 0", color: "#555" }}>
      {page > 1 ? <a href={`/?page=${page - 1}`}>← 上一页</a> : <span style={{ color: "#bbb" }}>← 上一页</span>}
      <span>第 {page} / {totalPages} 页 · 共 {total} 条</span>
      {page < totalPages ? <a href={`/?page=${page + 1}`}>下一页 →</a> : <span style={{ color: "#bbb" }}>下一页 →</span>}
    </nav>
  );
}
