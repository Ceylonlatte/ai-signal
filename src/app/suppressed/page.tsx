import { db } from "../../db/client.js";
import { getSuppressed } from "../feed-queries.js";
import { FeedbackButtons } from "../feedback-buttons.js";

export const dynamic = "force-dynamic";

export default async function Suppressed() {
  const rows = await getSuppressed(db, { limit: 50 });
  return (
    <main style={{ maxWidth: 760, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>已压制内容</h1>
      <p><a href="/">← 返回 Feed</a>　这些条目因与你点踩过的内容相似而从 Feed 隐藏（仍可搜索）。撤销点踩即恢复。</p>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {rows.map((item: any) => (
          <li key={item.id} style={{ padding: "0.9rem 0", borderBottom: "1px solid #eee" }}>
            <a href={item.url ?? "#"} target="_blank" rel="noreferrer"><strong>{item.titleZh || item.title}</strong></a>
            <FeedbackButtons itemId={item.id} />
            {item.summaryZh && <div style={{ margin: "4px 0" }}>{item.summaryZh}</div>}
            <div style={{ fontSize: 12, color: "#888" }}>{item.source}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
