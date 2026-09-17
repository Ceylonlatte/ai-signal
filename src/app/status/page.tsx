import { db } from "../../db/client.js";
import {
  getPipelineStatus, getDataStats, getModelUsage, getIngestStats,
  getKeyBudget, assessHealth, STALL_MINUTES, FEED_STALE_HOURS,
  type PipelineHealth, type KeyBudget,
} from "../status-queries.js";
import { relativeTime } from "../format.js";
import { StatusAutoRefresh } from "./auto-refresh.js";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  score: "打分", summarize: "摘要", label: "话题标签", embed: "向量",
};

const fmtInt = (n: number) => n.toLocaleString("en-US");
// Cost is in USD credits; sub-cent spend is common, so show enough precision.
const fmtCost = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "—";

type Stage = { label: string; done: number; total: number; extra?: string };

function Notice({ tone, children }: { tone: "alert" | "warn"; children: React.ReactNode }) {
  return (
    <div className={`notice notice--${tone}`} role="alert">
      <span className="notice__dot" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

// The banners that name a stuck pipeline outright. Ordered worst-first: a stall
// is the symptom the user actually sees ("the feed stopped updating"), the
// budget line is usually its cause, and feed staleness is the trailing echo —
// so it only shows on its own, once the two live problems are clear.
function HealthBanners({ health, budget }: { health: PipelineHealth; budget: KeyBudget }) {
  const heartbeat =
    health.stalledMinutes === null
      ? "从未调用过模型"
      : `最近一次模型调用在 ${health.stalledMinutes} 分钟前`;
  const ageHours = health.feedAgeHours === null ? 0 : Math.round(health.feedAgeHours);

  return (
    <>
      {health.stalled && (
        <Notice tone="alert">
          <strong>流水线停滞</strong>：{fmtInt(health.pending)} 条待处理，但{heartbeat}
          （阈值 {STALL_MINUTES} 分钟）。新抓到的内容不会进入信号流。
          {budget.ok && health.budgetExhausted
            ? "下方模型额度已用尽，多半就是原因。"
            : "先看下方模型额度，再查 worker 日志：docker compose logs --tail=50 worker。"}
        </Notice>
      )}

      {/* Two different ways to run out of money, with two different fixes: the
          key's own cap, and the account balance it bills to. Naming the wrong
          one sends you to the wrong OpenRouter page. */}
      {health.budgetExhausted && (
        <Notice tone="alert">
          {budget.source === "credits" ? (
            <>
              <strong>OpenRouter 账户余额已用尽</strong>：余额 {fmtCost(budget.credits ?? 0)}
              {budget.keyRemaining !== null
                ? `（key 限额还剩 ${fmtCost(budget.keyRemaining)}，但账户没有余额，调用一样 402）`
                : ""}
              。打分、摘要、KB 会全部失败。去 openrouter.ai/settings/credits 充值后重启 worker。
            </>
          ) : (
            <>
              <strong>模型 key 额度已用尽</strong>：已用 {fmtCost(budget.usage)}
              {budget.limit !== null ? ` / 上限 ${fmtCost(budget.limit)}` : ""}
              {budget.reset ? `（${budget.reset} 重置）` : ""}。
              打分、摘要、KB 会全部收到 402/403 并失败。去 OpenRouter 提高 key 上限后重启 worker。
            </>
          )}
        </Notice>
      )}

      {health.budgetLow && (
        <Notice tone="warn">
          <strong>{budget.source === "credits" ? "账户余额紧张" : "模型 key 额度紧张"}</strong>
          ：仅剩 {fmtCost(budget.remaining ?? 0)}
          {budget.source === "key" && budget.limit !== null ? ` / ${fmtCost(budget.limit)}` : ""}
          。用尽后流水线会整体停摆。
        </Notice>
      )}

      {health.feedStale && !health.stalled && (
        <Notice tone="warn">
          <strong>信号流数据偏旧</strong>：最新入库条目已是 {ageHours} 小时前
          （阈值 {FEED_STALE_HOURS} 小时）。流水线本身在动，请检查采集台账里各平台的「最近采集」。
        </Notice>
      )}

      {!budget.ok && (
        <Notice tone="warn">
          <strong>额度探测失败</strong>：{budget.error ?? "未知错误"}。
          本页无法确认模型额度，请自行到 OpenRouter 核对。
        </Notice>
      )}
    </>
  );
}

function Pipeline({ stages }: { stages: Stage[] }) {
  // The flow is sequential; the first stage that isn't fully drained is the
  // live bottleneck — it gets the pulsing node, completed stages go solid.
  const activeIdx = stages.findIndex((st) => st.total > 0 && st.done < st.total);
  return (
    <div className="pipe-shell">
      <div className="pipe">
        {stages.map((st, i) => {
          const pct = st.total > 0 ? Math.round((st.done / st.total) * 100) : 100;
          const complete = pct >= 100;
          const active = i === activeIdx;
          const last = i === stages.length - 1;
          return (
            <div
              className={`pipe__step${complete ? " is-done" : ""}${active ? " is-active" : ""}`}
              key={st.label}
            >
              <div className="pipe__spine" aria-hidden="true">
                <span className="pipe__node" />
                {!last && <span className="pipe__seg" />}
              </div>
              <div className="pipe__cap">
                <div className="pipe__head">
                  <span className="pipe__label">{st.label}</span>
                  <span className="pipe__val">
                    {fmtInt(st.done)} / {fmtInt(st.total)}
                    {st.extra ? <span className="pipe__pending"> · {st.extra}</span> : null}
                  </span>
                </div>
                <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={st.label}>
                  <div className="bar__fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          );
        })}
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
  const [s, data, usage, ingestStats, budget] = await Promise.all([
    getPipelineStatus(db),
    getDataStats(db),
    getModelUsage(db),
    getIngestStats(db),
    getKeyBudget(),
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
  const health = assessHealth({
    rawPending: s.rawPending,
    lastCallAt: usage.lastCallAt,
    latestItemAt: data.latest,
    budget,
  });
  const degraded = health.stalled || health.budgetExhausted;

  return (
    <main className="page is-live">
      {/* Soft auto-refresh scoped to this page (see auto-refresh.tsx). */}
      <StatusAutoRefresh />

      <div className="page__head">
        <h1 className="page__title">
          流水线状态 <span className="run-dot" data-running={running && !degraded} aria-hidden="true" />
        </h1>
        <div className="page__tools">
          <span className="page__count">
            {degraded ? `${fmtInt(pending)} 项卡住` : running ? `${fmtInt(pending)} 项处理中` : "空闲 ✓"}
          </span>
        </div>
      </div>
      <p className="page__lead">
        采集 → 入库 → 打分 → 向量 → 摘要 → 聚类的实时进度。本页每 5 秒自动刷新。
      </p>

      <HealthBanners health={health} budget={budget} />

      <section className="section" style={{ marginTop: 0 }}>
        <Pipeline
          stages={[
            { label: "采集 raw_items（已 triage）", done: s.rawTotal - s.rawPending, total: s.rawTotal, extra: s.rawPending > 0 ? `${fmtInt(s.rawPending)} 待处理` : undefined },
            { label: "入库 items（过门槛 Q）", done: s.items, total: s.items },
            { label: "打分 scores", done: s.scored, total: s.items },
            { label: "向量 embedding", done: s.embeddings, total: s.items, extra: s.embedPending > 0 ? `${fmtInt(s.embedPending)} 待补` : undefined },
            { label: "双语摘要 summary", done: s.summarized, total: s.items, extra: [s.summaryPending > 0 ? `${fmtInt(s.summaryPending)} 待摘要` : null, s.summaryFailed > 0 ? `${fmtInt(s.summaryFailed)} 死信` : null].filter(Boolean).join(" · ") || undefined },
            { label: "话题聚类（已归类条目）", done: s.items - s.unclustered, total: s.items, extra: `${fmtInt(s.topics)} 个话题` },
          ]}
        />
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
          <Stat label="收藏" value={fmtInt(data.favorited)} />
          <Stat label="点踩" value={fmtInt(data.feedbackDown)} />
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
          <Stat
            label="额度剩余"
            value={
              !budget.ok ? "—" : budget.remaining === null ? "无上限" : fmtCost(budget.remaining)
            }
            hint={
              !budget.ok
                ? "探测失败"
                : budget.source === "credits"
                  ? `账户余额${budget.keyRemaining !== null ? ` · key 限额还剩 ${fmtCost(budget.keyRemaining)}` : ""}`
                  : budget.limit === null
                    ? "key 未设上限"
                    : `key 上限 ${fmtCost(budget.limit)}${budget.reset ? ` · ${budget.reset} 重置` : ""}`
            }
          />
          <Stat
            label="最近调用"
            value={usage.lastCallAt ? relativeTime(usage.lastCallAt) : "—"}
            hint={usage.lastCallAt ? fmtDate(usage.lastCallAt) : "尚无记录"}
          />
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
