# 点赞收藏板块设计（Liked Collection）

**目标：** 把用户点过赞（👍 / `feedback.signal = 'up'`）的内容收录到一个独立板块，可随时回看，作为长期收藏夹。

**背景：** 信号流里每条内容已有 👍/👎 反馈按钮，写入 `feedback` 表。👍 目前主要服务于排序（在 `PROFILE_WINDOW_DAYS` 时间窗内提升相似内容的排名）。本需求复用这个 👍，不引入新的「收藏」动作，也不改数据模型。已有 `/suppressed`（已压制）页面是「独立板块」的成熟先例，本设计完全复刻其模式。

**技术栈：** Next.js App Router、React 19、TypeScript、drizzle-orm 原生 SQL、Postgres、vitest。

---

## 决策汇总（来自 brainstorming 澄清）

- **「点赞」语义**：复用现有 👍（`feedback.signal = 'up'`），不新增收藏动作、不动数据模型。
- **范围**：展示所有曾点过赞的条目，**不受 `PROFILE_WINDOW_DAYS` 时间窗限制**（长期收藏）。
- **排序**：按「最近一次点赞时间」倒序（收藏夹直觉）。
- **卡片操作**：与信号流一致的 👍/👎 按钮，但 👍 默认高亮（已点赞）；取消 👍 后刷新即从板块移除。
- **导航命名**：「收藏」，放在「信号流」右侧（最靠前、常用入口）。
- **卡片时间显示**：内容发布时间（与 `/suppressed` 一致，最简单）。

---

## 架构

复刻 `/suppressed` 模式，新增「收藏」板块：

- 新路由 `src/app/liked/page.tsx`：服务端组件，`export const dynamic = "force-dynamic"`，调用 `getLiked()` 渲染列表。
- 新查询 `getLiked()`：放进 `src/app/feed-queries.ts`，与 `getSuppressed()` 并排。
- `FeedbackButtons` 增加可选 `initialSignal` 属性，让 👍 在收藏页默认高亮。
- `site-header.tsx` 导航新增入口「收藏」→ `/liked`，置于「信号流」右侧。
- 新增 `src/app/liked/loading.tsx`：骨架屏，复刻 `src/app/suppressed/loading.tsx`。

---

## 文件结构

- `src/app/feed-queries.ts`
  - 新增 `getLiked(db, { limit })`，返回可直接渲染的行（含 `likedAt`）。
- `tests/integration/feed-queries.test.ts`
  - 扩展集成测试，覆盖 `getLiked` 的去重、排除 down、按点赞时间倒序、`limit`、`is_archived` 过滤。
- `src/app/liked/page.tsx`
  - 新页面，列出收藏条目，卡片样式与 `/suppressed` 一致。
- `src/app/liked/loading.tsx`
  - 加载骨架屏，复刻 `suppressed/loading.tsx`。
- `src/app/feedback-buttons.tsx`
  - 新增可选 `initialSignal?: Signal | null`（默认 `null`）。信号流与已压制页不传，行为不变；收藏页传 `"up"`。
- `src/app/site-header.tsx`
  - 导航数组在「信号流」之后插入 `{ href: "/liked", label: "收藏" }`。

不需要数据库迁移：`feedback` 表与 `items.is_archived` 均已存在。

---

## 数据流与查询

`getLiked()` 直接产出渲染所需字段，按 `itemId` 去重、按最近点赞时间倒序：

```sql
SELECT i.id, i.title, s.title_zh AS "titleZh", i.url, i.source, i.author AS "author",
       i.created_at AS "createdAt", i.metrics,
       s.summary_zh AS "summaryZh", s.summary_en AS "summaryEn",
       s.topic_tags AS "topicTags", s.reason,
       f.liked_at AS "likedAt"
FROM items i
JOIN scores s ON s.item_id = i.id
JOIN (
  SELECT item_id, max(created_at) AS liked_at
  FROM feedback
  WHERE signal = 'up'
  GROUP BY item_id
) f ON f.item_id = i.id
WHERE i.is_archived = false
ORDER BY f.liked_at DESC
LIMIT ${limit}
```

要点：

- **去重**：`feedback` 表对 `(item_id, signal)` 无唯一约束，同一条可能有多行 up；用 `GROUP BY item_id` + `max(created_at)` 折叠为一条。
- **排序**：按 `liked_at` 倒序，最近点赞的在最上。
- **不计算 ranking 分数**：本板块不按分数排，省去相似度子查询（`maxLikeSim` 等），查询更轻。
- **范围**：不加时间窗过滤，覆盖所有历史点赞。
- **`is_archived = false`**：与 `/suppressed` 及信号流保持一致。
- `limit`：页面传入一个保守上限（建议 200，个人量级足够）。

### 函数签名

```ts
export async function getLiked(db: Db, opts: { limit: number }): Promise<LikedRow[]>;
```

`LikedRow` 为上面 SELECT 的列形状（与 `/suppressed` 渲染所用字段一致，外加 `likedAt`，当前 UI 不展示 `likedAt`，但保留以备后续切换为「收藏于 X」显示）。

---

## 页面与组件

### `src/app/liked/page.tsx`

- 结构复刻 `src/app/suppressed/page.tsx`：`page__head` 标题「收藏」、`page__count`、`page__lead` 说明文案、列表 `results`。
- 每张卡片渲染：标题（链接到 `item.url`，外站标记 host）、`summaryZh`、来源标签、发布时间相对值、`<FeedbackButtons itemId={item.id} initialSignal="up" />`。
- 标题文案与导航一致：「收藏」。

### 空状态

```
标题：还没有收藏
正文：在信号流里点 👍 的内容会收录到这里，方便长期回看。
```

### `FeedbackButtons` 增强

```ts
export function FeedbackButtons({
  itemId,
  initialSignal = null,
}: {
  itemId: number;
  initialSignal?: Signal | null;
}) {
  const [active, setActive] = useState<Signal | null>(initialSignal);
  // ...其余不变
}
```

- 收藏页传 `initialSignal="up"`：进入即高亮 👍。
- 取消 👍 调用现有 `DELETE /api/feedback`（按 `itemId + signal='up'` 删除全部匹配行），刷新后该条从收藏板块消失。
- 其它调用点（信号流、已压制）不传该属性，默认 `null`，行为完全不变。

### `site-header.tsx`

`NAV` 数组在 `{ href: "/", label: "信号流" }` 之后插入 `{ href: "/liked", label: "收藏" }`。`isActive` 逻辑对 `/liked` 走 `startsWith` 分支，无需改动。

---

## 错误处理

- 服务端组件查询失败由 Next 的 error 边界（`src/app/error.tsx`）兜底，与其它页面一致，无需额外处理。
- 反馈写入/删除沿用现有 `FeedbackButtons` 的乐观更新与失败回滚逻辑（出错时回退状态并显示「未保存，重试」）。

---

## 测试

集成测试（扩展 `tests/integration/feed-queries.test.ts`，复用其 `insertScoredItem` 等辅助）：

1. 有 up 反馈的条目进入 `getLiked` 结果；只有 down 反馈的条目被排除；无任何反馈的条目被排除。
2. 同一条目两次 up 反馈，结果中只出现一次（去重）。
3. 多条目按「最近一次点赞时间」倒序返回。
4. `limit` 生效（超出部分被截断）。
5. `is_archived = true` 的条目被排除。

`FeedbackButtons` 的 `initialSignal` 属性改动很小，且无现成组件测试栈，故不单独加组件测试，靠类型检查与人工/浏览器冒烟覆盖。

---

## 不做（YAGNI）

- 不新增独立「收藏」数据动作或 `items.isFavorited` 用法（按决策复用 👍）。
- 不做分页/无限滚动（个人量级，固定 `limit` 足够）。
- 不在信号流回显已点赞状态（超出本需求范围，仅在收藏页通过 `initialSignal` 处理）。
- 不显示 ranking 分数/强度（本板块按点赞时间排序）。
