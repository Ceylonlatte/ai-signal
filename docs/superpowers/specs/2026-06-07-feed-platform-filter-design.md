# Design: Feed 平台过滤

Date: 2026-06-07
Repo: ai-signal
Status: DESIGN（已确认设计，待写实现计划）
Brainstormed via: superpowers:brainstorming

## Problem Statement

首页 feed 目前只有全局排序：`最新` 和 `按分数`。当 Hacker News、Reddit、X 等平台同时进入主 feed 后，用户需要按平台查看该平台的最新内容或分数排名，而不是只能在混合流里浏览。

目标是在首页增加平台过滤：

- 支持 `全部 / Hacker News / Reddit / X`。
- 每个平台内仍可切换 `最新 / 按分数`。
- 平台切换保留当前排序，排序切换保留当前平台。
- RSS 继续由 `/rss` 专页承载，不进入首页平台过滤。

## Current Context

- 首页入口在 `src/app/page.tsx`，通过 `sort` query 参数选择 `time` 或 `score`。
- 数据查询在 `src/app/feed-queries.ts`，`getFeed()` 先取候选项，再过滤压制项、计算 live ranking `r`、按时间或分数排序并分页。
- 无限加载在 `src/app/feed-list.tsx` 调用 server action `src/app/feed-actions.ts` 的 `loadFeedPage(page, sort)`。
- `items` 表已有 `source` 字段，可直接过滤 `hn`、`reddit`、`twitter`。不需要迁移数据库。
- 项目已有独立 `/rss` 页面；首页 `全部` 应明确排除 `rss`，避免和 RSS 独立体验混在一起。

## Confirmed Approach

采用 query 参数方案：在现有首页增加 `source` 参数，而不是新建平台路由或客户端本地过滤。

URL 形态：

- `/`：默认视图，等价于 `source=all&sort=time`。
- `/?source=twitter&sort=score`：只看 X，并按分数排序。
- `/?source=reddit&sort=time`：只看 Reddit，并按最新排序。

允许的 `source` 值：

- `all`
- `hn`
- `reddit`
- `twitter`

任何未知值都按 `all` 处理。`rss` 不作为首页 source 选项暴露。

## Data Flow

`page.tsx` 解析 `searchParams.source` 和 `searchParams.sort`，得到规范化后的 `FeedSource` 与 `FeedSort`，再调用：

```ts
getFeed(db, { page: 1, pageSize: PAGE_SIZE, sort, source })
```

`getFeed()` 把 `source` 传给内部 `candidates()`。SQL 查询在候选阶段就过滤平台：

- `source === "all"`：取 `hn`、`reddit`、`twitter`。
- `source !== "all"`：取单一 `items.source = source`。

候选项之后沿用现有流程：

1. 过滤 `isSuppressed(row.maxDislikeSim)`。
2. 为每条计算 live ranking `r`。
3. 根据 `sort` 用 `createdAt` 或 `r` 排序。
4. 计算当前可见集合的 `rMin` / `rMax`，保持强度展示稳定。
5. 分页返回。

`loadFeedPage(page, sort, source)` 也接收同一个 `source`，因此无限滚动加载的是当前平台下的下一页，不会出现客户端过滤漏数据。

## UI Behavior

首页顶部保留现有排序控件，并新增平台控件。两个控件都使用分段按钮样式：

- 平台：`全部 / Hacker News / Reddit / X`
- 排序：`最新 / 按分数`

状态保留规则：

- 当前 `?source=twitter&sort=score`，点击 `Reddit` 后链接到 `?source=reddit&sort=score`。
- 当前 `?source=reddit&sort=time`，点击 `按分数` 后链接到 `?source=reddit&sort=score`。
- 默认状态 `全部 + 最新` 使用干净 URL `/`。

页面计数 `共 N 条` 表示当前平台和当前可见规则下的总数。单个平台为空时，空状态文案可从“还没有信号”调整为“当前平台还没有信号”；`all` 为空时保留现有语义。

## Implementation Scope

需要修改：

- `src/app/feed-queries.ts`
  - 增加 `FeedSource` 类型。
  - 增加 source 参数规范化 helper。
  - 让 `getFeed()` / `candidates()` 接收 source，并在 SQL 层过滤。
- `src/app/page.tsx`
  - 解析 `searchParams.source`。
  - 渲染平台分段控件。
  - 生成保留另一维度状态的链接。
  - 把 source 传给 `getFeed()` 和 `FeedList`。
- `src/app/feed-actions.ts`
  - `loadFeedPage()` 增加 source 参数并传给 `getFeed()`。
- `src/app/feed-list.tsx`
  - 接收 source，并在加载更多时传回 server action。
- `src/app/globals.css`
  - 复用 `.sort` / `.sort__btn` 的视觉语言。
  - 只补必要布局，让两个控件在窄屏换行时保持可读。

不做：

- 不暴露 reddit `hot/new` 或 twitter `following/for-you` 的二级过滤。
- 不把 RSS 混入首页平台过滤。
- 不改变 ranking 公式、平台热度、trust 逻辑。
- 不做数据库迁移。

## Error Handling And Edge Cases

- 未知 `source` 参数按 `all` 处理，避免坏链接导致页面异常。
- 未知 `sort` 参数继续按现有规则回退到 `time`。
- 当前平台没有条目时返回空列表和总数 0，页面展示空状态。
- 无限加载时 source 由服务端已规范化值传给客户端，避免客户端构造未知 source。
- `all` 明确只包含主 feed 平台 `hn/reddit/twitter`，不包含 `rss`。

## Testing

优先验证查询行为和类型安全：

- 为 source 规范化 helper 增加单测：未知值回退到 `all`，合法值保持原样。
- 为平台链接 helper 增加单测（如拆出 helper）：平台切换保留 sort，排序切换保留 source，默认状态生成 `/`。
- 若项目现有测试设施不适合直接测 raw SQL 查询，则通过 helper 单测覆盖参数语义，并运行 `pnpm typecheck`。
- 手动验证首页：
  - `/?source=twitter&sort=score` 只显示 X，且加载更多仍只加载 X。
  - `/?source=reddit&sort=time` 只显示 Reddit 且按最新排序。
  - `/` 显示 `hn/reddit/twitter`，不显示 RSS。

## Success Criteria

- 用户可以在首页按平台查看主 feed 信号。
- 每个平台都能切换最新和分数排名。
- 平台和排序两个维度互相保留状态。
- 无限滚动不会跨平台加载数据。
- RSS 仍保持独立 `/rss` 体验。
