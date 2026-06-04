# Design: Reddit / Twitter 数据接入（digest 产出时顺带入库）

Date: 2026-06-04
Repo: ai-signal（+ 外部 skill：`~/.hermes/skills/digest/opencli-reddit-digest`、`opencli-twitter-digest`）
Status: DESIGN（已确认设计，待写实现计划）
Brainstormed via: superpowers:brainstorming

## Problem Statement

打分系统已为 Reddit/Twitter 定义了热度/信任规则，但属于"前瞻规则"——**采集器尚未真正接入**，所以 feed 里没有 reddit/twitter 数据。

源数据由两个 OpenCLI digest skill 在本机产出（采集-only，落盘 `raw/<source>/items.json`）：

- `opencli-reddit-digest`：`reddit-ainews`（hot，每日）、`reddit-ainews-new`（new，每 8h）。
- `opencli-twitter-digest`：`twitter-following`（关注流）、`twitter-for-you`（算法推荐流）。

目标：让这些源数据流进 ai-signal 的管道（`raw_items → triage → items/scores → feed`），且 reddit/twitter 的热度/打分真正生效。

## 现状勘察（已存在但不可用的脚手架）

- `POST /api/ingest`：Bearer 鉴权 + `ingest()` 落 `raw_items`（`onConflictDoNothing` 去重）。**可复用**。
- `bin/mac-collect.ts` + `src/collectors/mac-cursor.ts`（`readDigestSince` 扫描 digest 目录 + `mapReddit`/`mapTwitter`）：定时扫描后 POST 到 VPS。**有缺陷、将被取代**：
  - `jobTs` 正则 `/-(\d+)$/` 对 `reddit-ainews-daily-20260604-093038` 只截到 `093038`（丢日期），跨天游标排序/去重错乱、漏采。
  - twitter 子目录配错（`following`/`for-you` 实为 `twitter-following`/`twitter-for-you`），reddit 漏了 `reddit-ainews-new`。
  - 依赖 `.env` 里不存在的 `VPS_INGEST_URL`/`STATE_FILE`。
- 字段错位（导致热度恒为 0）：`engagementOf("reddit")` 读 `ups`/`points`，但 digest 给的是 `score`；twitter 的 `replies` 未带入 metrics。

## Decisions（已确认）

| 主题 | 决定 |
|---|---|
| 触发方式 | **写进 skill**：digest 采完后，`collect.mjs` 顺带把这批原始条目 POST 给 ai-signal。不再用独立调度器/游标扫描。 |
| 拓扑 | 维持 Mac→VPS HTTP 推送（库/worker 可在 VPS，skill 在产出 digest 的本机）。 |
| 去重 | 靠 `raw_items (source_id, external_id)` 唯一约束 + `onConflictDoNothing`，天然覆盖 twitter overlap 窗口与 reddit 跨天重叠。**无需 cursor/state**。 |
| 映射位置 | **方案 A：服务端映射**。skill 只转发原始条目，ai-signal 独占 raw→`RawPayload` 规范化（契合 skill「只采集」定位）。 |
| 推送性质 | **opt-in + best-effort**：未配置 ingest env → skill 行为与现状完全一致；POST 失败/超时绝不改 exit code、不影响落盘与 Telegram 简报。 |
| twitter feed 区分 | **方案 1**：单一 kind `"twitter"` + 每条带 `feed` 溯源标记；打分用信任先验 `following > for-you`（压 for-you 噪声）。heat 除数先共用 `HEAT_K_TWITTER`。 |
| reddit feed 区分 | 统一 kind `"reddit"`（同一 multireddit），但**每条带 `feed` 溯源标记** `hot`/`new`（取自 source 的 `sort`）。**仅溯源、不改打分**（hot/new 同源同信任度，trust 不分流）。 |
| 旧脚手架 | 删除 `bin/mac-collect.ts`、`src/collectors/mac-cursor.ts` 及其测试（映射逻辑迁入服务端）。 |

## Architecture：数据流

```
[cron 包装脚本] 若存在则 source ~/.hermes/digest-ingest.env
                (定义 AI_SIGNAL_INGEST_URL / AI_SIGNAL_INGEST_TOKEN)
      │  exec node collect.mjs --job <id>
      ▼
[collect.mjs] 采集各 source → 写 raw/<source>/items.json        (现有行为，不变)
      │  新增·opt-in·best-effort：每个成功 source 调一次 postIngest
      ▼
   POST {source, feed?, items:[...原始条目...]}  →  AI_SIGNAL_INGEST_URL
      │  Authorization: Bearer <token>，AbortController 15s 超时
      ▼
[ai-signal POST /api/ingest]
   Bearer 校验 → mapDigestItems(source, feed, items) → RawPayload[]
                → ingest()(onConflictDoNothing) → raw_items
                → sources.lastRunAt = now()
      ▼
[worker] triage（normalize → 预筛 → LLM → Q 门禁）→ items + scores
                → embed → summarize → cluster                  (不变)
      ▼
[feed] reddit/twitter 的 platformHeat 非 0；for-you 因低信任先验需更高门槛
```

## skill 侧改动（两个 `collect.mjs`）

新增一个无依赖的 `postIngest({ source, feed, items })` 辅助函数（两份 skill 各一份，逻辑一致）：

1. 读 `process.env.AI_SIGNAL_INGEST_URL` 与 `AI_SIGNAL_INGEST_TOKEN`；任一缺失 → 返回 `{ skipped: true }`，不做任何事（opt-in）。
2. 用全局 `fetch`（运行时 node v25，无三方依赖）+ `AbortController`（15s）POST JSON `{ source, feed?, items }`，带 `Authorization: Bearer <token>`。
3. 整体 try/catch；任何异常/超时/非 2xx 都**只**返回 `{ ok:false, status, error }`，**绝不抛出、绝不 process.exit**。
4. 在 `main()` 源循环里，对每个 `status==="success"` 的 source 调一次（**按 source 推送**，便于隔离失败与携带 feed）：
   - reddit：`source="reddit"`，`feed = src.sort`（config 里 `reddit-ainews`→`"hot"`、`reddit-ainews-new`→`"new"`），items = 该 source 刚采集的条目。
   - twitter：`source="twitter"`，`feed = src.mode`（config 里 `twitter-following`→`"following"`、`twitter-for-you`→`"for-you"`），items = 该 source 条目。
5. 在 stdout 简报末尾追加一行（不配置时不打印）：`入库: ✅ 24 条` / `入库: ⚠️ 失败(502)` / `入库: ⚠️ 跳过(URL未配)`。

辅助改动：

- reddit `collect.mjs` 的 `runSourceOpencli`/`runMultireddit`/`runSourceFixture` 返回值补 `items`（twitter 侧已返回 `items`，对齐即可），避免为推送重新读盘。
- 两个 SKILL.md 增补「可选 ingest 推送」小节：env 变量、opt-in、best-effort 语义。
- 4 个 cron 包装脚本（`opencli_reddit_ainews_collect.sh`、`opencli_reddit_ainews_new_collect.sh`、`opencli_twitter_following_collect.sh`、`opencli_twitter_for_you_collect.sh`）在 `exec` 前加：
  ```bash
  [ -f "$HOME/.hermes/digest-ingest.env" ] && . "$HOME/.hermes/digest-ingest.env"
  ```
  `~/.hermes/digest-ingest.env`（chmod 600，不进任何仓库）定义两个变量。缺文件 → 不推送。

## 服务端改动（ai-signal）

### 1. 新增 `src/lib/sources/digest-map.ts`

把映射逻辑从将删除的 `mac-cursor.ts` 迁移过来并对齐真实字段：

- `mapRedditItem(raw, feed?)`：
  - `externalId = raw.id`，`url = raw.url`，`author = raw.author`，`title = raw.title`，`text = raw.selftext ?? ""`
  - `createdAt = new Date(raw.created_utc * 1000).toISOString()`
  - `metrics = { score: raw.score ?? 0, comments: raw.comments ?? 0 }`
  - `feed`（若传入，`hot`/`new`）写入 `RawPayload.feed`
  - `raw = raw`
- `mapTwitterItem(raw, feed?)`：
  - `externalId = raw.id`，`url = raw.url`，`author = raw.author`，`text = raw.text`（**完整推文，不截断**）
  - `title = tweetTitle(raw.text)`：推文无天然标题（`items.title` 为 `NOT NULL`），合成一个短头条。逻辑：
    1. 折叠空白：`text.replace(/\s+/g, " ").trim()`（去掉换行/多空格）。
    2. 按 **Unicode 码点**计长（`Array.from`，避免切断 emoji/代理对）；≤120 码点直接返回。
    3. 否则取前 120 码点，若尾部存在空格（位置 ≥80）则回退到该空格做**词边界**截断（无空格的 CJK/长 URL 则硬截），末尾加 `…`。
  - `createdAt = new Date(raw.created_at).toISOString()`（V8 可解析 `"Thu Jun 04 12:54:33 +0000 2026"`，已验证）
  - `metrics = { likes: raw.likes ?? 0, retweets: raw.retweets ?? 0, replies: raw.replies ?? 0 }`
  - `feed`（若传入，`following`/`for-you`）写入 `RawPayload.feed`
  - `raw = raw`
- `mapDigestItems(source, feed, rawItems): RawPayload[]`：分发到对应 mapper 并透传 `feed`；缺 `id` 或 `title`/`text` 的脏数据跳过（不抛错）。

### 2. 改造 `POST /api/ingest`

- body schema 改为 `{ source: enum, feed?: string, items: z.array(z.record(z.unknown())) }`（接收**原始**对象）。
- 流程：Bearer 校验 → `mapDigestItems(source, feed, items)` → `ingest()` → `sources.lastRunAt = now()`。
- 安全性：该路由现仅被即将删除的 `mac-collect` 调用（hn/rss 直接调 `ingest()`），改造无破坏面。

### 3. `RawPayload` / `NormalizedItem` 增加可选 `feed`

- `src/types.ts`：`RawPayload` 与 `NormalizedItem` 加 `feed?: string`。
- `src/lib/normalize.ts`：`normalizeRawItem` 透传 `feed`。

### 4. 信任先验（feed 影响打分）

- `src/lib/sources/trust.ts`：`sourceTrust(source, url, feed?)` 增加 feed 参数：
  - `source === "twitter"` 且 `feed === "following"` → `0.6`
  - `source === "twitter"` 且 `feed === "for-you"` → `0.45`
  - **reddit 的 `feed`（hot/new）不参与 trust**：同源同信任度，统一走 reddit 缺省 0.5（feed 仅作溯源）。
  - 其余维持现有 `KIND_DEFAULT`/`HOST_TRUST` 逻辑（twitter 缺省仍 0.5）。
  - 常量写在 `trust.ts`（与该模块现有硬编码风格一致，注释标注可调）。
- `src/pipeline/triage.ts`：`sourceTrust(n.source, n.url, n.feed)`。trust 进入质量分 Q（`Q_WEIGHT_TRUST`）→ for-you 需要更强 LLM/相关性才过门禁。

### 5. 字段修复（热度）

- `src/lib/scoring/platform-heat.ts`：`engagementOf("reddit")` 改为 `metrics.ups ?? metrics.score ?? metrics.points ?? 0`。
- twitter 的 `replies` 由 mapper 提供，`engagementOf("twitter")` 已使用，无需改。

### 6. 删除 / 清理（方案 A 已含）

- 删 `bin/mac-collect.ts`
- 删 `src/collectors/mac-cursor.ts`（映射逻辑已迁入 `digest-map.ts`）
- 删 `tests/lib/mac-cursor.test.ts`
- 删 `deploy/launchd/com.aisignal.mac-collect.plist`（launchd 定时跑 mac-collect，已被 skill 推送取代）
- 改 `deploy/README.md` 的 §6「Mac collector」：删掉 launchd/cursor 说明，改写为「skill 内置推送」——在产出 digest 的 Mac 上创建 `~/.hermes/digest-ingest.env`（定义 `AI_SIGNAL_INGEST_URL`/`AI_SIGNAL_INGEST_TOKEN`），cron 包装脚本会自动 source 它，digest 跑完即推送；无需独立定时器。
- 代码侧确认无其它引用（`readDigestSince`/`mapReddit`/`mapTwitter` 仅被上述文件 import）。
- 文档侧：本 spec 取代 `docs/superpowers/plans/2026-06-03-ai-signal-platform.md` 中 M3 的 mac-cursor 游标采集方案（旧 plan 为历史记录，不改）。

### 7. token / env

- 复用现有 `INGEST_TOKEN`（ai-signal 端），不新增 ai-signal env。
- skill 端用 `AI_SIGNAL_INGEST_TOKEN`，其值需等于 ai-signal 的 `INGEST_TOKEN`。
- `.env.example` 注释补一句两端一致；新增对照说明 `AI_SIGNAL_INGEST_URL` 指向 `<host>/api/ingest`。

## 字段映射速查

| ai-signal | reddit 原始 | twitter 原始 |
|---|---|---|
| externalId | `id` | `id` |
| url | `url` | `url` |
| author | `author` | `author` |
| title | `title` | `tweetTitle(text)`（折叠空白·词边界·~120 码点·加…·不切 emoji）|
| text | `selftext` | `text` |
| createdAt | `created_utc`×1000 | `created_at`（Twitter 经典格式）|
| metrics | `{ score, comments }` | `{ likes, retweets, replies }` |
| feed | `hot` / `new`（仅溯源，不改打分） | `following` / `for-you`（带信任先验） |

## 测试与验收

- 新增 `tests/lib/digest-map.test.ts`：reddit/twitter 原始样本 → `RawPayload` 正确（metrics、createdAt、feed 透传 reddit=hot/new 与 twitter=following/for-you、脏数据跳过）。
- `tweetTitle` 单测：折叠换行/多空格、短文不加…、超长加…且按词边界、emoji（代理对）不被切断、无空格 CJK 硬截。
- 改 `tests/integration/ingest-route.test.ts`：POST **原始** reddit 条目 → 200 且 `raw_items` 落库为映射后 payload；twitter 带 `feed` 的用例。
- 改/补 `tests/lib/platform-heat.test.ts`：reddit `{ score: 50 }` → `engagementOf` = 50。
- 补 `tests/lib/trust.test.ts`：twitter following=0.6、for-you=0.45、缺省=0.5。
- 验收标准：
  - 配置 ingest env 跑一次 digest（可用 `--fixtures-dir` 离线）后，`raw_items` 出现去重后的新行；worker 处理进 `items/scores`；feed 中 reddit/twitter 热度非 0。
  - **不配置 ingest env 时，digest 的落盘 + Telegram 简报行为与现状逐字一致。**
  - `pnpm typecheck` + 全量 `pnpm test` 通过。

## 边界与风险

- best-effort + opt-in：网络/鉴权失败只在简报加一行，绝不影响 digest 主职责（落盘 + Telegram）。
- 跨流重复推文（同时在 following 与 for-you）：同 `externalId` 同 kind `"twitter"` → 只落 1 行 raw，先到的 feed 胜出（溯源轻微非确定，可接受）。
- reddit `hot`/`new` 跨流去重同理：高频的 `new`（每 8h）常先抓到帖子（此时 `score` 还低），随后 `hot`（每日）再见到同帖会被 `onConflictDoNothing` 丢弃 → **该帖以早期低互动快照入库，heat 偏低**，且 `feed` 标记成 `new`。这是 `raw_items` 只读台账（首见即定）的固有特性，本次**不处理**（不做指标刷新/二次更新）。`feed` 标记反而让这种情况在事后可观测。如后续发现高价值帖因此被埋，再单列「指标刷新」需求。
- 推文量小（following ~60、for-you ~120、reddit ~100/run），JSON POST 体积无压力。
- `feed` 目前仅存于 `raw_items.payload` 并在 triage 时影响 trust；feed 在 UI 上的展示/筛选为后续需求，本次不做（YAGNI）。

## 不做（YAGNI）

- 不引入独立调度器/launchd/cron 专门跑采集（改由 digest 自身触发）。
- 不为 for-you 单独设 `HEAT_K`（先复用，需要再升级到「两个 kind」方案）。
- 不在 `items` 表加 `feed` 列；不做 feed 维度的 UI 展示。
- 不改 hn/rss 的直连 `ingest()` 路径。
