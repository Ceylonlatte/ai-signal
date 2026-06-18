# 收藏 → 个人知识库（项目 A）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「收藏」升级为个人知识库——⭐ 收藏的内容自动抓全文 + 转存图片到 R2 + LLM 生成结构化笔记，并提供收藏列表与详情页阅读视图。

**Architecture:** 复用现有 worker 状态轮询管道，新增 `runKbStage` 处理 `isFavorited` 条目；四级抽取链（Firecrawl→markdown.new→article-extractor→已采文本）产出 Markdown，图片转存 Cloudflare R2 并改写 URL，OpenRouter 产出五字段中文笔记，存入新表 `kb_entries`；UI 把 `/liked` 改造为 `/library` 列表 + `/library/[id]` 详情。

**Tech Stack:** Next.js App Router、React 19、TypeScript、drizzle-orm、Postgres、vitest、@aws-sdk/client-s3（R2）、react-markdown + remark-gfm、OpenRouter、Firecrawl、markdown.new。

参考设计文档：`docs/superpowers/specs/2026-06-18-knowledge-base-collection-design.md`

---

## File Structure

**新增**
- `src/lib/kb/r2.ts` — R2 客户端（put + 配置判断 + 公网 URL）
- `src/lib/kb/reader.ts` — 四级抽取链，产出 `{ markdown, images, source }`
- `src/lib/kb/images.ts` — 图片过滤 / 下载 / 上传 R2 / Markdown URL 改写
- `src/lib/kb/notes.ts` — LLM 结构化笔记
- `src/pipeline/kb-stage.ts` — worker 阶段 `runKbStage`
- `src/app/favorite-button.tsx` — ⭐ 客户端组件
- `src/app/library/page.tsx`、`src/app/library/[id]/page.tsx`、`src/app/library/loading.tsx`
- 测试：`tests/lib/kb-reader.test.ts`、`tests/lib/kb-images.test.ts`、`tests/lib/kb-notes.test.ts`、`tests/integration/kb-stage.test.ts`、`tests/integration/favorites-query.test.ts`

**修改**
- `src/config.ts`（新增 env）
- `src/lib/usage.ts`（`UsageKind` 加 `"kb"`）
- `src/db/schema.ts`（`kbEntries` 表 + `items.favoritedAt`）+ 新 migration
- `src/pipeline/worker.ts`（挂 `runKbStage`）
- `src/app/feed-queries.ts`（`getFavorites` 取代 `getLiked`；`candidates` 增选 `is_favorited`；`Row` 加 `isFavorited`）
- `src/app/feed-item-data.ts`（`FeedItemData` 加 `isFavorited`；`toFeedData` 映射）
- `src/app/feed-list.tsx`（`FeedItem` 渲染 ⭐）
- `src/app/api/items/[id]/route.ts`（写 `favoritedAt`）
- `src/app/site-header.tsx`（导航 `/liked` → `/library`）
- `tests/integration/item-state-route.test.ts`（断言 `favoritedAt`）
- `package.json`（新依赖）
- 删除 `src/app/liked/page.tsx`、`src/app/liked/loading.tsx`

---

## Task 1: 依赖 + 配置 + usage 类型

**Files:**
- Modify: `package.json`
- Modify: `src/config.ts`
- Modify: `src/lib/usage.ts`

- [ ] **Step 1: 安装依赖**

Run:
```bash
cd "/Applications/vibe Coding/ai-signal" && npm i @aws-sdk/client-s3 react-markdown remark-gfm
```
Expected: 三个包写入 `package.json` dependencies。

- [ ] **Step 2: 在 `src/config.ts` 的 zod schema 末尾（`SUMMARY_MAX_ATTEMPTS` 那行后）追加 KB 配置**

```ts
  // --- Knowledge base (收藏 → KB) ---
  FIRECRAWL_API_KEY: z.string().default(""),
  R2_ACCOUNT_ID: z.string().default(""),
  R2_ACCESS_KEY_ID: z.string().default(""),
  R2_SECRET_ACCESS_KEY: z.string().default(""),
  R2_BUCKET: z.string().default(""),
  R2_PUBLIC_BASE_URL: z.string().default(""),
  KB_FETCH_LIMIT: z.coerce.number().default(5),
  KB_MAX_ATTEMPTS: z.coerce.number().default(3),
  KB_MAX_IMAGE_BYTES: z.coerce.number().default(5_000_000),
  KB_MIN_BODY_CHARS: z.coerce.number().default(400),
  KB_NOTE_INPUT_CHARS: z.coerce.number().default(12000),
```

- [ ] **Step 3: 在 `src/lib/usage.ts` 给 `UsageKind` 加 `"kb"`**

把：
```ts
export type UsageKind = "score" | "summarize" | "label" | "embed" | "merge";
```
改为：
```ts
export type UsageKind = "score" | "summarize" | "label" | "embed" | "merge" | "kb";
```

- [ ] **Step 4: typecheck**

Run: `cd "/Applications/vibe Coding/ai-signal" && npm run typecheck`
Expected: 通过（无新错误）。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/config.ts src/lib/usage.ts
git commit -m "feat(kb): add deps, config, usage kind for knowledge base"
```

---

## Task 2: 数据模型 `kb_entries` + `items.favoritedAt` + 迁移与回填

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/<generated>.sql`（drizzle 生成 + 手动追加回填）

- [ ] **Step 1: 在 `src/db/schema.ts` 的 `items` 定义里，`isFavorited` 那行后加一列**

```ts
  isFavorited: boolean("is_favorited").notNull().default(false),
  favoritedAt: timestamp("favorited_at", { withTimezone: true }),
```

- [ ] **Step 2: 在 `src/db/schema.ts` 文件末尾追加 `kbEntries` 表**

```ts
// 个人知识库条目：与 items 1:1。重内容（全文 Markdown、结构化笔记、图片清单）
// 独立成表，不污染 scores。仅对 isFavorited 条目由 runKbStage 生成。
export const kbEntries = pgTable("kb_entries", {
  itemId: bigint("item_id", { mode: "number" }).primaryKey(),
  status: text("status").notNull().default("pending"), // pending | ready | failed | skipped
  note: jsonb("note").notNull().default({}), // { overview, keypoints[], facts[], why, terms[{term,def}] }
  bodyMd: text("body_md").notNull().default(""), // 正文 Markdown（图片 URL 已改写为 R2）
  bodySource: text("body_source").notNull().default(""), // firecrawl | markdownnew | extractor | fallback
  images: jsonb("images").notNull().default([]), // [{ srcUrl, r2Url, bytes, contentType }]
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});
```

- [ ] **Step 3: 生成迁移**

Run:
```bash
cd "/Applications/vibe Coding/ai-signal" && DATABASE_URL=postgres://aisignal:aisignal@localhost:5432/aisignal npm run db:generate
```
Expected: `src/db/migrations/` 新增一个 `NNNN_*.sql`（建 `kb_entries`、给 `items` 加 `favorited_at`）。

- [ ] **Step 4: 在新生成的迁移 SQL 文件末尾，手动追加历史 👍 回填**

打开刚生成的 `src/db/migrations/NNNN_*.sql`，在文件最后追加：
```sql
--> statement-breakpoint
UPDATE items SET is_favorited = true, favorited_at = now()
WHERE id IN (SELECT DISTINCT item_id FROM feedback WHERE signal = 'up');
```

- [ ] **Step 5: 本地应用迁移**

Run:
```bash
cd "/Applications/vibe Coding/ai-signal" && DATABASE_URL=postgres://aisignal:aisignal@localhost:5432/aisignal npm run db:migrate
```
Expected: `kb_entries` 表创建、`items.favorited_at` 列存在；无报错。

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/migrations
git commit -m "feat(kb): kb_entries table, items.favorited_at, backfill liked items"
```

---

## Task 3: PATCH 路由写 `favoritedAt`（TDD）

**Files:**
- Modify: `src/app/api/items/[id]/route.ts`
- Modify: `tests/integration/item-state-route.test.ts`

- [ ] **Step 1: 扩展测试 `tests/integration/item-state-route.test.ts`，在文件末尾追加**

```ts
it("sets favorited_at when favoriting and clears it when unfavoriting", async () => {
  const { PATCH } = await import("../../src/app/api/items/[id]/route.js");
  const on = await PATCH(
    new Request(`http://x/api/items/${id}`, { method: "PATCH", body: JSON.stringify({ isFavorited: true }) }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  expect(on.status).toBe(200);
  const [a] = await db.select().from(items).where(eq(items.id, id));
  expect(a!.favoritedAt).toBeInstanceOf(Date);

  const off = await PATCH(
    new Request(`http://x/api/items/${id}`, { method: "PATCH", body: JSON.stringify({ isFavorited: false }) }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  expect(off.status).toBe(200);
  const [b] = await db.select().from(items).where(eq(items.id, id));
  expect(b!.favoritedAt).toBeNull();
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd "/Applications/vibe Coding/ai-signal" && TEST_DATABASE_URL=postgres://aisignal:aisignal@localhost:5432/aisignal_test npm test -- item-state-route`
Expected: 新用例 FAIL（`favoritedAt` 为 null，因为路由还没写）。

> 注：测试库需已建并迁移。若未建：`createdb aisignal_test` 后 `DATABASE_URL=postgres://aisignal:aisignal@localhost:5432/aisignal_test npm run db:migrate`。

- [ ] **Step 3: 修改 `src/app/api/items/[id]/route.ts` 的 patch 组装逻辑**

把：
```ts
  const patch: Record<string, unknown> = {};
  if (parsed.data.isFavorited !== undefined) patch.isFavorited = parsed.data.isFavorited;
  if (Object.keys(patch).length === 0) return new Response("no-op", { status: 400 });
```
改为：
```ts
  const patch: Record<string, unknown> = {};
  if (parsed.data.isFavorited !== undefined) {
    patch.isFavorited = parsed.data.isFavorited;
    patch.favoritedAt = parsed.data.isFavorited ? new Date() : null;
  }
  if (Object.keys(patch).length === 0) return new Response("no-op", { status: 400 });
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd "/Applications/vibe Coding/ai-signal" && TEST_DATABASE_URL=postgres://aisignal:aisignal@localhost:5432/aisignal_test npm test -- item-state-route`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/items/[id]/route.ts tests/integration/item-state-route.test.ts
git commit -m "feat(kb): PATCH writes favorited_at on favorite toggle"
```

---

## Task 4: R2 客户端 `src/lib/kb/r2.ts`

**Files:**
- Create: `src/lib/kb/r2.ts`

- [ ] **Step 1: 写 `src/lib/kb/r2.ts`**

```ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "../../config.js";

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: "auto",
    endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

// True only when every R2 setting is present, so the image pipeline can skip
// uploads (and keep remote src) instead of throwing in a half-configured env.
export function r2Configured(): boolean {
  return Boolean(
    config.R2_ACCOUNT_ID && config.R2_ACCESS_KEY_ID &&
    config.R2_SECRET_ACCESS_KEY && config.R2_BUCKET && config.R2_PUBLIC_BASE_URL,
  );
}

export function publicUrl(key: string): string {
  return `${config.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<string> {
  await s3().send(new PutObjectCommand({
    Bucket: config.R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return publicUrl(key);
}
```

- [ ] **Step 2: typecheck**

Run: `cd "/Applications/vibe Coding/ai-signal" && npm run typecheck`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add src/lib/kb/r2.ts
git commit -m "feat(kb): Cloudflare R2 client wrapper"
```

---

## Task 5: 抽取链 `src/lib/kb/reader.ts`（TDD）

**Files:**
- Create: `src/lib/kb/reader.ts`
- Create: `tests/lib/kb-reader.test.ts`

- [ ] **Step 1: 写失败测试 `tests/lib/kb-reader.test.ts`**

```ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Firecrawl needs a key to be attempted; set it for these tests.
beforeEach(() => { process.env.FIRECRAWL_API_KEY = "fc-test"; });
afterEach(() => { vi.restoreAllMocks(); delete process.env.FIRECRAWL_API_KEY; });

function mockFetchSequence(handlers: Array<(url: string) => Response | Promise<Response>>) {
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    const h = handlers[Math.min(i, handlers.length - 1)]!;
    i++;
    return h(url);
  }));
}

it("returns firecrawl markdown + images when firecrawl succeeds", async () => {
  mockFetchSequence([
    () => new Response(JSON.stringify({ data: { markdown: "# Hi\n![a](http://x/a.png)", images: ["http://x/a.png"] } }), { status: 200 }),
  ]);
  const { fetchArticle } = await import("../../src/lib/kb/reader.js");
  const a = await fetchArticle("http://example.com/post", "fallback");
  expect(a.source).toBe("firecrawl");
  expect(a.markdown).toContain("# Hi");
  expect(a.images).toEqual(["http://x/a.png"]);
});

it("falls back to markdown.new when firecrawl fails, reading content + images", async () => {
  mockFetchSequence([
    () => new Response("err", { status: 500 }),              // firecrawl
    () => new Response(JSON.stringify({ success: true, content: "# Doc\n![cap](http://y/i.jpg)" }), { status: 200 }), // markdown.new
  ]);
  const { fetchArticle } = await import("../../src/lib/kb/reader.js");
  const a = await fetchArticle("http://example.com/post", "fallback");
  expect(a.source).toBe("markdownnew");
  expect(a.images).toEqual(["http://y/i.jpg"]);
});

it("falls back to provided text when url is null", async () => {
  const { fetchArticle } = await import("../../src/lib/kb/reader.js");
  const a = await fetchArticle(null, "raw text body");
  expect(a.source).toBe("fallback");
  expect(a.markdown).toBe("raw text body");
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd "/Applications/vibe Coding/ai-signal" && npm test -- kb-reader`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现 `src/lib/kb/reader.ts`**

```ts
import { config } from "../../config.js";
import { fetchFullText, isFetchableUrl } from "../fulltext.js";

export type ReaderSource = "firecrawl" | "markdownnew" | "extractor" | "fallback";
export interface Article { markdown: string; images: string[]; source: ReaderSource; }

const TIMEOUT_MS = 30_000;

function imageLinksFromMarkdown(md: string): string[] {
  return [...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]!).filter(Boolean);
}

async function fetchViaFirecrawl(url: string): Promise<Article | null> {
  if (!config.FIRECRAWL_API_KEY) return null;
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { authorization: `Bearer ${config.FIRECRAWL_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown", "images"] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: { markdown?: string; images?: string[] } };
  const markdown = data?.data?.markdown ?? "";
  if (!markdown.trim()) return null;
  const images = Array.isArray(data?.data?.images) ? data.data!.images! : imageLinksFromMarkdown(markdown);
  return { markdown, images, source: "firecrawl" };
}

// markdown.new — free, keyless, Cloudflare-backed (incl. headless-browser
// rendering for JS pages). POST returns JSON; markdown is in `content`, images
// inline when retain_images is set.
async function fetchViaMarkdownNew(url: string): Promise<Article | null> {
  const res = await fetch("https://markdown.new/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, retain_images: true }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { success?: boolean; content?: string };
  const markdown = data?.content ?? "";
  if (!data?.success || !markdown.trim()) return null;
  return { markdown, images: imageLinksFromMarkdown(markdown), source: "markdownnew" };
}

// Four-tier chain: Firecrawl → markdown.new → article-extractor (text only) →
// caller's fallback text. Each tier swallows its own errors so a single failure
// degrades to the next, never throwing out of fetchArticle.
export async function fetchArticle(url: string | null, fallbackText: string): Promise<Article> {
  if (url && isFetchableUrl(url)) {
    for (const fn of [fetchViaFirecrawl, fetchViaMarkdownNew]) {
      try {
        const a = await fn(url);
        if (a) return a;
      } catch {
        // try next tier
      }
    }
    try {
      const ft = await fetchFullText(url, "");
      if (ft.fetched && ft.text.trim()) return { markdown: ft.text, images: [], source: "extractor" };
    } catch {
      // fall through
    }
  }
  return { markdown: fallbackText ?? "", images: [], source: "fallback" };
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `cd "/Applications/vibe Coding/ai-signal" && npm test -- kb-reader`
Expected: 3 用例 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/kb/reader.ts tests/lib/kb-reader.test.ts
git commit -m "feat(kb): four-tier article reader chain (firecrawl/markdown.new/extractor/fallback)"
```

---

## Task 6: 图片管道 `src/lib/kb/images.ts`（TDD）

**Files:**
- Create: `src/lib/kb/images.ts`
- Create: `tests/lib/kb-images.test.ts`

- [ ] **Step 1: 写失败测试 `tests/lib/kb-images.test.ts`**

```ts
import { afterEach, expect, it, vi } from "vitest";

// Stub the R2 module so no network/S3 is touched; uploads return a fake URL.
vi.mock("../../src/lib/kb/r2.js", () => ({
  r2Configured: () => true,
  publicUrl: (k: string) => `https://cdn.test/${k}`,
  putObject: vi.fn(async (k: string) => `https://cdn.test/${k}`),
}));

afterEach(() => { vi.restoreAllMocks(); });

function imgResponse(bytes: number, contentType = "image/png") {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": contentType } });
}

it("flags noise images (cookie/icon/svg) regardless of host", async () => {
  const { isNoiseImage } = await import("../../src/lib/kb/images.js");
  expect(isNoiseImage("https://cdn-cookieyes.com/assets/images/close.svg")).toBe(true);
  expect(isNoiseImage("https://site.com/favicon.png")).toBe(true);
  expect(isNoiseImage("https://site.com/article/diagram.png")).toBe(false);
});

it("downloads a content image, uploads it, and rewrites the markdown URL", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => imgResponse(1000, "image/png")));
  const { localizeImages } = await import("../../src/lib/kb/images.js");
  const md = "before ![cap](https://site.com/a/diagram.png) after";
  const out = await localizeImages(42, md, ["https://site.com/a/diagram.png"]);
  expect(out.images).toHaveLength(1);
  expect(out.images[0]!.r2Url).toContain("https://cdn.test/kb/42/");
  expect(out.markdown).toContain("https://cdn.test/kb/42/");
  expect(out.markdown).not.toContain("site.com/a/diagram.png");
});

it("skips oversized images and keeps the original markdown url", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => imgResponse(10_000_000, "image/png")));
  const { localizeImages } = await import("../../src/lib/kb/images.js");
  const md = "![big](https://site.com/a/huge.png)";
  const out = await localizeImages(7, md, ["https://site.com/a/huge.png"]);
  expect(out.images).toHaveLength(0);
  expect(out.markdown).toBe(md);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd "/Applications/vibe Coding/ai-signal" && npm test -- kb-images`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现 `src/lib/kb/images.ts`**

```ts
import { createHash } from "node:crypto";
import { config } from "../../config.js";
import { isFetchableUrl } from "../fulltext.js";
import { putObject, r2Configured } from "./r2.js";

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
  "image/webp": "webp", "image/avif": "avif",
};

// UI chrome / tracking / icons that pollute extracted markdown. Dropped before
// download so the KB body keeps only real content images.
const NOISE = /(cookieyes|consent|sprite|favicon|\blogo\b|\bicon\b|pixel|analytics|\.svg(\?|$))/i;

const DOWNLOAD_TIMEOUT_MS = 15_000;

export interface StoredImage { srcUrl: string; r2Url: string; bytes: number; contentType: string; }

export function isNoiseImage(srcUrl: string): boolean {
  return NOISE.test(srcUrl);
}

export async function downloadAndStore(itemId: number, srcUrl: string): Promise<StoredImage | null> {
  if (!r2Configured() || !isFetchableUrl(srcUrl) || isNoiseImage(srcUrl)) return null;
  const res = await fetch(srcUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) return null;
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const ext = ALLOWED[contentType];
  if (!ext) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > config.KB_MAX_IMAGE_BYTES) return null;
  const key = `kb/${itemId}/${createHash("sha1").update(srcUrl).digest("hex")}.${ext}`;
  const r2Url = await putObject(key, buf, contentType);
  return { srcUrl, r2Url, bytes: buf.byteLength, contentType };
}

// Download every unique content image, upload to R2, and replace its URL in the
// markdown body. Per-image failures are swallowed: the original remote URL stays
// in the markdown so the body is never broken.
export async function localizeImages(
  itemId: number, markdown: string, imageUrls: string[],
): Promise<{ markdown: string; images: StoredImage[] }> {
  const images: StoredImage[] = [];
  let md = markdown;
  for (const src of [...new Set(imageUrls)]) {
    const stored = await downloadAndStore(itemId, src).catch(() => null);
    if (stored) {
      images.push(stored);
      md = md.split(src).join(stored.r2Url);
    }
  }
  return { markdown: md, images };
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `cd "/Applications/vibe Coding/ai-signal" && npm test -- kb-images`
Expected: 3 用例 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/kb/images.ts tests/lib/kb-images.test.ts
git commit -m "feat(kb): image pipeline — filter, download, upload R2, rewrite markdown"
```

---

## Task 7: LLM 结构化笔记 `src/lib/kb/notes.ts`（TDD）

**Files:**
- Create: `src/lib/kb/notes.ts`
- Create: `tests/lib/kb-notes.test.ts`

- [ ] **Step 1: 写失败测试 `tests/lib/kb-notes.test.ts`**

```ts
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.restoreAllMocks(); });

it("parses the five-field note from the model JSON", async () => {
  const content = JSON.stringify({
    overview: "概述句。",
    keypoints: ["要点1", "要点2"],
    facts: ["72.6% FuncPass"],
    why: "值得记的理由。",
    terms: [{ term: "harness", def: "工具框架" }],
  });
  // No `usage` field → recordModelUsage returns early, keeping this test db-free.
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }),
  ));
  const { synthesizeNotes } = await import("../../src/lib/kb/notes.js");
  const note = await synthesizeNotes({ title: "T", markdown: "body" });
  expect(note.overview).toBe("概述句。");
  expect(note.keypoints).toEqual(["要点1", "要点2"]);
  expect(note.terms[0]).toEqual({ term: "harness", def: "工具框架" });
});

it("tolerates missing fields with safe defaults", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ overview: "只有概述" }) } }] }), { status: 200 }),
  ));
  const { synthesizeNotes } = await import("../../src/lib/kb/notes.js");
  const note = await synthesizeNotes({ title: "T", markdown: "body" });
  expect(note.overview).toBe("只有概述");
  expect(note.keypoints).toEqual([]);
  expect(note.facts).toEqual([]);
  expect(note.terms).toEqual([]);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd "/Applications/vibe Coding/ai-signal" && npm test -- kb-notes`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现 `src/lib/kb/notes.ts`**

```ts
import { z } from "zod";
import { config } from "../../config.js";
import { recordModelUsage, type OpenRouterUsage } from "../usage.js";

export interface KbNote {
  overview: string;
  keypoints: string[];
  facts: string[];
  why: string;
  terms: { term: string; def: string }[];
}

const TIMEOUT_MS = 90_000;

const schema = z.object({
  overview: z.string().catch(""),
  keypoints: z.array(z.string()).catch([]),
  facts: z.array(z.string()).catch([]),
  why: z.string().catch(""),
  terms: z.array(z.object({ term: z.string().catch(""), def: z.string().catch("") })).catch([]),
});

const SYSTEM = `你是一名资深 AI 资讯编辑。给你一篇文章，请用简体中文整理成结构化知识库笔记。
只返回 JSON：{"overview","keypoints","facts","why","terms"}。
- overview：2-4 句概述，抓住具体技术实质，不要套话。
- keypoints：3-6 条核心要点（字符串数组）。
- facts：关键数据 / 可验证结论（字符串数组）；没有就空数组。
- why：为什么这篇值得记、与读者的相关性，1-2 句。
- terms：出现的术语/人物/工具解释，元素为 {"term","def"}；没有就空数组。`;

export async function synthesizeNotes(input: { title: string; markdown: string }): Promise<KbNote> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${config.OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.SCORING_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `标题：${input.title}\n\n${input.markdown.slice(0, config.KB_NOTE_INPUT_CHARS)}` },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`notes ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[]; usage?: OpenRouterUsage };
  await recordModelUsage("kb", config.SCORING_MODEL, data.usage);
  return schema.parse(JSON.parse(data.choices[0]!.message.content));
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `cd "/Applications/vibe Coding/ai-signal" && npm test -- kb-notes`
Expected: 2 用例 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/kb/notes.ts tests/lib/kb-notes.test.ts
git commit -m "feat(kb): LLM structured-note synthesis"
```

---

## Task 8: worker 阶段 `src/pipeline/kb-stage.ts` + 接入循环（TDD）

**Files:**
- Create: `src/pipeline/kb-stage.ts`
- Modify: `src/pipeline/worker.ts`
- Create: `tests/integration/kb-stage.test.ts`

- [ ] **Step 1: 写失败测试 `tests/integration/kb-stage.test.ts`**

```ts
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { items, kbEntries } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";

vi.mock("../../src/db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/client.js")>();
  const { db, pool } = actual.makeDb(process.env.TEST_DATABASE_URL!);
  return { ...actual, db, pool };
});

// Stub the heavy lib modules so the stage test stays deterministic + offline.
vi.mock("../../src/lib/kb/reader.js", () => ({
  fetchArticle: vi.fn(async (_url: string | null, fallback: string) => ({
    markdown: fallback || "# Long body ".padEnd(600, "x"),
    images: [],
    source: "firecrawl",
  })),
}));
vi.mock("../../src/lib/kb/images.js", () => ({
  localizeImages: vi.fn(async (_id: number, md: string) => ({ markdown: md, images: [] })),
}));
vi.mock("../../src/lib/kb/notes.js", () => ({
  synthesizeNotes: vi.fn(async () => ({ overview: "ov", keypoints: ["k"], facts: [], why: "w", terms: [] })),
}));

async function makeItem(over: Partial<typeof items.$inferInsert> = {}) {
  const [row] = await db.insert(items).values({
    rawItemId: 1, source: "hn", title: "t", text: "x".repeat(600),
    contentHash: `h${Math.random()}`, createdAt: new Date(), isFavorited: true,
    favoritedAt: new Date(), ...over,
  }).returning();
  return row!.id;
}

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); vi.clearAllMocks(); });
afterAll(async () => { await pool.end(); });

it("processes a favorited item into a ready kb_entry", async () => {
  const id = await makeItem();
  const { runKbStage } = await import("../../src/pipeline/kb-stage.js");
  const n = await runKbStage(db);
  expect(n).toBe(1);
  const [k] = await db.select().from(kbEntries).where(eq(kbEntries.itemId, id));
  expect(k!.status).toBe("ready");
  expect((k!.note as any).overview).toBe("ov");
});

it("marks skipped when body is too short", async () => {
  const id = await makeItem({ text: "短" });
  const { fetchArticle } = await import("../../src/lib/kb/reader.js");
  (fetchArticle as any).mockResolvedValueOnce({ markdown: "短", images: [], source: "fallback" });
  const { runKbStage } = await import("../../src/pipeline/kb-stage.js");
  await runKbStage(db);
  const [k] = await db.select().from(kbEntries).where(eq(kbEntries.itemId, id));
  expect(k!.status).toBe("skipped");
});

it("does not pick non-favorited items", async () => {
  await makeItem({ isFavorited: false, favoritedAt: null });
  const { runKbStage } = await import("../../src/pipeline/kb-stage.js");
  expect(await runKbStage(db)).toBe(0);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd "/Applications/vibe Coding/ai-signal" && TEST_DATABASE_URL=postgres://aisignal:aisignal@localhost:5432/aisignal_test npm test -- kb-stage`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现 `src/pipeline/kb-stage.ts`**

```ts
import { eq, sql as dsql } from "drizzle-orm";
import { kbEntries } from "../db/schema.js";
import { config } from "../config.js";
import { fetchArticle } from "../lib/kb/reader.js";
import { localizeImages } from "../lib/kb/images.js";
import { synthesizeNotes } from "../lib/kb/notes.js";

type Db = any;

// State-poll stage (same shape as embed/summarize): pick favorited items that
// have no finished kb_entry yet and process them. Only ⭐ items reach here.
export async function runKbStage(db: Db): Promise<number> {
  const rows = await db.execute(dsql`
    SELECT i.id, i.title, i.url, i.text
    FROM items i
    LEFT JOIN kb_entries k ON k.item_id = i.id
    WHERE i.is_favorited = true
      AND (k.item_id IS NULL OR (k.status NOT IN ('ready','skipped') AND k.attempts < ${config.KB_MAX_ATTEMPTS}))
    ORDER BY i.favorited_at DESC NULLS LAST
    LIMIT ${config.KB_FETCH_LIMIT}
  `);
  const list = (rows.rows ?? rows) as Array<{ id: number; title: string; url: string | null; text: string }>;
  if (list.length === 0) return 0;

  let done = 0;
  for (const row of list) {
    const itemId = Number(row.id);
    try {
      await db.insert(kbEntries).values({ itemId, status: "pending" })
        .onConflictDoNothing({ target: kbEntries.itemId });

      const article = await fetchArticle(row.url, row.text ?? "");
      const { markdown, images } = await localizeImages(itemId, article.markdown, article.images);
      const enoughBody = markdown.trim().length >= config.KB_MIN_BODY_CHARS;
      const note = enoughBody ? await synthesizeNotes({ title: row.title, markdown }) : {};

      await db.update(kbEntries).set({
        bodyMd: markdown,
        bodySource: article.source,
        images,
        note,
        status: enoughBody ? "ready" : "skipped",
        processedAt: new Date(),
        error: null,
      }).where(eq(kbEntries.itemId, itemId));
      done++;
    } catch (err) {
      await db.update(kbEntries).set({
        attempts: dsql`${kbEntries.attempts} + 1`,
        status: dsql`CASE WHEN ${kbEntries.attempts} + 1 >= ${config.KB_MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END`,
        error: String(err).slice(0, 500),
      }).where(eq(kbEntries.itemId, itemId));
      console.error("kb stage error", itemId, err);
    }
  }
  return done;
}
```

- [ ] **Step 4: 接入 `src/pipeline/worker.ts`**

在 import 区加：
```ts
import { runKbStage } from "./kb-stage.js";
```
把 loop 体改为（在 `mergedTopics` 后加 `kb`，并计入空转判断）：
```ts
      const triaged = await runTriageStage(db);
      const embedded = await runEmbedStage(db);
      const summarized = await runSummarizeStage(db);
      const rssSummarized = await runRssSummarizeStage(db);
      const clustered = await runClusterStage(db, { threshold: 0.25 });
      const mergedTopics = await runTopicMergeStage(db);
      const kb = await runKbStage(db);
      if (triaged + embedded + summarized + rssSummarized + clustered + mergedTopics + kb === 0) {
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
```

- [ ] **Step 5: 运行，确认通过**

Run: `cd "/Applications/vibe Coding/ai-signal" && TEST_DATABASE_URL=postgres://aisignal:aisignal@localhost:5432/aisignal_test npm test -- kb-stage`
Expected: 3 用例 PASS。

- [ ] **Step 6: typecheck + commit**

```bash
cd "/Applications/vibe Coding/ai-signal" && npm run typecheck
git add src/pipeline/kb-stage.ts src/pipeline/worker.ts tests/integration/kb-stage.test.ts
git commit -m "feat(kb): worker stage to build knowledge-base entries for favorites"
```

---

## Task 9: 收藏查询 `getFavorites` + feed 带出 `isFavorited`（TDD）

**Files:**
- Modify: `src/app/feed-queries.ts`
- Modify: `src/app/feed-item-data.ts`
- Create: `tests/integration/favorites-query.test.ts`

- [ ] **Step 1: 写失败测试 `tests/integration/favorites-query.test.ts`**

```ts
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { items, kbEntries } from "../../src/db/schema.js";
import { db, pool, truncateAll } from "../setup/db.js";

vi.mock("../../src/db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/client.js")>();
  const { db, pool } = actual.makeDb(process.env.TEST_DATABASE_URL!);
  return { ...actual, db, pool };
});

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await pool.end(); });

it("returns favorited items newest-favorite-first with kb note + status", async () => {
  const base = { rawItemId: 1, source: "hn", title: "t", createdAt: new Date() };
  const [older] = await db.insert(items).values({ ...base, contentHash: "a", isFavorited: true, favoritedAt: new Date("2026-06-01") }).returning();
  const [newer] = await db.insert(items).values({ ...base, contentHash: "b", isFavorited: true, favoritedAt: new Date("2026-06-10") }).returning();
  await db.insert(items).values({ ...base, contentHash: "c", isFavorited: false }).returning();
  await db.insert(kbEntries).values({ itemId: newer!.id, status: "ready", note: { overview: "ov" } });

  const { getFavorites } = await import("../../src/app/feed-queries.js");
  const rows = await getFavorites(db, { limit: 50 });
  expect(rows.map((r) => r.id)).toEqual([newer!.id, older!.id]);
  expect(rows[0]!.status).toBe("ready");
  expect((rows[0]!.note as any).overview).toBe("ov");
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd "/Applications/vibe Coding/ai-signal" && TEST_DATABASE_URL=postgres://aisignal:aisignal@localhost:5432/aisignal_test npm test -- favorites-query`
Expected: FAIL（`getFavorites` 不存在）。

- [ ] **Step 3: 在 `src/app/feed-queries.ts` 用 `getFavorites` 取代 `getLiked`**

删除 `LikedRow` 接口与 `getLiked` 函数，替换为：
```ts
export interface FavoriteRow {
  id: number; title: string; titleZh: string; url: string | null; source: string;
  author: string | null; createdAt: string; favoritedAt: string | null;
  summaryZh: string; status: string | null; note: unknown;
}

// Items the user ⭐ saved to the knowledge base, newest-favorite first. Joins the
// kb_entry (may be null while the worker is still processing) for card preview.
export async function getFavorites(db: Db, opts: { limit: number }): Promise<FavoriteRow[]> {
  const res = await db.execute(sql`
    SELECT i.id, i.title, s.title_zh AS "titleZh", i.url, i.source, i.author AS "author",
           i.created_at AS "createdAt", i.favorited_at AS "favoritedAt",
           s.summary_zh AS "summaryZh",
           k.status AS "status", k.note AS "note"
    FROM items i
    LEFT JOIN scores s ON s.item_id = i.id
    LEFT JOIN kb_entries k ON k.item_id = i.id
    WHERE i.is_favorited = true
    ORDER BY i.favorited_at DESC NULLS LAST
    LIMIT ${opts.limit}
  `);
  return (res.rows ?? res) as FavoriteRow[];
}
```

- [ ] **Step 4: 让 feed `candidates` 带出 `isFavorited`**

在 `Row` 接口里加一行：
```ts
  signal: "up" | "down" | null;
  isFavorited: boolean;
```
在 `candidates` 的 SELECT 里，`i.author AS "author",` 同段加：
```ts
    SELECT i.id, i.title, s.title_zh AS "titleZh", i.url, i.source, i.author AS "author",
           i.is_favorited AS "isFavorited",
           i.created_at AS "createdAt", i.metrics,
```

- [ ] **Step 5: `src/app/feed-item-data.ts` 带出 `isFavorited`**

`FeedItemData` 接口加：
```ts
  signal: "up" | "down" | null;
  isFavorited: boolean;
```
`toFeedData` 返回对象里加：
```ts
    signal: item.signal === "up" || item.signal === "down" ? item.signal : null,
    isFavorited: item.isFavorited === true,
```

- [ ] **Step 6: 运行测试 + typecheck**

Run: `cd "/Applications/vibe Coding/ai-signal" && TEST_DATABASE_URL=postgres://aisignal:aisignal@localhost:5432/aisignal_test npm test -- favorites-query && npm run typecheck`
Expected: PASS；typecheck 通过。

- [ ] **Step 7: Commit**

```bash
git add src/app/feed-queries.ts src/app/feed-item-data.ts tests/integration/favorites-query.test.ts
git commit -m "feat(kb): getFavorites query + isFavorited on feed items"
```

---

## Task 10: ⭐ 收藏按钮组件 + 接入信号流卡片

**Files:**
- Create: `src/app/favorite-button.tsx`
- Modify: `src/app/feed-list.tsx`

- [ ] **Step 1: 写 `src/app/favorite-button.tsx`**

```tsx
"use client";

import { useState } from "react";

async function setFavorite(itemId: number, isFavorited: boolean) {
  const res = await fetch(`/api/items/${itemId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ isFavorited }),
  });
  if (!res.ok) throw new Error(`favorite failed: ${res.status}`);
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      className="star__icon"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2 15.09 8.26 22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2Z" />
    </svg>
  );
}

export function FavoriteButton({ itemId, initial = false }: { itemId: number; initial?: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (pending) return;
    const next = !on;
    setOn(next);
    setPending(true);
    try {
      await setFavorite(itemId, next);
    } catch {
      setOn(!next);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className="star"
      data-active={on}
      aria-pressed={on}
      aria-label={on ? "已存入知识库，点击移除" : "存入知识库"}
      title={on ? "已存入知识库" : "存入知识库"}
      disabled={pending}
      onClick={toggle}
    >
      <StarIcon filled={on} />
    </button>
  );
}
```

- [ ] **Step 2: 在 `src/app/feed-list.tsx` 引入并渲染**

文件顶部 import 区加：
```ts
import { FavoriteButton } from "./favorite-button.js";
```
在 `FeedItem` 的 `<span className="vote">…</span>` 之后、`</div>`（`item__meta`）之前插入：
```tsx
        <FavoriteButton itemId={data.id} initial={data.isFavorited} />
```

- [ ] **Step 3: typecheck**

Run: `cd "/Applications/vibe Coding/ai-signal" && npm run typecheck`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/app/favorite-button.tsx src/app/feed-list.tsx
git commit -m "feat(kb): ⭐ favorite button on signal-flow cards"
```

---

## Task 11: 收藏列表页 `/library` + 移除 `/liked` + 导航

**Files:**
- Create: `src/app/library/page.tsx`
- Create: `src/app/library/loading.tsx`
- Modify: `src/app/site-header.tsx`
- Delete: `src/app/liked/page.tsx`, `src/app/liked/loading.tsx`

- [ ] **Step 1: 写 `src/app/library/page.tsx`**

```tsx
import { db } from "../../db/client.js";
import { getFavorites } from "../feed-queries.js";
import { FavoriteButton } from "../favorite-button.js";
import { sourceLabel, relativeTime } from "../format.js";
import { hostOf } from "../feed-item-data.js";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending: "整理中…",
  ready: "",
  failed: "整理失败",
  skipped: "仅原文",
};

export default async function Library() {
  const rows = await getFavorites(db, { limit: 200 });
  const now = new Date();

  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">收藏</h1>
        <div className="page__tools">
          {rows.length > 0 && <span className="page__count">{rows.length} 条</span>}
        </div>
      </div>
      <p className="page__lead">
        点 ⭐ 存入的内容会在这里整理成知识库笔记，可点开看全文与结构化摘要。
      </p>

      {rows.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">知识库还是空的</p>
          <p className="placeholder__body">在信号流里点 ⭐ 把值得留存的内容存进来。</p>
        </div>
      ) : (
        <div className="results">
          {rows.map((item) => {
            const title = item.titleZh || item.title || "(无标题)";
            const host = hostOf(item.url ?? null);
            const note = (item.note ?? {}) as { overview?: string; keypoints?: string[] };
            const statusText = item.status ? STATUS_LABEL[item.status] ?? "" : "整理中…";
            const keypoints = Array.isArray(note.keypoints) ? note.keypoints.slice(0, 3) : [];
            return (
              <article key={item.id} className="item">
                <div className="item__top">
                  <a className="item__title" href={`/library/${item.id}`}>
                    {title}
                    {host && <span className="item__ext">{host}</span>}
                  </a>
                </div>
                {note.overview && <p className="item__summary">{note.overview}</p>}
                {!note.overview && item.summaryZh && <p className="item__summary">{item.summaryZh}</p>}
                {keypoints.length > 0 && (
                  <ul className="kb-card__points">
                    {keypoints.map((k, i) => (
                      <li key={i}>{k}</li>
                    ))}
                  </ul>
                )}
                <div className="item__meta">
                  <span className="item__source">{sourceLabel(item.source)}</span>
                  {item.createdAt && (
                    <>
                      <span className="meta-dot">·</span>
                      <span>{relativeTime(item.createdAt, now)}</span>
                    </>
                  )}
                  {statusText && (
                    <>
                      <span className="meta-dot">·</span>
                      <span className="kb-status" data-status={item.status ?? "pending"}>{statusText}</span>
                    </>
                  )}
                  <FavoriteButton itemId={item.id} initial={true} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: 写 `src/app/library/loading.tsx`（复刻 `src/app/suppressed/loading.tsx` 的骨架，先读它再照搬结构）**

Run（先看现有骨架样式）: 用 Read 打开 `src/app/suppressed/loading.tsx`，照其结构写 `src/app/library/loading.tsx`，标题文案改为「收藏」。例如：
```tsx
export default function Loading() {
  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">收藏</h1>
      </div>
      <div className="results">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton-item">
            <div className="skeleton-line" style={{ width: "60%" }} />
            <div className="skeleton-line" style={{ width: "90%", marginTop: 10 }} />
          </div>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: 改导航 `src/app/site-header.tsx`**

把：
```ts
  { href: "/liked", label: "收藏" },
```
改为：
```ts
  { href: "/library", label: "收藏" },
```

- [ ] **Step 4: 删除旧 `/liked` 页面**

Run:
```bash
cd "/Applications/vibe Coding/ai-signal" && rm -f src/app/liked/page.tsx src/app/liked/loading.tsx && rmdir src/app/liked 2>/dev/null || true
```

- [ ] **Step 5: typecheck**

Run: `cd "/Applications/vibe Coding/ai-signal" && npm run typecheck`
Expected: 通过（确认没有别处仍 import `getLiked` 或 `src/app/liked`）。

- [ ] **Step 6: 加最小样式（`kb-card__points` / `kb-status` / `star`）**

在全局样式表（与 `.vote` / `.item__summary` 同文件，先用 Grep 搜 `.vote__btn` 定位到 `src/app/globals.css` 之类）追加：
```css
.star { background: none; border: 0; cursor: pointer; color: var(--text-quaternary, #9a9a9a); padding: 4px; line-height: 0; }
.star[data-active="true"] { color: var(--accent, #594ff4); }
.star:disabled { opacity: .5; cursor: default; }
.kb-card__points { margin: 6px 0 0; padding-left: 18px; color: var(--text-secondary, #555); font-size: 13px; }
.kb-card__points li { margin: 2px 0; }
.kb-status[data-status="failed"] { color: #c0392b; }
.kb-status[data-status="pending"] { color: var(--text-tertiary, #888); }
```

> 注：变量名以现有 `globals.css` 实际定义为准；先 Read 该文件确认 token 名称再粘贴，避免引入未定义变量。

- [ ] **Step 7: Commit**

```bash
git add src/app/library src/app/site-header.tsx
git add -A src/app/liked 2>/dev/null || true
git commit -m "feat(kb): /library list page replaces /liked; nav + styles"
```

---

## Task 12: 收藏详情页 `/library/[id]`（reader 视图）

**Files:**
- Create: `src/app/library/[id]/page.tsx`

- [ ] **Step 1: 写 `src/app/library/[id]/page.tsx`**

```tsx
import { sql } from "drizzle-orm";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { db } from "../../../db/client.js";
import { sourceLabel, relativeTime } from "../../format.js";
import { hostOf } from "../../feed-item-data.js";
import { FavoriteButton } from "../../favorite-button.js";

export const dynamic = "force-dynamic";

interface DetailRow {
  id: number; title: string; titleZh: string; url: string | null; source: string;
  author: string | null; createdAt: string; isFavorited: boolean;
  status: string | null; note: any; bodyMd: string | null; bodySource: string | null;
}

async function getEntry(id: number): Promise<DetailRow | null> {
  const res = await db.execute(sql`
    SELECT i.id, i.title, s.title_zh AS "titleZh", i.url, i.source, i.author AS "author",
           i.created_at AS "createdAt", i.is_favorited AS "isFavorited",
           k.status AS "status", k.note AS "note", k.body_md AS "bodyMd", k.body_source AS "bodySource"
    FROM items i
    LEFT JOIN scores s ON s.item_id = i.id
    LEFT JOIN kb_entries k ON k.item_id = i.id
    WHERE i.id = ${id}
    LIMIT 1
  `);
  const rows = (res.rows ?? res) as DetailRow[];
  return rows[0] ?? null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="kb-note__sec">
      <h3 className="kb-note__h">{title}</h3>
      {children}
    </section>
  );
}

export default async function LibraryDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = await getEntry(Number(id));
  const now = new Date();

  if (!entry) {
    return (
      <main className="page">
        <div className="placeholder">
          <p className="placeholder__title">条目不存在</p>
          <p className="placeholder__body"><a href="/library">← 返回收藏</a></p>
        </div>
      </main>
    );
  }

  const title = entry.titleZh || entry.title || "(无标题)";
  const host = hostOf(entry.url ?? null);
  const note = (entry.note ?? {}) as {
    overview?: string; keypoints?: string[]; facts?: string[]; why?: string;
    terms?: { term: string; def: string }[];
  };
  const hasNote = entry.status === "ready" && (note.overview || (note.keypoints?.length ?? 0) > 0);

  return (
    <main className="page kb-detail">
      <p className="kb-detail__back"><a href="/library">← 收藏</a></p>

      <div className="kb-detail__head">
        <h1 className="kb-detail__title">{title}</h1>
        <div className="item__meta">
          <span className="item__source">{sourceLabel(entry.source)}</span>
          {entry.author && entry.source === "twitter" && (
            <><span className="meta-dot">·</span><span>@{entry.author}</span></>
          )}
          {entry.createdAt && (
            <><span className="meta-dot">·</span><span>{relativeTime(entry.createdAt, now)}</span></>
          )}
          {entry.url && (
            <><span className="meta-dot">·</span>
            <a href={entry.url} target="_blank" rel="noreferrer">原文{host ? `（${host}）` : ""} ↗</a></>
          )}
          <FavoriteButton itemId={entry.id} initial={entry.isFavorited} />
        </div>
      </div>

      {entry.status === "pending" || entry.status === null ? (
        <div className="notice" role="status">正在整理这篇内容，稍后刷新查看。</div>
      ) : entry.status === "failed" ? (
        <div className="notice" role="status">整理失败。可取消 ⭐ 再重新收藏以重试。</div>
      ) : null}

      {hasNote && (
        <div className="kb-note">
          {note.overview && <Section title="概述"><p>{note.overview}</p></Section>}
          {note.keypoints && note.keypoints.length > 0 && (
            <Section title="核心要点">
              <ul>{note.keypoints.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </Section>
          )}
          {note.facts && note.facts.length > 0 && (
            <Section title="关键数据 · 结论">
              <ul>{note.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </Section>
          )}
          {note.why && <Section title="为什么值得记"><p>{note.why}</p></Section>}
          {note.terms && note.terms.length > 0 && (
            <Section title="术语">
              <ul>{note.terms.map((t, i) => <li key={i}><strong>{t.term}</strong>：{t.def}</li>)}</ul>
            </Section>
          )}
        </div>
      )}

      {entry.bodyMd && (
        <div className="kb-body">
          <h2 className="kb-body__h">全文</h2>
          <div className="markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.bodyMd}</ReactMarkdown>
          </div>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: 加详情页样式**

在与 Task 11 同一全局样式文件追加（token 名以实际为准）：
```css
.kb-detail__back { margin: 0 0 12px; font-size: 13px; }
.kb-detail__title { font-size: 22px; line-height: 1.3; margin: 0 0 8px; }
.kb-note { background: var(--fill-tertiary, #f5f5f7); border-radius: 8px; padding: 16px; margin: 16px 0; }
.kb-note__sec { margin: 0 0 14px; }
.kb-note__sec:last-child { margin-bottom: 0; }
.kb-note__h { font-size: 13px; font-weight: 600; color: var(--accent, #594ff4); margin: 0 0 6px; }
.kb-note ul { margin: 0; padding-left: 18px; }
.kb-note li { margin: 2px 0; }
.kb-body { margin-top: 20px; }
.kb-body__h { font-size: 16px; font-weight: 600; margin: 0 0 10px; }
.markdown { line-height: 1.7; }
.markdown img { max-width: 100%; height: auto; border-radius: 6px; margin: 12px 0; }
.markdown h1, .markdown h2, .markdown h3 { margin: 20px 0 8px; }
.markdown p { margin: 10px 0; }
.markdown pre { overflow: auto; background: var(--fill-tertiary, #f5f5f7); padding: 12px; border-radius: 6px; }
```

- [ ] **Step 3: typecheck + 构建冒烟**

Run: `cd "/Applications/vibe Coding/ai-signal" && npm run typecheck && npm run build`
Expected: typecheck 通过；build 成功（确认 `react-markdown` 在 RSC 下可用）。

- [ ] **Step 4: Commit**

```bash
git add src/app/library/[id]
git commit -m "feat(kb): /library/[id] reader detail with structured notes + markdown body"
```

---

## Task 13: 全量回归 + 部署前清单

**Files:** 无（验证 + 文档）

- [ ] **Step 1: 跑全部测试**

Run: `cd "/Applications/vibe Coding/ai-signal" && TEST_DATABASE_URL=postgres://aisignal:aisignal@localhost:5432/aisignal_test npm test`
Expected: 全绿。

- [ ] **Step 2: typecheck + build**

Run: `cd "/Applications/vibe Coding/ai-signal" && npm run typecheck && npm run build`
Expected: 通过。

- [ ] **Step 3: 记录部署所需 env（写入 PR 描述 / 交接，不提交密钥）**

生产 `.env` 需新增：`FIRECRAWL_API_KEY`、`R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET`、`R2_PUBLIC_BASE_URL`。`KB_*` 用默认即可（markdown.new 免费 keyless，无需配置）。

> 部署后：迁移会自动把历史 👍（生产当前 4 条）标为 `isFavorited` 并回填 `favorited_at`，worker 下一轮开始为它们生成知识库条目。R2 桶需配公共读 + 自定义域，`R2_PUBLIC_BASE_URL` 指向该域。

---

## Self-Review（写计划后自检）

**1. Spec coverage**
- 数据模型 → Task 2 ✓；PATCH favoritedAt → Task 3 ✓；R2 → Task 4 ✓；抽取链 → Task 5 ✓；图片转存 → Task 6 ✓；LLM 笔记 → Task 7 ✓；worker 阶段 + 降级（skipped/failed）→ Task 7/8 ✓；getFavorites + feed isFavorited → Task 9 ✓；⭐ 按钮 → Task 10 ✓；列表页 + 迁移 nav → Task 11 ✓；详情页 markdown 渲染 → Task 12 ✓；配置/依赖 → Task 1 ✓；测试策略 → Task 3/5/6/7/8/9/13 ✓；历史迁移回填 → Task 2 ✓。B/C 明确不在范围。
- 安全：SSRF（复用 `isFetchableUrl`）→ Task 6 ✓；markdown 默认不渲染原始 HTML（不加 rehype-raw）→ Task 12 ✓。

**2. Placeholder scan**：无 TBD/TODO；样式 token 名标注「以实际 globals.css 为准」并要求先 Read 确认，非占位。

**3. Type consistency**：`ReaderSource`/`Article`（reader.ts）、`StoredImage`（images.ts）、`KbNote`（notes.ts）、`FavoriteRow`（feed-queries.ts）、`kbEntries` 列名（schema.ts）在各 Task 间一致；`runKbStage` 入参/返回、`fetchArticle`/`localizeImages`/`synthesizeNotes` 签名与 Task 8 调用一致；`UsageKind` 加 `"kb"` 与 notes.ts 的 `recordModelUsage("kb", …)` 一致。
