# 收藏 → 个人知识库设计（项目 A：内容主链路）

**目标：** 把「收藏」从"只存标题+摘要"升级为个人知识库——对显式收藏（⭐）的内容抓取**全文 + 图片**，用 LLM 整理出**结构化笔记**，并提供可长期回看的**详情页阅读视图**。

**背景：** 现有 `/liked` 收藏页复用 👍 反馈，只展示中文标题 + 一句话摘要。处理管道在生成摘要时其实已抓过一次全文（`fetchFullText`），但用完即弃。现在要把"具体内容整理汇总"沉淀下来，作为个人知识库的第一块基石。

**技术栈：** Next.js App Router、React 19、TypeScript、drizzle-orm 原生 SQL、Postgres、vitest；新增 Firecrawl/markdown.new 抽取、Cloudflare R2 图床、OpenRouter LLM（复用现有）。

---

## 范围

- **本期（项目 A，本文）**：⭐ 收藏动作 + 全文抓取 + 图片转存 R2 + 结构化笔记 + 收藏列表与详情页 + 历史 👍 迁移与批量补跑。
- **不在本期（各自独立项目，仅记录推荐方案，见文末「未来」）**：
  - **B**：Reddit/Twitter 深度内容（完整评论树 / 整条 thread）入知识库。
  - **C**：用 twitterapi.io 替换 Mac `twitter-digest` 采集源。

---

## 决策汇总（来自 brainstorming 澄清）

- **方向**：先做单篇「全文 + 结构化笔记」，跨文章主题综述留到未来。
- **触发动作**：新增独立的 ⭐「存入知识库」动作，复用现有未使用的 `items.isFavorited` 字段；与 👍 分离——👍 仅服务排序，⭐ 仅服务知识库。**只有 ⭐ 触发重处理。**
- **信息架构**：现有「收藏」导航演进为 ⭐ 知识库；路由 `/liked` → `/library`，详情页 `/library/[id]`，导航标签仍叫「收藏」。👍 不再单独成页。
- **历史迁移**：把历史 👍 过的条目一次性标记 `isFavorited=true` 作为初始种子（生产库当前仅 4 条），随后由 worker 批量补跑。
- **补跑策略**：后台 worker 状态轮询、限速批处理。
- **正文保真度**：正文 + 图片；图片**不落 VPS**，转存 **Cloudflare R2**（零出站费、永久、S3 接口）。
- **抽取链**：**Firecrawl（免费额度优先）→ markdown.new（keyless 兜底）→ article-extractor（兜底）→ 已采集 `items.text`（最终兜底）**。Firecrawl/markdown.new 原生返回 Markdown，故正文**存 Markdown**。Jina 已弃用（付费额度耗尽；markdown.new 免费、无需 key、自带 Cloudflare 无头浏览器渲染）。
- **结构化笔记字段**（LLM 生成，全中文）：`概述` / `核心要点` / `关键数据·结论` / `为什么值得记` / `术语`（不要金句）。
- **展示**：列表卡片显示「概述 + 要点预览」；详情页 reader 视图 = 上半结构化笔记 + 下半全文（Markdown 渲染 + R2 图片）。
- **降级**：Reddit/Twitter 与抽取失败 → 正文回退 `items.text`；正文过短（< `KB_MIN_BODY_CHARS`）→ 不生成结构化笔记，仅保留原文，状态标 `skipped`。

实测依据（2026-06-18，对真实 URL 现场抓取）：同一篇 HN 外链文章，Firecrawl / markdown.new 均可拿到全文+图（markdown.new 实测 ~25KB / 13 图、含「72.6% FuncPass」等数据）；Reddit / Twitter 被各平台反爬封锁，均回退已采文本（深度内容见项目 B/C）。

---

## 架构

### 1. 数据模型

新增表 `kb_entries`（与 `items` 1:1，`itemId` 关联；重内容独立成表，不污染 `scores`）：

| 列 | 类型 | 说明 |
|---|---|---|
| `itemId` | bigint PK | → items.id |
| `status` | text | `pending` / `ready` / `failed` / `skipped`（默认 `pending`） |
| `note` | jsonb | `{ overview, keypoints[], facts[], why, terms[{term,def}] }`，默认 `{}` |
| `bodyMd` | text | 正文 Markdown（图片 URL 已改写为 R2），默认 `''` |
| `bodySource` | text | 实际命中的抽取器：`firecrawl`/`markdownnew`/`extractor`/`fallback` |
| `images` | jsonb | `[{ srcUrl, r2Url, bytes, contentType }]`，默认 `[]` |
| `attempts` | int | 默认 0 |
| `error` | text | 最近一次失败原因 |
| `processedAt` | timestamptz | 处理完成时间 |

`items` 表新增：`favoritedAt timestamptz`（可空），⭐ 置真时写 `now()`、取消时置 `null`，供收藏页按"最近收藏"排序。`isFavorited` 沿用现有列。

### 2. 抽取链（`src/lib/kb/reader.ts`）

统一接口 `fetchArticle(url, fallbackText): Promise<{ markdown, images, source }>`，按序尝试，任一成功即返回：

1. **Firecrawl** `/scrape`，`formats: ["markdown","images"]`（1 credit/页，免费 1000/月）。
2. **markdown.new** `POST https://markdown.new/`，body `{ url, retain_images: true }`，解析 JSON 的 `content` 字段（免费、keyless、Cloudflare 无头浏览器渲染 JS）。
3. **article-extractor**（现有 `fetchFullText`，仅纯文本、无图）。
4. **最终兜底**：`{ markdown: fallbackText, images: [], source: "fallback" }`。

每步带超时 + try/catch，失败即降级到下一步。`url` 为空或不可抓时直接到兜底。

### 3. 图片转存 Cloudflare R2（`src/lib/kb/images.ts`）

- 过滤噪声图：跟踪像素 / cookie 同意图 / 站点图标 / SVG sprite / 尺寸过小（按 URL 模式 + content-type + bytes）。
- 对保留的每张图：`isFetchableUrl` SSRF 校验 → 下载（超时 + `KB_MAX_IMAGE_BYTES` 上限 + `image/*` 类型白名单）→ 用 `@aws-sdk/client-s3` PutObject 到 R2，key = `kb/<itemId>/<sha1(srcUrl)>.<ext>`。
- 改写 `bodyMd` 中的图片 URL 为 `R2_PUBLIC_BASE_URL/<key>`；下载/上传失败的图保留原始远程 URL 兜底，并在 `images` 标记。

### 4. LLM 结构化笔记（`src/lib/kb/notes.ts`）

`synthesizeNotes({ title, markdown }): Promise<Note>`，仿 `summarizeBilingual`：OpenRouter `SCORING_MODEL`、`response_format: json_object`，system 提示产出全中文五字段 JSON；zod 校验、`recordModelUsage("kb", …)`。输入正文截断到 `KB_NOTE_INPUT_CHARS`（如 12000）。

### 5. 管道阶段（`src/pipeline/kb-stage.ts`，挂进 `worker.ts`）

`runKbStage(db)`：状态轮询，每轮 `LIMIT KB_FETCH_LIMIT`（如 5）。

- 选取：`items.isFavorited = true` 且无 `ready/skipped` 的 `kb_entries`，且 `attempts < KB_MAX_ATTEMPTS`（`LEFT JOIN kb_entries`）。
- 每条：插入/更新 `pending` → `fetchArticle` → 过滤+转存图片 → 若正文 ≥ `KB_MIN_BODY_CHARS` 则 `synthesizeNotes`，否则 `note={}`、状态置 `skipped` → 写 `kb_entries`（`bodyMd`/`note`/`images`/`bodySource`/`status=ready|skipped`/`processedAt`）。
- 失败：`attempts++` 记 `error`，到上限置 `failed`。
- 加入 `worker.ts` 主循环（与 embed/summarize 并列，返回处理条数参与空转 sleep 判断）。

### 6. UI

- **⭐ 收藏按钮** `src/app/favorite-button.tsx`（client）：调现有 `PATCH /api/items/[id]`（已支持 `isFavorited`），乐观更新。放在信号流卡片 👍/👎 旁。
- **收藏列表** `src/app/library/page.tsx`（由 `/liked` 改造）：`getFavorites(db)` 查 `isFavorited` 条目 + `kb_entries` 预览，按 `favoritedAt` 倒序。卡片 = 标题 + 来源/时间 + 概述 + 前 2–3 条要点 + ⭐；状态徽标：`pending→整理中…`、`failed→整理失败（点击重试）`、`skipped→仅原文`。
- **详情页** `src/app/library/[id]/page.tsx`：顶部标题/来源/作者/时间/原文↗/⭐；结构化笔记区（五字段）；分隔；全文区（`react-markdown` + `remark-gfm` 渲染 `bodyMd`，图片走 R2）。
- **导航**：`site-header.tsx` 「收藏」指向 `/library`。
- **PATCH 路由**：`favoritedAt` 随 `isFavorited` 同步写入（true→`now()`，false→`null`）。

### 7. 迁移与基础设施

- drizzle migration：建 `kb_entries`；`items` 加 `favorited_at`；数据回填 `UPDATE items SET is_favorited=true, favorited_at=now() WHERE id IN (SELECT DISTINCT item_id FROM feedback WHERE signal='up')`。
- 无需新增 Docker 卷 / 媒体路由（图片走 R2 公网 URL）。
- `.env` / `docker-compose.yml` `web`+`worker` 注入新环境变量（见下）。R2 凭证 worker 用于上传、web 仅用公网 URL。

---

## 文件结构

**新增**
- `src/lib/kb/reader.ts` — 抽取链
- `src/lib/kb/images.ts` — 图片过滤/下载/上传 R2/URL 改写
- `src/lib/kb/notes.ts` — LLM 结构化笔记
- `src/lib/kb/r2.ts` — R2 客户端封装（@aws-sdk/client-s3）
- `src/pipeline/kb-stage.ts` — worker 阶段
- `src/app/favorite-button.tsx` — ⭐ 组件
- `src/app/library/page.tsx`、`src/app/library/[id]/page.tsx`、`src/app/library/loading.tsx`
- 测试：`tests/lib/kb-reader.test.ts`、`tests/lib/kb-images.test.ts`、`tests/integration/kb-stage.test.ts`、`tests/integration/item-state-route.test.ts`（扩展 favoritedAt）

**修改**
- `src/db/schema.ts`（`kb_entries` + `items.favoritedAt`）+ 新 migration
- `src/pipeline/worker.ts`（挂 `runKbStage`）
- `src/app/feed-queries.ts`（`getFavorites`；feed `candidates` 增选 `i.is_favorited`）
- `src/app/api/items/[id]/route.ts`（写 `favoritedAt`）
- `src/app/site-header.tsx`（导航 → `/library`）
- 信号流卡片组件（挂 ⭐ 按钮）
- `src/config.ts`（新增配置）
- `package.json`（新依赖）
- 删除/重定向旧 `src/app/liked/*`

---

## 配置与依赖

**新增 env（`src/config.ts` + `.env` + compose）**
- `FIRECRAWL_API_KEY`（空则跳过 Firecrawl，链路从 markdown.new 起）
- `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_PUBLIC_BASE_URL`
- `KB_FETCH_LIMIT`（默认 5）、`KB_MAX_ATTEMPTS`（默认 3）、`KB_MAX_IMAGE_BYTES`（默认 5_000_000）、`KB_MIN_BODY_CHARS`（默认 400）、`KB_NOTE_INPUT_CHARS`（默认 12000）

**新依赖**：`@aws-sdk/client-s3`、`react-markdown`、`remark-gfm`。（Firecrawl/markdown.new 用原生 `fetch`，不引 SDK。）

---

## 错误处理与降级

- 抽取四级兜底，任何一级异常不影响整体，最差落到 `items.text`。
- 图片单张失败不阻断；保留远程 URL。
- 正文过短 → `skipped`，不浪费 LLM。
- LLM/网络异常 → `attempts++`，到上限 `failed`，详情页显示"整理失败（点击重试）"（重试 = 清 `kb_entries` 行或重置 attempts，worker 重新拾取）。

## 安全

- 图片下载复用 `isFetchableUrl` SSRF 防护 + 大小/类型/超时上限。
- Markdown 渲染用 `react-markdown`（默认不渲染原始 HTML，天然防存储型 XSS；不引入 `rehype-raw`）。
- R2 凭证仅在 worker 容器使用；公网读用 `R2_PUBLIC_BASE_URL`。

## 成本

- 仅 ⭐ 条目处理（历史 4 条 + 以后按需，每天个位数）。
- Firecrawl 免费 1000 页/月、markdown.new keyless 免费、R2 近乎免费（零出站 + 10GB 免费存储）、LLM 每条约 1 次调用，`model_usage` 已记账。整体每月可忽略。

## 测试策略

- 单元：抽取链四级降级（mock 各抽取器）、图片过滤+改写（mock 下载/R2）、笔记 JSON 解析/校验、`getFavorites` 排序。
- 集成：`kb-stage` 处理一条 ⭐ → `ready`；正文过短 → `skipped`；失败累加至 `failed`；PATCH 切 `isFavorited` 写/清 `favoritedAt`。

---

## 未来（独立项目，本期不做）

- **B｜Reddit/Twitter 深度内容**：Reddit 用 Apify「Fast Reddit Scraper」（官方 OAuth API，$2/1k、月免费 1000）或自建官方 API；Twitter 用 twitterapi.io（$0.15/1k）或 Apify x-tweet-scraper。把完整评论树 / thread 喂给笔记生成。
- **C｜替换 Twitter 采集源**：twitter-digest → twitterapi.io。当前量 ≈ 376 条/天（~1.1 万/月）≈ **$1.7–5/月**；摆脱 Mac 开机依赖；注意 `for-you` 算法流无法复刻，`following` 改为 List/逐账号拉取。
- **跨文章主题综述**：基于每条 `note` + 已有 embedding 做主题聚合笔记；标签 / 手写批注。
