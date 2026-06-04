# Reddit / Twitter 数据接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 reddit/twitter 的 digest 源数据在 digest 产出时顺带推送进 ai-signal，并使其热度/打分真正生效。

**Architecture:** digest skill 的 `collect.mjs` 采完后把**原始**条目 opt-in/best-effort POST 到 ai-signal 的 `POST /api/ingest`；服务端 `mapDigestItems()` 把 raw 映射为 `RawPayload` 再 `ingest()`（靠 `raw_items` 唯一约束去重）。twitter 用单一 kind + `feed` 标记（following/for-you 带信任先验），reddit 也带 `feed` 标记（hot/new，仅溯源）。删除被取代的 `mac-collect` 游标扫描。

**Tech Stack:** TypeScript / Next.js（App Router）/ drizzle-orm / Postgres / zod / vitest；skill 侧为纯 Node ESM（`collect.mjs`，无三方依赖，运行时 node v25 内置 `fetch`）。

Spec: `docs/superpowers/specs/2026-06-04-reddit-twitter-ingestion-design.md`

---

## File Structure

ai-signal 仓库（TDD，有 vitest）：

- `src/types.ts` — 修改：`RawPayload` / `NormalizedItem` 增加可选 `feed`。
- `src/lib/normalize.ts` — 修改：`normalizeRawItem` 透传 `feed`。
- `src/lib/sources/digest-map.ts` — **新建**：`tweetTitle`、`mapDigestItems`（reddit/twitter raw → `RawPayload`）。
- `src/lib/sources/trust.ts` — 修改：`sourceTrust` 加 `feed` 参数（twitter following/for-you 先验）。
- `src/pipeline/triage.ts` — 修改：调用 `sourceTrust(n.source, n.url, n.feed)`。
- `src/lib/scoring/platform-heat.ts` — 修改：`engagementOf("reddit")` 读 `score`。
- `src/app/api/ingest/route.ts` — 修改：接收原始条目，服务端映射。
- 测试：新建 `tests/lib/digest-map.test.ts`；修改 `tests/lib/normalize.test.ts`、`tests/lib/trust.test.ts`、`tests/lib/platform-heat.test.ts`、`tests/integration/ingest-route.test.ts`。
- 删除：`bin/mac-collect.ts`、`src/collectors/mac-cursor.ts`、`tests/lib/mac-cursor.test.ts`、`deploy/launchd/com.aisignal.mac-collect.plist`。
- 文档：`deploy/README.md`（§6 改写）、`.env.example`（注释）。

skill 侧（**在 ai-signal 仓库之外**：`~/.hermes/...`，按自身是否版本化决定提交方式）：

- `~/.hermes/skills/digest/opencli-reddit-digest/scripts/collect.mjs` — 加 `postIngest` 并接入 `main()`。
- `~/.hermes/skills/digest/opencli-twitter-digest/scripts/collect.mjs` — 同上。
- `~/.hermes/scripts/opencli_reddit_ainews_collect.sh`、`opencli_reddit_ainews_new_collect.sh`、`opencli_twitter_following_collect.sh`、`opencli_twitter_for_you_collect.sh` — source `~/.hermes/digest-ingest.env`。
- 两个 `SKILL.md` — 增补「可选 ingest 推送」小节。

> 注：feed 时排序在 `src/app/feed-queries.ts:54` 也调用了 `sourceTrust(row.source, row.url)`，但 `items` 表无 `feed` 列且 `platformHeat` 对 twitter/reddit 不使用 trust（仅 rss 分支用）。**该处不改**，twitter 信任先验只在 triage 时影响 Q/composite。

---

## Task 1: `feed` 字段贯通 types + normalize

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/normalize.ts`
- Test: `tests/lib/normalize.test.ts`

- [ ] **Step 1: 写失败测试（feed 透传）**

在 `tests/lib/normalize.test.ts` 的 `describe` 内追加：

```ts
  it("passes through the optional feed provenance", () => {
    const n = normalizeRawItem({ ...raw, feed: "following" });
    expect(n.feed).toBe("following");
  });
  it("leaves feed undefined when absent", () => {
    expect(normalizeRawItem(raw).feed).toBeUndefined();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/lib/normalize.test.ts`
Expected: FAIL（`RawPayload` 无 `feed` 字段的类型错误 / `n.feed` 为 undefined 不符）。

- [ ] **Step 3: 给 types 加 `feed`**

修改 `src/types.ts`，在 `RawPayload` 与 `NormalizedItem` 各加一行：

```ts
export interface RawPayload {
  source: SourceKind;
  externalId: string;
  url: string | null;
  author: string | null;
  title: string;
  text: string;
  createdAt: string; // ISO 8601
  metrics: Record<string, number>;
  feed?: string; // provenance: reddit hot/new, twitter following/for-you
  raw: unknown;
}

export interface NormalizedItem {
  source: SourceKind;
  url: string | null;
  canonicalUrl: string | null;
  author: string | null;
  title: string;
  text: string;
  createdAt: Date;
  metrics: Record<string, number>;
  feed?: string;
  contentHash: string;
}
```

- [ ] **Step 4: normalize 透传 feed**

修改 `src/lib/normalize.ts` 的 return：

```ts
export function normalizeRawItem(raw: RawPayload): NormalizedItem {
  const title = raw.title.trim();
  const text = (raw.text ?? "").trim();
  return {
    source: raw.source,
    url: raw.url,
    canonicalUrl: canonicalizeUrl(raw.url),
    author: raw.author,
    title,
    text,
    createdAt: new Date(raw.createdAt),
    metrics: raw.metrics ?? {},
    ...(raw.feed ? { feed: raw.feed } : {}),
    contentHash: contentHash({ title, text }),
  };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run tests/lib/normalize.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/types.ts src/lib/normalize.ts tests/lib/normalize.test.ts
git commit -m "feat(ingest): thread optional feed provenance through types + normalize"
```

---

## Task 2: digest 映射模块（`mapDigestItems` + `tweetTitle`）

**Files:**
- Create: `src/lib/sources/digest-map.ts`
- Test: `tests/lib/digest-map.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/lib/digest-map.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { mapDigestItems, tweetTitle } from "../../src/lib/sources/digest-map.js";

describe("mapDigestItems reddit", () => {
  it("maps a reddit post (score/comments) + feed + epoch createdAt", () => {
    const [p] = mapDigestItems("reddit", "hot", [{
      id: "abc", title: "Hello", author: "u", score: 12, comments: 3,
      url: "https://reddit.com/x", created_utc: 1780000000, selftext: "body",
    }]);
    expect(p).toMatchObject({
      source: "reddit", externalId: "abc", title: "Hello", text: "body",
      url: "https://reddit.com/x", author: "u",
      metrics: { score: 12, comments: 3 }, feed: "hot",
    });
    expect(p.createdAt).toBe(new Date(1780000000 * 1000).toISOString());
  });
  it("skips items missing id or title", () => {
    expect(mapDigestItems("reddit", "new", [{ title: "no id" }, { id: "x" }])).toHaveLength(0);
  });
});

describe("mapDigestItems twitter", () => {
  it("maps a tweet (replies in metrics) + feed + parses twitter date", () => {
    const [p] = mapDigestItems("twitter", "following", [{
      id: "1", author: "alice", text: "hi there",
      likes: 4, retweets: 2, replies: 1,
      created_at: "Thu Jun 04 12:54:33 +0000 2026",
      url: "https://x.com/alice/status/1",
    }]);
    expect(p).toMatchObject({
      source: "twitter", externalId: "1", author: "alice",
      text: "hi there", title: "hi there",
      metrics: { likes: 4, retweets: 2, replies: 1 }, feed: "following",
    });
    expect(p.createdAt).toBe("2026-06-04T12:54:33.000Z");
  });
  it("skips tweets missing id or text", () => {
    expect(mapDigestItems("twitter", "for-you", [{ text: "no id" }, { id: "x" }])).toHaveLength(0);
  });
});

describe("tweetTitle", () => {
  it("returns short text unchanged", () => {
    expect(tweetTitle("short tweet")).toBe("short tweet");
  });
  it("collapses newlines / repeated whitespace", () => {
    expect(tweetTitle("line1\n\nline2   tabs\there")).toBe("line1 line2 tabs here");
  });
  it("truncates long text on a word boundary with an ellipsis", () => {
    const t = tweetTitle("word ".repeat(40).trim()); // 199 chars
    expect(t.endsWith("word…")).toBe(true);
    expect(Array.from(t).length).toBeLessThanOrEqual(121);
  });
  it("never splits an emoji at the boundary", () => {
    const t = tweetTitle("😀".repeat(200)).replace("…", "");
    expect(Array.from(t).every((c) => c === "😀")).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/lib/digest-map.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `digest-map.ts`**

新建 `src/lib/sources/digest-map.ts`：

```ts
import type { RawPayload, SourceKind } from "../../types.js";

interface RedditRaw {
  id?: string; postId?: string; title?: string; author?: string | null;
  score?: number; ups?: number; comments?: number; num_comments?: number;
  url?: string | null; created_utc?: number; selftext?: string;
}
interface TwitterRaw {
  id?: string; text?: string; author?: string | null; url?: string | null;
  created_at?: string; likes?: number; retweets?: number; replies?: number;
}

// Tweets have no title, but items.title is NOT NULL — synthesize a short
// headline. Collapse whitespace, cap at ~120 code points on a word boundary,
// add an ellipsis, and never split an emoji (surrogate pair).
export function tweetTitle(text: string): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  const chars = Array.from(s); // code points → never splits a surrogate pair
  if (chars.length <= 120) return s;
  let cut = chars.slice(0, 120).join("");
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace >= 80) cut = cut.slice(0, lastSpace);
  return cut.trimEnd() + "…";
}

function mapRedditItem(r: RedditRaw, feed?: string): RawPayload | null {
  const externalId = r.id ?? r.postId;
  const title = (r.title ?? "").trim();
  if (!externalId || !title) return null;
  return {
    source: "reddit",
    externalId,
    url: r.url ?? null,
    author: r.author ?? null,
    title,
    text: r.selftext ?? "",
    createdAt: new Date((r.created_utc ?? 0) * 1000).toISOString(),
    metrics: { score: r.score ?? r.ups ?? 0, comments: r.comments ?? r.num_comments ?? 0 },
    ...(feed ? { feed } : {}),
    raw: r,
  };
}

function mapTwitterItem(t: TwitterRaw, feed?: string): RawPayload | null {
  const externalId = t.id;
  const text = (t.text ?? "").trim();
  if (!externalId || !text) return null;
  const d = t.created_at ? new Date(t.created_at) : new Date(NaN);
  return {
    source: "twitter",
    externalId,
    url: t.url ?? null,
    author: t.author ?? null,
    title: tweetTitle(text),
    text,
    createdAt: isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(),
    metrics: { likes: t.likes ?? 0, retweets: t.retweets ?? 0, replies: t.replies ?? 0 },
    ...(feed ? { feed } : {}),
    raw: t,
  };
}

export function mapDigestItems(
  source: SourceKind,
  feed: string | undefined,
  items: unknown[],
): RawPayload[] {
  const out: RawPayload[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const mapped =
      source === "reddit" ? mapRedditItem(raw as RedditRaw, feed)
      : source === "twitter" ? mapTwitterItem(raw as TwitterRaw, feed)
      : null;
    if (mapped) out.push(mapped);
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/lib/digest-map.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/sources/digest-map.ts tests/lib/digest-map.test.ts
git commit -m "feat(ingest): server-side digest->RawPayload mapper (reddit/twitter)"
```

---

## Task 3: twitter feed 信任先验

**Files:**
- Modify: `src/lib/sources/trust.ts`
- Modify: `src/pipeline/triage.ts:54`
- Test: `tests/lib/trust.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/lib/trust.test.ts` 的 `describe("sourceTrust", ...)` 内追加：

```ts
  it("twitter following is trusted higher than for-you", () => {
    expect(sourceTrust("twitter", null, "following")).toBeCloseTo(0.6, 5);
    expect(sourceTrust("twitter", null, "for-you")).toBeCloseTo(0.45, 5);
    expect(sourceTrust("twitter", null)).toBeCloseTo(0.5, 5);
  });
  it("reddit feed (hot/new) does not change trust", () => {
    expect(sourceTrust("reddit", null, "hot")).toBeCloseTo(0.5, 5);
    expect(sourceTrust("reddit", null, "new")).toBeCloseTo(0.5, 5);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/lib/trust.test.ts`
Expected: FAIL（`sourceTrust` 只接受 2 个参数 / following 返回 0.5 而非 0.6）。

- [ ] **Step 3: 实现 feed 先验**

修改 `src/lib/sources/trust.ts`（在 `KIND_DEFAULT` 后新增常量，并改签名）：

```ts
const KIND_DEFAULT: Record<string, number> = {
  hn: 0.5, reddit: 0.5, twitter: 0.5, rss: 0.6,
};

// Per-feed trust prior for twitter: your curated "following" timeline beats the
// algorithmic "for-you" feed (noisier → higher bar). Reddit hot/new are the
// same multireddit, so they intentionally share the kind default. Tunable.
const TWITTER_FEED_TRUST: Record<string, number> = {
  following: 0.6,
  "for-you": 0.45,
};

export function sourceTrust(source: string, url: string | null, feed?: string): number {
  if (url) {
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch { host = ""; }
    for (const h of HOST_TRUST) {
      if (host === h.match || host.endsWith(`.${h.match}`)) return h.trust;
    }
  }
  if (source === "twitter" && feed && feed in TWITTER_FEED_TRUST) {
    return TWITTER_FEED_TRUST[feed]!;
  }
  return KIND_DEFAULT[source] ?? 0.5;
}
```

- [ ] **Step 4: triage 透传 feed**

修改 `src/pipeline/triage.ts` 第 54 行：

```ts
    const trust = sourceTrust(n.source, n.url, n.feed);
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run tests/lib/trust.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/lib/sources/trust.ts src/pipeline/triage.ts tests/lib/trust.test.ts
git commit -m "feat(scoring): twitter following/for-you trust prior at triage"
```

---

## Task 4: 修复 reddit 热度字段

**Files:**
- Modify: `src/lib/scoring/platform-heat.ts:20`
- Test: `tests/lib/platform-heat.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/lib/platform-heat.test.ts` 的 `describe("engagementOf", ...)` 内追加：

```ts
  it("reddit falls back to score when ups is absent", () => {
    expect(engagementOf("reddit", { score: 50, comments: 3 })).toBe(50);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/lib/platform-heat.test.ts`
Expected: FAIL（当前 `engagementOf("reddit", {score:50})` 返回 0）。

- [ ] **Step 3: 实现修复**

修改 `src/lib/scoring/platform-heat.ts` 第 20 行：

```ts
    case "reddit": return metrics.ups ?? metrics.score ?? metrics.points ?? 0;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/lib/platform-heat.test.ts`
Expected: PASS（含原有 `ups` 用例）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/scoring/platform-heat.ts tests/lib/platform-heat.test.ts
git commit -m "fix(scoring): reddit heat reads digest 'score' (was always 0)"
```

---

## Task 5: ingest 路由接收原始条目并映射

**Files:**
- Modify: `src/app/api/ingest/route.ts`
- Test: `tests/integration/ingest-route.test.ts`（需要 Postgres + `TEST_DATABASE_URL`）

- [ ] **Step 1: 改测试为 POST 原始条目**

把 `tests/integration/ingest-route.test.ts` 的 `body` 与第二个用例替换为：

```ts
const body = JSON.stringify({
  source: "reddit",
  feed: "hot",
  items: [{
    id: "abc", title: "Post", author: "u",
    url: "https://reddit.com/abc", created_utc: 1780000000,
    score: 5, comments: 1, selftext: "",
  }],
});

it("rejects without bearer token", async () => {
  const { POST } = await importRoute();
  const res = await POST(new Request("http://x/api/ingest", { method: "POST", body }));
  expect(res.status).toBe(401);
});

it("maps raw reddit items and stores them", async () => {
  process.env.INGEST_TOKEN = "dev-token";
  const { POST } = await importRoute();
  const res = await POST(new Request("http://x/api/ingest", {
    method: "POST",
    headers: { authorization: "Bearer dev-token" },
    body,
  }));
  expect(res.status).toBe(200);
  const rows = await db.select().from(rawItems);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.payload).toMatchObject({
    source: "reddit", externalId: "abc", feed: "hot",
    metrics: { score: 5, comments: 1 },
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/integration/ingest-route.test.ts`
Expected: FAIL（当前路由把已映射 payload 当 raw → `id` 缺失 → 0 行）。
（若本机无测试库：`docker compose up -d db` 或设置 `TEST_DATABASE_URL` 指向可用库。）

- [ ] **Step 3: 改造路由**

把 `src/app/api/ingest/route.ts` 整体替换为：

```ts
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../../db/client.js";
import { sources } from "../../../db/schema.js";
import { ingest } from "../../../ingest/ingest.js";
import { mapDigestItems } from "../../../lib/sources/digest-map.js";
import { config } from "../../../config.js";

export const dynamic = "force-dynamic";

// The digest skills POST RAW source items here; we map them server-side so the
// skills stay collect-only. (hn/rss ingest directly via bin/, not this route.)
const bodySchema = z.object({
  source: z.enum(["reddit", "twitter"]),
  feed: z.string().optional(),
  items: z.array(z.record(z.unknown())),
});

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${config.INGEST_TOKEN}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("bad request", { status: 400 });

  const { source, feed, items } = parsed.data;
  const payloads = mapDigestItems(source, feed, items);

  let [src] = await db.select().from(sources).where(eq(sources.kind, source));
  if (!src) [src] = await db.insert(sources).values({ kind: source }).returning();

  const inserted = await ingest({ db, sourceId: src!.id, payloads });
  // Record freshness so the dashboard's stale-source banner is accurate for
  // these Mac-pushed sources, which only arrive via this route.
  await db.update(sources).set({ lastRunAt: new Date() }).where(eq(sources.id, src!.id));
  return Response.json({ inserted, mapped: payloads.length });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/integration/ingest-route.test.ts`
Expected: PASS（401 + 映射入库各 1）。

- [ ] **Step 5: 提交**

```bash
git add src/app/api/ingest/route.ts tests/integration/ingest-route.test.ts
git commit -m "feat(ingest): /api/ingest accepts raw digest items, maps server-side"
```

---

## Task 6: reddit skill 推送（`collect.mjs`）

**Files:**
- Modify: `~/.hermes/skills/digest/opencli-reddit-digest/scripts/collect.mjs`

> 该文件在 ai-signal 仓库外。无对应 vitest；用离线 fixtures + 本地 mock 验证。改动需保证「未配置 env 时行为逐字不变」。

- [ ] **Step 1: runner 返回 items**

三处 runner 的成功返回值加 `items`：

`runSourceOpencli` 末尾（写完 `rawPath` 后）：
```js
  fs.writeFileSync(rawPath, JSON.stringify(items, null, 2), "utf8");
  return { raw_output_path: rawPath, raw_format: "json", item_count: items.length, status: "success", error: null, items };
```

`runSourceFixture` 末尾：
```js
  fs.writeFileSync(rawPath, JSON.stringify(items, null, 2), "utf8");
  return { raw_output_path: rawPath, raw_format: "json", item_count: items.length, status: "success", error: null, items };
```

`runMultireddit` 末尾：
```js
  fs.writeFileSync(rawPath, JSON.stringify(items, null, 2), "utf8");
  return { raw_output_path: rawPath, raw_format: "json", item_count: items.length, status: "success", error: null, items };
```

`writeFailure` 的返回也加 `items: []`（保持形状一致）：
```js
  return { raw_output_path: errorPath, raw_format: "json", item_count: 0, status: "failed", error, items: [] };
```

- [ ] **Step 2: 新增 `postIngest` 辅助**

在 `main()` 定义之前（如 `writeFailure` 之后）插入：

```js
// ---------------------------------------------------------------------------
// optional, best-effort push of collected items into ai-signal
// Opt-in: only runs when AI_SIGNAL_INGEST_URL + AI_SIGNAL_INGEST_TOKEN are set.
// Never throws, never changes the exit code; result goes in the summary line.
// ---------------------------------------------------------------------------
async function postIngest({ source, feed, items }) {
  const url = process.env.AI_SIGNAL_INGEST_URL;
  const token = process.env.AI_SIGNAL_INGEST_TOKEN;
  if (!url || !token) return { skipped: true };
  if (!Array.isArray(items) || items.length === 0) return { ok: true, posted: 0 };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(feed ? { source, feed, items } : { source, items }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, posted: items.length };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

async function pushIngest(sourceKind, sourceResults) {
  if (!process.env.AI_SIGNAL_INGEST_URL || !process.env.AI_SIGNAL_INGEST_TOKEN) return null;
  let posted = 0, failed = 0, lastErr = null;
  for (const sr of sourceResults) {
    if (sr.status !== "success" || !Array.isArray(sr.items) || sr.items.length === 0) continue;
    const r = await postIngest({ source: sourceKind, feed: sr.feed, items: sr.items });
    if (r.ok) posted += r.posted || 0;
    else if (!r.skipped) { failed++; lastErr = r.error; }
  }
  return failed ? `入库: ⚠️ 失败(${lastErr})` : `入库: ✅ ${posted} 条`;
}
```

- [ ] **Step 3: sourceResults 带 feed + items；main 改 async；接入推送**

把 reddit `main()` 的源循环 `sourceResults.push({...})` 改为（加 `feed` 与 `items`）：

```js
    sourceResults.push({
      source_id: sourceId,
      status: last.status || "failed",
      item_count: last.item_count || 0,
      raw_output_path: last.raw_output_path || null,
      error: last.error ?? null,
      feed: src.sort ?? null,
      items: last.items || [],
    });
```

把 `function main() {` 改为 `async function main() {`，并把结尾改为（在打印前算入库行）：

```js
  const ingestLine = await pushIngest("reddit", sourceResults);
  if (ingestLine) lines.push(ingestLine);
  lines.push(`输出: ${runRoot}`);
  process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

main();
```

（注意：`lines.push("输出: ...")` 这一行原本就在；把 `ingestLine` 插到它之前，不要重复 push。）

- [ ] **Step 4: 验证「未配置 → 行为不变」**

```bash
unset AI_SIGNAL_INGEST_URL AI_SIGNAL_INGEST_TOKEN
node ~/.hermes/skills/digest/opencli-reddit-digest/scripts/collect.mjs \
  --job reddit-ainews-daily \
  --fixtures-dir ~/.hermes/skills/digest/opencli-reddit-digest/tests/fixtures 2>/dev/null || true
```
Expected: 正常打印简报，**无 `入库:` 行**，exit 0。（若无 fixtures 目录，改用任一已存在的离线 fixtures，或跳到 Step 5 的真实采集做端到端验证。）

- [ ] **Step 5: 验证「配置 → 推送成功」（本地 mock）**

开一个一次性 mock 接收端（端口 8788）并指向它：

```bash
node -e 'require("http").createServer((q,s)=>{let b="";q.on("data",c=>b+=c);q.on("end",()=>{const j=JSON.parse(b||"{}");console.error("GOT",j.source,j.feed,(j.items||[]).length);s.end(JSON.stringify({inserted:(j.items||[]).length}))})}).listen(8788,()=>console.error("mock on 8788"))' &
AI_SIGNAL_INGEST_URL=http://127.0.0.1:8788 AI_SIGNAL_INGEST_TOKEN=dev-token \
  node ~/.hermes/skills/digest/opencli-reddit-digest/scripts/collect.mjs --job reddit-ainews-daily
```
Expected: mock 进程 stderr 打印 `GOT reddit hot <N>`；采集器简报末尾出现 `入库: ✅ <N> 条`，exit 0。（跑完 `kill %1` 关掉 mock。）

- [ ] **Step 6: 提交（若 skill 目录受版本控制）**

```bash
# 在 ~/.hermes 对应仓库内（若有）：
git -C ~/.hermes add skills/digest/opencli-reddit-digest/scripts/collect.mjs
git -C ~/.hermes commit -m "feat(reddit-digest): opt-in push of collected items to ai-signal"
```
（无版本控制则保存即可。）

---

## Task 7: twitter skill 推送（`collect.mjs`）

**Files:**
- Modify: `~/.hermes/skills/digest/opencli-twitter-digest/scripts/collect.mjs`

> twitter 的 runner 已返回 `items`（`runSourceFixture`/`runSourceOpencli` 经 `collectWithRefetch` 透传）。feed 取自 `src.mode`。

- [ ] **Step 1: 复制 `postIngest` + `pushIngest` 辅助**

把 Task 6 Step 2 的两个函数原样插入到 twitter `collect.mjs` 的 `main()` 之前（如 `saveState` 之后）。代码完全一致：

```js
async function postIngest({ source, feed, items }) {
  const url = process.env.AI_SIGNAL_INGEST_URL;
  const token = process.env.AI_SIGNAL_INGEST_TOKEN;
  if (!url || !token) return { skipped: true };
  if (!Array.isArray(items) || items.length === 0) return { ok: true, posted: 0 };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(feed ? { source, feed, items } : { source, items }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, posted: items.length };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

async function pushIngest(sourceKind, sourceResults) {
  if (!process.env.AI_SIGNAL_INGEST_URL || !process.env.AI_SIGNAL_INGEST_TOKEN) return null;
  let posted = 0, failed = 0, lastErr = null;
  for (const sr of sourceResults) {
    if (sr.status !== "success" || !Array.isArray(sr.items) || sr.items.length === 0) continue;
    const r = await postIngest({ source: sourceKind, feed: sr.feed, items: sr.items });
    if (r.ok) posted += r.posted || 0;
    else if (!r.skipped) { failed++; lastErr = r.error; }
  }
  return failed ? `入库: ⚠️ 失败(${lastErr})` : `入库: ✅ ${posted} 条`;
}
```

- [ ] **Step 2: sourceResults 带 feed + items**

把 twitter `main()` 的源循环 `sourceResults.push({...})`（约 626 行）改为：

```js
    sourceResults.push({
      source_id: sourceId,
      status: last.status || "failed",
      item_count: last.item_count || 0,
      raw_output_path: last.raw_output_path || null,
      error: last.error ?? null,
      feed: src.mode ?? null,
      items: last.items || [],
    });
```

- [ ] **Step 3: main 改 async + 接入推送**

把 `function main() {` 改为 `async function main() {`；把结尾的输出段改为（在 `输出:` 行之前插入入库行）：

```js
  lines.push(`窗口: ${window.started_at} → ${window.ended_at} (${winHours}h)`);
  const ingestLine = await pushIngest("twitter", sourceResults);
  if (ingestLine) lines.push(ingestLine);
  lines.push(`输出: ${runRoot}`);
  process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

main();
```

- [ ] **Step 4: 验证未配置 → 不变**

```bash
unset AI_SIGNAL_INGEST_URL AI_SIGNAL_INGEST_TOKEN
node ~/.hermes/skills/digest/opencli-twitter-digest/scripts/collect.mjs \
  --job twitter-following-daily \
  --fixtures-dir ~/.hermes/skills/digest/opencli-twitter-digest/tests/fixtures 2>/dev/null || true
```
Expected: 简报正常，无 `入库:` 行，exit 0。

- [ ] **Step 5: 验证配置 → 推送（mock，同 Task 6 Step 5）**

```bash
node -e 'require("http").createServer((q,s)=>{let b="";q.on("data",c=>b+=c);q.on("end",()=>{const j=JSON.parse(b||"{}");console.error("GOT",j.source,j.feed,(j.items||[]).length);s.end(JSON.stringify({inserted:(j.items||[]).length}))})}).listen(8788,()=>console.error("mock on 8788"))' &
AI_SIGNAL_INGEST_URL=http://127.0.0.1:8788 AI_SIGNAL_INGEST_TOKEN=dev-token \
  node ~/.hermes/skills/digest/opencli-twitter-digest/scripts/collect.mjs --job twitter-following-daily
kill %1
```
Expected: mock 打印 `GOT twitter following <N>`；简报出现 `入库: ✅ <N> 条`。

- [ ] **Step 6: 提交（若受版本控制，同 Task 6 Step 6）**

```bash
git -C ~/.hermes add skills/digest/opencli-twitter-digest/scripts/collect.mjs
git -C ~/.hermes commit -m "feat(twitter-digest): opt-in push of collected items to ai-signal"
```

---

## Task 8: cron 包装脚本 + `digest-ingest.env`

**Files:**
- Modify: `~/.hermes/scripts/opencli_reddit_ainews_collect.sh`
- Modify: `~/.hermes/scripts/opencli_reddit_ainews_new_collect.sh`
- Modify: `~/.hermes/scripts/opencli_twitter_following_collect.sh`
- Modify: `~/.hermes/scripts/opencli_twitter_for_you_collect.sh`

- [ ] **Step 1: 每个 wrapper 在 `exec` 之前 source env 文件**

在每个脚本里、`PATH="$(dirname "$NODE_BIN"):$PATH"` / `export PATH` 之后、`exec ...` 之前插入：

```bash
# Optional ai-signal ingest push (defines AI_SIGNAL_INGEST_URL / _TOKEN).
# Absent file => digests behave exactly as before (no push).
[ -f "$HOME/.hermes/digest-ingest.env" ] && . "$HOME/.hermes/digest-ingest.env"
```

- [ ] **Step 2: 创建 env 文件（真实值由你填）**

```bash
cat > "$HOME/.hermes/digest-ingest.env" <<'EOF'
export AI_SIGNAL_INGEST_URL="http://127.0.0.1:3000/api/ingest"
export AI_SIGNAL_INGEST_TOKEN="dev-token"
EOF
chmod 600 "$HOME/.hermes/digest-ingest.env"
```
（生产改成 VPS 地址，token 与 ai-signal 的 `INGEST_TOKEN` 一致。）

- [ ] **Step 3: 验证 wrapper 仍能跑通**

```bash
bash ~/.hermes/scripts/opencli_reddit_ainews_collect.sh
```
Expected: 与平时一致的简报；若 env 文件存在且 ai-signal 在跑，末尾出现 `入库: ✅`。

- [ ] **Step 4: 提交（若受版本控制）**

```bash
git -C ~/.hermes add scripts/opencli_reddit_ainews_collect.sh scripts/opencli_reddit_ainews_new_collect.sh scripts/opencli_twitter_following_collect.sh scripts/opencli_twitter_for_you_collect.sh
git -C ~/.hermes commit -m "feat(cron): source digest-ingest.env before collect for ai-signal push"
```
（`digest-ingest.env` 含密钥，**不要**提交。）

---

## Task 9: 删除旧 mac-collect + 文档

**Files:**
- Delete: `bin/mac-collect.ts`, `src/collectors/mac-cursor.ts`, `tests/lib/mac-cursor.test.ts`, `deploy/launchd/com.aisignal.mac-collect.plist`
- Modify: `deploy/README.md`（§6）、`.env.example`

- [ ] **Step 1: 删除四个文件**

```bash
git rm bin/mac-collect.ts src/collectors/mac-cursor.ts tests/lib/mac-cursor.test.ts deploy/launchd/com.aisignal.mac-collect.plist
```

- [ ] **Step 2: 改写 `deploy/README.md` 的 §6**

把「## 6. Mac collector ...」整节（标题 + Edit 段 + bash 块 + "It reads ..." 段）替换为：

````markdown
## 6. Twitter + Reddit ingestion — pushed by the digest skills (on your Mac)

The `opencli-twitter-digest` / `opencli-reddit-digest` skills push freshly
collected items to this app's `/api/ingest` on each run (opt-in, best-effort —
absent config = digests behave exactly as before).

On the Mac that produces the digests, create `~/.hermes/digest-ingest.env`
(chmod 600, never committed — it holds the token):

```bash
cat > ~/.hermes/digest-ingest.env <<'EOF'
export AI_SIGNAL_INGEST_URL="https://YOUR_VPS/api/ingest"
export AI_SIGNAL_INGEST_TOKEN="<same value as the app's INGEST_TOKEN>"
EOF
chmod 600 ~/.hermes/digest-ingest.env
```

The cron wrappers source this file before running, so each digest run also
ingests into the corpus. De-dup is handled by the `raw_items (source_id,
external_id)` constraint, so overlapping windows are safe. Requires the
logged-in x.com / reddit.com browser sessions the digests already depend on.
````

- [ ] **Step 3: 更新 `.env.example` 注释**

把：
```
# Ingest API (Mac collectors POST here)
INGEST_TOKEN=change-me-long-random
```
改为：
```
# Ingest API: the digest skills POST raw reddit/twitter items here.
# Their AI_SIGNAL_INGEST_TOKEN must equal this; AI_SIGNAL_INGEST_URL = <host>/api/ingest
INGEST_TOKEN=change-me-long-random
```

- [ ] **Step 4: typecheck + 全量测试**

Run: `pnpm typecheck && pnpm test`
Expected: 通过；无对 `mac-cursor`/`readDigestSince` 的悬空引用。
（若集成测试需库：先 `docker compose up -d db` 并设 `TEST_DATABASE_URL`。）

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "chore(ingest): drop obsolete mac-collect cursor scanner; document skill push"
```

---

## Task 10: 端到端验证

**Files:** 无（验证）

- [ ] **Step 1: 起库 + 迁移 + worker + 应用**

```bash
docker compose up -d db
pnpm db:migrate
INGEST_TOKEN=dev-token pnpm dev &          # 暴露 /api/ingest 于 :3000
INGEST_TOKEN=dev-token pnpm worker &        # triage/embed/score 循环
```

- [ ] **Step 2: 跑一次真实采集并推送**

```bash
AI_SIGNAL_INGEST_URL=http://127.0.0.1:3000/api/ingest AI_SIGNAL_INGEST_TOKEN=dev-token \
  node ~/.hermes/skills/digest/opencli-reddit-digest/scripts/collect.mjs --job reddit-ainews-daily
AI_SIGNAL_INGEST_URL=http://127.0.0.1:3000/api/ingest AI_SIGNAL_INGEST_TOKEN=dev-token \
  node ~/.hermes/skills/digest/opencli-twitter-digest/scripts/collect.mjs --job twitter-following-daily
```
Expected: 两次简报末尾均 `入库: ✅ <N> 条`。

- [ ] **Step 3: 校验入库与打分**

```bash
psql "$DATABASE_URL" -c "select kind,count(*) from sources s join raw_items r on r.source_id=s.id group by kind;"
psql "$DATABASE_URL" -c "select i.source, count(*), round(avg(sc.heat)::numeric,3) avg_heat from items i join scores sc on sc.item_id=i.id where i.source in ('reddit','twitter') group by i.source;"
```
Expected: `raw_items` 出现 reddit/twitter 行；worker 跑完后 `items`/`scores` 出现 reddit/twitter，且 `avg_heat > 0`（验证字段修复生效）。重复跑采集不应使 `raw_items` 计数翻倍（去重生效）。

- [ ] **Step 4: 收尾**

```bash
kill %1 %2 2>/dev/null || true   # 关 dev / worker
```

---

## Self-Review

**Spec coverage：**
- 触发=写进 skill → Task 6/7/8。
- 服务端映射（方案 A）→ Task 2 + Task 5。
- feed 标记（reddit hot/new、twitter following/for-you）→ Task 1/2 + skill Task 6/7。
- twitter 信任先验、reddit 不分流 → Task 3。
- reddit 热度字段修复 → Task 4。
- tweetTitle 干净截断 → Task 2。
- opt-in + best-effort → Task 6/7（`postIngest` 守卫 + 永不抛错）。
- env 文件 / wrapper → Task 8；token 复用 `INGEST_TOKEN` + `.env.example` → Task 9。
- 删除旧脚手架（含 plist + README §6）→ Task 9。
- 去重靠唯一约束 → Task 5（`ingest` 既有 `onConflictDoNothing`）+ Task 10 校验。

**Placeholder scan：** 无 TBD/TODO；每个 code step 均含完整代码与期望输出。

**Type consistency：** `mapDigestItems(source, feed, items)`、`sourceTrust(source, url, feed?)`、`postIngest({source,feed,items})`、`pushIngest(sourceKind, sourceResults)`、`tweetTitle(text)`、`RawPayload.feed`/`NormalizedItem.feed` 在各 task 间签名一致；`sr.feed`/`sr.items` 在 skill 端定义（Task 6/7 Step 3）后于 `pushIngest` 消费。
