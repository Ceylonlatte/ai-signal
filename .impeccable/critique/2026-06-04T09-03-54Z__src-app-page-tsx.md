---
target: feed 页面 (src/app/page.tsx)
total_score: 16
p0_count: 1
p1_count: 3
timestamp: 2026-06-04T09-03-54Z
slug: src-app-page-tsx
---
# Critique — Feed 页面 (`src/app/page.tsx`)

Register: product · 目标：个人 AI 资讯仪表盘首页（排序后的信号流）

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Stale 源横幅 + 分页计数不错，但投票仅靠 emoji+✓ 反馈，无加载态，R 分无解释 |
| 2 | Match System / Real World | 2 | 内容中文但 `lang="en"`；`R 0.42` 纯术语；source 显示原始 token（"hn"） |
| 3 | User Control and Freedom | 2 | 投票一次性、按钮永久禁用、无法撤销/改投 |
| 4 | Consistency and Standards | 1 | 全是临时内联样式 + 原生未样式按钮；DESIGN.md 的紫/白系统完全未应用 |
| 5 | Error Prevention | 2 | 交互面很小、可出错点少，但也几乎没有护栏 |
| 6 | Recognition Rather Than Recall | 2 | `R 0.42` 需要外部记忆才懂；`reason` 被埋在 12px 灰字末尾 |
| 7 | Flexibility and Efficiency | 1 | 无键盘导航（j/k/u/d/o）、无批量、仅分页；日用阅读器零加速器 |
| 8 | Aesthetic and Minimalist Design | 2 | 是"靠缺席的极简"，非"设计出的极简"；层级扁平，权重几乎相等 |
| 9 | Error Recovery | 1 | 投票 `fetch` 不校验 `response.ok`，失败仍显示 ✓（静默说谎）；无错误态 |
| 10 | Help and Documentation | 1 | 无 R/分数图例、无 tooltip、无空状态、无引导 |
| **Total** | | **16/40** | **Poor — 需要大幅 UX 重做** |

## Anti-Patterns Verdict

**LLM 评估**：不是典型"一眼 AI 生成"（它太朴素，连可被指认为 slop 的装饰都没有）。它失败在 product register 的另一端——**"前设计"状态**：system-ui 内联样式、未加载品牌字体、Signal Violet 一处未用、层级全靠浏览器默认。一个用惯 Linear/Notion/Raycast 的用户不会说"这是 AI 做的"，而会说"这是开发者本地未完成的内部原型"。product 的及格线是"习得的熟悉感、工具消失于任务"，这里因缺乏打磨而未达标。

**确定性扫描**：检测器在三个文件上返回 0 命中（`detect.mjs --json`，EXIT=0）。合理——几乎没有样式，自然没有装饰型反模式。这恰恰印证了问题是"未设计"而非"设计过度"。

**浏览器覆盖层**：未注入。feed 是 `force-dynamic`、依赖 Postgres + 已摄取数据，且当前无运行中的 dev server，无法可靠渲染/截图。无可靠的用户可见覆盖层；以源码评审 + CLI 扫描为准。

## Overall Impression

骨架是对的，皮肤没穿。每条 item 的信息架构（标题 → 投票 → 中文摘要 → 英文摘要 → 元信息）其实合理，数据层也很富（q/novelty/reason/tags/r 都在），但渲染出来是一个匿名的 localhost 列表，完全没有体现 PRODUCT.md 的"界面后退、内容发声"和 DESIGN.md 的紫/白克制系统。**最大机会**：把已经存在的丰富排序信号「翻译」成有层级、可信任的视觉表达——尤其是把"为什么这条值得你花时间"的 `reason` 扶正为一等公民，而不是塞在灰字里。

## What's Working

1. **克制、不杂乱的逐条信息架构**：标题→投票→中文摘要→英文摘要→元信息的顺序合理，双语摘要 + reason + tags 原料齐全。底子是对的。
2. **Stale 源横幅**是恰当且产品化的系统状态信号，契合 PRODUCT.md「反馈/状态看得见」。
3. **反馈内联、分页诚实**：👍/👎 就地放在每条上（没有滥用模态），分页显示「第 x/y 页 · 共 N 条」，符合 product register「模态是最后手段」。

## Priority Issues

- **[P0] feed 渲染为未样式原型，整套 DESIGN.md 身份未被应用。** system-ui、无品牌字体、Signal Violet 一处未用、无字号阶梯、无间距节奏；层级扁平（标题外几乎全是等权重灰字）。
  - **为何重要**：产品有明确身份（PRODUCT.md「界面后退、内容发声」+ DESIGN.md），却渲染成匿名列表，既违背克制原则（克制是"设计出的安静"，不是"什么都没做"），也浪费了已定义的设计系统。
  - **Fix**：建立全局 tokens（从 DESIGN.md 落 CSS 变量）+ 加载字体；做一个真正分级的 FeedItem（标题醒目、摘要用 ink 而非灰、元信息才 muted）；落地 64/24 间距节奏与圆角。
  - **Suggested command**: `/impeccable shape feed 页面`（先规划），随后 `/impeccable layout` + `/impeccable typeset` + `/impeccable colorize`

- **[P1] 排序理由——产品的核心卖点——被藏起来了。** `R 0.42` 是不解释的术语数字；真正的"为什么值得读"`reason` 被丢在 12px #888 灰字的元信息行尾，极易错过。
  - **为何重要**：PRODUCT.md 原则 #1 字面就是「排序即产品…把排序理由露出来让我信任顺序」。当前 UI 恰好反着做。
  - **Fix**：去掉/重命名裸 `R`；把 `reason` 扶正为可读正文；如需分数，给小 chip + 图例/tooltip 说明 R 是什么。
  - **Suggested command**: `/impeccable clarify`（重命名/解释分数与理由）+ `/impeccable layout`

- **[P1] 反馈不可逆、且会静默说谎。** 点一次即永久禁用双键（无法撤销/改投）；`feedback-buttons.tsx` 是 `await fetch(...); setSent(signal)`，不校验 `response.ok`——POST 失败仍显示「✓」。
  - **为何重要**：反馈是核心回路（原则 #4「反馈回路看得见、有后果」）。一个不可撤销又会静默失败的投票，恰恰侵蚀了用来校准 feed 的那个机制的信任。
  - **Fix**：允许切换/撤销；校验响应、失败显示错误态；让投票可见地影响排序（例如标注"已降权/已压制"）。
  - **Suggested command**: `/impeccable harden`（状态/错误）+ `/impeccable clarify`

- **[P1] 对每日必用的阅读器缺乏高效路径。** 无键盘导航（j/k 切条目、u/d 投票、o 打开）、无"标记已读"、只能分页。
  - **为何重要**：这是单人每天都开的工具（Alex/power-user 画像），摩擦每天复利。
  - **Fix**：移动/打开/投票的键盘快捷键；考虑已读状态。
  - **Suggested command**: `/impeccable shape`（先定交互模型；这是新功能，需先规划）

- **[P2] 元信息与 i18n 漏洞。** 中文内容却 `lang="en"`；source 显示原始 token（"hn"）而非人话标签；无 `<title>`/favicon；头部两个链接用表意空格 `"　"` 凑间距。
  - **为何重要**：correctness/打磨缺口（Sam 屏幕阅读器语言、Riley 边界、基础元数据）。
  - **Fix**：`lang="zh-CN"`；source→可读标签映射；补 metadata；用真实布局间距。
  - **Suggested command**: `/impeccable clarify` + `/impeccable polish`

## Persona Red Flags

**Alex（power user，每日必开）**：无任何键盘快捷键，必须用鼠标逐条点；投票点一次就锁死、不能改；只能分页、不能快速跳读。每日复利的摩擦，高弃用风险。

**Sam（可访问性）**：`lang="en"` 套在中文内容上，屏幕阅读器会用错语音；元信息 12px `#888` 在白底约 3.5:1，**未达 AA 4.5:1**；原生按钮无自定义可见焦点环；`R 0.42` 无标签朗读，分数/含义仅靠视觉。

**「每日信号分诊者」（项目专属画像，源自 PRODUCT.md）**：每天早上开来分诊。扁平层级让 top1 和第 30 条看起来等权重，直接消解了「排序即产品」；一眼看不出为什么 #1 排在 #5 前面，信任建立不起来。

## Minor Observations

- `force-dynamic` + 无骨架屏：翻页是整页刷新，会有闪动。
- 英文摘要默认始终展示在中文摘要下，对中文为主的读者偏冗余；可考虑折叠/按需展开。
- 头部链接分隔用表意空格 `"　"` 是 hack，应用真实布局 gap。
- h1「AI Signal」缺产品语境（日期？「今日信号」？）。
- 无空状态：feed 为空时只是一个空 `<ul>`。

## Questions to Consider

- `R` 到底要传达什么——一个可信的信号，还是仅仅一个顺序？顺序本身 + 一句话 reason 是否就能替代这个数字？
- 英文摘要该默认可见，还是按需展开？
- 投票该可逆吗？投票后是否应可见地重排/标注该条目？
