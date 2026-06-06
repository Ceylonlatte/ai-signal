---
target: 今日信号 / feed 页面 (src/app/page.tsx)
total_score: 28
p0_count: 0
p1_count: 3
timestamp: 2026-06-06T04-47-42Z
slug: src-app-page-tsx
---
# Critique — 今日信号 / Feed 页面 (`src/app/page.tsx`)

Register: product · 目标：个人 AI 资讯仪表盘首页（排序后的信号流）。本轮在已运行的 dev server（localhost:3000，含真实数据 30 条/页）上做了浏览器实测。

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Stale 横幅 / 分页计数 / 投票 pending+error / 骨架屏 / aria-current 都到位；投票后看不出"排序真的变了" |
| 2 | Match System / Real World | 3 | `lang="zh-CN"` 已修；source 映射成人话（Hacker News / X）；R 收进 强/中/弱 + tooltip |
| 3 | User Control and Freedom | 3 | 投票可切换/撤销（DELETE+POST）；排序切换；分页返回；EN 可展开收起 |
| 4 | Consistency and Standards | 3 | 已落地 token 系统 + 统一 pill/badge；但 👍👎 emoji 违反 DESIGN.md 单色图标禁令；/suppressed 仍用旧的未样式 `feedback-buttons.tsx` |
| 5 | Error Prevention | 3 | 投票低风险且可逆；fetch 校验 `res.ok`；护栏需求本就不多 |
| 6 | Recognition Rather Than Recall | 3 | 强/中/弱 + 三段 bar + tooltip 替代裸 R；reason 扶正；但"强弱是相对当前页"无图例、tooltip 触屏失效 |
| 7 | Flexibility and Efficiency | 2 | 仍无键盘快捷键（j/k/u/d/o）、无批量、无"标记已读"，每日阅读器仅靠鼠标 + 分页 |
| 8 | Aesthetic and Minimalist Design | 3 | 真正"设计出的克制"：badge→粗标题→reason→muted 摘要→faint 元信息，层级清晰；emoji + reason/摘要冗余是仅有的杂音 |
| 9 | Error Recovery | 3 | 投票失败显示"未保存，重试"并回滚状态；error.tsx 边界含重试 + 状态链接 |
| 10 | Help and Documentation | 2 | 有 tooltip + 教学型空状态 + 错误指引；但无强弱/排序图例、无引导、R 仅 hover 可见 |
| **Total** | | **28/40** | **Good — 底子已成型，剩排序语义 + 效率 + 个别身份瑕疵** |

## Anti-Patterns Verdict

**LLM 评估**：与上一轮（16/40 的"前设计原型"）相比是质变。现在它真正穿上了 DESIGN.md 的皮：Inter 已加载、Signal Violet 严格只服务动作（filled 投票态、active 排序、当前导航、品牌 S）、porcelain 画布 + 清晰字号阶梯 + 间距节奏。一个用惯 Linear/Notion/Raycast 的人坐下来会信任它、不会觉得"AI 做的"。它已达到 product register 的及格线——工具开始消失于任务。剩下的不是"未设计"，而是几个有主见的产品/身份决策没收口。

**确定性扫描**：`detect.mjs --json`（page/feed-list/site-header/layout/loading/error 六个文件）返回 `[]`，EXIT=0，零命中。与 LLM 判断一致：没有装饰型反模式（侧边色条、渐变文字、玻璃拟态、card 堆砌等均无）。注意：检测器扫不到 emoji-图标 与"默认排序与价值主张冲突"这类语义问题，需人工评审补位（已在下方列出）。

**浏览器实测**：在真实 dev server + 真实数据上截图三张（首屏 / 单条特写 / score 排序）。确认：(1) `lang=zh-CN`、单一 h1、reason 色 `#2a2a2a` vs 摘要 `#5d5d5d` 层级成立；(2) 默认 `sort=time` 时首屏强度徽章为 弱/弱/弱/中/中…，与排序顺序脱钩；(3) 👍👎 渲染为黄色多色 emoji，是整张单色画布上唯一的彩色物。左下角 Next.js "1 Issue" 经查只是 dev overlay 自身注入的 Bootstrap reset 样式，非设计缺陷。a11y 快照里偶现的 `main=加载中` + 重复 h1 是 force-dynamic 的 loading.tsx 骨架被瞬时捕获，非 bug。

## Overall Impression

骨架对、现在皮也穿上了。信息架构（强度徽章 → 粗标题 → reason → 中文摘要 → 英文摘要 → 元信息 → 投票）成立，克制得体，违和处只剩零星几个。**最大机会**：把"排序即产品"这条第一原则真正落到首屏——默认排序是"最新"而非"按价值"，且强度徽章与顺序脱钩，导致打开就看到一排"弱"压在最上面，直接削弱了本产品赖以立身的"信任这个顺序"。这是产品决策层面的收口，不是样式问题。

## What's Working

1. **设计出的克制（而非缺席的极简）**：清晰的视觉层级——强度徽章定位、粗标题抓眼、reason 用 ink 正文、摘要 muted、元信息 faint；Signal Violet 只在动作/激活态出现。完全兑现了 PRODUCT.md「界面后退、内容发声」与 DESIGN.md 的紫/白克制。
2. **状态与错误闭环扎实**：stale 源横幅、分页计数、投票 pending/error 回滚（"未保存，重试"）、骨架屏、error.tsx 边界 + 重试。上一轮"静默说谎"的投票已被 `res.ok` 校验 + 可撤销取代。
3. **R 被翻译成人能读的强/中/弱**：三段 bar + 强/中/弱 + tooltip(R 值) + `aria-label`，把上一轮的裸 `R 0.42` 变成有意义、可访问的信号；source 也映射成 Hacker News / X 等人话。

## Priority Issues

- **[P1] 默认排序是"最新"，与核心价值主张冲突；强度徽章与顺序脱钩。** PRODUCT.md 原则 #1 字面是「按对我个人的价值排序…露出理由让我信任顺序」，但默认 `sort=time`，且 强/中/弱 是相对当前页归一化的，于是首屏顶部出现 弱/弱/弱。打开第一眼就在告诉用户"最该看的几条是弱信号"，自相矛盾。
  - **为何重要**：护城河是"排序质量 + 个人记忆"。首屏若不是"按价值排"，且强弱与位置矛盾，信任根本建立不起来——这是产品的命门。
  - **Fix**：默认改为按价值/分数排（或让"今日值得"成为首屏默认视图）；在时间排序下，弱化/重构强度徽章语义，使徽章与顺序不再打架；明确"强弱相对什么"。
  - **Suggested command**: `/impeccable shape 今日信号默认排序与强度语义`（这是产品决策，先规划）

- **[P1] 👍👎 emoji 违反 DESIGN.md 单色图标禁令，是画布上唯一的彩色物。** DESIGN.md 明文「Do not use emoji or multicolor icon sets — icons are monoline, monocolor」。整套系统的纪律就建立在"98% 单色 + 一个紫"上，黄色 emoji 拇指直接破功。
  - **为何重要**：身份一致性是 product register 的核心；这一处彩色噪点削弱了其余所有克制的可信度。
  - **Fix**：换成 1.5–2px 单线拇指图标（`currentColor`），让 active 态用既有的 violet 实心 / ink 实心来承载，而不是靠 emoji 本身的颜色。
  - **Suggested command**: `/impeccable colorize`（图标改单色 + 状态色）或并入 `/impeccable polish`

- **[P1] 每日必用阅读器仍无键盘加速器。** 无 j/k 切条目、u/d 投票、o 打开、无"标记已读"、无批量；仅鼠标 + 分页。排序切换是进步，但不替代导航快捷键。
  - **为何重要**：这是单人每天都开的工具（Alex/power-user 画像），每次多点几下的摩擦每天复利。
  - **Fix**：移动/打开/投票快捷键；考虑已读状态与"只看未读"。
  - **Suggested command**: `/impeccable shape feed 键盘交互模型`（新功能，先定模型）

- **[P2] reason 与 中文摘要常常读起来像两段重复的中文。** 多条 item 上「为什么值得读」(reason) 与「是什么」(summaryZh) 措辞高度重叠，造成冗余阅读负担，也稀释了 reason 作为信任信号的份量。
  - **为何重要**：reason 本该是"替我判断值不值得"的一等公民；当它和摘要看起来一样，第一原则的力度就被摊薄。
  - **Fix**：结构/视觉上拉开二者（reason 作带标识或紫色 lead 突出，摘要默认收起或更弱）；或在数据层去重。
  - **Suggested command**: `/impeccable layout` + `/impeccable clarify`

- **[P2] 强度"相对当前页"无图例、tooltip 触屏失效。** 同一条在不同页可能 强 也可能 弱（见 format.ts 注释的归一化逻辑），界面无任何说明；R 仅在 hover tooltip 出现，触屏/键盘拿不到。
  - **为何重要**：Recognition/Help 缺口（Sam 触屏与键盘、Jordan 首次理解）。
  - **Fix**：加一处轻量图例（强/中/弱 各代表什么、相对什么）；R/含义不要只靠 hover。
  - **Suggested command**: `/impeccable clarify`

## Persona Red Flags

**Alex（power user，每日必开）**：仍无任何键盘快捷键，逐条鼠标点投票；只能分页、无"标记已读"/批量；排序切换聊胜于无。每日复利的摩擦仍在。

**「每日信号分诊者」（项目专属画像，源自 PRODUCT.md）**：早上打开默认是"最新"视图，顶部三条徽章是 弱/弱/弱——"今天最该看的"没有排在最上，强弱还和顺序打架。本产品赖以立身的"信任这个排序"在第一屏就没立住。

**Sam（可访问性）**：对比度已修（元信息 `#707070`≈4.9:1 过 AA，上一轮的 `#888` 问题已解决）；投票按钮有 `aria-label`、强度徽章有 `aria-label`。残留：强弱的"相对归一化"语义对所有人不可见，且 R 仅 hover tooltip 可得（键盘/触屏拿不到）。

## Minor Observations

- force-dynamic 导致每次切排序/翻页都整页骨架闪一下；骨架屏让它可接受，但仍是整页刷新。
- `/suppressed` 仍引用旧的 `feedback-buttons.tsx`（内联样式 + 未样式原生按钮），与 feed 的投票组件是两套词汇，属全站一致性遗留。
- `error.tsx` 用表意空格 `"　"` 凑间距，应改真实布局 gap。
- 英文摘要按需展开（EN 切换）是合理决定。
- 左下 Next.js "1 Issue" 为 dev-only 指示器（overlay 自身样式），非生产/设计问题。

## Questions to Consider

- 首屏默认该不该是"按价值"而不是"最新"？若坚持"最新"默认，强度徽章在时间排序下还要不要出现？
- 强/中/弱 要传达"绝对价值"还是"本页相对位置"？要不要给它一个可见图例？
- reason 与中文摘要能否合并/分层，让 reason 真正成为唯一的"值不值得读"信号？
