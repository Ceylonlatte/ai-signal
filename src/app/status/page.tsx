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

function Pipe({ label, done, total, extra }: { label: string; done: number; total: number; extra?: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 100;
  return (
    <div className="pipe__row">
      <div className="pipe__head">
        <span className="pipe__label">{label}</span>
        <span className="pipe__val">
          {fmtInt(done)} / {fmtInt(total)}
          {extra ? <span className="pipe__pending"> · {extra}</span> : null}
        </span>
      </div>
      <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="bar__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {hint ? <div className="stat__hint">{hint}</div> : null}
    </div>
  );
}

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
  const running = pending > 0;

  return (
    <main className="page is-wide is-live">
      {/* React 19 hoists this to <head>: client-side meta refresh every 5s */}
      <meta httpEquiv="refresh" content="5" />

      <div className="page__head">
        <h1 className="page__title">
          流水线状态 <span className="run-dot" data-running={running} aria-hidden="true" />
        </h1>
        <div className="page__tools">
          <span className="page__count">{running ? `${fmtInt(pending)} 项处理中` : "空闲 ✓"}</span>
        </div>
      </div>
      <p className="page__lead">
        采集 → 入库 → 打分 → 向量 → 摘要 → 聚类的实时进度。本页每 5 秒自动刷新。
      </p>

      <section className="section" style={{ marginTop: 0 }}>
        <div className="pipe">
          <Pipe label="采集 raw_items（已 triage）" done={s.rawTotal - s.rawPending} total={s.rawTotal} extra={s.rawPending > 0 ? `${fmtInt(s.rawPending)} 待处理` : undefined} />
          <Pipe label="入库 items（过门槛 Q）" done={s.items} total={s.items} />
          <Pipe label="打分 scores" done={s.scored} total={s.items} />
          <Pipe label="向量 embedding" done={s.embeddings} total={s.items} extra={s.embedPending > 0 ? `${fmtInt(s.embedPending)} 待补` : undefined} />
          <Pipe label="双语摘要 summary" done={s.summarized} total={s.items} extra={[s.summaryPending > 0 ? `${fmtInt(s.summaryPending)} 待摘要` : null, s.summaryFailed > 0 ? `${fmtInt(s.summaryFailed)} 死信` : null].filter(Boolean).join(" · ") || undefined} />
          <Pipe label="话题聚类（已归类条目）" done={s.items - s.unclustered} total={s.items} extra={`${fmtInt(s.topics)} 个话题`} />
        </div>
        {s.summaryFailed > 0 && (
          <div className="notice notice--alert" role="alert" style={{ marginTop: "var(--space-5)" }}>
            <span className="notice__dot" aria-hidden="true" />
            <span>{fmtInt(s.summaryFailed)} 条摘要连续失败已死信（超过 SUMMARY_MAX_ATTEMPTS），不再重试。</span>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">数据信息</h2>
        </div>
        <div className="stats">
          <Stat label="数据源" value={`${data.sourcesEnabled} / ${data.sourcesTotal}`} hint="启用 / 总数" />
          <Stat label="入库条目" value={fmtInt(s.items)} />
          <Stat label="话题" value={fmtInt(s.topics)} />
          <Stat label="关键词" value={fmtInt(data.keywords)} />
          <Stat label="收藏 / 归档" value={`${fmtInt(data.favorited)} / ${fmtInt(data.archived)}`} hint={`已读 ${fmtInt(data.read)}`} />
          <Stat label="反馈 ↑ / ↓" value={`${fmtInt(data.feedbackUp)} / ${fmtInt(data.feedbackDown)}`} />
        </div>
        <p className="section__note" style={{ marginTop: "var(--space-3)", marginBottom: 0 }}>
          数据覆盖区间：{fmtDate(data.earliest)} → {fmtDate(data.latest)}
        </p>
        {data.bySource.length > 0 && (
          <div className="table-wrap" style={{ marginTop: "var(--space-4)" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>来源</th>
                  <th className="num">条目数</th>
                </tr>
              </thead>
              <tbody>
                {data.bySource.map((r) => (
                  <tr key={r.source}>
                    <td className="strong">{r.source}</td>
                    <td className="num">{fmtInt(r.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">采集 / raw 台账</h2>
        </div>
        <p className="section__note">
          每个平台抓取或推送了多少条，去重后新增多少条 raw_items。这里是采集台账，不等于上方最终入库 items。
        </p>
        {ingestStats.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>平台</th>
                  <th className="num">抓取/推送</th>
                  <th className="num">新增 raw_items</th>
                  <th className="num">去重率</th>
                  <th className="num">近 24h（抓取→raw）</th>
                  <th>最近采集</th>
                </tr>
              </thead>
              <tbody>
                {ingestStats.map((r) => (
                  <tr key={r.source}>
                    <td className="strong">{r.source}</td>
                    <td className="num">{fmtInt(r.attempted)}</td>
                    <td className="num">{fmtInt(r.inserted)}</td>
                    <td className="num">{dupePct(r.attempted, r.inserted)}</td>
                    <td className="num muted">{fmtInt(r.attempted24h)} → {fmtInt(r.inserted24h)}</td>
                    <td className="muted">{fmtDate(r.lastRunAt)}</td>
                  </tr>
                ))}
                <tr className="table__total">
                  <td>合计</td>
                  <td className="num">{fmtInt(ingestTotal.attempted)}</td>
                  <td className="num">{fmtInt(ingestTotal.inserted)}</td>
                  <td className="num">{dupePct(ingestTotal.attempted, ingestTotal.inserted)}</td>
                  <td className="num muted">—</td>
                  <td className="muted">{fmtDate(ingestLastRunAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="section__note">暂无采集记录（下次采集后开始累计）。</p>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">模型使用花销</h2>
        </div>
        <div className="stats">
          <Stat label="总花销" value={fmtCost(usage.totalCost)} hint={`${fmtInt(usage.totalCalls)} 次调用`} />
          <Stat label="近 24h 花销" value={fmtCost(usage.cost24h)} hint={`${fmtInt(usage.calls24h)} 次调用`} />
          <Stat label="总 token" value={fmtInt(usage.totalTokens)} />
        </div>
        {usage.rows.length > 0 ? (
          <div className="table-wrap" style={{ marginTop: "var(--space-4)" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>用途</th>
                  <th>模型</th>
                  <th className="num">调用数</th>
                  <th className="num">输入 token</th>
                  <th className="num">输出 token</th>
                  <th className="num">总 token</th>
                  <th className="num">花销</th>
                </tr>
              </thead>
              <tbody>
                {usage.rows.map((r) => (
                  <tr key={`${r.kind}:${r.model}`}>
                    <td className="strong">{KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td>{r.model}</td>
                    <td className="num">{fmtInt(r.calls)}</td>
                    <td className="num">{fmtInt(r.promptTokens)}</td>
                    <td className="num">{fmtInt(r.completionTokens)}</td>
                    <td className="num">{fmtInt(r.totalTokens)}</td>
                    <td className="num">{fmtCost(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="section__note">暂无模型调用记录（worker 运行后将开始累计）。</p>
        )}
      </section>
    </main>
  );
}
