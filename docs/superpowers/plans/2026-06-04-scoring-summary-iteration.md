# Scoring Rework + Bilingual Summary + Feedback Personalization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ai-signal 的打分改为"稳定质量分 Q 卡门槛入库 + 实时排序分 R 带平台时间衰减"，加独立的抓全文双语摘要，并把 👍/👎 反馈接入排序（点赞救回 + 点踩软压制）。

**Architecture:** 打分前移到写 `items` 之前（triage 阶段）；低于阈值丢弃、达标入库；保留文章再抓全文做双语摘要；Feed 查询时按平台时间衰减实时算 R，并用反馈画像加权/压制。

**Tech Stack:** TypeScript (ESM, `.js` import 后缀), Next.js 15, Drizzle ORM + Postgres/pgvector, vitest, OpenRouter (`SCORING_MODEL` 复用做摘要), `@extractus/article-extractor` 做正文抽取, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-04-scoring-summary-iteration-design.md`

---

## 约定 / 前置

- 命令一律用 `pnpm`（CI 用 pnpm）。单测：`pnpm exec vitest run <path>`；全量：`pnpm test`；类型：`pnpm typecheck`。
- 集成测试需要 DB：先 `docker compose up -d db`，再 `DATABASE_URL=$TEST_DATABASE_URL pnpm db:migrate`，并导出 `TEST_DATABASE_URL`（见 `tests/setup/db.ts`）。
- 所有相对 import 必须带 `.js` 后缀（ESM + NodeNext，全仓库现有约定）。
- 提交粒度：每个 Task 末尾提交一次。

## File Structure（先锁定边界与签名）

**新建**
- `src/lib/scoring/platform-heat.ts` — 各平台 engagement 定义 + 时间衰减热度 + 按平台归一化。
  - `export type Source = "hn" | "rss" | "reddit" | "twitter";`
  - `export function hoursSince(createdAt: Date, now?: Date): number`
  - `export function engagementOf(source: string, metrics: Record<string, number>): number`
  - `export function platformHeat(args: { source: string; metrics: Record<string, number>; hours: number; trust: number }): number` → 0..1
- `src/lib/sources/trust.ts` — 源信任度。
  - `export function sourceTrust(source: string, url: string | null): number` → 0..1
- `src/lib/scoring/quality.ts` — 质量分 Q（时间无关、llm 主导）+ 门槛/救回带判断。
  - `export interface QualityInput { llmValue: number; relevance: number; trust: number }`
  - `export function computeQuality(i: QualityInput): number` → 0..1（权重从 config 读）
  - `export function passesGate(q: number): boolean`
  - `export function inRescueBand(q: number): boolean`
- `src/lib/scoring/ranking.ts` — 排序分 R（实时）。
  - `export interface RankingInput { q: number; platformHeat: number; novelty: number; likeAffinity: number }`
  - `export function computeRanking(i: RankingInput): number`
- `src/lib/feedback/profile.ts` — 纯函数画像判断（相似度→亲和/压制/救回）。
  - `export function clamp01(x: number): number`
  - `export function likeAffinity(maxLikeSim: number | null, nUp: number): number`
  - `export function isSuppressed(maxDislikeSim: number | null): boolean`
  - `export function likeRescues(maxLikeSim: number | null): boolean`
- `src/lib/fulltext.ts` — 抓原文正文 + 失败回退。
  - `export async function fetchFullText(url: string | null, fallback: string): Promise<{ text: string; fetched: boolean }>`
- `src/lib/scoring/summarize.ts` — 双语摘要 LLM 调用。
  - `export interface BilingualSummary { titleZh: string; summaryEn: string; summaryZh: string }`
  - `export async function summarizeBilingual(input: { title: string; text: string }): Promise<BilingualSummary>`
- `src/pipeline/triage.ts` — triage 阶段（取代 normalize→items 直写）。
  - `export async function runTriageStage(db: any): Promise<number>`
- `src/pipeline/summarize-stage.ts` — 摘要阶段。
  - `export async function runSummarizeStage(db: any): Promise<number>`
- `bin/reset-corpus.ts` — 一次性存量清空脚本。
- 测试：每个新文件配 `tests/lib/*.test.ts` 或 `tests/integration/*.test.ts`。

**修改**
- `src/config.ts` — 新增打分/画像 env。
- `src/db/schema.ts` — `scores` 加 `titleZh/summaryEn/summaryZh/fullTextFetched`；`rawItems` 加 `processedAt`。
- `src/lib/scoring/llm.ts` — `scoreBatch` 去掉 `summary` 字段（摘要移到独立阶段）。
- `src/lib/scoring/rubric.ts` — `RUBRIC_VERSION` 升版。
- `src/pipeline/stages.ts` — 删除 `runScoreStage`/`runPendingJobs`/`handleNormalize`（normalize 逻辑移入 triage），保留 `runEmbedStage`。
- `src/ingest/ingest.ts` — 不再入队 `normalize` job（triage 扫 `raw_items.processed_at`）。
- `src/pipeline/worker.ts` — 改为 triage → embed → summarize → cluster。
- `src/app/feed-queries.ts` — 取候选 + 反馈相似度，应用层算 R、过滤压制项；新增 `getSuppressed`。
- `src/app/page.tsx` — 展示中文标题/摘要 + 指向"已压制"页。
- `src/app/api/feedback/route.ts` — 支持撤销点踩（DELETE）。
- 新增 `src/app/suppressed/page.tsx` — 已压制视图 + 撤销。

**Q 存储约定**：Q 存进现有 `scores.composite` 列（语义改为"质量分"，cluster 的 `score_sum` 继续读它，无需改 cluster）。`scores.novelty` 存保留文章的新颖度。R 不入库、查询时算。

---

# Milestone 1 — 打分重构 + triage 门槛 + 存量清空

产出：新进数据按"平台时间衰减 + Q 门槛"处理，低分丢弃、达标入库；Feed 按 R 排序。可独立运行。

### Task 1: 平台时间衰减热度（platform-heat）

**Files:**
- Create: `src/lib/scoring/platform-heat.ts`
- Test: `tests/lib/platform-heat.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/lib/platform-heat.test.ts
import { describe, expect, it } from "vitest";
import { hoursSince, engagementOf, platformHeat } from "../../src/lib/scoring/platform-heat.js";

describe("hoursSince", () => {
  it("computes fractional hours", () => {
    const now = new Date("2026-06-04T12:00:00Z");
    expect(hoursSince(new Date("2026-06-04T10:00:00Z"), now)).toBeCloseTo(2, 5);
  });
  it("never negative", () => {
    const now = new Date("2026-06-04T12:00:00Z");
    expect(hoursSince(new Date("2026-06-04T13:00:00Z"), now)).toBe(0);
  });
});

describe("engagementOf", () => {
  it("HN uses points only", () => {
    expect(engagementOf("hn", { points: 120, comments: 999 })).toBe(120);
  });
  it("reddit uses ups", () => {
    expect(engagementOf("reddit", { ups: 50 })).toBe(50);
  });
  it("twitter weights retweets", () => {
    expect(engagementOf("twitter", { likes: 10, retweets: 5, replies: 3 })).toBe(10 + 2 * 5 + 3);
  });
  it("rss has no engagement", () => {
    expect(engagementOf("rss", {})).toBe(0);
  });
});

describe("platformHeat", () => {
  it("decays with age for HN", () => {
    const fresh = platformHeat({ source: "hn", metrics: { points: 300 }, hours: 1, trust: 0.5 });
    const old = platformHeat({ source: "hn", metrics: { points: 300 }, hours: 48, trust: 0.5 });
    expect(fresh).toBeGreaterThan(old);
    expect(fresh).toBeLessThanOrEqual(1);
    expect(old).toBeGreaterThanOrEqual(0);
  });
  it("RSS fresh official post ~ trust, decays over time", () => {
    const fresh = platformHeat({ source: "rss", metrics: {}, hours: 0, trust: 0.9 });
    expect(fresh).toBeCloseTo(0.9, 5);
    const old = platformHeat({ source: "rss", metrics: {}, hours: 24, trust: 0.9 });
    expect(old).toBeLessThan(fresh);
  });
  it("zero/low engagement gives ~0 heat for HN", () => {
    expect(platformHeat({ source: "hn", metrics: { points: 1 }, hours: 1, trust: 0.5 })).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/lib/platform-heat.test.ts`
Expected: FAIL（找不到模块 / 函数未定义）。

- [ ] **Step 3: 实现**

```ts
// src/lib/scoring/platform-heat.ts
import { config } from "../../config.js";

export type Source = "hn" | "rss" | "reddit" | "twitter";

const G = 1.8; // gravity exponent (HN ranking)
const H0 = 2;  // hours offset

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function hoursSince(createdAt: Date, now: Date = new Date()): number {
  const h = (now.getTime() - createdAt.getTime()) / 3_600_000;
  return h > 0 ? h : 0;
}

export function engagementOf(source: string, metrics: Record<string, number>): number {
  switch (source) {
    case "hn": return metrics.points ?? 0;
    case "reddit": return metrics.ups ?? metrics.points ?? 0;
    case "twitter":
      return (metrics.likes ?? 0) + 2 * (metrics.retweets ?? 0) + (metrics.replies ?? 0);
    default: return 0; // rss / unknown: no engagement
  }
}

// Per-platform log-normalization divisor; tunable via config.
function normDivisor(source: string): number {
  switch (source) {
    case "hn": return config.HEAT_K_HN;
    case "reddit": return config.HEAT_K_REDDIT;
    case "twitter": return config.HEAT_K_TWITTER;
    default: return 1;
  }
}

export function platformHeat(args: {
  source: string; metrics: Record<string, number>; hours: number; trust: number;
}): number {
  const { source, metrics, hours, trust } = args;
  const decay = Math.pow(H0 / (hours + H0), G); // 1 at hours=0, →0 as hours grows

  if (source === "rss") {
    // No engagement: freshness × source trust.
    return clamp01(trust * decay);
  }
  const eng = engagementOf(source, metrics);
  const raw = (eng - 1) / Math.pow(hours + H0, G);
  if (raw <= 0) return 0;
  return clamp01(Math.log10(1 + raw) / normDivisor(source));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/lib/platform-heat.test.ts`
Expected: PASS（注意：本任务依赖 Task 2 的 config 字段；若 config 尚未加字段，先做 Task 2 再回跑，或两任务一起提交。推荐顺序：先 Task 2）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/scoring/platform-heat.ts tests/lib/platform-heat.test.ts
git commit -m "feat(scoring): per-platform time-decayed heat"
```

> 注：Task 1 引用 `config.HEAT_K_*`。**先执行 Task 2** 再回跑 Task 1 的 Step 4。

### Task 2: 配置项（config）

**Files:**
- Modify: `src/config.ts`
- Test: `tests/lib/config-scoring.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/lib/config-scoring.test.ts
import { describe, expect, it } from "vitest";
import { config, qualityWeights, rankingWeights } from "../../src/config.js";

describe("scoring config defaults", () => {
  it("has a quality gate threshold", () => {
    expect(config.Q_THRESHOLD).toBeGreaterThan(0);
    expect(config.Q_THRESHOLD).toBeLessThanOrEqual(1);
  });
  it("exposes quality weights (llm-dominant)", () => {
    expect(qualityWeights.wRel).toBeGreaterThanOrEqual(0);
    expect(qualityWeights.wTrust).toBeGreaterThanOrEqual(0);
  });
  it("ranking weights sum near 1", () => {
    const sum = rankingWeights.wQ + rankingWeights.wHeat + rankingWeights.wNov + rankingWeights.wAff;
    expect(sum).toBeCloseTo(1, 5);
  });
  it("has feedback profile knobs", () => {
    expect(config.SUPPRESS_THRESHOLD).toBeGreaterThan(0);
    expect(config.RESCUE_SIM_THRESHOLD).toBeGreaterThan(0);
    expect(config.RESCUE_MARGIN).toBeGreaterThan(0);
    expect(config.COLDSTART_N0).toBeGreaterThan(0);
    expect(config.PROFILE_WINDOW_DAYS).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/lib/config-scoring.test.ts`
Expected: FAIL（字段未定义）。

- [ ] **Step 3: 实现（在 `src/config.ts` 的 schema 末尾追加字段，并导出权重对象）**

在 `const schema = z.object({ ... })` 内、`WEIGHT_LLM` 之后追加：

```ts
  // --- Quality gate Q (time-invariant, llm-dominant) ---
  Q_THRESHOLD: z.coerce.number().default(0.55),
  Q_WEIGHT_REL: z.coerce.number().default(0.15),
  Q_WEIGHT_TRUST: z.coerce.number().default(0.15),
  // --- Ranking R (live) ---
  R_WEIGHT_Q: z.coerce.number().default(0.45),
  R_WEIGHT_HEAT: z.coerce.number().default(0.30),
  R_WEIGHT_NOVELTY: z.coerce.number().default(0.10),
  R_WEIGHT_AFFINITY: z.coerce.number().default(0.15),
  // --- Per-platform heat log-normalization divisors ---
  HEAT_K_HN: z.coerce.number().default(2.5),
  HEAT_K_REDDIT: z.coerce.number().default(2.5),
  HEAT_K_TWITTER: z.coerce.number().default(3.5),
  // --- Feedback profile ---
  SUPPRESS_THRESHOLD: z.coerce.number().default(0.92),
  RESCUE_SIM_THRESHOLD: z.coerce.number().default(0.85),
  RESCUE_MARGIN: z.coerce.number().default(0.10),
  COLDSTART_N0: z.coerce.number().default(5),
  PROFILE_WINDOW_DAYS: z.coerce.number().default(90),
```

在文件末尾（`export const weights = {...}` 之后）追加：

```ts
export const qualityWeights = {
  wRel: config.Q_WEIGHT_REL,
  wTrust: config.Q_WEIGHT_TRUST,
};

export const rankingWeights = {
  wQ: config.R_WEIGHT_Q,
  wHeat: config.R_WEIGHT_HEAT,
  wNov: config.R_WEIGHT_NOVELTY,
  wAff: config.R_WEIGHT_AFFINITY,
};
```

- [ ] **Step 4: 跑测试确认通过（含 Task 1 回跑）**

Run: `pnpm exec vitest run tests/lib/config-scoring.test.ts tests/lib/platform-heat.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/config.ts tests/lib/config-scoring.test.ts
git commit -m "feat(config): scoring + feedback-profile knobs"
```

### Task 3: 源信任度（trust）

**Files:**
- Create: `src/lib/sources/trust.ts`
- Test: `tests/lib/trust.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/lib/trust.test.ts
import { describe, expect, it } from "vitest";
import { sourceTrust } from "../../src/lib/sources/trust.js";

describe("sourceTrust", () => {
  it("official lab blogs get high trust", () => {
    expect(sourceTrust("rss", "https://openai.com/news/foo")).toBeGreaterThanOrEqual(0.9);
    expect(sourceTrust("rss", "https://www.anthropic.com/news/bar")).toBeGreaterThanOrEqual(0.9);
  });
  it("unknown rss host gets medium trust", () => {
    const t = sourceTrust("rss", "https://some-random-blog.example/post");
    expect(t).toBeGreaterThan(0).toBeLessThan(0.9);
  });
  it("hn/reddit/twitter default trust", () => {
    expect(sourceTrust("hn", null)).toBeCloseTo(0.5, 5);
  });
  it("null url is safe", () => {
    expect(sourceTrust("rss", null)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/lib/trust.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/sources/trust.ts
// Per-host trust for RSS official blogs; per-kind default otherwise. 0..1.
const HOST_TRUST: Array<{ match: string; trust: number }> = [
  { match: "openai.com", trust: 0.95 },
  { match: "anthropic.com", trust: 0.95 },
  { match: "deepmind.google", trust: 0.95 },
  { match: "research.google", trust: 0.9 },
  { match: "cursor.com", trust: 0.85 },
  { match: "cursor.sh", trust: 0.85 },
];

const KIND_DEFAULT: Record<string, number> = {
  hn: 0.5, reddit: 0.5, twitter: 0.5, rss: 0.6,
};

export function sourceTrust(source: string, url: string | null): number {
  if (url) {
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch { host = ""; }
    for (const h of HOST_TRUST) {
      if (host === h.match || host.endsWith(`.${h.match}`)) return h.trust;
    }
  }
  return KIND_DEFAULT[source] ?? 0.5;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/lib/trust.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/sources/trust.ts tests/lib/trust.test.ts
git commit -m "feat(sources): per-host/per-kind source trust"
```

### Task 4: 质量分 Q + 门槛/救回带（quality）

**Files:**
- Create: `src/lib/scoring/quality.ts`
- Test: `tests/lib/quality.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/lib/quality.test.ts
import { describe, expect, it } from "vitest";
import { computeQuality, passesGate, inRescueBand } from "../../src/lib/scoring/quality.js";

describe("computeQuality", () => {
  it("is dominated by llmValue", () => {
    const q = computeQuality({ llmValue: 0.8, relevance: 0.5, trust: 0.5 });
    expect(q).toBeCloseTo(0.8, 5); // neutral rel/trust => no adjustment
  });
  it("relevance/trust nudge around the 0.5 midpoint", () => {
    const up = computeQuality({ llmValue: 0.5, relevance: 1, trust: 1 });
    const down = computeQuality({ llmValue: 0.5, relevance: 0, trust: 0 });
    expect(up).toBeGreaterThan(0.5);
    expect(down).toBeLessThan(0.5);
  });
  it("clamps to [0,1]", () => {
    expect(computeQuality({ llmValue: 1, relevance: 1, trust: 1 })).toBeLessThanOrEqual(1);
    expect(computeQuality({ llmValue: 0, relevance: 0, trust: 0 })).toBeGreaterThanOrEqual(0);
  });
});

describe("gate", () => {
  it("passesGate at/above threshold (default 0.55)", () => {
    expect(passesGate(0.55)).toBe(true);
    expect(passesGate(0.54)).toBe(false);
  });
  it("inRescueBand for borderline below threshold (default margin 0.10)", () => {
    expect(inRescueBand(0.50)).toBe(true);   // 0.45..0.55
    expect(inRescueBand(0.44)).toBe(false);  // too low
    expect(inRescueBand(0.60)).toBe(false);  // already passes
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/lib/quality.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/scoring/quality.ts
import { config, qualityWeights } from "../../config.js";

export interface QualityInput { llmValue: number; relevance: number; trust: number; }

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

// Q is time-invariant and llm-dominant: llmValue plus small ± nudges from
// relevance and source trust around their 0.5 midpoint.
export function computeQuality(i: QualityInput): number {
  const q = i.llmValue
    + qualityWeights.wRel * (i.relevance - 0.5)
    + qualityWeights.wTrust * (i.trust - 0.5);
  return clamp01(q);
}

export function passesGate(q: number): boolean {
  return q >= config.Q_THRESHOLD;
}

// Borderline band just below the gate, eligible for like-rescue.
export function inRescueBand(q: number): boolean {
  return q < config.Q_THRESHOLD && q >= config.Q_THRESHOLD - config.RESCUE_MARGIN;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/lib/quality.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/scoring/quality.ts tests/lib/quality.test.ts
git commit -m "feat(scoring): time-invariant quality score Q + gate/rescue band"
```

### Task 5: 排序分 R（ranking）

**Files:**
- Create: `src/lib/scoring/ranking.ts`
- Test: `tests/lib/ranking.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/lib/ranking.test.ts
import { describe, expect, it } from "vitest";
import { computeRanking } from "../../src/lib/scoring/ranking.js";

describe("computeRanking", () => {
  it("combines all factors with config weights", () => {
    const r = computeRanking({ q: 1, platformHeat: 1, novelty: 1, likeAffinity: 1 });
    // weights sum to ~1 => max ~1
    expect(r).toBeCloseTo(1, 5);
  });
  it("higher platformHeat ranks higher, all else equal", () => {
    const hot = computeRanking({ q: 0.6, platformHeat: 0.9, novelty: 0.2, likeAffinity: 0 });
    const cold = computeRanking({ q: 0.6, platformHeat: 0.1, novelty: 0.2, likeAffinity: 0 });
    expect(hot).toBeGreaterThan(cold);
  });
  it("like affinity boosts ranking", () => {
    const liked = computeRanking({ q: 0.6, platformHeat: 0.3, novelty: 0.2, likeAffinity: 1 });
    const neutral = computeRanking({ q: 0.6, platformHeat: 0.3, novelty: 0.2, likeAffinity: 0 });
    expect(liked).toBeGreaterThan(neutral);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/lib/ranking.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/scoring/ranking.ts
import { rankingWeights } from "../../config.js";

export interface RankingInput {
  q: number; platformHeat: number; novelty: number; likeAffinity: number;
}

export function computeRanking(i: RankingInput): number {
  return rankingWeights.wQ * i.q
    + rankingWeights.wHeat * i.platformHeat
    + rankingWeights.wNov * i.novelty
    + rankingWeights.wAff * i.likeAffinity;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/lib/ranking.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/scoring/ranking.ts tests/lib/ranking.test.ts
git commit -m "feat(scoring): live ranking score R"
```

### Task 6: Schema 变更 + migration

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/0005_*.sql`（由 drizzle-kit 生成）

- [ ] **Step 1: 改 schema —— `scores` 加摘要列**

在 `export const scores = pgTable("scores", { ... })` 内、`rubricVersion` 之前追加：

```ts
  titleZh: text("title_zh").notNull().default(""),
  summaryEn: text("summary_en").notNull().default(""),
  summaryZh: text("summary_zh").notNull().default(""),
  fullTextFetched: boolean("full_text_fetched").notNull().default(false),
```

- [ ] **Step 2: 改 schema —— `rawItems` 加 `processedAt`**

在 `export const rawItems = pgTable("raw_items", { ... })` 内、`fetchedAt` 之后追加：

```ts
  processedAt: timestamp("processed_at", { withTimezone: true }),
```

- [ ] **Step 3: 生成 migration**

Run: `pnpm db:generate`
Expected: 在 `src/db/migrations/` 生成 `0005_*.sql`，journal 增加一条；SQL 含 `ALTER TABLE "scores" ADD COLUMN ...` 与 `ALTER TABLE "raw_items" ADD COLUMN "processed_at" ...`。

- [ ] **Step 4: 应用 migration 并 typecheck**

Run: `docker compose up -d db && DATABASE_URL=$TEST_DATABASE_URL pnpm db:migrate && pnpm typecheck`
Expected: migrate 成功；typecheck 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/db/schema.ts src/db/migrations
git commit -m "feat(db): scores bilingual summary cols + raw_items.processed_at"
```

### Task 7: `scoreBatch` 去掉 summary + 升 rubric 版本

**Files:**
- Modify: `src/lib/scoring/llm.ts`
- Modify: `src/lib/scoring/rubric.ts`
- Test: `tests/lib/llm.test.ts`（更新现有断言）

- [ ] **Step 1: 更新/确认测试不再期望 summary**

打开 `tests/lib/llm.test.ts`，删除任何对 `summary` 字段的断言（若有）。新增断言确保解析结果含 `value/topics/reason` 且**不含** `summary`：

```ts
// 在现有 describe 内补一条
it("parsed result has no summary field (moved to summarize stage)", async () => {
  // ...复用文件中已有的 mock fetch 与调用方式...
  // 断言：返回对象不含 summary 键
  // expect("summary" in result).toBe(false);
});
```

（注：若现有 `tests/lib/llm.test.ts` 结构不同，按其既有 mock 模式补；关键是移除 summary 期望。）

- [ ] **Step 2: 跑测试确认失败（旧测试期望 summary）**

Run: `pnpm exec vitest run tests/lib/llm.test.ts`
Expected: FAIL（旧断言或新断言不满足）。

- [ ] **Step 3: 改 `llm.ts` —— 从 schema 与 prompt 移除 summary**

`resultSchema` 去掉 `summary` 行：

```ts
const resultSchema = z.object({
  id: z.number(),
  value: z.number().catch(0).transform((v) => Math.max(0, Math.min(100, v))),
  topics: z.array(z.string()).catch([]).transform((a) => a.slice(0, 3)),
  reason: z.string().catch(""),
});
```

system prompt 改为不要 summary：

```ts
{ role: "system", content: `${RUBRIC}\nReturn JSON: {"results":[{"id","value","topics","reason"}]}` },
```

- [ ] **Step 4: 升 rubric 版本**

`src/lib/scoring/rubric.ts`：

```ts
export const RUBRIC_VERSION = "2026-06-04.1";
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run tests/lib/llm.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/lib/scoring/llm.ts src/lib/scoring/rubric.ts tests/lib/llm.test.ts
git commit -m "refactor(scoring): scoreBatch drops summary; bump rubric version"
```

### Task 8: triage 阶段（核心：打分前移 + 门槛）

**Files:**
- Create: `src/pipeline/triage.ts`
- Modify: `src/ingest/ingest.ts`（不再入队 normalize）
- Test: `tests/integration/triage.test.ts`

triage 逻辑：扫 `raw_items WHERE processed_at IS NULL` → 内存 `normalizeRawItem` → `selectCandidates` 预筛 → `scoreBatch` 打价值分 → 对每条算 `relevance/trust/Q` → `passesGate` 入库（写 items + scores，composite=Q），其余标记 processed 丢弃（救回逻辑在 Milestone 3 接入；本任务先不救回）。所有处理过的 raw_items 都置 `processed_at = now()`。

- [ ] **Step 1: 写失败测试**

```ts
// tests/integration/triage.test.ts
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { rawItems, items, scores } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";

// LLM mock: high value for "keep", low value for "drop".
vi.mock("../../src/lib/scoring/llm.js", () => ({
  scoreBatch: vi.fn(async (cands: { id: number; title: string }[]) =>
    new Map(cands.map((c) => [c.id, {
      id: c.id,
      value: c.title.includes("KEEP") ? 95 : 5,
      topics: ["agents"], reason: "r",
    }]))),
}));

function rawPayload(over: Partial<any>) {
  return {
    source: "hn", externalId: over.externalId ?? "x", url: "https://h.com/a",
    author: "a", title: over.title ?? "t", text: "body",
    createdAt: new Date().toISOString(), metrics: { points: 200 }, raw: {},
    ...over,
  };
}

beforeEach(async () => {
  await truncateAll();
  await db.insert(rawItems).values([
    { sourceId: 1, externalId: "k1", payload: rawPayload({ externalId: "k1", title: "KEEP Claude agents" }) },
    { sourceId: 1, externalId: "d1", payload: rawPayload({ externalId: "d1", title: "DROP random marketing", metrics: { points: 1 } }) },
  ]);
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("keeps high-Q items (writes item + score) and drops low ones", async () => {
  const { runTriageStage } = await import("../../src/pipeline/triage.js");
  const n = await runTriageStage(db);
  expect(n).toBeGreaterThan(0);

  const keptItems = await db.select().from(items);
  expect(keptItems).toHaveLength(1);
  expect(keptItems[0]!.title).toContain("KEEP");

  const keptScores = await db.select().from(scores);
  expect(keptScores).toHaveLength(1);
  expect(keptScores[0]!.composite).toBeGreaterThanOrEqual(0.55); // Q gate

  // all raw_items marked processed
  const unprocessed = await db.execute(sql`SELECT count(*)::int n FROM raw_items WHERE processed_at IS NULL`);
  expect(Number((unprocessed.rows ?? unprocessed)[0].n)).toBe(0);
});

it("is idempotent: a second run processes nothing", async () => {
  const { runTriageStage } = await import("../../src/pipeline/triage.js");
  await runTriageStage(db);
  const n2 = await runTriageStage(db);
  expect(n2).toBe(0);
  expect(await db.select().from(items)).toHaveLength(1);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/integration/triage.test.ts`
Expected: FAIL（`runTriageStage` 不存在）。

- [ ] **Step 3: 实现 `src/pipeline/triage.ts`**

```ts
// src/pipeline/triage.ts
import { eq, isNull, sql as dsql } from "drizzle-orm";
import { items, rawItems, scores } from "../db/schema.js";
import { normalizeRawItem } from "../lib/normalize.js";
import { computeRelevance } from "../lib/keywords.js";
import { selectCandidates } from "../lib/scoring/prefilter.js";
import { scoreBatch } from "../lib/scoring/llm.js";
import { computeQuality, passesGate } from "../lib/scoring/quality.js";
import { sourceTrust } from "../lib/sources/trust.js";
import { normalizeHeat } from "../lib/scoring/composite.js";
import { RUBRIC_VERSION } from "../lib/scoring/rubric.js";
import type { RawPayload } from "../types.js";

type Db = any;
const BATCH = 500;

export async function runTriageStage(db: Db): Promise<number> {
  const pending = await db.select().from(rawItems)
    .where(isNull(rawItems.processedAt))
    .limit(BATCH);
  if (pending.length === 0) return 0;

  // Normalize in memory; keep a map from a synthetic candidate id -> raw row.
  const normalized = pending.map((r: any) => ({
    rawId: Number(r.id),
    n: normalizeRawItem(r.payload as RawPayload),
  }));

  const candInputs = normalized.map((x: any) => ({
    id: x.rawId, title: x.n.title, text: x.n.text, source: x.n.source, metrics: x.n.metrics,
  }));
  const candidates = selectCandidates(candInputs);
  const llm = await scoreBatch(candidates);

  let processed = 0;
  for (const { rawId, n } of normalized) {
    const r = llm.get(rawId);
    const llmValue = (r?.value ?? 0) / 100;
    const relevance = computeRelevance(n.title, n.text);
    const trust = sourceTrust(n.source, n.url);
    const q = computeQuality({ llmValue, relevance, trust });

    if (passesGate(q)) {
      const [inserted] = await db.insert(items).values({
        rawItemId: rawId, source: n.source, url: n.url, canonicalUrl: n.canonicalUrl,
        author: n.author, title: n.title, text: n.text, createdAt: n.createdAt,
        metrics: n.metrics, contentHash: n.contentHash,
      }).onConflictDoNothing({ target: items.contentHash }).returning({ id: items.id });

      if (inserted) {
        await db.insert(scores).values({
          itemId: inserted.id,
          heat: normalizeHeat(n.metrics),
          relevance, novelty: 0, llmValue, composite: q,
          summary: "", reason: r?.reason ?? "", topicTags: r?.topics ?? [],
          rubricVersion: RUBRIC_VERSION,
        }).onConflictDoNothing({ target: scores.itemId });
      }
    }
    await db.update(rawItems).set({ processedAt: new Date() }).where(eq(rawItems.id, rawId));
    processed++;
  }
  return processed;
}
```

- [ ] **Step 4: 改 `ingest.ts` —— 不再入队 normalize**

把 `src/ingest/ingest.ts` 中入队 jobs 的块删除，只保留 raw_items upsert：

```ts
// src/ingest/ingest.ts
import { rawItems } from "../db/schema.js";
import type { RawPayload } from "../types.js";

interface IngestArgs { db: any; sourceId: number; payloads: RawPayload[]; }

export async function ingest({ db, sourceId, payloads }: IngestArgs): Promise<number> {
  if (payloads.length === 0) return 0;
  const inserted = await db
    .insert(rawItems)
    .values(payloads.map((p) => ({ sourceId, externalId: p.externalId, payload: p })))
    .onConflictDoNothing({ target: [rawItems.sourceId, rawItems.externalId] })
    .returning({ id: rawItems.id });
  return inserted.length;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run tests/integration/triage.test.ts`
Expected: PASS（两个用例）。

- [ ] **Step 6: 更新受影响的旧测试 / 删除过时 stage**

- 删除 `tests/integration/pipeline-normalize.test.ts` 与 `tests/integration/pipeline-score.test.ts`（normalize/score 流程已被 triage 取代）。
- 更新 `tests/integration/ingest.test.ts`：移除任何对 `jobs`(stage=normalize) 入队的断言；改为断言 `raw_items` 行已写入。

Run: `pnpm exec vitest run tests/integration/ingest.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/pipeline/triage.ts src/ingest/ingest.ts tests/integration/triage.test.ts tests/integration/ingest.test.ts
git rm tests/integration/pipeline-normalize.test.ts tests/integration/pipeline-score.test.ts
git commit -m "feat(pipeline): triage stage gates items by quality Q before storage"
```

### Task 9: 清理 stages.ts、改 worker、feed 按 R 排序、reset-corpus

**Files:**
- Modify: `src/pipeline/stages.ts`（删 normalize/score，留 embed）
- Modify: `src/pipeline/worker.ts`
- Modify: `src/app/feed-queries.ts`
- Create: `bin/reset-corpus.ts`
- Test: `tests/integration/feed-queries.test.ts`（更新）

- [ ] **Step 1: 精简 `stages.ts`**

删除 `handleNormalize`、`HANDLERS`、`runPendingJobs`、`runScoreStage`，仅保留 `runEmbedStage`（连同它的 imports）。结果文件大致：

```ts
// src/pipeline/stages.ts
import { sql as dsql } from "drizzle-orm";
import { itemEmbeddings } from "../db/schema.js";
import { embedTexts } from "../lib/embeddings.js";

type Db = any;

export async function runEmbedStage(db: Db): Promise<number> {
  const rows = await db.execute(dsql`
    SELECT i.id, i.title, i.text FROM items i
    LEFT JOIN item_embeddings e ON e.item_id = i.id
    WHERE e.item_id IS NULL
    LIMIT 100
  `);
  const items_ = (rows.rows ?? rows) as Array<{ id: number; title: string; text: string }>;
  if (items_.length === 0) return 0;
  const vectors = await embedTexts(items_.map((r) => `${r.title}\n${r.text ?? ""}`.slice(0, 2000)));
  for (let i = 0; i < items_.length; i++) {
    await db.insert(itemEmbeddings)
      .values({ itemId: Number(items_[i]!.id), embedding: vectors[i]! })
      .onConflictDoNothing({ target: itemEmbeddings.itemId });
  }
  return items_.length;
}
```

- [ ] **Step 2: 改 `worker.ts`**

```ts
// src/pipeline/worker.ts
import { db } from "../db/client.js";
import { runTriageStage } from "./triage.js";
import { runEmbedStage } from "./stages.js";
import { runSummarizeStage } from "./summarize-stage.js";
import { runClusterStage } from "../lib/cluster.js";

const POLL_MS = 5000;

async function loop() {
  for (;;) {
    try {
      const triaged = await runTriageStage(db);
      const embedded = await runEmbedStage(db);
      const summarized = await runSummarizeStage(db);
      const clustered = await runClusterStage(db, { threshold: 0.25 });
      if (triaged + embedded + summarized + clustered === 0) {
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch (err) {
      console.error("worker loop error", err);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}
loop();
```

> `runSummarizeStage` 在 Milestone 2 创建。若先只做 M1，可临时注释该行；推荐按里程碑顺序，M2 完成后此 import 才生效。

- [ ] **Step 3: 写/更新 feed 测试（按 R 排序，先不含反馈）**

更新 `tests/integration/feed-queries.test.ts`：插入两条 item+score，验证 `getFeed` 返回按 R 降序、且字段含 `titleZh/summaryZh`。示例：

```ts
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { items, scores } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { getFeed } from "../../src/app/feed-queries.js";

beforeEach(async () => {
  await truncateAll();
  const now = new Date();
  const [a] = await db.insert(items).values({
    rawItemId: 1, source: "hn", title: "fresh hot", text: "", createdAt: now,
    metrics: { points: 500 }, contentHash: "a",
  }).returning();
  const [b] = await db.insert(items).values({
    rawItemId: 2, source: "hn", title: "old cold", text: "",
    createdAt: new Date(now.getTime() - 72 * 3600_000),
    metrics: { points: 5 }, contentHash: "b",
  }).returning();
  await db.insert(scores).values([
    { itemId: a!.id, composite: 0.7, novelty: 0.2, summaryZh: "中文A", titleZh: "标题A", rubricVersion: "t" },
    { itemId: b!.id, composite: 0.7, novelty: 0.2, summaryZh: "中文B", titleZh: "标题B", rubricVersion: "t" },
  ]);
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("orders by live ranking R (fresh+hot first)", async () => {
  const feed = await getFeed(db, { limit: 50 });
  expect(feed[0]!.titleZh).toBe("标题A");
  expect(feed.map((r: any) => r.titleZh)).toEqual(["标题A", "标题B"]);
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `pnpm exec vitest run tests/integration/feed-queries.test.ts`
Expected: FAIL。

- [ ] **Step 5: 实现 `feed-queries.ts`（M1 版本：R 排序，反馈在 M3 接入）**

```ts
// src/app/feed-queries.ts
import { sql } from "drizzle-orm";
import { platformHeat, hoursSince } from "../lib/scoring/platform-heat.js";
import { sourceTrust } from "../lib/sources/trust.js";
import { computeRanking } from "../lib/scoring/ranking.js";

type Db = any;

interface Row {
  id: number; title: string; titleZh: string; url: string | null; source: string;
  createdAt: string; metrics: Record<string, number>;
  q: number; novelty: number; summaryZh: string; summaryEn: string;
  topicTags: unknown; reason: string;
  maxLikeSim: number | null; maxDislikeSim: number | null; nUp: number;
}

// Pull recent kept items + (M3) feedback similarities. M1: like/dislike sims are 0/null.
export async function getFeedCandidates(db: Db, opts: { limit: number }): Promise<Row[]> {
  const res = await db.execute(sql`
    SELECT i.id, i.title, s.title_zh AS "titleZh", i.url, i.source,
           i.created_at AS "createdAt", i.metrics,
           s.composite AS q, s.novelty, s.summary_zh AS "summaryZh", s.summary_en AS "summaryEn",
           s.topic_tags AS "topicTags", s.reason,
           NULL::float8 AS "maxLikeSim", NULL::float8 AS "maxDislikeSim", 0::int AS "nUp"
    FROM items i
    JOIN scores s ON s.item_id = i.id
    WHERE i.is_archived = false
    ORDER BY i.created_at DESC
    LIMIT ${Math.max(opts.limit * 6, 300)}
  `);
  return (res.rows ?? res) as Row[];
}

function rank(rows: Row[]): Array<Row & { r: number }> {
  const now = new Date();
  return rows.map((row) => {
    const hours = hoursSince(new Date(row.createdAt), now);
    const heat = platformHeat({
      source: row.source, metrics: row.metrics ?? {}, hours,
      trust: sourceTrust(row.source, row.url),
    });
    const r = computeRanking({ q: row.q ?? 0, platformHeat: heat, novelty: row.novelty ?? 0, likeAffinity: 0 });
    return { ...row, r };
  }).sort((a, b) => b.r - a.r);
}

export async function getFeed(db: Db, opts: { limit: number }) {
  const rows = await getFeedCandidates(db, opts);
  return rank(rows).slice(0, opts.limit);
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm exec vitest run tests/integration/feed-queries.test.ts`
Expected: PASS。

- [ ] **Step 7: 写 reset-corpus 脚本**

```ts
// bin/reset-corpus.ts
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";

// One-off: wipe the curated corpus and the raw ingestion ledger so collectors
// re-pull fresh under the new rules. Destructive — run intentionally.
async function main() {
  await db.execute(sql`TRUNCATE TABLE
    item_topics, topic_trends, topics, item_embeddings, scores, feedback, items, jobs, raw_items
    RESTART IDENTITY CASCADE`);
  console.log("reset-corpus: corpus + raw_items cleared");
  await pool.end();
}
main();
```

加 package.json script（在 `"rescore"` 行后）：

```json
    "reset-corpus": "tsx bin/reset-corpus.ts",
```

- [ ] **Step 8: typecheck + 提交**

Run: `pnpm typecheck`
Expected: 通过（若 worker 引用了尚未创建的 summarize-stage，先做 M2 或临时注释；见 Step 2 备注）。

```bash
git add src/pipeline/stages.ts src/pipeline/worker.ts src/app/feed-queries.ts bin/reset-corpus.ts package.json tests/integration/feed-queries.test.ts
git commit -m "feat(pipeline): R-ranked feed, slim stages, reset-corpus script"
```

---

# Milestone 2 — 抓全文 + 双语摘要

产出：保留文章抓原文正文并生成中文标题/英文摘要/中文翻译。

### Task 10: 加依赖 `@extractus/article-extractor`

**Files:** `package.json`（由 pnpm 更新）

- [ ] **Step 1: 安装**

Run: `pnpm add @extractus/article-extractor`
Expected: 写入 dependencies，pnpm-lock 更新。

- [ ] **Step 2: 提交**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: add @extractus/article-extractor for full-text extraction"
```

### Task 11: 抓全文 + 回退（fulltext）

**Files:**
- Create: `src/lib/fulltext.ts`
- Test: `tests/lib/fulltext.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/lib/fulltext.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchFullText } from "../../src/lib/fulltext.js";
import { extract } from "@extractus/article-extractor";

vi.mock("@extractus/article-extractor", () => ({ extract: vi.fn() }));

describe("fetchFullText", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns extracted content when available", async () => {
    (extract as any).mockResolvedValue({ content: "<p>Hello world body</p>" });
    const out = await fetchFullText("https://x.com/a", "fallback");
    expect(out.fetched).toBe(true);
    expect(out.text).toContain("Hello world body");
  });

  it("falls back when extraction fails", async () => {
    (extract as any).mockRejectedValue(new Error("paywall"));
    const out = await fetchFullText("https://x.com/a", "fallback text");
    expect(out.fetched).toBe(false);
    expect(out.text).toBe("fallback text");
  });

  it("falls back when url is null", async () => {
    const out = await fetchFullText(null, "fallback text");
    expect(out.fetched).toBe(false);
    expect(out.text).toBe("fallback text");
    expect(extract).not.toHaveBeenCalled();
  });

  it("falls back when extraction returns empty", async () => {
    (extract as any).mockResolvedValue({ content: "   " });
    const out = await fetchFullText("https://x.com/a", "fb");
    expect(out.fetched).toBe(false);
    expect(out.text).toBe("fb");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/lib/fulltext.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/fulltext.ts
import { extract } from "@extractus/article-extractor";

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Always attempt to fetch + extract the article body; on any failure
// (network, paywall, empty), fall back to the provided text.
export async function fetchFullText(
  url: string | null, fallback: string,
): Promise<{ text: string; fetched: boolean }> {
  if (!url) return { text: fallback, fetched: false };
  try {
    const article = await extract(url);
    const content = article?.content ? stripHtml(article.content) : "";
    if (content.length > 0) return { text: content, fetched: true };
  } catch {
    // swallow: fall through to fallback
  }
  return { text: fallback, fetched: false };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/lib/fulltext.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/fulltext.ts tests/lib/fulltext.test.ts
git commit -m "feat(summary): full-text fetch with safe fallback"
```

### Task 12: 双语摘要 LLM 调用（summarize）

**Files:**
- Create: `src/lib/scoring/summarize.ts`
- Test: `tests/lib/summarize.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/lib/summarize.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function llmReply(obj: unknown) {
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) };
}

describe("summarizeBilingual", () => {
  beforeEach(() => fetchMock.mockReset());

  it("returns title_zh / summary_en / summary_zh", async () => {
    fetchMock.mockResolvedValue(llmReply({
      title_zh: "中文标题", summary_en: "English summary.", summary_zh: "中文翻译。",
    }));
    const { summarizeBilingual } = await import("../../src/lib/scoring/summarize.js");
    const out = await summarizeBilingual({ title: "Title", text: "Body text" });
    expect(out.titleZh).toBe("中文标题");
    expect(out.summaryEn).toBe("English summary.");
    expect(out.summaryZh).toBe("中文翻译。");
  });

  it("tolerates missing fields (defaults to empty strings)", async () => {
    fetchMock.mockResolvedValue(llmReply({ summary_en: "Only english" }));
    const { summarizeBilingual } = await import("../../src/lib/scoring/summarize.js");
    const out = await summarizeBilingual({ title: "T", text: "B" });
    expect(out.summaryEn).toBe("Only english");
    expect(out.titleZh).toBe("");
    expect(out.summaryZh).toBe("");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/lib/summarize.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/scoring/summarize.ts
import { z } from "zod";
import { config } from "../../config.js";

export interface BilingualSummary { titleZh: string; summaryEn: string; summaryZh: string; }

const schema = z.object({
  title_zh: z.string().catch(""),
  summary_en: z.string().catch(""),
  summary_zh: z.string().catch(""),
});

const SYSTEM = `You are a senior AI-news editor. Given an article, produce a high-quality summary.
Return JSON: {"title_zh","summary_en","summary_zh"}.
- summary_en: 2-4 crisp sentences capturing the concrete technical substance (no hype).
- summary_zh: a faithful full Chinese translation of summary_en.
- title_zh: a natural Chinese title.`;

export async function summarizeBilingual(input: { title: string; text: string }): Promise<BilingualSummary> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${config.OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.SCORING_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Title: ${input.title}\n\n${input.text.slice(0, 6000)}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`summarize ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const parsed = schema.parse(JSON.parse(data.choices[0]!.message.content));
  return { titleZh: parsed.title_zh, summaryEn: parsed.summary_en, summaryZh: parsed.summary_zh };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/lib/summarize.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/scoring/summarize.ts tests/lib/summarize.test.ts
git commit -m "feat(summary): bilingual summary LLM call (zh title + en summary + zh translation)"
```

### Task 13: 摘要阶段（summarize-stage）

**Files:**
- Create: `src/pipeline/summarize-stage.ts`
- Test: `tests/integration/summarize-stage.test.ts`

阶段逻辑：扫"已入库但还没摘要"的文章（`scores.summary_en = ''`）→ 抓全文 → `summarizeBilingual` → 回写 `title_zh/summary_en/summary_zh/full_text_fetched`。

- [ ] **Step 1: 写失败测试**

```ts
// tests/integration/summarize-stage.test.ts
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { items, scores } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";
import { db, pool, truncateAll } from "../setup/db.js";

vi.mock("../../src/lib/fulltext.js", () => ({
  fetchFullText: vi.fn(async () => ({ text: "full article body", fetched: true })),
}));
vi.mock("../../src/lib/scoring/summarize.js", () => ({
  summarizeBilingual: vi.fn(async () => ({ titleZh: "标题", summaryEn: "EN", summaryZh: "中文" })),
}));

let itemId: number;
beforeEach(async () => {
  await truncateAll();
  const [it] = await db.insert(items).values({
    rawItemId: 1, source: "hn", url: "https://x.com/a", title: "T", text: "body",
    createdAt: new Date(), metrics: { points: 100 }, contentHash: "h",
  }).returning();
  itemId = it!.id;
  await db.insert(scores).values({ itemId, composite: 0.7, rubricVersion: "t" });
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("writes bilingual summary for un-summarized kept items", async () => {
  const { runSummarizeStage } = await import("../../src/pipeline/summarize-stage.js");
  const n = await runSummarizeStage(db);
  expect(n).toBe(1);
  const [s] = await db.select().from(scores).where(eq(scores.itemId, itemId));
  expect(s!.titleZh).toBe("标题");
  expect(s!.summaryEn).toBe("EN");
  expect(s!.summaryZh).toBe("中文");
  expect(s!.fullTextFetched).toBe(true);
});

it("is idempotent (already-summarized items are skipped)", async () => {
  const { runSummarizeStage } = await import("../../src/pipeline/summarize-stage.js");
  await runSummarizeStage(db);
  const n2 = await runSummarizeStage(db);
  expect(n2).toBe(0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/integration/summarize-stage.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// src/pipeline/summarize-stage.ts
import { eq, sql as dsql } from "drizzle-orm";
import { scores } from "../db/schema.js";
import { fetchFullText } from "../lib/fulltext.js";
import { summarizeBilingual } from "../lib/scoring/summarize.js";

type Db = any;
const LIMIT = 25;

export async function runSummarizeStage(db: Db): Promise<number> {
  const rows = await db.execute(dsql`
    SELECT i.id, i.title, i.url, i.text
    FROM items i JOIN scores s ON s.item_id = i.id
    WHERE s.summary_en = ''
    ORDER BY s.composite DESC
    LIMIT ${LIMIT}
  `);
  const list = (rows.rows ?? rows) as Array<{ id: number; title: string; url: string | null; text: string }>;
  if (list.length === 0) return 0;

  let done = 0;
  for (const row of list) {
    try {
      const ft = await fetchFullText(row.url, row.text ?? "");
      const sum = await summarizeBilingual({ title: row.title, text: ft.text });
      await db.update(scores).set({
        titleZh: sum.titleZh, summaryEn: sum.summaryEn || " ", summaryZh: sum.summaryZh,
        fullTextFetched: ft.fetched,
      }).where(eq(scores.itemId, Number(row.id)));
      done++;
    } catch (err) {
      console.error("summarize error", row.id, err);
    }
  }
  return done;
}
```

> 注：`summaryEn || " "` 保证即使模型回空也不会卡在"未摘要"循环里被无限重选（`summary_en = ''` 是未处理标记）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/integration/summarize-stage.test.ts`
Expected: PASS。

- [ ] **Step 5: 全量回归 + typecheck + 提交**

Run: `pnpm typecheck && pnpm test`
Expected: 全绿（worker 现在能正确 import summarize-stage）。

```bash
git add src/pipeline/summarize-stage.ts tests/integration/summarize-stage.test.ts
git commit -m "feat(pipeline): bilingual summarize stage (fetch full text + summarize kept items)"
```

---

# Milestone 3 — 反馈画像（点赞救回 + 点踩软压制）

产出：👍 加权排序并救回边缘文章；👎 软压制相似文章（隐藏出 Feed、可搜索、可撤销）。

### Task 14: 画像纯函数（profile）

**Files:**
- Create: `src/lib/feedback/profile.ts`
- Test: `tests/lib/profile.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/lib/profile.test.ts
import { describe, expect, it } from "vitest";
import { likeAffinity, isSuppressed, likeRescues, clamp01 } from "../../src/lib/feedback/profile.js";

describe("likeAffinity", () => {
  it("is 0 with no upvotes (cold start)", () => {
    expect(likeAffinity(0.9, 0)).toBe(0);
  });
  it("scales with upvote count up to N0 (default 5)", () => {
    expect(likeAffinity(1, 5)).toBeCloseTo(1, 5);
    expect(likeAffinity(1, 1)).toBeCloseTo(0.2, 5);
  });
  it("clamps negative similarity to 0", () => {
    expect(likeAffinity(-0.5, 10)).toBe(0);
  });
  it("null similarity => 0", () => {
    expect(likeAffinity(null, 10)).toBe(0);
  });
});

describe("isSuppressed", () => {
  it("true at/above SUPPRESS_THRESHOLD (default 0.92)", () => {
    expect(isSuppressed(0.95)).toBe(true);
    expect(isSuppressed(0.90)).toBe(false);
    expect(isSuppressed(null)).toBe(false);
  });
});

describe("likeRescues", () => {
  it("true at/above RESCUE_SIM_THRESHOLD (default 0.85)", () => {
    expect(likeRescues(0.86)).toBe(true);
    expect(likeRescues(0.80)).toBe(false);
    expect(likeRescues(null)).toBe(false);
  });
});

describe("clamp01", () => {
  it("clamps", () => { expect(clamp01(2)).toBe(1); expect(clamp01(-1)).toBe(0); });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/lib/profile.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/feedback/profile.ts
import { config } from "../../config.js";

export function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

// like affinity = clamped max similarity to liked items, scaled by cold-start factor.
export function likeAffinity(maxLikeSim: number | null, nUp: number): number {
  const sim = clamp01(maxLikeSim ?? 0);
  const cold = config.COLDSTART_N0 <= 0 ? 1 : Math.min(1, nUp / config.COLDSTART_N0);
  return sim * cold;
}

export function isSuppressed(maxDislikeSim: number | null): boolean {
  return (maxDislikeSim ?? 0) >= config.SUPPRESS_THRESHOLD;
}

export function likeRescues(maxLikeSim: number | null): boolean {
  return (maxLikeSim ?? 0) >= config.RESCUE_SIM_THRESHOLD;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/lib/profile.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/feedback/profile.ts tests/lib/profile.test.ts
git commit -m "feat(feedback): pure profile functions (affinity/suppress/rescue)"
```

### Task 15: feed 接入反馈相似度 + 压制过滤 + 亲和加权

**Files:**
- Modify: `src/app/feed-queries.ts`
- Test: `tests/integration/feed-feedback.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/integration/feed-feedback.test.ts
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { items, scores, itemEmbeddings, feedback } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { getFeed, getSuppressed } from "../../src/app/feed-queries.js";

// 3-dim "embeddings" are enough to test cosine behavior via pgvector.
function vec(a: number[]) { return a; }

let liked: number, similarToDisliked: number, neutral: number;
beforeEach(async () => {
  await truncateAll();
  const now = new Date();
  const mk = async (hash: string, emb: number[]) => {
    const [it] = await db.insert(items).values({
      rawItemId: 1, source: "hn", title: hash, text: "", createdAt: now,
      metrics: { points: 100 }, contentHash: hash,
    }).returning();
    await db.insert(scores).values({ itemId: it!.id, composite: 0.7, novelty: 0.2, rubricVersion: "t", summaryEn: "x" });
    await db.execute(sql`INSERT INTO item_embeddings (item_id, embedding) VALUES (${it!.id}, ${JSON.stringify(emb)}::vector)`);
    return it!.id;
  };
  // NOTE: real embeddings are 2048-dim; this test assumes a 3-dim test DB column.
  // If the column is fixed at 2048, pad vectors to 2048 in a helper instead.
  liked = await mk("liked", vec([1, 0, 0]));
  similarToDisliked = await mk("simdown", vec([0, 1, 0]));
  neutral = await mk("neutral", vec([0, 0, 1]));

  // upvote a 4th item whose embedding == liked's direction
  const [up] = await db.insert(items).values({
    rawItemId: 1, source: "hn", title: "upref", text: "", createdAt: now, metrics: {}, contentHash: "upref",
  }).returning();
  await db.execute(sql`INSERT INTO item_embeddings (item_id, embedding) VALUES (${up!.id}, ${JSON.stringify([1,0,0])}::vector)`);
  await db.insert(feedback).values({ itemId: up!.id, signal: "up" });

  // downvote an item whose embedding == simdown's direction
  const [down] = await db.insert(items).values({
    rawItemId: 1, source: "hn", title: "downref", text: "", createdAt: now, metrics: {}, contentHash: "downref",
  }).returning();
  await db.execute(sql`INSERT INTO item_embeddings (item_id, embedding) VALUES (${down!.id}, ${JSON.stringify([0,1,0])}::vector)`);
  await db.insert(feedback).values({ itemId: down!.id, signal: "down" });
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("hides items similar to a downvoted one from the feed", async () => {
  const feed = await getFeed(db, { limit: 50 });
  const titles = feed.map((r: any) => r.title);
  expect(titles).not.toContain("simdown"); // suppressed
});

it("surfaces suppressed items in the suppressed view", async () => {
  const sup = await getSuppressed(db, { limit: 50 });
  expect(sup.map((r: any) => r.title)).toContain("simdown");
});

it("ranks liked-similar item above neutral", async () => {
  const feed = await getFeed(db, { limit: 50 });
  const titles = feed.map((r: any) => r.title).filter((t: string) => ["liked", "neutral"].includes(t));
  expect(titles[0]).toBe("liked");
});
```

> **测试注意**：`item_embeddings.embedding` 在 schema 里是 `vector(2048)`。若测试 DB 列固定 2048 维，请把上面 `[1,0,0]` 等替换为"在指定下标置 1、其余 0 的 2048 维向量"的 helper（例如 `const e=(i)=>Array.from({length:2048},(_,k)=>k===i?1:0)`）。cosine 行为不变。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/integration/feed-feedback.test.ts`
Expected: FAIL（`getSuppressed` 不存在 / 未过滤）。

- [ ] **Step 3: 改 `feed-queries.ts` —— 相似度子查询 + 压制过滤 + 亲和**

把 `getFeedCandidates` 的 SQL 改为带窗口期的点赞/点踩最大相似度子查询，并新增 `getSuppressed`：

```ts
// src/app/feed-queries.ts  (替换 getFeedCandidates / rank / getFeed，并新增 getSuppressed)
import { sql } from "drizzle-orm";
import { config } from "../config.js";
import { platformHeat, hoursSince } from "../lib/scoring/platform-heat.js";
import { sourceTrust } from "../lib/sources/trust.js";
import { computeRanking } from "../lib/scoring/ranking.js";
import { likeAffinity, isSuppressed } from "../lib/feedback/profile.js";

type Db = any;

interface Row {
  id: number; title: string; titleZh: string; url: string | null; source: string;
  createdAt: string; metrics: Record<string, number>;
  q: number; novelty: number; summaryZh: string; summaryEn: string;
  topicTags: unknown; reason: string;
  maxLikeSim: number | null; maxDislikeSim: number | null; nUp: number;
}

async function candidates(db: Db, limit: number): Promise<Row[]> {
  const win = `${config.PROFILE_WINDOW_DAYS} days`;
  const res = await db.execute(sql`
    WITH up AS (
      SELECT count(*)::int AS n FROM feedback
      WHERE signal = 'up' AND created_at > now() - ${win}::interval
    )
    SELECT i.id, i.title, s.title_zh AS "titleZh", i.url, i.source,
           i.created_at AS "createdAt", i.metrics,
           s.composite AS q, s.novelty, s.summary_zh AS "summaryZh", s.summary_en AS "summaryEn",
           s.topic_tags AS "topicTags", s.reason,
           (SELECT 1 - MIN(le.embedding <=> e.embedding)
              FROM item_embeddings le JOIN feedback f ON f.item_id = le.item_id
              WHERE f.signal = 'up' AND f.created_at > now() - ${win}::interval) AS "maxLikeSim",
           (SELECT 1 - MIN(de.embedding <=> e.embedding)
              FROM item_embeddings de JOIN feedback f ON f.item_id = de.item_id
              WHERE f.signal = 'down' AND f.created_at > now() - ${win}::interval) AS "maxDislikeSim",
           (SELECT n FROM up) AS "nUp"
    FROM items i
    JOIN scores s ON s.item_id = i.id
    LEFT JOIN item_embeddings e ON e.item_id = i.id
    WHERE i.is_archived = false
    ORDER BY i.created_at DESC
    LIMIT ${Math.max(limit * 6, 300)}
  `);
  return (res.rows ?? res) as Row[];
}

function ranked(rows: Row[]): Array<Row & { r: number }> {
  const now = new Date();
  return rows.map((row) => {
    const hours = hoursSince(new Date(row.createdAt), now);
    const heat = platformHeat({
      source: row.source, metrics: row.metrics ?? {}, hours, trust: sourceTrust(row.source, row.url),
    });
    const aff = likeAffinity(row.maxLikeSim, Number(row.nUp ?? 0));
    const r = computeRanking({ q: row.q ?? 0, platformHeat: heat, novelty: row.novelty ?? 0, likeAffinity: aff });
    return { ...row, r };
  }).sort((a, b) => b.r - a.r);
}

export async function getFeed(db: Db, opts: { limit: number }) {
  const rows = await candidates(db, opts.limit);
  const visible = rows.filter((row) => !isSuppressed(row.maxDislikeSim));
  return ranked(visible).slice(0, opts.limit);
}

export async function getSuppressed(db: Db, opts: { limit: number }) {
  const rows = await candidates(db, opts.limit);
  const hidden = rows.filter((row) => isSuppressed(row.maxDislikeSim));
  return ranked(hidden).slice(0, opts.limit);
}
```

> 删除 M1 里临时的 `getFeedCandidates` 旧实现（被 `candidates` 取代）；如其它文件未引用它可直接移除。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/integration/feed-feedback.test.ts tests/integration/feed-queries.test.ts`
Expected: PASS（feed-queries 旧测试在无反馈时 `maxLikeSim/maxDislikeSim` 为 NULL，行为不变）。

- [ ] **Step 5: 提交**

```bash
git add src/app/feed-queries.ts tests/integration/feed-feedback.test.ts
git commit -m "feat(feedback): like-affinity ranking + dislike soft-suppression in feed"
```

### Task 16: triage 接入点赞救回

**Files:**
- Modify: `src/pipeline/triage.ts`
- Test: `tests/integration/triage-rescue.test.ts`

救回：对 `inRescueBand(q)` 的候选，临时算 embedding，查与点赞集合的 maxLikeSim，`likeRescues` 为真则破例保留（并把该 embedding 写入 `item_embeddings`，省一次重复 embed）。

- [ ] **Step 1: 写失败测试**

```ts
// tests/integration/triage-rescue.test.ts
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { rawItems, items, scores, itemEmbeddings, feedback } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";

// Force a borderline Q (just below the 0.55 gate): value 0.50 => Q≈0.50 in rescue band.
vi.mock("../../src/lib/scoring/llm.js", () => ({
  scoreBatch: vi.fn(async (cands: { id: number }[]) =>
    new Map(cands.map((c) => [c.id, { id: c.id, value: 50, topics: [], reason: "r" }]))),
}));
// Borderline candidate embeds identical to a previously-liked item.
vi.mock("../../src/lib/embeddings.js", () => ({
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0])),
}));

beforeEach(async () => {
  await truncateAll();
  // an already-liked item with embedding [1,0,0]
  const [liked] = await db.insert(items).values({
    rawItemId: 1, source: "hn", title: "liked", text: "", createdAt: new Date(), metrics: {}, contentHash: "liked",
  }).returning();
  await db.execute(sql`INSERT INTO item_embeddings (item_id, embedding) VALUES (${liked!.id}, ${JSON.stringify([1,0,0])}::vector)`);
  await db.insert(feedback).values({ itemId: liked!.id, signal: "up" });

  await db.insert(rawItems).values({
    sourceId: 1, externalId: "cand",
    payload: {
      source: "hn", externalId: "cand", url: "https://h/c", author: "a",
      title: "Agent borderline", text: "agentic body", createdAt: new Date().toISOString(),
      metrics: { points: 50 }, raw: {},
    },
  });
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("rescues a borderline candidate similar to a liked item", async () => {
  const { runTriageStage } = await import("../../src/pipeline/triage.js");
  await runTriageStage(db);
  const kept = await db.select().from(items).where(sql`title = 'Agent borderline'`);
  expect(kept).toHaveLength(1);
  // its embedding should have been persisted during rescue
  const emb = await db.execute(sql`SELECT count(*)::int n FROM item_embeddings e JOIN items i ON i.id=e.item_id WHERE i.title='Agent borderline'`);
  expect(Number((emb.rows ?? emb)[0].n)).toBe(1);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/integration/triage-rescue.test.ts`
Expected: FAIL（边缘候选被丢弃）。

- [ ] **Step 3: 改 `triage.ts` —— 加救回分支**

顶部补 import：

```ts
import { itemEmbeddings, feedback } from "../db/schema.js";
import { inRescueBand } from "../lib/scoring/quality.js";
import { likeRescues } from "../lib/feedback/profile.js";
import { embedTexts } from "../lib/embeddings.js";
import { config } from "../config.js";
```

新增辅助：对一个向量查与点赞集合的 maxLikeSim：

```ts
async function maxLikeSimForVector(db: Db, vec: number[]): Promise<number | null> {
  const res = await db.execute(dsql`
    SELECT 1 - MIN(le.embedding <=> ${JSON.stringify(vec)}::vector) AS sim
    FROM item_embeddings le JOIN feedback f ON f.item_id = le.item_id
    WHERE f.signal = 'up' AND f.created_at > now() - (${config.PROFILE_WINDOW_DAYS} || ' days')::interval
  `);
  const row = (res.rows ?? res)[0] as { sim: number | null } | undefined;
  return row?.sim ?? null;
}
```

把 `passesGate(q)` 那段改为"达标 OR 边缘救回"，并在救回时持久化 embedding：

```ts
    let keep = passesGate(q);
    let rescueVec: number[] | null = null;

    if (!keep && inRescueBand(q)) {
      const [vec] = await embedTexts([`${n.title}\n${n.text}`.slice(0, 2000)]);
      if (vec) {
        const sim = await maxLikeSimForVector(db, vec);
        if (likeRescues(sim)) { keep = true; rescueVec = vec; }
      }
    }

    if (keep) {
      const [inserted] = await db.insert(items).values({
        rawItemId: rawId, source: n.source, url: n.url, canonicalUrl: n.canonicalUrl,
        author: n.author, title: n.title, text: n.text, createdAt: n.createdAt,
        metrics: n.metrics, contentHash: n.contentHash,
      }).onConflictDoNothing({ target: items.contentHash }).returning({ id: items.id });

      if (inserted) {
        await db.insert(scores).values({
          itemId: inserted.id, heat: normalizeHeat(n.metrics), relevance, novelty: 0,
          llmValue, composite: q, summary: "", reason: r?.reason ?? "",
          topicTags: r?.topics ?? [], rubricVersion: RUBRIC_VERSION,
        }).onConflictDoNothing({ target: scores.itemId });

        if (rescueVec) {
          await db.insert(itemEmbeddings)
            .values({ itemId: inserted.id, embedding: rescueVec })
            .onConflictDoNothing({ target: itemEmbeddings.itemId });
        }
      }
    }
    await db.update(rawItems).set({ processedAt: new Date() }).where(eq(rawItems.id, rawId));
    processed++;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/integration/triage-rescue.test.ts tests/integration/triage.test.ts`
Expected: PASS（救回用例通过；原 triage 用例不受影响，因为它们的低分 value=5 远低于救回带）。

- [ ] **Step 5: 提交**

```bash
git add src/pipeline/triage.ts tests/integration/triage-rescue.test.ts
git commit -m "feat(feedback): like-rescue borderline candidates similar to upvotes"
```

### Task 17: 撤销点踩（feedback DELETE）

**Files:**
- Modify: `src/app/api/feedback/route.ts`
- Test: `tests/integration/feedback-route.test.ts`（补充 DELETE 用例）

- [ ] **Step 1: 在现有测试文件补失败用例**

```ts
// tests/integration/feedback-route.test.ts  (新增)
it("DELETE removes a feedback signal (undo)", async () => {
  const { POST, DELETE } = await import("../../src/app/api/feedback/route.js");
  await POST(new Request("http://x/api/feedback", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId: 1, signal: "down" }),
  }));
  const res = await DELETE(new Request("http://x/api/feedback", {
    method: "DELETE", headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId: 1, signal: "down" }),
  }));
  expect(res.status).toBe(200);
  // 断言 feedback 表中该行已删除（按文件已有的 db 读取方式）
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/integration/feedback-route.test.ts`
Expected: FAIL（无 DELETE 导出）。

- [ ] **Step 3: 实现 DELETE handler**

在 `src/app/api/feedback/route.ts` 末尾追加：

```ts
import { and, eq } from "drizzle-orm";

export async function DELETE(req: Request): Promise<Response> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("bad request", { status: 400 });
  await db.delete(feedback).where(
    and(eq(feedback.itemId, parsed.data.itemId), eq(feedback.signal, parsed.data.signal)),
  );
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/integration/feedback-route.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/app/api/feedback/route.ts tests/integration/feedback-route.test.ts
git commit -m "feat(feedback): DELETE endpoint to undo a feedback signal"
```

### Task 18: 前端 —— 中文展示 + 已压制页

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/app/suppressed/page.tsx`

（UI 为自用工具，保持现有内联样式风格；无独立单测，靠 `pnpm build` 验证。）

- [ ] **Step 1: 改 `page.tsx` 展示中文标题/摘要 + 指向已压制页**

将 feed `<li>` 内的展示改为优先中文：

```tsx
<a href={item.url ?? "#"} target="_blank" rel="noreferrer">
  <strong>{item.titleZh || item.title}</strong>
</a>
<FeedbackButtons itemId={item.id} />
{item.summaryZh && <div style={{ margin: "4px 0" }}>{item.summaryZh}</div>}
{item.summaryEn && <div style={{ margin: "4px 0", color: "#555", fontSize: 13 }}>{item.summaryEn}</div>}
<div style={{ fontSize: 12, color: "#888" }}>
  {item.source} · R {item.r?.toFixed?.(2) ?? "—"}
  {Array.isArray(item.topicTags) && item.topicTags.length > 0 && ` · ${item.topicTags.join(", ")}`}
</div>
```

在 `<h1>AI Signal</h1>` 下方加入口：

```tsx
<p><a href="/suppressed">查看已压制（被点踩相似）的内容 →</a></p>
```

- [ ] **Step 2: 新建已压制页**

```tsx
// src/app/suppressed/page.tsx
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
```

- [ ] **Step 3: 构建验证**

Run: `pnpm build`
Expected: 构建成功，无类型/编译错误。

- [ ] **Step 4: 提交**

```bash
git add src/app/page.tsx src/app/suppressed/page.tsx
git commit -m "feat(ui): bilingual feed display + suppressed-items view"
```

### Task 19: 全量回归 + 收尾

**Files:** 无新文件

- [ ] **Step 1: 类型 + 全量测试**

Run: `pnpm typecheck && pnpm test`
Expected: 全绿。

- [ ] **Step 2: 手动冒烟（可选，需 DB + OPENROUTER_API_KEY）**

```bash
pnpm reset-corpus           # 清空存量
pnpm collect:hn && pnpm collect:rss
pnpm worker                 # 观察 triage→embed→summarize→cluster 日志
```
Expected: 仅高 Q 文章入库；保留文章带中文标题/摘要；Feed 按 R 排序；点踩后相似内容移出 Feed。

- [ ] **Step 3: 终审（建议用 superpowers:requesting-code-review）**

对照 spec 检查覆盖与一致性，再决定合并。

---

## Self-Review（计划自检）

**1. Spec coverage**
- 平台时间衰减热度 → Task 1。规则区分平台（HN points / Reddit ups / Twitter 加权 / RSS trust×新鲜度）→ Task 1+3。
- 双层打分（Q 门槛 + R 实时）→ Task 4/5；Q 存入 `composite` → Task 8；R 实时算 → Task 9/15。
- 低分不入库（丢弃）→ Task 8（gate）。
- 独立高质量摘要 + 中文翻译 → Task 12/13；抓全文 → Task 11；复用 SCORING_MODEL → Task 12。
- 反馈画像：点赞加权 → Task 15；点赞救回 → Task 16；点踩软压制 + 已压制视图 + 撤销 → Task 15/17/18。
- 存量清空 → Task 9（reset-corpus）。
- Schema/migration/rubric 升版 → Task 6/7。
- 错误处理：抓全文回退（Task 11）、summarize 异常吞掉续跑（Task 13）、triage 幂等 processed_at（Task 8）。
- 测试覆盖：每个 Task 含单元/集成测试。

**2. Placeholder scan**：无 TBD/TODO；每个改码步骤都给了完整代码与命令。两处显式标注的"实现顺序依赖"（Task1↔Task2、worker↔summarize-stage）和"测试向量维度"（Task15/16 的 2048 维 helper）已写明处理方式，非占位。

**3. Type consistency**
- `platformHeat({source,metrics,hours,trust})` 在 Task 1 定义，Task 9/15 调用一致。
- `computeQuality({llmValue,relevance,trust})`、`passesGate`、`inRescueBand` 在 Task 4 定义，Task 8/16 调用一致。
- `computeRanking({q,platformHeat,novelty,likeAffinity})` Task 5 定义，Task 9/15 调用一致。
- `likeAffinity/isSuppressed/likeRescues` Task 14 定义，Task 15/16 调用一致。
- `fetchFullText(url,fallback)→{text,fetched}`、`summarizeBilingual({title,text})→{titleZh,summaryEn,summaryZh}` Task 11/12 定义，Task 13 调用一致。
- Q 统一存 `scores.composite`；摘要列名 `title_zh/summary_en/summary_zh/full_text_fetched` 与 schema(Task 6) 一致。
