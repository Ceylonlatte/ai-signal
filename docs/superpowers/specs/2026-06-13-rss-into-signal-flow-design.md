# Design: RSS 并入信号流筛选 Tab

Date: 2026-06-13
Repo: ai-signal
Status: DESIGN（已确认设计，待写实现计划）
Brainstormed via: superpowers:brainstorming

## Problem Statement

当前 RSS 是导航栏里的一个独立入口（`/rss`），与信号流首页平级。用户希望把 RSS 收进信号流内部，让它成为信号流页里的一个筛选 Tab，而不再单独占用顶部导航栏的一项。

目标：

- 在信号流首页（`/`）的平台筛选行里新增 `RSS` Tab，排在最后：`全部 / Hacker News / Reddit / X / RSS`。
- 从导航栏移除独立的 `RSS` 入口。
- RSS 仍保持其原有的「按天分组、不打分、不排序」展示，只是搬进 Tab 内容区。
- 旧链接 `/rss` 继续可用（重定向到新位置）。

## Current Context

- 导航栏在 `src/app/site-header.tsx`，`NAV` 数组里有 `{ href: "/rss", label: "RSS" }`。
- 信号流首页 `src/app/page.tsx`：标题「今日信号」，平台筛选 Tab（`全部 / HN / Reddit / X`）+ 排序（`最新 / 按分数`）+ `共 N 条` + 过期源提示 + `FeedList` 无限滚动。数据来自 `getFeed()`（`items` + `scores`，经打分与 live ranking）。
- RSS 专页 `src/app/rss/page.tsx`：标题「RSS 订阅」+ 说明文案，数据来自 `getRssItems()`（`rssItems` 表），按天分组渲染，**不打分、不排序**，卡片元信息（来源 / 作者 / 发布时间）与主 feed 不同。
- `src/app/feed-queries.ts` 明确注释 `RSS keeps its separate surface and is excluded from 'all'`，`FeedSource = "all" | "hn" | "reddit" | "twitter"`，`getFeed()`/`candidates()` 的 SQL 仅过滤 `hn/reddit/twitter`。
- Tab 链接 helper 在 `src/app/feed-nav.ts` 的 `feedHref({ source, sort })`，已有单测 `tests/lib/feed-nav.test.ts`。
- `src/app/rss/loading.tsx`、`src/app/rss/rss-queries.ts` 服务于现 `/rss` 页。

## Confirmed Approach

把 RSS 作为信号流首页的一个筛选 Tab，用 query 参数 `?source=rss` 承载，由首页根据 `source` 是否为 `rss` 切换渲染。**不把 RSS 混入打分 feed，也不改 ranking。**

关键决策（已确认）：

1. RSS 以筛选 Tab 形式出现，不与 HN/Reddit/X 混排。
2. RSS Tab 内沿用现有「按天分组」样式，仅搬进 Tab。
3. URL 用 `/?source=rss`；旧 `/rss` 重定向到 `/?source=rss`。
4. RSS 激活时 H1 保持「今日信号」（信号流页统一标题），下方显示 RSS 说明文案。
5. RSS 激活时隐藏「最新 / 按分数」排序控件（RSS 不打分），也不显示平台过期提示。

## Data Flow

`page.tsx` 解析 `searchParams.source`：

- 若 `source === "rss"`：
  - 调用 `getRssItems(db, { limit: 300 })`，按天分组。
  - 渲染信号流页面壳（H1「今日信号」+ Tab 行，RSS 高亮，`共 N 条` 显示 RSS 条数），下方渲染 RSS 说明文案 + 按天分组列表。
  - 不调用 `getFeed()`，不计算 ranking，不显示排序控件与过期提示。
- 否则（`all/hn/reddit/twitter`）：维持现有 `getFeed()` + `FeedList` 行为，完全不动。

`getFeed()` / `candidates()` / `loadFeedPage()` 不变，RSS 不进入打分 feed 路径，因此无限滚动逻辑、ranking、强度展示均不受影响。

## UI Behavior

- 平台筛选行新增 `RSS`，顺序 `全部 / Hacker News / Reddit / X / RSS`。
- RSS Tab 的链接为 `/?source=rss`（不带 `sort` 参数）。
- 进入 RSS Tab：
  - H1 仍是「今日信号」。
  - 显示 RSS 说明文案（来自各家官方博客 / 发布说明的 RSS 源，每 24 小时全量抓取一次、仅保留近两天发布的条目，自动生成摘要与中文翻译，但不参与打分与排序）。
  - 隐藏排序控件，不显示过期源提示。
  - `共 N 条` 表示 RSS 条数；为空时展示现有 RSS 空状态文案。
  - 列表按天分组，沿用现有 RSS 卡片样式（标题、原文标题、摘要、来源 / 时间 / 作者）。
- 其余 Tab（全部/HN/Reddit/X）行为与样式完全保持现状。

## Implementation Scope

需要修改：

- `src/app/rss/rss-view.tsx`（新增）
  - 把现 `src/app/rss/page.tsx` 内的分组渲染逻辑（`dayLabel` / `clamp` / `groupByDay` + 列表 + 说明文案 + 空状态）抽成一个服务端组件，接收已查询好的 `rows`（或自行查询），输出「说明文案 + 分组列表 / 空状态」内容区（不含页面壳与 Tab）。
- `src/app/page.tsx`
  - 解析并识别 `source === "rss"` 分支。
  - `SOURCE_TABS` 增加 `{ source: "rss", label: "RSS" }`（类型放宽为 `FeedSource | "rss"`）。
  - RSS Tab href 用字面量 `/?source=rss`；其余 Tab 继续用 `feedHref`。
  - RSS 分支：查询 RSS、渲染页面壳（隐藏排序/过期提示）+ `<RssView />`。
- `src/app/site-header.tsx`
  - 从 `NAV` 删除 `{ href: "/rss", label: "RSS" }`。
- `src/app/rss/page.tsx`
  - 改为 `redirect("/?source=rss")`。
- `src/app/rss/loading.tsx`
  - 删除（`/rss` 仅剩重定向，旧「RSS 订阅」骨架成为孤儿；`/?source=rss` 由 `src/app/loading.tsx` 覆盖）。
- `src/app/globals.css`
  - 一般不需要新增样式（复用现有 `.sort` / `.section` / `.results` / `.item`）。若 5 个 Tab 在窄屏换行有问题再做最小调整。

复用不动：

- `src/app/rss/rss-queries.ts`（`getRssItems`）由 `rss-view.tsx` / `page.tsx` 复用。
- `src/lib/sources/rss-feeds.ts`（`rssFeedLabel`）。

不做：

- 不把 RSS 混入打分 feed（`all` 仍只含 `hn/reddit/twitter`）。
- 不改 `feedHref` 签名与其单测。
- 不改 ranking、平台热度、trust、采集管道、数据库结构。

## Error Handling And Edge Cases

- 未知 `source` 仍按 `all` 处理（现有 `normalizeFeedSource` 行为不变）；`rss` 在 `page.tsx` 层单独识别，不进入 `normalizeFeedSource` 的 feed 路径。
- RSS 为空：渲染现有 RSS 空状态文案（含「查看采集状态 →」）。
- 旧链接 / 书签 `/rss` 通过 `redirect("/?source=rss")` 保持可用。
- RSS 激活时不调用 `getFeed()`，避免对 RSS 数据做无意义的打分/排序计算。

## Testing

- 现有 `tests/lib/feed-nav.test.ts` 不破坏（`feedHref` 不变）。
- 可选新增断言：RSS Tab 的 href 等于 `/?source=rss`（若把该 href 也收敛进 helper）。
- `npm run typecheck`（或项目对应命令）通过。
- 手动验证：
  - 首页 Tab 行显示 `全部 / Hacker News / Reddit / X / RSS`；导航栏不再有 RSS。
  - 点 RSS → `/?source=rss`：按天分组列表、隐藏排序控件、显示 RSS 说明文案、`共 N 条` 正确。
  - 点回 `全部/HN/Reddit/X`：feed、排序、无限滚动、过期提示一切如旧。
  - 直接访问 `/rss`：重定向到 `/?source=rss`。

## Success Criteria

- RSS 成为信号流首页的一个筛选 Tab，导航栏不再有独立 RSS 入口。
- RSS Tab 内沿用按天分组、不打分的原有体验。
- 主 feed（全部/HN/Reddit/X）的打分、排序、无限滚动行为完全不受影响。
- 旧 `/rss` 链接仍可访问（重定向）。
