import { db } from "../../db/client.js";
import { getPipelineStatus } from "../status-queries.js";

export const dynamic = "force-dynamic";

function Bar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 100;
  return (
    <div style={{ background: "#eee", borderRadius: 4, height: 10, width: 220, display: "inline-block", verticalAlign: "middle" }}>
      <div style={{ background: "#3b82f6", height: 10, borderRadius: 4, width: `${pct}%` }} />
    </div>
  );
}

function Row({ label, done, total, extra }: { label: string; done: number; total: number; extra?: string }) {
  return (
    <tr>
      <td style={{ padding: "6px 10px", color: "#444" }}>{label}</td>
      <td style={{ padding: "6px 10px" }}><Bar done={done} total={total} /></td>
      <td style={{ padding: "6px 10px", fontVariantNumeric: "tabular-nums" }}>
        {done} / {total}{extra ? ` · ${extra}` : ""}
      </td>
    </tr>
  );
}

export default async function Status() {
  const s = await getPipelineStatus(db);
  const pending = s.rawPending + s.embedPending + s.summaryPending + s.unclustered;
  return (
    <main style={{ maxWidth: 760, margin: "2rem auto", fontFamily: "system-ui" }}>
      {/* React 19 hoists this to <head>: client-side meta refresh every 5s */}
      <meta httpEquiv="refresh" content="5" />
      <h1>流水线进度 {pending > 0 ? "· 运行中…" : "· 空闲 ✓"}</h1>
      <p><a href="/">← 返回 Feed</a>　本页每 5 秒自动刷新。</p>
      <table style={{ borderCollapse: "collapse", fontSize: 14 }}>
        <tbody>
          <Row label="采集 raw_items（已 triage）" done={s.rawTotal - s.rawPending} total={s.rawTotal} extra={s.rawPending > 0 ? `${s.rawPending} 待处理` : undefined} />
          <Row label="入库 items（过门槛 Q）" done={s.items} total={s.items} />
          <Row label="打分 scores" done={s.scored} total={s.items} />
          <Row label="向量 embedding" done={s.embeddings} total={s.items} extra={s.embedPending > 0 ? `${s.embedPending} 待补` : undefined} />
          <Row label="双语摘要 summary" done={s.summarized} total={s.items} extra={[s.summaryPending > 0 ? `${s.summaryPending} 待摘要` : null, s.summaryFailed > 0 ? `${s.summaryFailed} 死信` : null].filter(Boolean).join(" · ") || undefined} />
          <Row label="话题聚类（已归类条目）" done={s.items - s.unclustered} total={s.items} extra={`${s.topics} 个话题`} />
        </tbody>
      </table>
      {s.summaryFailed > 0 && (
        <p style={{ color: "#b45309", fontSize: 13 }}>
          ⚠️ {s.summaryFailed} 条摘要连续失败已死信（超过 SUMMARY_MAX_ATTEMPTS），不再重试。
        </p>
      )}
    </main>
  );
}
