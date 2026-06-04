# Design: ai-signal 打分系统重构 + 独立双语摘要

Date: 2026-06-04
Repo: ai-signal
Status: IMPLEMENTED on `feat/scoring-rework` (设计已落地；本文已按实现回写，偏差见末尾「实现偏差记录」)
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
| RSS 热度 | 无互动数 → `sourceTrust · (2/(hours+2))^1.8`（乘式衰减，hours=0 时 heat≈trust），官方实验室博客给高信任度。 |
| 质量分 Q | LLM 价值分主导，relevance/源信任度仅做小幅调整；`Q ≥ Q_THRESHOLD` 才保留。 |
| 摘要形态 | 双语：中文标题 + 英文高质量摘要 + 整段中文翻译。 |
| 抓全文 | 总是抓原文正文（readability 抽取）；失败/付费墙回退到现有文本。 |
| 摘要模型 | 复用现有 `SCORING_MODEL`，单独一次调用，不新增模型配置。 |
| 存量数据 | 清空旧 `items` 及衍生表，只对新数据按新规则处理。 |
| 反馈画像 | 用 👍/👎 的 embedding 做非对称画像：点赞→排序加权 **+ 门禁救回**（像我赞过的边缘分文章破例保留，仅多留不多丢）；点踩→**软压制**相似文章（隐藏出 Feed、仍可搜索、可撤销，纯 Feed 层）。 |

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
   │     ├─ 是 → 写 items + scores(Q=composite)            │
   │     └─ 否 → 在救回带内(Q≥阈值−RESCUE_MARGIN)?         │
   │            ├─ 是 → 算 embedding，likeSim≥阈值则破例保留 │
   │            └─ 否 → 丢弃：raw_items 标记 processed       │
   └──────────────────────────────────────────────────┘
         │（仅保留文章）
         ▼
   embed（向量）→ summarize（抓全文 + 双语摘要）→ cluster（话题）
         │
         ▼
   Feed 查询时实时计算排序分 R（带时间衰减）
```

- worker 循环按 **SQL 谓词**逐阶段拾取工作（无 `jobs` 队列）：`triage`（`raw_items.processed_at IS NULL`）→ `embed`（缺向量的 items）→ `summarize`（`scores.summary_en=''`）→ `cluster`。`jobs` 表已成遗留、主链路不再读写。
- `raw_items` 增加 `processed_at` 标记；triage 只处理 `processed_at IS NULL` 的行，保证幂等、不重复花 LLM。
- 保留文章的 `scores.composite` 列即存放质量分 Q（命名沿用旧列）。
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
- 计算 Q **不需要 embedding**，clearly-pass / clearly-drop 的候选都不白算向量；**仅救回带（边缘分）候选**会额外算 embedding 做点赞救回检查（见反馈画像节）。

### 排序分 R（刷 Feed 时实时计算、不存库）

决定 Feed 排序：

```
R = w_q·Q + w_heat·platformHeat(now) + w_nov·novelty + w_aff·likeAffinity
```

- `platformHeat` 用"当前小时数"**实时计算** → Feed 是"活的"排名（像 HN 首页）。这是 R 中唯一随时间变的项。
- `Q` 与 `novelty` 都是**存库的、计算一次的**值（`novelty` 在保留文章 embed 后算一次写入 `scores.novelty`），避免每次刷 Feed 都做昂贵的向量查询。
- `likeAffinity` 来自反馈画像（见下节），冷启动时影响趋近 0。
- 因此 R 的实时开销仅为：读出候选的 `Q/novelty/metrics/createdAt`，在应用层套热度公式后排序，并按点踩画像过滤被软压制的项。

### 各平台热度规则

`hours = (now - createdAt) / 3600`：

| 平台 | engagement | 热度 heat（0–1） |
|---|---|---|
| HN | `points` | `clamp01( log10(1 + (points-1)/(hours+2)^1.8) / HEAT_K_HN )` |
| Reddit | `ups`（回退 `points`） | `clamp01( log10(1 + (ups-1)/(hours+2)^1.8) / HEAT_K_REDDIT )` |
| Twitter | `likes + 2·retweets + replies` | `clamp01( log10(1 + (eng-1)/(hours+2)^1.8) / HEAT_K_TWITTER )` |
| RSS | 无互动数 | `clamp01( sourceTrust · (2/(hours+2))^1.8 )` |

- **有互动平台**（HN/Reddit/Twitter）：先算重力 raw `=(eng-1)/(hours+2)^1.8`（≤0 记 0），再对数归一化 `log10(1+raw)/HEAT_K_平台`，各 `HEAT_K_*` 独立可配，使跨平台可比、可在统一 Feed 混排。
- **RSS**：无 engagement，改用「源信任度 × 乘式时间衰减」，`hours=0` 时 heat≈trust、随时间趋 0；本身已落在 0–1，无需 `HEAT_K`。
- 所有权重（`w_rel/w_trust` 即 `Q_WEIGHT_*`；`R_WEIGHT_Q/HEAT/NOVELTY/AFFINITY`）、`Q_THRESHOLD`、`HEAT_K_*`、源信任表都进 `config.ts`，均 env 可调。

## Feedback-Driven Personalization (反馈画像)

把已有但未使用的 `feedback`（👍/👎 + reason）回流到排序，做**非对称**个性化。点踩侧只活在 **Feed/排序层**（门禁 Q 保持口味无关）；点赞侧在 Feed 层加权，并对 triage 的**边缘带**候选额外做一次救回（见下）。

### 画像构建（均用「最大相似度」，不用质心）

- 取 `feedback` join `item_embeddings`，滚动窗口（`PROFILE_WINDOW_DAYS`，默认 90 天，可配）。**实现选择对反馈项取最大余弦相似度**而非质心——更忠实于"像**某一篇**赞过/踩过的"，也免去维护质心：
  - `maxLikeSim(item)  = 1 − MIN(cosine_distance(item, 任一 👍 文章))`
  - `maxDislikeSim(item) = 1 − MIN(cosine_distance(item, 任一 👎 文章))`
- 查询时实时算（个人量级，pgvector `<=>`），不物化质心。

### 点赞 → 排序加权

```
likeAffinity(item) = clamp01(maxLikeSim) · coldStartScale
coldStartScale     = min(1, n_up / COLDSTART_N0)   // 反馈少时影响趋近 0
```
进入 R：`R += w_aff · likeAffinity`，让"像你喜欢过的"排得更前。

**门禁救回（点赞=对我有价值）**：点赞既影响排序，也能把"像我赞过的"边缘文章救回入库：

```
likeSim(item) = max cosine similarity 到点赞集合中的各文章
救回条件： (Q_THRESHOLD − RESCUE_MARGIN ≤ Q < Q_THRESHOLD)
          AND likeSim ≥ RESCUE_SIM_THRESHOLD
```

- **成本优化**：只有落在救回带（边缘分）的候选才去算 embedding 做 `likeSim` 检查；Q 远低于带的直接丢、不算向量。额外向量成本被限制在窄边缘带。
- **方向安全**：救回只会**多留**像你喜欢的内容，绝不多丢。
- 冷启动无点赞时不触发救回。
- 张力提示：救回 + 排序加权都在强化已有口味，与 `novelty`（奖励没见过的）方向相反；靠 `w_aff` 与阈值平衡，env 可调。

### 点踩 → 软压制相似文章

- `dislikeSim(item) = max cosine similarity 到点踩集合中的各文章`（用 max 而非质心，忠实于"别再给我看像**这篇**的"）。
- `dislikeSim ≥ SUPPRESS_THRESHOLD` → **软压制**：默认从 Feed 隐藏，**仍入库可搜索**。
- `SUPPRESS_THRESHOLD` 取高值（近重复 / 同一事件级别，env 可调），只压"很像的"，避免误杀整个宽泛话题。
- 可逆：提供"已压制"视图查看被隐藏项；撤销点踩即恢复。

### 与门禁 Q 的关系

- **点踩**：不改变留/丢（Q 不变），只影响是否在 Feed 出现 → 安全、可回溯；纯 Feed 层，不改 triage。
- **点赞**：除排序加权外，新增**门禁救回**——会让 triage 对**边缘分**候选额外算 embedding 做 `likeSim` 检查（仅边缘带，不是全部候选）。方向上只多留不多丢。
- 因此非对称：点踩只在 Feed 层、点赞额外影响 triage 的边缘救回；二者都不会让文章被多丢。

## Summary (独立阶段)

- **触发**：仅 Q ≥ 阈值的保留文章（低分不摘要）。
- **抓全文**：所有保留文章抓原文正文，用 `@extractus/article-extractor` 抽取。抓取失败 / 付费墙 / 被 SSRF 守卫拦截 → 回退用 `items.text`，记 `full_text_fetched = false`，不阻断后续。
  - **SSRF 守卫**：`isFetchableUrl` 仅放行 http(s) 公网 host，拒绝 loopback / 私网 / link-local / 云元数据(`169.254.169.254`) / CGNAT / 非 http 协议（pre-check，不跟随重定向）。
  - **超时**：抽取包在 `AbortSignal.timeout(10s)`，避免慢链接卡死串行摘要循环。
- **摘要 LLM**：复用 `SCORING_MODEL`，单独调用，产出双语 JSON：
  - `title_zh`：中文标题
  - `summary_en`：英文高质量摘要
  - `summary_zh`：整段中文翻译
- **打分调用瘦身**：`llm.ts` 的 `scoreBatch` 不再产出 summary（移到本阶段），仅产价值分 / 话题 / 理由。

## Data Model 变更

- `scores` 新增列（migration 0005）：`title_zh`、`summary_en`、`summary_zh`、`full_text_fetched (boolean)`；旧 `summary` 列保留兼容。
- `scores` 新增列（migration 0006）：`summary_attempts (int, default 0)`、`summary_error (text)`——摘要死信，见 Error Handling。
- `raw_items` 新增列（0005）：`processed_at (timestamptz, nullable)`；0006 回填存量行 `= now()`。
- `jobs` 表保留但**新 worker 不再读写**（遗留）。
- `RUBRIC_VERSION` 升版。

## 存量清理

一次性脚本 `bin/reset-corpus.ts`：

- 清空 `item_topics / topic_trends / topics / item_embeddings / scores / feedback / items / jobs / raw_items`（含 `feedback`——`RESTART IDENTITY` 后旧 item_id 会错配，故必须一并清；这会抹掉全部 👍/👎）。
- 清空 `raw_items`，让采集器按新规则重拉近 7 天。仅对新数据生效，不回填旧数据。
- **护栏**：缺 `RESET_CONFIRM=yes` 则拒绝执行，并先打印目标库名（防误触生产库）。
- 部署顺序：`db:migrate → reset-corpus → 启动 worker`（见 `deploy/README.md`）。

## Error Handling

- 抓全文失败 / SSRF 拦截 / 超时 → 回退现有文本，标记 `full_text_fetched = false`，继续摘要。
- 摘要 LLM 失败 → `scores.summary_attempts += 1` 并存 `summary_error`；超过 `SUMMARY_MAX_ATTEMPTS`（默认 3）即**死信跳过**，不再每轮重选（旧 `jobs.attempts` 重试链已随 worker 重写移除）。
- triage 幂等 → 靠 `raw_items.processed_at`；每行 `item+score(+embedding)+processed_at` 在独立事务内原子提交，崩溃可安全重跑。
- 丢弃项 → 保留 `raw_items`（标记 processed）防止采集器重复消费同一外部 ID。

## Testing (vitest)

- **单元**
  - 四平台热度公式 + 时间衰减 + 对数归一化（含边界：points=0、hours=0、负 raw 截断）。
  - Q 计算与门槛逻辑（llm_dominant、小幅调整、clamp）。
  - R 排序组合与跨平台可比性。
  - 双语摘要 prompt 构造与 JSON 解析（mock LLM）。
  - 全文抽取成功 / 失败回退。
  - 反馈画像：`likeAffinity` 计算 + 冷启动缩放；`dislikeSim` 阈值压制；空反馈时影响为 0。
  - SSRF 守卫 `isFetchableUrl`：放行公网、拦截私网/环回/元数据/非 http。
- **集成（带 DB）**
  - triage：Q < 阈值不产生 item 行；Q ≥ 阈值产生 item + score（summarize 由后续阶段按 `summary_en=''` 拾取）。
  - triage 幂等：重跑不重复。
  - summarize：保留文章写入 `title_zh/summary_en/summary_zh`；空摘要不无限重选；**持续报错超 `SUMMARY_MAX_ATTEMPTS` 后死信跳过**。
  - 反馈：👍 提升相似文章 R 排名；👍 把救回带内、likeSim 达标的边缘文章破例保留；👎 使相似文章从 Feed 隐藏但仍可搜索；撤销点踩后恢复。
  - 救回成本边界：只有救回带候选才算 embedding；Q 远低于带的不算。
  - `reset-corpus` 清空相关表。

## Out of Scope

- Reddit / Twitter 采集器接入（本次仅预留热度规则，等采集器落地）。
- 反馈驱动**自动调 rubric 权重**（本次只做 embedding 画像影响排序/压制，不自动改 rubric 文本或全局权重）。
- 付费墙绕过 / 高级反爬。

## Open Items（实现时已定）

- readability 库：选 `@extractus/article-extractor`。
- 反馈画像：查询时实时算最大相似度（不物化质心）。
- `R`：取候选（最近 `max(limit·6, 300)` 条）后在应用层算并排序。
- 初始默认值已落在 `config.ts`：`Q_THRESHOLD=0.55`、`Q_WEIGHT_REL/TRUST=0.15`、`R_WEIGHT_Q=0.45 / HEAT=0.30 / NOVELTY=0.10 / AFFINITY=0.15`、`HEAT_K_HN/REDDIT=2.5 / TWITTER=3.5`、`SUPPRESS_THRESHOLD=0.92`、`RESCUE_SIM_THRESHOLD=0.85`、`RESCUE_MARGIN=0.10`、`COLDSTART_N0=5`、`PROFILE_WINDOW_DAYS=90`、`SUMMARY_MAX_ATTEMPTS=3`（上线后按实际数据调）。

## 实现偏差记录 (2026-06-04)

实现相对初版设计的有意偏差（已回写本文）：

1. **likeAffinity 用最大相似度而非质心** —— 排序加权与救回都用「对反馈项的最大余弦相似度」，与点踩侧对称、且免维护质心。语义从"像我喜欢的整体"变为"像我赞过的某一篇"，个人工具下更合用。
2. **RSS 热度用乘式衰减** —— `trust·(2/(hours+2))^1.8` 取代初版的 `trust/(hours+2)^1.8`+log/k；`hours=0` 时 heat≈trust（更合理），且本身落在 0–1、无需 `HEAT_K_RSS`。
3. **`jobs` 重试机制弃用** —— 新 worker 改为 SQL 谓词驱动各阶段，`jobs` 表不再读写；摘要失败改用 `scores.summary_attempts/summary_error` 死信（`SUMMARY_MAX_ATTEMPTS`）。

附：评审后补的生产安全修复 —— `reset-corpus` 加 `RESET_CONFIRM` 护栏、全文抓取加 SSRF 守卫+超时、迁移 0006 回填 `processed_at`。

## 未决（评审 Minor，留待后续）

- `type Db = any` 普遍使用，牺牲 drizzle 类型安全。
- Feed 候选按"最近 300 条"截断，比 300 更老但 R 很高的条目进不了 Feed。
- 预筛只看 `relevance>0 ∨ heat≥floor`，未看 `sourceTrust`，无关键词命中的高信任 RSS 官方博文可能在送 LLM 前被丢。
- 空摘要用 `" "` 哨兵规避重选，偏 hack（Feed 会出现空白摘要）。
