import { db } from "../../db/client.js";
import { getPipelineStatus, getDataStats, getModelUsage, getIngestStats } from "../status-queries.js";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  score: "打分", summarize: "摘要", label: "话题标签", embed: "向量",
};

const fmtInt = (n: number) => n.toLocaleString("en-US");
// Cost is in USD credits; sub-cent spend is common, so show enough precision.
const fmtCost = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "—";

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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 8, padding: "10px 14px", minWidth: 120 }}>
      <div style={{ fontSize: 12, color: "#888" }}>{label}</div>
      <div style={{ fontSize: 20, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {hint ? <div style={{ fontSize: 12, color: "#aaa" }}>{hint}</div> : null}
    </div>
  );
}

const th: React.CSSProperties = { padding: "6px 10px", textAlign: "left", color: "#888", fontWeight: 500, borderBottom: "1px solid #eee" };
const td: React.CSSProperties = { padding: "6px 10px", fontVariantNumeric: "tabular-nums" };

export default async function Status() {
  const [s, data, usage, ingestStats] = await Promise.all([
    getPipelineStatus(db),
    getDataStats(db),
    getModelUsage(db),
    getIngestStats(db),
  ]);
  const ingestTotal = ingestStats.reduce(
    (a, r) => ({ attempted: a.attempted + r.attempted, inserted: a.inserted + r.inserted }),
    { attempted: 0, inserted: 0 },
  );
  const ingestLastRunAt = ingestStats
    .map((r) => r.lastRunAt)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1) ?? null;
  const dupePct = (att: number, ins: number) =>
    att > 0 ? `${Math.round(((att - ins) / att) * 100)}%` : "—";
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

      <h2 style={{ marginTop: 36 }}>数据信息</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Stat label="数据源" value={`${data.sourcesEnabled} / ${data.sourcesTotal}`} hint="启用 / 总数" />
        <Stat label="入库条目" value={fmtInt(s.items)} />
        <Stat label="话题" value={fmtInt(s.topics)} />
        <Stat label="关键词" value={fmtInt(data.keywords)} />
        <Stat label="收藏 / 归档" value={`${fmtInt(data.favorited)} / ${fmtInt(data.archived)}`} hint={`已读 ${fmtInt(data.read)}`} />
        <Stat label="反馈 ↑ / ↓" value={`${fmtInt(data.feedbackUp)} / ${fmtInt(data.feedbackDown)}`} />
      </div>
      <p style={{ fontSize: 13, color: "#666", marginTop: 10 }}>
        数据覆盖区间：{fmtDate(data.earliest)} → {fmtDate(data.latest)}
      </p>
      {data.bySource.length > 0 && (
        <table style={{ borderCollapse: "collapse", fontSize: 14, marginTop: 8 }}>
          <thead><tr><th style={th}>来源</th><th style={th}>条目数</th></tr></thead>
          <tbody>
            {data.bySource.map((r) => (
              <tr key={r.source}>
                <td style={{ ...td, color: "#444" }}>{r.source}</td>
                <td style={td}>{fmtInt(r.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: 36 }}>采集 / 入库</h2>
      <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
        每个平台抓取或推送了多少条，去重后实际入库多少条（差值即重复内容）。
      </p>
      {ingestStats.length > 0 ? (
        <table style={{ borderCollapse: "collapse", fontSize: 14, marginTop: 8 }}>
          <thead>
            <tr>
              <th style={th}>平台</th>
              <th style={th}>抓取/推送</th>
              <th style={th}>实际入库</th>
              <th style={th}>去重率</th>
              <th style={th}>近 24h（抓取→入库）</th>
              <th style={th}>最近采集</th>
            </tr>
          </thead>
          <tbody>
            {ingestStats.map((r) => (
              <tr key={r.source}>
                <td style={{ ...td, color: "#444" }}>{r.source}</td>
                <td style={td}>{fmtInt(r.attempted)}</td>
                <td style={td}>{fmtInt(r.inserted)}</td>
                <td style={td}>{dupePct(r.attempted, r.inserted)}</td>
                <td style={{ ...td, color: "#666" }}>{fmtInt(r.attempted24h)} → {fmtInt(r.inserted24h)}</td>
                <td style={{ ...td, color: "#666" }}>{fmtDate(r.lastRunAt)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "1px solid #eee" }}>
              <td style={{ ...td, color: "#888" }}>合计</td>
              <td style={td}>{fmtInt(ingestTotal.attempted)}</td>
              <td style={td}>{fmtInt(ingestTotal.inserted)}</td>
              <td style={td}>{dupePct(ingestTotal.attempted, ingestTotal.inserted)}</td>
              <td style={td}>—</td>
              <td style={{ ...td, color: "#666" }}>{fmtDate(ingestLastRunAt)}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p style={{ fontSize: 13, color: "#888" }}>暂无采集记录（下次采集后开始累计）。</p>
      )}

      <h2 style={{ marginTop: 36 }}>模型使用花销</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Stat label="总花销" value={fmtCost(usage.totalCost)} hint={`${fmtInt(usage.totalCalls)} 次调用`} />
        <Stat label="近 24h 花销" value={fmtCost(usage.cost24h)} hint={`${fmtInt(usage.calls24h)} 次调用`} />
        <Stat label="总 token" value={fmtInt(usage.totalTokens)} />
      </div>
      {usage.rows.length > 0 ? (
        <table style={{ borderCollapse: "collapse", fontSize: 14, marginTop: 10 }}>
          <thead>
            <tr>
              <th style={th}>用途</th><th style={th}>模型</th><th style={th}>调用数</th>
              <th style={th}>输入 token</th><th style={th}>输出 token</th>
              <th style={th}>总 token</th><th style={th}>花销</th>
            </tr>
          </thead>
          <tbody>
            {usage.rows.map((r) => (
              <tr key={`${r.kind}:${r.model}`}>
                <td style={{ ...td, color: "#444" }}>{KIND_LABEL[r.kind] ?? r.kind}</td>
                <td style={{ ...td, color: "#444" }}>{r.model}</td>
                <td style={td}>{fmtInt(r.calls)}</td>
                <td style={td}>{fmtInt(r.promptTokens)}</td>
                <td style={td}>{fmtInt(r.completionTokens)}</td>
                <td style={td}>{fmtInt(r.totalTokens)}</td>
                <td style={td}>{fmtCost(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ fontSize: 13, color: "#888" }}>暂无模型调用记录（worker 运行后将开始累计）。</p>
      )}
    </main>
  );
}
