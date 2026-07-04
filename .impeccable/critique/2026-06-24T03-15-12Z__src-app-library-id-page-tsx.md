---
target: /library/1528?from=feed
total_score: 30
p0_count: 0
p1_count: 1
timestamp: 2026-06-24T03-15-12Z
slug: src-app-library-id-page-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Favorite shows only an error state, no positive "已存入" confirm; loading fallback shows the list skeleton |
| 2 | Match System / Real World | 4 | Chinese-first, natural labels (概述/全文/讨论/查看原文/原文), Reddit source + relative time |
| 3 | User Control and Freedom | 3 | Smart back, external link, reversible ⭐; no vote/undo on the reader |
| 4 | Consistency and Standards | 3 | Reuses the design system well, but body ignores the project's own 68/72ch reading cap, and detail loading uses the list skeleton |
| 5 | Error Prevention | 3 | Low-risk reversible actions; failed-processing notice explains retry |
| 6 | Recognition Rather Than Recall | 3 | Sections + labeled nav; "查看原文" toggle is faint and easy to miss |
| 7 | Flexibility and Efficiency | 2 | No keyboard shortcuts, no prev/next between items, no vote on the reader |
| 8 | Aesthetic and Minimalist Design | 4 | Strong, restrained, content-forward; one deliberate glass card |
| 9 | Error Recovery | 3 | "未保存" reverts optimistic state but is terse, no retry button |
| 10 | Help and Documentation | 2 | None on page (acceptable for a single-user tool, but minimal) |
| **Total** | | **30/40** | **Good — solid foundation, address the reading measure + reader affordances** |

## Anti-Patterns Verdict

**LLM assessment**: This does **not** read as AI slop. It's a committed, distinctive product surface (Astro deep-space "mission control"): a Void canvas, a single double-bezel glass note card, achromatic UI with violet used only for links/labels, mono instrument figures. No SaaS card-grid sameness, no gradient text, no eyebrow scaffolding, no decorative motion. Against the product slop test (would a Linear/Notion/Raycast-fluent user trust it?) — yes. It reads as a polished reader.

**Deterministic scan**: `detect.mjs` on `src/app/library/[id]/page.tsx` returned `[]` (exit 0) — zero anti-patterns in the markup. CSS-only files aren't scanned by the detector; manual + browser review covered the styles.

**Visual overlays**: No script-injection overlay was used; review relied on Playwright measurement + screenshots at 1280 and 430. The one headless-Chrome screenshot that appeared to show mobile right-edge clipping was a **false positive** — Playwright measured `documentElement.scrollWidth === innerWidth === 430` with zero overflowing elements. There is no horizontal overflow.

## Overall Impression

A confident, on-brand reader. The chrome recedes and the content (structured note → full text → threaded discussion) leads, exactly as the product intends. The single biggest opportunity is the **reading measure**: this is a reading tool, yet the body and note run ~968px / ~60 CJK (~121 Latin) characters per line with no max-width — wider than the project's own 68/72ch caps used elsewhere. Capping the measure is the highest-leverage fix.

## What's Working

- **Threaded discussion**: replies indent under parents behind a hairline thread guide, author names bold, mono `▲score`, inline code (`git diff --stat`) styled — 36 comments read as distinct blocks, not a wall.
- **Restraint & hierarchy**: one glass note card on a shadowless void, weight-driven hierarchy, violet spent only on links/labels. The structured note (概述/核心要点/关键数据·结论/为什么值得记/术语) is the genuine value and it's front-and-center.
- **Bilingual reader done right**: Chinese-first body with the original one click away in `查看原文`; smart back link that labels itself by origin (← 信号流 vs ← 收藏) and restores feed scroll via history pop.

## Priority Issues

- **[P1] Over-wide prose measure on a reading surface**
  - **Why it matters**: The full-text body is 968px (~60 CJK / ~121 Latin ch) and the note ~954px, with no reading cap; on a wide monitor the column grows to the full 1160px. Long lines are the classic readability killer, and this is the core reading task. It's also *inconsistent with the project's own system* — `globals.css` already caps other reading surfaces at `68ch`/`72ch`.
  - **Fix**: Apply a reading-measure cap (~62–70ch, ≈720–760px) to `.kb-note` and `.kb-body .markdown` (and `.kb-comments`), matching the existing 68/72ch pattern.
  - **Suggested command**: `/impeccable layout`

- **[P2] Detail page loads with the wrong skeleton**
  - **Why it matters**: There's no `app/library/[id]/loading.tsx`, so the detail route inherits `app/library/loading.tsx` — opening an item (including from the feed) flashes the **收藏 list** skeleton (a "收藏" title + 3-line item rows) instead of a detail-shaped placeholder. It's a visible status/consistency break right at navigation.
  - **Fix**: Add a `[id]/loading.tsx` whose skeleton mirrors the detail layout (title + meta + note card + body lines).
  - **Suggested command**: `/impeccable harden`

- **[P2] The core "keep" action is visually buried**
  - **Why it matters**: Personal memory ("收藏 everything valuable") is a headline product value, yet on the reader the ⭐ is a 23×23px icon at the tail of the faint meta line — low visual weight, low discoverability, and a sub-44px touch target on mobile.
  - **Fix**: Promote the save action near the title (a labeled, larger affordance) and bump the tap target to ≥44px on touch.
  - **Suggested command**: `/impeccable layout`

- **[P2] No feedback loop or item-to-item movement on the reader**
  - **Why it matters**: Design Principle 4 says the 👍/👎 loop must be visible and consequential, but the feed has vote chips while the detail reader has none and no prev/next. Reading and reacting to N items means N round-trips back to the feed (a power-user/daily-habit drag).
  - **Fix**: Decide whether the reader should carry vote chips + prev/next; if yes, shape it against the feed's vote vocabulary.
  - **Suggested command**: `/impeccable shape`

- **[P3] Faint, small secondary affordances**
  - **Why it matters**: `查看原文` is `--text-faint` (#888e9b) at 13px (AA floor, low discoverability), and the note section labels are 11px CJK in the mono fallback with 0.08em tracking, which adds awkward gaps between Chinese glyphs and reads small.
  - **Fix**: Lift the toggle one contrast step (or add a ▸ affordance weight); set CJK section labels a touch larger / drop the tracking for the Chinese fallback.
  - **Suggested command**: `/impeccable typeset`

## Persona Red Flags

**Alex (Power User)**: No keyboard shortcuts anywhere. No prev/next to move between library items — every item is a back-out. No vote on the reader, so triage/calibration can't happen where the reading happens. Reading 20 items = 20 navigation round-trips.

**Sam (Accessibility)**: Favorite star is a 23px target (below 44px). `查看原文` and meta sit at ~4.6:1 (passes AA, but at the floor). Positives: real `<button>` with `aria-pressed` + descriptive `aria-label`, global `:focus-visible` outline, semantic headings, content visible without JS.

**Casey (Mobile)**: Layout is sound (no overflow, title wraps, full-bleed column), and state is preserved via history-pop back. But the save ⭐ (23px) and the small text back link are fiddly one-handed, and both primary touch points sit at the top of the screen, outside the thumb zone.

**"The Builder" (project persona, from PRODUCT.md)**: the single self-serving user on a daily habit who wants fast triage + permanent recall. The reader nails recall (permanent, structured, bilingual) but not the daily-loop ergonomics: can't calibrate ranking (vote) or sweep through saved items from the reader itself.

## Minor Observations

- **Broken comment link**: one rendered link points to `http://Https://github.com/loganpederson/` — a capitalized `Https:` scheme made react-markdown treat it as relative and prepend `http://`, producing a dead link. It's pipeline/content data, but it surfaces as a broken UI affordance; consider normalizing URLs at ingest or in the markdown renderer.
- **No positive save confirmation**: only the error path ("未保存") is visible; a brief "已存入" affirmation would close the loop on the product's headline action.
- The structured-note card is the page's only card (double-bezel = tray + core), so it's not a nested-card violation — it's the sanctioned instrument-hardware treatment.

## Questions to Consider

- Should the reader be a place you *act* (vote, mark read, jump to next), or strictly a place you *read*? The answer decides whether P2 (feedback loop) is in scope.
- What's the longest comfortable line for your mixed zh/en content — and should the note, body, and comments all share one measure for a calmer column?
- On a tool whose whole point is "keep what's valuable," should the save action be the most prominent control on the page rather than the least?
