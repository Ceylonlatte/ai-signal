# RSS 并入信号流筛选 Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 RSS 从导航栏独立入口改为信号流首页的 `?source=rss` 筛选 Tab，保留按天分组、不打分的原有展示，旧 `/rss` 重定向。

**Architecture:** 首页 `page.tsx` 读取 `searchParams.source`，当值为 `rss` 时走独立分支：查询 `getRssItems`、复用抽出的纯分组逻辑、渲染信号流页面壳（H1 仍是「今日信号」+ Tab 行，隐藏排序控件与过期提示）+ `RssView` 内容区；其余 source 维持现有打分 feed。RSS 不进入打分/ranking 路径。

**Tech Stack:** Next.js 15 (App Router, RSC), React 19, TypeScript (NodeNext，import 用 `.js` 后缀), Drizzle ORM, Vitest。

---

## File Structure

- Create: `src/app/rss/rss-group.ts` — 纯函数：`dayLabel` / `groupByDay`（从现 `rss/page.tsx` 抽出，可单测）。
- Create: `src/app/rss/rss-view.tsx` — 服务端组件：接收 `rows`，渲染「说明文案 + 按天分组列表 / 空状态」内容区（不含页面壳与 Tab）。
- Create: `tests/lib/rss-group.test.ts` — `groupByDay` 单测。
- Modify: `src/app/page.tsx` — 新增 RSS Tab、`SourceTabs` 复用组件、`source === "rss"` 渲染分支。
- Modify: `src/app/site-header.tsx` — 从 `NAV` 删除 RSS 项。
- Modify: `src/app/rss/page.tsx` — 改为 `redirect("/?source=rss")`。
- Delete: `src/app/rss/loading.tsx` — `/rss` 仅剩重定向，骨架成孤儿。

约束：不改 `feed-queries.ts` / `feed-nav.ts` 签名，不改 ranking / 采集 / 数据库；`feed-nav.test.ts` 保持通过。

---

## Task 1: 抽出并测试 RSS 按天分组纯逻辑

**Files:**
- Create: `src/app/rss/rss-group.ts`
- Test: `tests/lib/rss-group.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/lib/rss-group.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupByDay } from "../../src/app/rss/rss-group.js";
import type { RssRow } from "../../src/app/rss/rss-queries.js";

function row(id: number, publishedAt: string): RssRow {
  return {
    id,
    feedUrl: "https://example.com/feed.xml",
    url: "https://example.com/post",
    title: "title",
    titleZh: "标题",
    author: null,
    summary: "summary",
    summaryZh: "摘要",
    publishedAt,
  };
}

describe("groupByDay", () => {
  it("groups consecutive same-day rows and preserves order", () => {
    // identical timestamp => same day in any timezone; a month apart => a
    // different day in every timezone, so grouping is deterministic in CI.
    const rows = [
      row(1, "2026-06-13T12:00:00.000Z"),
      row(2, "2026-06-13T12:00:00.000Z"),
      row(3, "2026-05-10T12:00:00.000Z"),
    ];
    const groups = groupByDay(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((r) => r.id)).toEqual([1, 2]);
    expect(groups[1].items.map((r) => r.id)).toEqual([3]);
    expect(groups[0].day).not.toBe(groups[1].day);
  });

  it("returns an empty array for no rows", () => {
    expect(groupByDay([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- rss-group`
Expected: FAIL，报错类似 `Failed to resolve import ".../rss-group.js"` 或 `groupByDay is not a function`。

- [ ] **Step 3: Write minimal implementation**

`src/app/rss/rss-group.ts`:

```ts
import type { RssRow } from "./rss-queries.js";

export interface RssDayGroup {
  day: string;
  items: RssRow[];
}

export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

// Items already arrive newest-first, so a single linear pass produces
// date-ordered groups without re-sorting.
export function groupByDay(rows: RssRow[]): RssDayGroup[] {
  const groups: RssDayGroup[] = [];
  for (const r of rows) {
    const day = dayLabel(r.publishedAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(r);
    else groups.push({ day, items: [r] });
  }
  return groups;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- rss-group`
Expected: PASS（2 个用例通过）。

- [ ] **Step 5: Commit**

```bash
git add src/app/rss/rss-group.ts tests/lib/rss-group.test.ts
git commit -m "refactor(rss): 抽出可测试的 RSS 按天分组纯逻辑"
```

---

## Task 2: 创建 RssView 内容区组件

**Files:**
- Create: `src/app/rss/rss-view.tsx`

- [ ] **Step 1: Write the component**

`src/app/rss/rss-view.tsx`（内容与现 `rss/page.tsx` 的 lead + 列表 + 空状态完全一致，只是接收 `rows`、不含页面壳/标题/Tab；分组改用 `rss-group.js`）：

```tsx
import { rssFeedLabel } from "../../lib/sources/rss-feeds.js";
import { relativeTime } from "../format.js";
import { hostOf } from "../feed-item-data.js";
import type { RssRow } from "./rss-queries.js";
import { groupByDay } from "./rss-group.js";

const SUMMARY_MAX = 240;

function clamp(text: string): string {
  const t = text.trim();
  return t.length > SUMMARY_MAX ? `${t.slice(0, SUMMARY_MAX)}…` : t;
}

export function RssView({ rows }: { rows: RssRow[] }) {
  const groups = groupByDay(rows);
  const now = new Date();

  return (
    <>
      <p className="page__lead">
        来自各家官方博客 / 发布说明的 RSS 源，每 24 小时全量抓取一次、仅保留近两天发布的条目；自动生成摘要与中文翻译，但不参与打分与排序。
      </p>

      {rows.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">还没有 RSS 内容</p>
          <p className="placeholder__body">
            下一次每日抓取后，当天发布的官方文章会出现在这里。<a href="/status">查看采集状态 →</a>
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section className="section" key={g.day}>
            <div className="section__head">
              <h2 className="section__title">{g.day}</h2>
              <span className="page__count">{g.items.length} 条</span>
            </div>
            <div className="results">
              {g.items.map((item) => {
                const host = hostOf(item.url);
                const title = item.titleZh || item.title;
                const summary = item.summaryZh || item.summary;
                return (
                  <article key={item.id} className="item">
                    <div className="item__top">
                      <a
                        className="item__title"
                        href={item.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {title}
                        {host && <span className="item__ext">{host} ↗</span>}
                      </a>
                    </div>
                    {item.titleZh && item.title && item.titleZh !== item.title && (
                      <p className="item__orig">{item.title}</p>
                    )}
                    {summary && <p className="item__summary">{clamp(summary)}</p>}
                    <div className="item__meta">
                      <span className="item__source">{rssFeedLabel(item.feedUrl)}</span>
                      <span className="meta-dot">·</span>
                      <span>{relativeTime(item.publishedAt, now)}</span>
                      {item.author && (
                        <>
                          <span className="meta-dot">·</span>
                          <span className="item__author">{item.author}</span>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS（无报错）。`rss-view.tsx` 目前未被引用属正常，TS 不会报「未使用文件」。

- [ ] **Step 3: Commit**

```bash
git add src/app/rss/rss-view.tsx
git commit -m "feat(rss): 抽出 RssView 内容区组件（说明文案 + 按天分组列表）"
```

---

## Task 3: 在信号流首页接入 RSS Tab 与渲染分支

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: 重写 `src/app/page.tsx`**

整文件替换为（新增 `RSS` Tab、`SourceTabs` 复用组件、`source === "rss"` 分支；其余 feed 行为保持原样）：

```tsx
import { db } from "../db/client.js";
import { getFeed, normalizeFeedSource, type FeedSort, type FeedSource } from "./feed-queries.js";
import { getSourceStatus } from "./source-status.js";
import { FeedList } from "./feed-list.js";
import { toFeedData } from "./feed-item-data.js";
import { sourceLabel } from "./format.js";
import { feedHref } from "./feed-nav.js";
import { getRssItems } from "./rss/rss-queries.js";
import { RssView } from "./rss/rss-view.js";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

type TabSource = FeedSource | "rss";

const SOURCE_TABS: { source: TabSource; label: string }[] = [
  { source: "all", label: "全部" },
  { source: "hn", label: "Hacker News" },
  { source: "reddit", label: "Reddit" },
  { source: "twitter", label: "X" },
  { source: "rss", label: "RSS" },
];

function tabHref(source: TabSource, sort: FeedSort): string {
  return source === "rss" ? "/?source=rss" : feedHref({ source, sort });
}

function SourceTabs({ active, sort }: { active: TabSource; sort: FeedSort }) {
  return (
    <div className="sort" role="group" aria-label="平台过滤">
      {SOURCE_TABS.map((tab) => (
        <a
          key={tab.source}
          className="sort__btn"
          data-active={active === tab.source}
          href={tabHref(tab.source, sort)}
        >
          {tab.label}
        </a>
      ))}
    </div>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; source?: string }>;
}) {
  const sp = await searchParams;
  const isRss = sp.source === "rss";
  const sort: FeedSort = sp.sort === "score" ? "score" : "time";
  const source = normalizeFeedSource(sp.source);

  // RSS branch: a separate, unscored surface rendered inside the signal-flow
  // shell. No sort control, no platform-staleness notice — RSS isn't ranked.
  if (isRss) {
    const rssRows = await getRssItems(db, { limit: 300 });
    return (
      <main className="page">
        <div className="page__head">
          <h1 className="page__title">今日信号</h1>
          <div className="page__tools">
            <SourceTabs active="rss" sort={sort} />
            {rssRows.length > 0 && <span className="page__count">共 {rssRows.length} 条</span>}
          </div>
        </div>
        <RssView rows={rssRows} />
      </main>
    );
  }

  const { items: feed, total, totalPages, rMin, rMax } = await getFeed(db, {
    page: 1,
    pageSize: PAGE_SIZE,
    sort,
    source,
  });
  const status = await getSourceStatus(db);
  const stale = status.filter((s: any) => s.stale);
  const now = new Date();
  const data = feed.map((item: any) => toFeedData(item, now, rMin, rMax));

  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">今日信号</h1>
        <div className="page__tools">
          <SourceTabs active={source} sort={sort} />
          <div className="sort" role="group" aria-label="排序方式">
            <a className="sort__btn" data-active={sort === "time"} href={feedHref({ source, sort: "time" })}>
              最新
            </a>
            <a className="sort__btn" data-active={sort === "score"} href={feedHref({ source, sort: "score" })}>
              按分数
            </a>
          </div>
          {total > 0 && <span className="page__count">共 {total} 条</span>}
        </div>
      </div>

      {stale.length > 0 && (
        <div className="notice" role="status">
          <span className="notice__dot" aria-hidden="true" />
          <span>
            部分源数据已过期：
            {stale
              .map((s: any) => `${sourceLabel(s.kind)}（${s.lastRunAt ? new Date(s.lastRunAt).toLocaleString("zh-CN") : "从未"}）`)
              .join("、")}
            。其余源照常更新。
          </span>
        </div>
      )}

      {data.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">
            {source === "all" ? "还没有信号" : "当前平台还没有信号"}
          </p>
          <p className="placeholder__body">
            采集与打分管道可能还在运行。<a href="/status">查看流水线状态 →</a>
          </p>
        </div>
      ) : (
        <FeedList
          key={`${source}:${sort}`}
          initialItems={data}
          total={total}
          totalPages={totalPages}
          sort={sort}
          source={source}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS。重点确认 `tabHref` 的三元在非 `rss` 分支把 `source` 正确收窄为 `FeedSource`，`feedHref` 调用无类型错误。

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(feed): RSS 作为信号流筛选 Tab（?source=rss）"
```

---

## Task 4: 从导航栏移除 RSS 入口

**Files:**
- Modify: `src/app/site-header.tsx:5-14`

- [ ] **Step 1: 删除 NAV 中的 RSS 项**

把：

```tsx
const NAV = [
  { href: "/", label: "信号流" },
  { href: "/liked", label: "收藏" },
  { href: "/rss", label: "RSS" },
  { href: "/topics", label: "话题" },
  { href: "/search", label: "搜索" },
  { href: "/keywords", label: "关键词" },
  { href: "/status", label: "状态" },
  { href: "/suppressed", label: "已压制" },
] as const;
```

改为（仅删除 `/rss` 一行，其余不动）：

```tsx
const NAV = [
  { href: "/", label: "信号流" },
  { href: "/liked", label: "收藏" },
  { href: "/topics", label: "话题" },
  { href: "/search", label: "搜索" },
  { href: "/keywords", label: "关键词" },
  { href: "/status", label: "状态" },
  { href: "/suppressed", label: "已压制" },
] as const;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/app/site-header.tsx
git commit -m "feat(nav): 移除导航栏独立 RSS 入口"
```

---

## Task 5: 旧 /rss 路由改为重定向并删除其骨架

**Files:**
- Modify: `src/app/rss/page.tsx`
- Delete: `src/app/rss/loading.tsx`

- [ ] **Step 1: 重写 `src/app/rss/page.tsx` 为重定向**

整文件替换为：

```tsx
import { redirect } from "next/navigation";

export default function RssPage() {
  redirect("/?source=rss");
}
```

- [ ] **Step 2: 删除 `src/app/rss/loading.tsx`**

Run: `git rm src/app/rss/loading.tsx`
Expected: 文件被删除并进入暂存区。（`/?source=rss` 的加载态由 `src/app/loading.tsx` 覆盖。）

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS。确认 `rss/page.tsx` 不再引用 `getRssItems` / `rssFeedLabel` 等（已全部移入 `rss-view.tsx`），无未使用 import。

- [ ] **Step 4: Commit**

```bash
git add src/app/rss/page.tsx
git commit -m "feat(rss): 旧 /rss 重定向到 /?source=rss 并移除冗余 loading"
```

---

## Task 6: 全量验证

**Files:** 无（仅运行与手动验证）

- [ ] **Step 1: 跑完整测试**

Run: `npm test`
Expected: 全部 PASS，含新增 `rss-group` 用例与现有 `feed-nav` 用例。

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: 手动验证（开发服务器）**

Run: `npm run dev`，浏览器依次确认：
- 首页 Tab 行显示 `全部 / Hacker News / Reddit / X / RSS`；顶部导航栏不再有「RSS」。
- 点 RSS → URL 变为 `/?source=rss`：H1 仍是「今日信号」，显示 RSS 说明文案、按天分组列表、`共 N 条`；**不显示**排序控件与过期源提示。
- 点回 `全部 / Hacker News / Reddit / X`：feed、排序（最新/按分数）、无限滚动、过期提示一切如旧。
- 直接访问 `/rss`：重定向到 `/?source=rss`，内容一致。
- RSS 无数据时显示「还没有 RSS 内容」空状态。

- [ ] **Step 4: 无新增改动则无需额外提交**

若手动验证发现问题，按需修复后单独提交；否则结束。

---

## Self-Review

**1. Spec coverage：**
- 新增 RSS Tab、排在最后 → Task 3（`SOURCE_TABS` 末位 `rss`）。
- 导航栏移除 RSS → Task 4。
- 保留按天分组、不打分 → Task 1（分组逻辑）+ Task 2（RssView 沿用原样式）+ Task 3（不调用 `getFeed`）。
- `/?source=rss` 路由 + H1 保持「今日信号」+ 隐藏排序/过期提示 → Task 3。
- 旧 `/rss` 重定向 → Task 5。
- 不改 ranking / 采集 / 数据库 / `feedHref` 签名 → 全程未触及对应文件签名。
- 测试不破坏 + 可选 RSS 分组单测 → Task 1、Task 6。

**2. Placeholder scan：** 无 TBD/TODO；每个改动步骤均给出完整代码或完整命令。

**3. Type consistency：** `TabSource = FeedSource | "rss"`；`tabHref(source, sort)` 与 `SourceTabs({ active, sort })` 签名一致；`RssView({ rows })` 与 Task 3 调用一致；`RssRow` 来自 `rss-queries.js`，`groupByDay` 返回 `RssDayGroup[]` 与 Task 2 使用一致；import 统一 `.js` 后缀，符合现有约定。
