# AI Signal — Style Reference
> Awesomic light — a Mist canvas with white cards, one near-black action colour, and colour almost absent from the UI. Ember is a scarce, badge-sized spark.

**Theme:** light

A quiet, achromatic reading tool. Content sits on white cards floating on a Mist (`#f4f4f5`) canvas; depth comes from surface-tone steps (Mist → Snow → Fog) and generous rounding (36px cards), never from drop shadows. The system has **no chromatic CTA**: every filled action is near-black `#09090b` with white text — the same pressed-pill the whole UI shares. Colour is reserved: a single ember (`#ff5a00`) appears only at badge size — the page eyebrow, the saved star, the "live" pulse, the accepted tag. Hierarchy is weight-driven within one typeface (Plus Jakarta Sans). The signal dial and trend bars stay monochrome — strength reads as tone (ink → graphite → ash), not hue. The interface recedes; the content speaks.

These are the tokens implemented in `src/app/globals.css` (`:root`). Treat that file as the source of truth.

## Colors

| Name | Token | Value | Role |
|------|-------|-------|------|
| Action | `--action` / `--accent` | `#09090b` | The only filled-action colour: primary buttons, vote-active, toggle-on, brand mark, active states. White text on it. `--accent` resolves here, so all accent call-sites read as monochrome ink. |
| On-action | `--on-accent` | `#ffffff` | Text/icon on a near-black fill |
| Ember (spark) | `--ember` | `#ff5a00` | The scarce vivid spark — badge-sized fills/dots only: eyebrow dot, scroll-progress bar, live pulse |
| Ember (ink) | `--ember-ink` | `#c2410c` | Ember used as text/icon on light (~5.2:1 AA): eyebrow label, saved star, accepted tag |
| Ember weak | `--ember-weak` | `rgba(255,90,0,0.12)` | Ember tint backgrounds (eyebrow / accepted tag) |
| Danger | `--danger` | `#b4231f` | Errors + destructive only (vote/feed errors, delete) |
| Ink | `--ink` | `#18181b` | Headings, strongest dial/bar, body emphasis |
| Graphite | `--graphite` | `#3f3f46` | Mid-strength dial, secondary strokes |
| Slate | `--slate` | `#52525b` | Muted body text (`--text-muted`, ~7:1) |
| Steel | `--smoke` | `#71717a` | Tertiary text, input hover border |
| Ash | `--ash` | `#a1a1aa` | Faint dial/dot, idle indicators |
| Pebble | `--pebble` | `#d4d4d8` | Strong hairline (`--border-strong`) |
| Fog | `--mist` | `#ececee` | Hairline dividers / borders (`--border`) |
| Mist | `--cloud` | `#f4f4f5` | Page canvas (`--app-bg`) + sunken surfaces |
| Snow | `--porcelain` | `#ffffff` | White card / control surface (`--surface`) |
| Obsidian | `--obsidian` | `#09090b` | Darkest — same as the action colour |

### Text roles

| Token | Value | Use |
|-------|-------|-----|
| `--text-strong` | `#18181b` | Headings, titles, emphasis |
| `--text` | `#27272a` | Body / reading text |
| `--text-muted` | `#52525b` | Summaries, secondary copy (~7:1) |
| `--text-faint` | `#6b6b73` | Meta, captions — the lowest we let text go (~4.9:1) |

## Typography

### Plus Jakarta Sans — the single family across the entire system
Hierarchy is **weight-driven**, never family-switching. Latin glyphs use Plus Jakarta Sans; CJK falls back to the system Chinese face (PingFang SC / Hiragino Sans GB / Microsoft YaHei) so 中文 stays crisp without shipping a CJK webfont.
- **Substitute:** DM Sans, system-ui
- **Weights:** 400, 500, 600, 700, 800 (body 500, headings 700)
- **Tracking:** near-normal — headings `-0.01em`; no tracked-out display text
- **Variables:** `--font-sans` (body/UI) and `--font-display` (= `--font-sans`; one family)

### Type scale (implemented)

| Role | Size | Line height | Notes |
|------|------|-------------|-------|
| page title | `clamp(1.9rem, 4vw, 2.75rem)` | 1.08 | weight 700, `-0.02em` |
| section title | 18px | 1.2 | weight 700 |
| item title | 18–19px | 1.3 | weight 700 |
| body | 15–16px | 1.5 | weight 500 |
| meta / caption | 12–14px | 1.4–1.5 | tabular-nums for figures |
| eyebrow | 10px | — | uppercase, `0.2em`, ember-ink |

## Spacing & Layout

**Base unit:** 4px · **Density:** comfortable

- **Reading width:** 900px (centered white card)
- **Card padding:** 32–40px (`--space-8`/`--space-10`)
- **Element gap:** 16–24px
- **Shell height:** 60px

### Border radius

| Token | Value | Use |
|-------|-------|-----|
| `--radius-lg` | 36px | Page card + large surfaces (the signature rounding) |
| `--radius-pill` | 999px | Buttons, vote/sort/switch controls, nav pills |
| `--radius-md` | 16px | Notice, kb-note, table wrap |
| `--radius-input` | 14px | Text inputs |
| `--radius-badge` | 12px | Tags + badges |
| `--radius-sm` | 10px | Images, code blocks |

## Components

### App Top Bar (`.shell`)
Sticky full-width bar, 60px, translucent white (`color-mix(porcelain 86%)`) with `backdrop-filter` blur and a hairline bottom border. Left: brand mark (near-black rounded square, white "S") + wordmark. Right: inline nav pills. On scroll it earns a hairline + soft shadow. Below 860px the inline nav is replaced by a hamburger.

### Mobile Nav Takeover (`.navmodal`)
Full-screen near-white glass (`backdrop-filter` blur). Hamburger morphs to an X; large display links fade + rise in with a per-item stagger. Esc / backdrop / link-tap closes; body scroll locks while open.

### Page Card (`.page`)
A white card on the Mist canvas: `--surface` fill, 1px Fog border, 36px radius, **no drop shadow** (depth via the colour step). Centered at 900px. Full-bleed (no side radius/border) below 600px.

### Page Eyebrow (`.page__eyebrow`)
One of ember's few homes: a 12px-radius pill, `--ember-weak` background, ember-tint border, `--ember-ink` uppercase label, a vivid `--ember` dot. One per page, never per section.

### Feed Item (`.item`) + Signal Dial (`.signal`)
Borderless row separated by a hairline; on hover it lifts (`translateY(-2px)`) onto a faint Mist wash with a soft shadow. The signal dial is **monochrome**: an SVG ring whose arc length is the 0–100 score, on a tonal ladder — high = `--ink`, mid = `--graphite`, low/default = `--ash` on a faint track. No colour in the dial.

### Vote Pills (`.vote__btn`)
Ghost pills (white, strong-border). Hover → near-black border/text. Active (up) → near-black fill, white thumb; active (down) → graphite fill. Activation blooms a one-shot ring + thumb pop.

### Favorite Star (`.star`)
Active = `--ember-ink` (a scarce saved-marker).

### Primary Button (`.btn--primary`)
Near-black `--action` fill, white text, pill radius, Awesomic pressed-glass shadow (inner highlight + 1px ring + soft drop). Hover darkens to `--action-hover`. There is no chromatic button.

### Ghost Button (`.btn--ghost`)
White fill, strong hairline border, ink text; hover → near-black border/text.

### Segmented Control (`.sort` / `.seg`)
Pill track on a sunken Mist surface; the active chip is a white pill with a subtle shadow and slides between options via View Transitions (`view-transition-name: sort-active`).

### Toggle Switch (`.switch`)
Off = ash track; on = near-black track, white knob (action = near-black).

### Tag / Badge (`.tag` / `.badge`)
12px radius, Mist fill, muted text. `--tag--accepted` = `--ember-weak` fill + `--ember-ink` text (scarce). Status badge carries a dot.

### Data Table (`.table`) + Stat Tile (`.stat`)
Sunken Mist header, hairline row borders, tabular-nums. Stat tiles are sunken Mist cards with a 16px radius.

### Pipeline Bar (`.bar`) + Topics Board (`.topic`)
Both monochrome: bar fill and the #1 topic's rank/trend bar are `--ink`; lower bars are `--ash`. Strength reads as tone, not hue.

## Do's and Don'ts

### Do
- Use near-black `#09090b` for **every** filled action — buttons, vote-active, toggle-on, brand mark. It's the only filled-action colour.
- Keep ember scarce and badge-sized: eyebrow, saved star, accepted tag, scroll-progress, live pulse. Use `--ember-ink` (`#c2410c`) whenever ember is text or an icon, for AA.
- Express depth with the surface steps (Mist → Snow → Fog) and 36px rounding — not drop shadows.
- Carry hierarchy with weight inside Plus Jakarta Sans; one family only.
- Keep the signal dial and trend bars monochrome (ink → graphite → ash).
- Hold body text ≥ `--text-faint` (~4.9:1); verify AA.
- Give every animation a `prefers-reduced-motion` fallback; never gate content visibility on JS.

### Don't
- No chromatic CTA. Never colour a primary button/action ember (or anything else).
- Don't spread ember into UI states, hovers, or repeated elements — its power is scarcity.
- No drop shadows on cards; no glows; no gradients.
- No second typeface; no tracked-out display text.
- No sharp corners on cards (stay ≥ 16px; cards 36px).
- No emoji or multicolour icon sets — icons are monoline, near-black/ink.

## Motion

State-bearing and brief, built from transform / opacity / blur. Ember in motion stays tied to status (reading progress) and the live pulse; everything else is achromatic. Every effect degrades under `prefers-reduced-motion`; content is never gated on JS (CSS-hidden reveals ship `<noscript>` + reduced-motion fallbacks).

**Tokens** (`globals.css`): easings `--ease-out-quart/quint/expo` and `--ease-island` `cubic-bezier(0.32,0.72,0,1)`; durations `--dur-fast` 120ms, `--dur` 180ms, `--dur-slow` 320ms, `--dur-reveal` 560ms. No bounce, no elastic.

| Moment | Motion | Material / timing |
|--------|--------|-------------------|
| Page-head arrival | One-time blur-in + rise, title then tools | translate + blur + opacity, expo, 600ms |
| Feed item reveal | Rise + sharpen as it enters view; first screen staggers per observer batch | transform + blur + opacity, expo, 560ms |
| Signal dial | Arc sweeps 0 → score as the card reveals | `stroke-dashoffset` draw on `.is-in`, expo, 560ms, +110ms after the card |
| Reading progress | Top **ember** bar scrubbed by scroll | scroll-driven scaleX, `animation-timeline: scroll()` |
| Live pulse | Running status dot pulses ember | `box-shadow` ring, 1.6s loop |
| Sticky top bar | Gains hairline + soft shadow as content slides under | scroll-driven, range 0–96px |
| Navigation (sort / nav) | Soft crossfade + active sort chip slides | View Transitions API (MPA), `view-transition-name: sort-active` / `shell` |
| Mobile takeover | Hamburger → X; links fade + rise, staggered | transform + blur + opacity, island ease |
| Vote | Press scale 0.9, then a one-shot ring + thumb pop on activate | transform + box-shadow ring, expo |
| Item hover | Subtle lift | translateY(-2px) + soft shadow, slow |
| EN summary | Smooth expand / collapse | `grid-template-rows` 0fr↔1fr + fade, 320ms |

Scroll-driven and View-Transition effects are progressive enhancements (Chromium-first); other engines fall back to no progress bar / instant navigation with no loss of function.

## Surfaces

- **Mist** (`#f4f4f5`, `--app-bg`/`--cloud`) — page canvas + sunken controls
- **Snow** (`#ffffff`, `--surface`) — white cards and control fills
- **Fog** (`#ececee`, `--border`) — hairlines and dividers
- **Action** (`#09090b`, `--action`) — filled buttons + active states

## Imagery

No photography, illustration, or decorative graphics. Icons are minimal monoline, ~1.5–2px stroke, near-black/ink (never multicolour). The product content is the hero; the chrome stays out of the way.

## Layout

A single centered white card (max-width 900px) on the Mist canvas, padded 32–40px, 36px radius. Sticky top bar above it (brand-left, nav-right). Page head: ember eyebrow + large title on the left, tools (source tabs / sort / count) on the right, wrapping below 720px. Below 600px the card goes full-bleed and the nav collapses to a hamburger takeover.

## Similar Brands

- **Awesomic** — the direct reference: Mist canvas, white cards, near-black filled actions, scarce vivid accents, single typeface, extreme rounding.
- **Arc.dev** — near-black primary actions on white, graduated zinc neutrals, rounded containers.
- **Contra** — extreme rounded corners and minimal accent against achromatic surfaces.
- **Framer** — single typeface at all sizes, large rounded cards, dark filled CTAs on a light page.
- **Linear** — pill controls, monochrome interface, flat-surface-over-shadow elevation.
