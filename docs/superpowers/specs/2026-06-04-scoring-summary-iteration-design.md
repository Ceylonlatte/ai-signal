# Design: ai-signal 打分系统重构 + 独立双语摘要

Date: 2026-06-04
Repo: ai-signal
Status: APPROVED (设计已确认，待生成实现计划)
Brainstormed via: superpowers:brainstorming

## Problem Statement

现有打分系统对所有平台用同一个热度公式、且无时间衰减，排序不够"严谨"；摘要在打分同一次 LLM 调用里顺带产出、质量一般且无中文翻译；所有抓到的内容（含低价值）都永久入库，噪音多、成本高。

本次迭代要做四件事：

1. **严谨的打分系统**，规则区分平台（HN 用时间衰减 `(points-1)/(hours+2)^1.8`）。
2. **独立的高质量摘要**，含中文翻译（双语对照）。
3. **低分文章不摘要、不入库**（彻底丢弃，不可搜索、不可回溯）。
4. 存量旧数据清空，只对新数据按新规则跑。

## Decisions (已确认)

| 主题 | 决定 |
|---|---|
| "不入库"语义 | 低分文章**彻底不写 `items`**，不可搜索/回溯（主动放弃 PRD 中"低价值内容也永久记忆"的设定）。 |
| 打分架构 | 方案 A 双层：稳定**质量分 Q**（卡门槛、决定是否摘要/入库）+ 实时**排序分 R**（带平台时间衰减，决定 Feed 排序）。 |
| 平台范围 | HN / RSS / Reddit / Twitter 都定义热度规则；Reddit/Twitter 为前瞻规则（采集器接入后自动生效）。 |
| RSS 热度 | 无互动数 → `sourceTrust / (hours+2)^1.8`，官方实验室博客给高信任度。 |
| 质量分 Q | LLM 价值分主导，relevance/源信任度仅做小幅调整；`Q ≥ Q_THRESHOLD` 才保留。 |
| 摘要形态 | 双语：中文标题 + 英文高质量摘要 + 整段中文翻译。 |
| 抓全文 | 总是抓原文正文（readability 抽取）；失败/付费墙回退到现有文本。 |
| 摘要模型 | 复用现有 `SCORING_MODEL`，单独一次调用，不新增模型配置。 |
| 存量数据 | 清空旧 `items` 及衍生表，只对新数据按新规则处理。 |

## Architecture: 新数据流

打分前移到写 `items` 之前，用质量分卡门槛后再决定是否入库。

```
采集 → raw_items（保留，作去重台账，不可搜索）
         │
         ▼
   ┌─ triage 阶段（批量，幂等）─────────────────────────┐
   │ 1. 内存中 normalize 未处理的 raw_items              │
   │ 2. 便宜预筛（relevance / heat）砍掉明显噪音           │
   │ 3. 过筛候选批量送 LLM → 价值分 + 话题 + 理由          │
   │ 4. 计算质量分 Q（时间无关）                          │
   │ 5. Q ≥ Q_THRESHOLD ?                               │
   │     ├─ 是 → 写 items + scores(Q)，入队 embed/summarize │
   │     └─ 否 → 丢弃：raw_items 标记 processed，不写 items │
   └──────────────────────────────────────────────────┘
         │（仅保留文章）
         ▼
   embed（向量）→ summarize（抓全文 + 双语摘要）→ cluster（话题）
         │
         ▼
   Feed 查询时实时计算排序分 R（带时间衰减）
```

- `raw_items` 增加 `processed_at` 标记；triage 只处理 `processed_at IS NULL` 的行，保证幂等、不重复花 LLM。
- 丢弃的文章不写 `items`，因此不可搜索/回溯。`raw_items` 仅作去重台账，避免采集器反复重拉重打分。

## Scoring (方案 A 双层)

### 质量分 Q（写入时算一次、存库、不含时间）

决定留/丢 + 是否摘要：

```
Q = clamp01( llm_value
             + w_rel   · (relevance   - 0.5)
             + w_trust · (sourceTrust - 0.5) )

保留条件： Q ≥ Q_THRESHOLD     （env 可调，默认 0.55）
```

- `llm_value` ∈ [0,1]（LLM 价值分 / 100）主导。
- relevance / 源信任度只在中性点 0.5 附近做小幅 ±调整（llm_dominant）。
- Q 不含时间，老的高质量文章不会因变旧被误杀。
- 计算 Q **不需要 embedding**，因此不给将被丢弃的文章浪费向量计算。

### 排序分 R（刷 Feed 时实时计算、不存库）

决定 Feed 排序：

```
R = w_q·Q + w_heat·platformHeat(now) + w_nov·novelty
```

- `platformHeat` 用"当前小时数"**实时计算** → Feed 是"活的"排名（像 HN 首页）。这是 R 中唯一随时间变的项。
- `Q` 与 `novelty` 都是**存库的、计算一次的**值（`novelty` 在保留文章 embed 后算一次写入 `scores.novelty`），避免每次刷 Feed 都做昂贵的向量查询。
- 因此 R 的实时开销仅为：读出候选的 `Q/novelty/metrics/createdAt`，在应用层套热度公式后排序。

### 各平台热度规则

`hours = (now - createdAt) / 3600`：

| 平台 | engagement | 原始热度 raw |
|---|---|---|
| HN | `points` | `(points - 1) / (hours + 2)^1.8` |
| Reddit | `ups` | `(ups - 1) / (hours + 2)^1.8` |
| Twitter | `likes + 2·retweets + replies` | `(eng - 1) / (hours + 2)^1.8` |
| RSS | 无互动数 | `sourceTrust / (hours + 2)^1.8` |

按平台对数归一化到 0–1：

```
heat = min(1, log10(1 + max(0, raw)) / k_平台)
```

- `k_平台` 各平台独立常数，使不同平台热度可比、可在统一 Feed 中混排。
- 所有权重（`w_rel/w_trust/w_q/w_heat/w_nov`）、`Q_THRESHOLD`、`k_平台`、源信任表都进 `config.ts`，均 env 可调。

## Summary (独立阶段)

- **触发**：仅 Q ≥ 阈值的保留文章（低分不摘要）。
- **抓全文**：所有保留文章抓原文正文，readability 抽取（计划：`@extractus/article-extractor` 或 `@mozilla/readability` + `jsdom`）。抓取失败 / 付费墙 → 回退用 `items.text`，记 `full_text_fetched = false`，不阻断后续。
- **摘要 LLM**：复用 `SCORING_MODEL`，单独调用，产出双语 JSON：
  - `title_zh`：中文标题
  - `summary_en`：英文高质量摘要
  - `summary_zh`：整段中文翻译
- **打分调用瘦身**：`llm.ts` 的 `scoreBatch` 不再产出 summary（移到本阶段），仅产价值分 / 话题 / 理由。

## Data Model 变更

- `scores` 新增列：`title_zh`、`summary_en`、`summary_zh`、`full_text_fetched (boolean)`；旧 `summary` 列保留兼容（或后续废弃）。
- `raw_items` 新增列：`processed_at (timestamptz, nullable)`。
- `RUBRIC_VERSION` 升版。
- Drizzle migration 生成对应 SQL。

## 存量清理

一次性脚本 `bin/reset-corpus.ts`：

- 清空 `items / scores / item_embeddings / item_topics / topic_trends / topics / jobs`。
- 清空 `raw_items`，让采集器按新规则重拉近 7 天。
- 仅对新数据生效，不回填旧数据的摘要 / 不重打分旧数据。

## Error Handling

- 抓全文失败 → 回退现有文本，标记 `full_text_fetched = false`，继续摘要。
- LLM 调用失败 → 沿用现有 `jobs.attempts` / `jobs.error` 重试机制。
- triage 幂等 → 靠 `raw_items.processed_at`，重跑不产生重复 item 或重复 LLM 消费。
- 丢弃项 → 保留 `raw_items` 防止采集器重复消费同一外部 ID。

## Testing (vitest)

- **单元**
  - 四平台热度公式 + 时间衰减 + 对数归一化（含边界：points=0、hours=0、负 raw 截断）。
  - Q 计算与门槛逻辑（llm_dominant、小幅调整、clamp）。
  - R 排序组合与跨平台可比性。
  - 双语摘要 prompt 构造与 JSON 解析（mock LLM）。
  - 全文抽取成功 / 失败回退。
- **集成（带 DB）**
  - triage：Q < 阈值不产生 item 行；Q ≥ 阈值产生 item + score(+ 入队 summarize)。
  - triage 幂等：重跑不重复。
  - summarize：保留文章写入 `title_zh/summary_en/summary_zh`。
  - `reset-corpus` 清空相关表。

## Out of Scope

- Reddit / Twitter 采集器接入（本次仅预留热度规则，等采集器落地）。
- 反馈回路（👍/👎）调权重的自动化（沿用现有）。
- 付费墙绕过 / 高级反爬。

## Open Items (实现阶段确认)

- readability 库最终选型（抽取质量 vs 依赖体积）。
- 各 `k_平台` 与权重 / 阈值的初始默认值（上线后按实际数据调）。
- `R` 在 SQL 内计算还是取候选后在应用层计算（个人工具量小，倾向应用层，实现时定）。
