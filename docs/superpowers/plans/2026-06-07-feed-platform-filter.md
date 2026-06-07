# Feed Platform Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add platform filtering to the home feed so users can view all main sources, Hacker News, Reddit, or X, each sorted by latest or ranking score.

**Architecture:** Keep the existing home route and add a normalized `source` query dimension beside the existing `sort` dimension. Filtering happens in the server-side candidate SQL so pagination and infinite scroll stay correct. URL generation is isolated in a tiny helper that can be unit-tested independently from React.

**Tech Stack:** Next.js App Router, React 19, TypeScript, drizzle-orm raw SQL, Postgres, vitest.

---

## File Structure

- `src/app/feed-queries.ts`
  - Owns feed query types and data retrieval.
  - Add `FeedSource`, `normalizeFeedSource()`, and source-aware candidate SQL.
- `tests/integration/feed-queries.test.ts`
  - Extend existing integration coverage for `getFeed()` to prove source filtering happens before paging/ranking and that `all` excludes RSS.
- `src/app/feed-nav.ts`
  - New small helper for feed URLs.
  - Keeps `page.tsx` declarative and makes state-preserving links testable.
- `tests/lib/feed-nav.test.ts`
  - Unit tests for default clean URL and source/sort state preservation.
- `src/app/page.tsx`
  - Parse `source`, render platform tabs, preserve source/sort in links, pass source to query and list.
- `src/app/feed-actions.ts`
  - Extend `loadFeedPage()` with source so infinite scroll stays on the active platform.
- `src/app/feed-list.tsx`
  - Accept source and pass it to `loadFeedPage()`.
- `src/app/globals.css`
  - Small layout tweak for two segmented controls, especially narrow screens.

No database migration is needed because `items.source` already exists.

---

### Task 1: Source-Aware Feed Query

**Files:**
- Modify: `tests/integration/feed-queries.test.ts`
- Modify: `src/app/feed-queries.ts`

- [ ] **Step 1: Refactor the feed query test setup and add failing source-filter tests**

Replace `tests/integration/feed-queries.test.ts` with:

```ts
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { items, scores } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";
import { getFeed, normalizeFeedSource } from "../../src/app/feed-queries.js";

async function insertScoredItem(opts: {
  rawItemId: number;
  source: string;
  title: string;
  titleZh: string;
  createdAt: Date;
  metrics: Record<string, number>;
  contentHash: string;
  composite?: number;
  novelty?: number;
}) {
  const [item] = await db.insert(items).values({
    rawItemId: opts.rawItemId,
    source: opts.source,
    title: opts.title,
    text: "",
    createdAt: opts.createdAt,
    metrics: opts.metrics,
    contentHash: opts.contentHash,
  }).returning();
  await db.insert(scores).values({
    itemId: item!.id,
    composite: opts.composite ?? 0.7,
    novelty: opts.novelty ?? 0.2,
    summaryZh: `中文${opts.titleZh}`,
    titleZh: opts.titleZh,
    rubricVersion: "t",
  });
  return item!;
}

beforeEach(async () => {
  await truncateAll();
  const now = new Date();
  // "热门": older (5h) but very high engagement -> high platformHeat.
  await insertScoredItem({
    rawItemId: 1,
    source: "hn",
    title: "hot",
    titleZh: "热门",
    createdAt: new Date(now.getTime() - 5 * 3600_000),
    metrics: { points: 5000 },
    contentHash: "hot",
  });
  // "新但冷": freshest but tiny engagement -> low platformHeat.
  await insertScoredItem({
    rawItemId: 2,
    source: "hn",
    title: "cold",
    titleZh: "新但冷",
    createdAt: now,
    metrics: { points: 2 },
    contentHash: "cold",
  });
});
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("ranks by live R: heat beats recency (older+hot first, fresher+cold second)", async () => {
  // composites are tied (0.7) and the cold item is the freshest, so only a
  // heat-aware ranker puts the older "热门" first. Rules out recency-only / composite-only.
  const feed = await getFeed(db, { page: 1, pageSize: 50 });
  expect(feed.items.map((r: any) => r.titleZh)).toEqual(["热门", "新但冷"]);
  expect(feed.total).toBe(2);
});

it("paginates the ranked list without a hard cap (pageSize splits across pages)", async () => {
  const p1 = await getFeed(db, { page: 1, pageSize: 1 });
  const p2 = await getFeed(db, { page: 2, pageSize: 1 });
  expect(p1.total).toBe(2);
  expect(p1.totalPages).toBe(2);
  // ranking order is preserved across pages: hot on p1, cold on p2.
  expect(p1.items.map((r: any) => r.titleZh)).toEqual(["热门"]);
  expect(p2.items.map((r: any) => r.titleZh)).toEqual(["新但冷"]);
});

it("clamps an out-of-range page to the last page", async () => {
  const p = await getFeed(db, { page: 99, pageSize: 1 });
  expect(p.page).toBe(2);
  expect(p.items.map((r: any) => r.titleZh)).toEqual(["新但冷"]);
});

it("normalizes unknown source values to all", () => {
  expect(normalizeFeedSource(undefined)).toBe("all");
  expect(normalizeFeedSource("")).toBe("all");
  expect(normalizeFeedSource("rss")).toBe("all");
  expect(normalizeFeedSource("twitter")).toBe("twitter");
});

it("defaults to main feed sources and excludes rss from all", async () => {
  await insertScoredItem({
    rawItemId: 3,
    source: "rss",
    title: "rss",
    titleZh: "RSS",
    createdAt: new Date(),
    metrics: {},
    contentHash: "rss",
  });

  const feed = await getFeed(db, { page: 1, pageSize: 50 });
  expect(feed.source).toBe("all");
  expect(feed.total).toBe(2);
  expect(feed.items.map((r: any) => r.source)).toEqual(["hn", "hn"]);
});

it("filters to a requested platform before paging", async () => {
  const now = new Date();
  await insertScoredItem({
    rawItemId: 3,
    source: "reddit",
    title: "reddit",
    titleZh: "Reddit",
    createdAt: now,
    metrics: { score: 100, comments: 5 },
    contentHash: "reddit",
  });
  await insertScoredItem({
    rawItemId: 4,
    source: "twitter",
    title: "twitter",
    titleZh: "X",
    createdAt: now,
    metrics: { likes: 100, retweets: 10, replies: 3 },
    contentHash: "twitter",
  });

  const feed = await getFeed(db, { page: 1, pageSize: 1, source: "twitter" });
  expect(feed.source).toBe("twitter");
  expect(feed.total).toBe(1);
  expect(feed.totalPages).toBe(1);
  expect(feed.items.map((r: any) => r.source)).toEqual(["twitter"]);
});
```

- [ ] **Step 2: Run the focused integration test and confirm it fails**

Run:

```bash
pnpm vitest run tests/integration/feed-queries.test.ts
```

Expected: FAIL because `normalizeFeedSource` is not exported yet, `FeedPage` has no `source`, and `getFeed()` ignores `source`.

- [ ] **Step 3: Implement `FeedSource`, normalization, and SQL filtering**

In `src/app/feed-queries.ts`, update the relevant sections to:

```ts
type Ranked = Row & { r: number };

// Main feed platforms. RSS keeps its separate /rss surface and is intentionally
// excluded from `all` here.
const MAIN_FEED_SOURCES = ["hn", "reddit", "twitter"] as const;

export type FeedSort = "time" | "score";
export type FeedSource = "all" | (typeof MAIN_FEED_SOURCES)[number];

export function normalizeFeedSource(source: string | null | undefined): FeedSource {
  return source === "hn" || source === "reddit" || source === "twitter" ? source : "all";
}

function sourceFilter(source: FeedSource) {
  return source === "all"
    ? sql`i.source IN ('hn', 'reddit', 'twitter')`
    : sql`i.source = ${source}`;
}
```

Change `candidates()` to accept source and apply the filter:

```ts
async function candidates(db: Db, cap: number, source: FeedSource): Promise<Row[]> {
  const win = `${config.PROFILE_WINDOW_DAYS} days`;
  const res = await db.execute(sql`
    WITH up AS (
      SELECT count(*)::int AS n FROM feedback
      WHERE signal = 'up' AND created_at > now() - ${win}::interval
    ), down AS (
      SELECT count(*)::int AS n FROM feedback
      WHERE signal = 'down' AND created_at > now() - ${win}::interval
    )
    SELECT i.id, i.title, s.title_zh AS "titleZh", i.url, i.source, i.author AS "author",
           i.created_at AS "createdAt", i.metrics,
           s.composite AS q, s.novelty, s.summary_zh AS "summaryZh", s.summary_en AS "summaryEn",
           s.topic_tags AS "topicTags", s.reason,
           (SELECT 1 - MIN(le.embedding <=> e.embedding)
              FROM item_embeddings le JOIN feedback f ON f.item_id = le.item_id
              WHERE f.signal = 'up' AND f.created_at > now() - ${win}::interval) AS "maxLikeSim",
           (SELECT 1 - MIN(de.embedding <=> e.embedding)
              FROM item_embeddings de JOIN feedback f ON f.item_id = de.item_id
              WHERE f.signal = 'down' AND f.created_at > now() - ${win}::interval) AS "maxDislikeSim",
           (SELECT n FROM up) AS "nUp",
           (SELECT n FROM down) AS "nDown"
    FROM items i
    JOIN scores s ON s.item_id = i.id
    LEFT JOIN item_embeddings e ON e.item_id = i.id
    WHERE i.is_archived = false
      AND ${sourceFilter(source)}
    ORDER BY i.created_at DESC
    LIMIT ${cap}
  `);
  return (res.rows ?? res) as Row[];
}
```

Update `FeedPage` and `getFeed()`:

```ts
export interface FeedPage {
  items: Ranked[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sort: FeedSort;
  source: FeedSource;
  // Ranking-score bounds across the whole visible set (not just this page), so
  // strength tiers stay stable and comparable as infinite scroll appends pages.
  rMin: number;
  rMax: number;
}

export async function getFeed(
  db: Db,
  opts: { page?: number; pageSize?: number; sort?: FeedSort; source?: string },
): Promise<FeedPage> {
  const sort: FeedSort = opts.sort === "score" ? "score" : "time";
  const source = normalizeFeedSource(opts.source);
  const pageSize = Math.max(1, opts.pageSize ?? 30);
  const rows = await candidates(db, MAX_CANDIDATES, source);
  const visible = rows.filter((row) => !isSuppressed(row.maxDislikeSim));
  const all = withRanking(visible).sort(sort === "score" ? byScore : byTime);
  const total = all.length;
  const rs = all.map((row) => row.r);
  const rMin = rs.length ? Math.min(...rs) : 0;
  const rMax = rs.length ? Math.max(...rs) : 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, opts.page ?? 1), totalPages);
  const start = (page - 1) * pageSize;
  return { items: all.slice(start, start + pageSize), total, page, pageSize, totalPages, sort, source, rMin, rMax };
}
```

Update `getSuppressed()` to pass `"all"`:

```ts
export async function getSuppressed(db: Db, opts: { limit: number }) {
  const rows = await candidates(db, Math.max(opts.limit * 6, 300), "all");
  const hidden = rows.filter((row) => isSuppressed(row.maxDislikeSim));
  return ranked(hidden).slice(0, opts.limit);
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
pnpm vitest run tests/integration/feed-queries.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/app/feed-queries.ts tests/integration/feed-queries.test.ts
git commit -m "feat(feed): filter feed queries by platform"
```

---

### Task 2: Feed URL Helper

**Files:**
- Create: `src/app/feed-nav.ts`
- Create: `tests/lib/feed-nav.test.ts`

- [ ] **Step 1: Write failing URL helper tests**

Create `tests/lib/feed-nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { feedHref } from "../../src/app/feed-nav.js";

describe("feedHref", () => {
  it("uses a clean URL for the default all + latest view", () => {
    expect(feedHref({ source: "all", sort: "time" })).toBe("/");
  });

  it("keeps score sort for the all view", () => {
    expect(feedHref({ source: "all", sort: "score" })).toBe("/?sort=score");
  });

  it("keeps sort when switching platform", () => {
    expect(feedHref({ source: "reddit", sort: "score" })).toBe("/?source=reddit&sort=score");
  });

  it("keeps source even when sort is latest", () => {
    expect(feedHref({ source: "twitter", sort: "time" })).toBe("/?source=twitter&sort=time");
  });
});
```

- [ ] **Step 2: Run the URL helper test and confirm it fails**

Run:

```bash
pnpm vitest run tests/lib/feed-nav.test.ts
```

Expected: FAIL because `src/app/feed-nav.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/app/feed-nav.ts`:

```ts
import type { FeedSort, FeedSource } from "./feed-queries.js";

export function feedHref({ source, sort }: { source: FeedSource; sort: FeedSort }): string {
  const params = new URLSearchParams();
  if (source !== "all") params.set("source", source);
  if (!(source === "all" && sort === "time")) params.set("sort", sort);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}
```

- [ ] **Step 4: Run the URL helper test and confirm it passes**

Run:

```bash
pnpm vitest run tests/lib/feed-nav.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/app/feed-nav.ts tests/lib/feed-nav.test.ts
git commit -m "feat(feed): add platform filter links"
```

---

### Task 3: Wire Platform Filtering Into The Home Feed UI

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/feed-actions.ts`
- Modify: `src/app/feed-list.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Extend the server action for infinite scroll**

Update `src/app/feed-actions.ts` to:

```ts
"use server";

import { db } from "../db/client.js";
import { getFeed, normalizeFeedSource, type FeedSort, type FeedSource } from "./feed-queries.js";
import { toFeedData, type FeedItemData } from "./feed-item-data.js";

const PAGE_SIZE = 30;

export interface FeedPageResult {
  items: FeedItemData[];
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
}

export async function loadFeedPage(page: number, sort: FeedSort, source: FeedSource): Promise<FeedPageResult> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safeSort: FeedSort = sort === "score" ? "score" : "time";
  const safeSource = normalizeFeedSource(source);
  const res = await getFeed(db, { page: safePage, pageSize: PAGE_SIZE, sort: safeSort, source: safeSource });
  const now = new Date();
  return {
    items: res.items.map((it) => toFeedData(it, now, res.rMin, res.rMax)),
    total: res.total,
    page: res.page,
    totalPages: res.totalPages,
    hasMore: res.page < res.totalPages,
  };
}
```

- [ ] **Step 2: Pass source through the client feed list**

In `src/app/feed-list.tsx`, update the imports and props:

```ts
import type { FeedSort, FeedSource } from "./feed-queries.js";
```

Update the component signature:

```ts
export function FeedList({
  initialItems,
  total: initialTotal,
  totalPages: initialTotalPages,
  sort,
  source,
}: {
  initialItems: FeedItemData[];
  total: number;
  totalPages: number;
  sort: FeedSort;
  source: FeedSource;
}) {
```

Update the load-more call:

```ts
const res = await loadFeedPage(page + 1, sort, source);
```

- [ ] **Step 3: Render source tabs and pass source from the home page**

Update `src/app/page.tsx` to:

```tsx
import { db } from "../db/client.js";
import { getFeed, normalizeFeedSource, type FeedSort, type FeedSource } from "./feed-queries.js";
import { getSourceStatus } from "./source-status.js";
import { FeedList } from "./feed-list.js";
import { toFeedData } from "./feed-item-data.js";
import { sourceLabel } from "./format.js";
import { feedHref } from "./feed-nav.js";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
const SOURCE_TABS: { source: FeedSource; label: string }[] = [
  { source: "all", label: "全部" },
  { source: "hn", label: "Hacker News" },
  { source: "reddit", label: "Reddit" },
  { source: "twitter", label: "X" },
];

export default async function Home({ searchParams }: { searchParams: Promise<{ sort?: string; source?: string }> }) {
  const sp = await searchParams;
  const sort: FeedSort = sp.sort === "score" ? "score" : "time";
  const source = normalizeFeedSource(sp.source);
  const { items: feed, total, totalPages, rMin, rMax } = await getFeed(db, { page: 1, pageSize: PAGE_SIZE, sort, source });
  const status = await getSourceStatus(db);
  const stale = status.filter((s: any) => s.stale);
  const now = new Date();
  const data = feed.map((item: any) => toFeedData(item, now, rMin, rMax));

  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">今日信号</h1>
        <div className="page__tools">
          <div className="sort" role="group" aria-label="平台过滤">
            {SOURCE_TABS.map((tab) => (
              <a
                key={tab.source}
                className="sort__btn"
                data-active={source === tab.source}
                href={feedHref({ source: tab.source, sort })}
              >
                {tab.label}
              </a>
            ))}
          </div>
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
          <p className="placeholder__title">{source === "all" ? "还没有信号" : "当前平台还没有信号"}</p>
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

- [ ] **Step 4: Add minimal responsive layout CSS**

In `src/app/globals.css`, update the existing `.page__tools` rule around the feed sort section to include wrapping:

```css
.page__tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-4);
}
```

Add this near the existing feed sort styles:

```css
@media (max-width: 720px) {
  .page__tools {
    justify-content: flex-start;
  }
}
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm vitest run tests/integration/feed-queries.test.ts tests/lib/feed-nav.test.ts
pnpm typecheck
```

Expected: both commands PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/app/page.tsx src/app/feed-actions.ts src/app/feed-list.tsx src/app/globals.css
git commit -m "feat(feed): add platform filter controls"
```

---

### Task 4: Final Verification

**Files:**
- Verify only; no planned edits unless a check fails.

- [ ] **Step 1: Run the broader relevant test set**

Run:

```bash
pnpm vitest run tests/integration/feed-queries.test.ts tests/integration/feed-feedback.test.ts tests/lib/feed-nav.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Optional browser smoke check if a dev server is available**

Open the homepage and check:

- `/` shows the `全部` and `最新` buttons active.
- `/?source=twitter&sort=score` shows `X` and `按分数` active.
- Clicking `Reddit` from `/?source=twitter&sort=score` navigates to `/?source=reddit&sort=score`.
- Clicking `最新` from `/?source=reddit&sort=score` navigates to `/?source=reddit&sort=time`.

If no local database/dev server is available, skip this browser check and report that only automated tests and typecheck were run.

- [ ] **Step 4: Commit any verification fixes**

Only if Step 1 or Step 2 required fixes:

```bash
git add <fixed-files>
git commit -m "fix(feed): address platform filter verification issues"
```

Do not create an empty commit if there were no fixes.

---

## Self-Review

- Spec coverage: covered platform tabs, latest/score per platform, state preservation, RSS exclusion from `all`, server-side filtering before paging, infinite scroll source propagation, empty state wording, and no ranking/database changes.
- Placeholder scan: no `TBD`, `TODO`, vague "handle edge cases", or unexpanded "write tests" steps remain.
- Type consistency: `FeedSource`, `FeedSort`, `normalizeFeedSource()`, and `feedHref()` signatures are introduced before use. `loadFeedPage()` and `FeedList` both receive normalized `FeedSource`.
