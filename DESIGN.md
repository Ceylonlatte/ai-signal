# AI Signal — Style Reference
> Astro deep-space mission control: a clean Void near-black canvas, an inverted Lunar-White action colour, and colour almost absent from the UI. The one purple-magenta nebula gradient is spent only on edges (selected nav/filter strokes, focus rings, hovered cards, stat panels) and the scroll-progress bar, never as a background fill -- and those lit edges bloom with a soft twin-hue nebula glow so the void reads as lit from within. Each chromatic pixel does real work.

**Theme:** dark (single theme, locked)

A quiet, overwhelmingly achromatic reading tool rebuilt as a cosmic command bridge. Content floats on a Void canvas (`#1f232e`, never pure black) with a cool-blue undertone; spatial depth comes from surface-tone steps that go *darker* (Void → Abyss → Singularity), never from elevation drop shadows. The system has **no chromatic CTA**: every filled action is the inverted Lunar-White `#f2f6fa` with dark Void text, the same pressed pill the whole UI shares. Colour is scarce and assigned by meaning: violet for links, signal-blue for the live pulse, amber for the saved star, mint for the accepted tag, and one purple-magenta nebula gradient spent only on edges (the selected nav/filter stroke, a focused input, a hovered ghost button, hovered feed/topic/result cards and vote chips, plus an always-on hairline on stat panels) and the scroll-progress bar. Those lit edges -- and the white CTA and brand mark -- carry a soft twin-hue nebula **glow** (signal-blue + ultraviolet bloom) so the void reads as lit from within; the strongest signal dials glow faint white. The glow is a lighting accent, never an elevation cue, and the canvas *behind* content stays a clean even void with no background fill. Hierarchy is weight-driven; figures read like a mission-control gauge in JetBrains Mono. The signal dial and trend bars stay monochrome: strength reads as brightness (bright = strong, dim = weak), not hue.

These are the tokens implemented in `src/app/globals.css` (`:root`). Treat that file as the source of truth.

## Colors

| Name | Token | Value | Role |
|------|-------|-------|------|
| Action | `--action` | `#f2f6fa` | The only filled-action colour: primary buttons, vote-active, toggle-on track, brand mark, active nav/sort pills. Dark Void text on it. The white-on-dark inversion is the system's signature action pattern. |
| On-action | `--on-accent` | `#1f232e` | Dark Void text/icon on a Lunar-White fill |
| Accent | `--accent` | `#acafff` | Ultraviolet: links, hover text, focus ring, active toggle track. `--accent` tints + text; `--action` fills. |
| Signal blue (spark) | `--ember` / `--signal-blue` | `#61dafb` | The scarce status spark: live pulse / running dot. Also the scroll-progress and nebula belong to this cosmic family. |
| Amber | `--amber` | `#ffd493` | The saved star (a scarce warm "kept" marker) |
| Aurora mint | `--aurora-mint` | `#4bf3c8` | The accepted tag (a scarce "go" marker) |
| Plasma blue | `--plasma-blue` | `#54b9ff` | Supporting decorative accent, low-frequency emphasis |
| Electric cyan | `--electric-cyan` | `#00daef` | Reserved syntax / rare accent stroke |
| Nebula gradient | `--nebula-gradient` / `--nebula-bright` | `linear-gradient(83.21deg, #3245ff, #b845ed)` | The one decorative gradient, spent only on edges: the gradient stroke on a selected nav/filter pill, a focused input, a hovered ghost button, hovered feed/topic/result cards and vote chips, an always-on hairline on stat panels, plus the scroll-progress bar. A brightened variant `--nebula-bright` (`#7c8cff -> #d98bff`) keeps the lit strokes legible on the void; selected nav/filter labels themselves stay crisp Lunar-White, so the gradient lives in the ring, not the type. Never a background fill; never on text. |
| Nebula glow | `--glow-nebula` / `--glow-nebula-soft` / `--glow-white` | twin-hue `box-shadow` bloom (signal-blue `#7c8cff` + ultraviolet `#d98bff`) | The lighting layer behind lit edges. `-soft` is the resting/ambient tier (hovered cards, active tabs, ghost-button hover); the brighter one lights focus rings. `--glow-white` is the Lunar-White bloom on the CTA and brand mark. A lighting accent, never an elevation shadow. |
| Danger | `--danger` | `#ff6b6b` | Errors + destructive only (vote/feed errors, delete) |
| Lunar White | `--ink` | `#f2f6fa` | Headings, strongest dial/bar, body emphasis. Brightest = strongest. |
| Mist | `--graphite` | `#bfc1c9` | Mid-strength dial, downvote fill |
| Steel | `--slate` | `#858b98` | Muted body text, subdued descriptions |
| Smoke | `--smoke` | `#6f7480` | Tertiary text |
| Gunmetal | `--ash` | `#545864` | Faint dial, idle dots, off-toggle track |
| Strong hairline | `--pebble` / `--border-strong` | `#3a3e4a` | Borders on inputs / ghost pills |
| Hairline | `--mist` / `--border` | `#2a2e39` | Dividers + dial/bar tracks |
| Void Canvas | `--porcelain` / `--surface` | `#1f232e` | Primary surface: main pane, cards, control fills, active chips |
| Abyss | `--cloud` / `--surface-sunken` | `#0c0f19` | Sunken rails, segmented tracks, wells, chips |
| Singularity | `--obsidian` | `#060913` | Deepest surface for the highest-contrast containers |

### Text roles

| Token | Value | Use | Contrast on Void |
|-------|-------|-----|------------------|
| `--text-strong` | `#f2f6fa` | Headings, titles, emphasis | ~15:1 |
| `--text` | `#d4d8e0` | Body / reading text | ~11:1 |
| `--text-muted` | `#a2a8b4` | Summaries, secondary copy | ~6.8:1 |
| `--text-faint` | `#888e9b` | Meta, captions (lowest we let text go) | ~4.6:1 |

Hover surfaces use a single light wash, `--hover` (`rgba(255,255,255,0.04)`): rows light up rather than recede.

## Typography

Three families, each with a job. Latin glyphs pick up the webfont; CJK falls back to the system Chinese face (PingFang SC / Hiragino Sans GB / Microsoft YaHei) so 中文 stays crisp without shipping a CJK webfont.

### Plus Jakarta Sans — body + UI
Weight carries hierarchy. Body 500, button/nav 600, subheadings 700. `--font-sans`.
- **Weights:** 400, 500, 600, 700, 800

### Space Grotesk — display headlines (`--font-display`)
An Obviously stand-in: wide apertures, a slightly retrofuturist swagger against the void. Used for page + section titles and the mobile nav takeover.
- **Weights:** 400, 500, 600, 700 · headings 700, `-0.01em`

### JetBrains Mono — instrument figures (`--font-mono`)
The mission-control readout: the signal dial number, stat values + labels, badges, page count, ranks, sims, and pipeline figures. Tabular by default.
- **Weights:** 400, 500, 600

### Type scale (implemented)

| Role | Size | Line height | Notes |
|------|------|-------------|-------|
| page title | `clamp(1.9rem, 4vw, 2.75rem)` | 1.08 | Space Grotesk 700, `-0.02em` |
| section title | 18px | 1.2 | weight 700 |
| item title | 18px | 1.3 | weight 700 |
| body | 15-16px | 1.5 | weight 500 |
| meta / readout | 12-14px | 1.4-1.5 | JetBrains Mono, tabular-nums |

## Spacing & Layout

**Base unit:** 4px · **Density:** comfortable

- **Reading width:** 1160px (left-aligned in the main pane)
- **Card padding:** 32-40px (`--space-8`/`--space-10`)
- **Element gap:** 16-24px
- **Sidebar rail:** 232px (Abyss), main pane Void, split by a hairline
- **Shell height (mobile top bar):** 56px

### Border radius

| Token | Value | Use |
|-------|-------|-----|
| `--radius-pill` | 999px | Buttons, vote/sort/switch controls, nav pills, chips |
| `--radius-lg` | 36px | Large surfaces |
| `--radius-md` | 16px | Notice, kb-note, table wrap, cards |
| `--radius-input` | 14px | Text inputs |
| `--radius-badge` | 12px | Tags + badges |
| `--radius-sm` | 10px | Images, code blocks |

## Components

### App shell (`.app`)
A two-tone split, no floating card: an Abyss sidebar rail (`--surface-sunken`) and a Void main pane (`--surface`), divided by a hairline. The mobile top bar is translucent Void glass with `backdrop-filter` blur. The brand mark is the inverted action pill: a Lunar-White rounded square with a dark "S".

### Nebula stroke + glow detailing
The gradient is spent only on edges, never on the background, and never on the type -- selected labels stay crisp Lunar-White so the gradient reads in the ring. A selected sidebar item is a white label on a Void pill wrapped in a strong 2px nebula-gradient ring; a selected sort/filter tab and the search segmented control earn the same white label + 2px ring; a focused input and a hovered ghost button draw a 1px gradient stroke; hovered feed/topic/result cards and vote chips light up a 1px gradient ring; stat panels wear a quieter always-on gradient hairline. The selected/active rings are 2px (a clear selection edge); the rest are a 1px hairline. Strokes are a masked ring inside a pseudo-element (no layout shift, rides view transitions), or the padding-box / border-box double-background trick for inputs (which cannot carry a pseudo-element). The brightened `--nebula-bright` keeps the gradient legible on the void.

Every lit edge also blooms: a soft twin-hue glow (`--glow-nebula-soft` on hovered cards and active tabs, `--glow-nebula` on focus rings) makes the void read as lit from within. The selected nav label and its pill ring share one `drop-shadow` so text and stroke glow together; the white CTA and brand mark carry `--glow-white`; and the strongest signal dials glow faint white. Glow is purely a lighting accent -- elevation still comes from tone + hairline, never from these blooms.

### Mobile nav takeover (`.navmodal`)
Full-screen translucent Void glass (`backdrop-filter` blur). Large Space Grotesk links fade + rise in with a per-item stagger; the hamburger morphs to an X. Esc / backdrop / link-tap closes; body scroll locks while open.

### Feed item (`.item`) + signal dial (`.signal`)
A borderless row separated by a hairline; on hover it lifts (`translateY(-2px)`) onto the `--hover` wash. The signal dial is **monochrome**: an SVG ring whose arc length is the 0-100 score on a brightness ladder (high = Lunar White, mid = Mist, low/default = Gunmetal on a near-void track). The score reads in JetBrains Mono. No colour in the dial.

### Primary button (`.btn--primary`)
The signature inverted CTA: a Lunar-White pill with dark Void text and no border, wearing a soft white glow (`--glow-white`) so it reads as lit on the void. Hover brightens to pure white and the bloom intensifies. The glow is a lighting accent, not an elevation shadow.

### Ghost button (`.btn--ghost`)
Void fill, strong hairline border, light text; hover earns a violet (`--accent`) border + text.

### Vote pills (`.vote__btn`)
Ghost pills (Void, strong-border). Hover earns a violet border/text. Active (up) inverts to a Lunar-White fill with dark text; active (down) uses a Mist fill (a dimmer-than-white pill). Activation blooms a one-shot ring + thumb pop.

### Favorite star (`.star`)
Active = amber (`--amber`), a scarce warm "saved" marker. Saving blooms an amber ring.

### Segmented control (`.sort` / `.seg`)
A pill track on the Abyss surface; the active chip is a Void pill that pops by tone, lit by a hairline inset, and slides between options via View Transitions.

### Toggle switch (`.switch`)
Off = Gunmetal track; on = Ultraviolet (`--accent`) track with a white knob.

### Tag / badge (`.tag` / `.badge`)
12px radius, Abyss fill, muted text, JetBrains Mono on badges. `--tag--accepted` = mint fill + mint text (scarce). Status badges carry a dot (Gunmetal idle, Lunar White on).

### Data table (`.table`) + stat tile (`.stat`)
Abyss header, hairline row borders, mono tabular figures, light-wash row hover. Stat tiles are Abyss wells with mono values + labels.

### Pipeline bar (`.bar`) + topics board (`.topic`)
Both monochrome: the #1 topic and active pipeline fill are Lunar White; lower bars are Gunmetal. Strength reads as brightness, not hue.

## Do's and Don'ts

### Do
- Use the inverted Lunar-White `#f2f6fa` for **every** filled action: buttons, vote-active, toggle-on, brand mark, active pills. It is the only filled-action colour, with dark Void text on it.
- Spend chromatic colour scarcely and by meaning: violet links, signal-blue live pulse, amber saved star, mint accepted tag. Each chromatic pixel does real work.
- Reserve the nebula gradient for edges: the selected nav/filter stroke (a strong 2px ring), a focused input, a hovered ghost button, hovered feed/topic/result cards and vote chips, the always-on stat-panel hairline, and the scroll-progress bar. Never a background fill; never on text.
- Let lit edges bloom with the nebula glow (`--glow-nebula` / `--glow-nebula-soft`), the CTA and brand mark with `--glow-white`. Treat glow as lighting, not elevation.
- Express *spatial depth* with surface steps that go darker (Void → Abyss → Singularity) and hairline borders, not elevation drop shadows.
- Keep the signal dial and trend bars monochrome (bright = strong, dim = weak).
- Carry hierarchy with weight; set readout figures in JetBrains Mono.
- Hold body text at or above `--text-faint` (~4.6:1); verify AA in dark.
- Give every animation a `prefers-reduced-motion` fallback; never gate content visibility on JS.

### Don't
- No chromatic CTA. Never colour a primary button or filled action.
- Don't apply the nebula gradient to text: it destroys legibility. Selected nav/filter labels stay crisp Lunar-White; the gradient lives in their ring, not the type.
- Don't spread one accent into another's role; their power is scarcity and meaning.
- Don't overuse the glow: it lights edges and the CTA only -- never floods backgrounds or large surfaces.
- No drop shadows for *elevation*: spatial depth is tone + hairline (the nebula glow is lighting, not elevation).
- Don't lighten elevated surfaces; elevation goes darker, not lighter.
- No second light theme; the dark theme is locked.

## Motion

State-bearing and brief, built from transform / opacity / blur. The scroll-progress bar (nebula gradient) and the live pulse (signal-blue) are the only colour in motion, and both are tied to status. Every effect degrades under `prefers-reduced-motion`; content is never gated on JS.

**Tokens** (`globals.css`): easings `--ease-out-quart/quint/expo` and `--ease-island` `cubic-bezier(0.32,0.72,0,1)`; durations `--dur-fast` 120ms, `--dur` 180ms, `--dur-slow` 320ms, `--dur-reveal` 560ms. No bounce, no elastic.

| Moment | Motion | Material / timing |
|--------|--------|-------------------|
| Page-head arrival | One-time blur-in + rise | translate + blur + opacity, expo, 600ms |
| Feed item reveal | Rise + sharpen as it enters view; per-batch stagger | transform + blur + opacity, expo, 560ms |
| Signal dial | Arc sweeps 0 to score as the card reveals | `stroke-dashoffset` draw on `.is-in`, expo, 560ms |
| Reading progress | Top nebula-gradient bar scrubbed by scroll | scroll-driven scaleX, `animation-timeline: scroll()` |
| Live pulse | Running status dot pulses signal-blue | `box-shadow` ring, 1.6s loop |
| Navigation (sort / nav) | Soft crossfade + active sort chip slides | View Transitions API (MPA) |
| Mobile takeover | Hamburger to X; links fade + rise, staggered | transform + blur + opacity, island ease |
| Vote / save | Press scale, then a one-shot ring + icon pop | transform + box-shadow ring, expo |
| Item hover | Subtle lift onto the light wash | translateY(-2px), slow |

Scroll-driven and View-Transition effects are progressive enhancements (Chromium-first); other engines fall back gracefully with no loss of function.

## Surfaces

- **Void Canvas** (`#1f232e`, `--surface`) — main pane, cards, control fills, active chips
- **Abyss** (`#0c0f19`, `--surface-sunken`) — sidebar rail, segmented tracks, wells, tags
- **Singularity** (`#060913`, `--obsidian`) — deepest, highest-contrast containers
- **Action** (`#f2f6fa`, `--action`) — inverted filled buttons + active states

## Imagery

No photography, illustration, or decorative graphics. The clean void canvas, with the nebula gradient surfacing only on selected/focused edges, is the visual statement. Icons are minimal monoline, ~1.5-2px stroke, in light foreground tones (never multicolour). The product content is the hero; the chrome stays out of the way.

## Layout

A full-width dark canvas: an Abyss sidebar rail (brand + nav) beside a Void main pane holding a left-aligned reading column (max-width 1160px, padded 32-40px). The canvas carries no background glow; the nebula gradient appears only on selected/focused edges. Sections flow vertically with no dividers between bands. Below 860px the sidebar collapses to a translucent top bar with a hamburger takeover; below 600px the reading column goes full-bleed.

## Similar Brands

- **Astro** - the direct reference: Void canvas, nebula gradient on selected edges, inverted white CTA, wide display type, instrument-panel mono, pill controls.
- **Vercel** — dark cosmic canvas with a single brand-gradient hero glow and pill-shaped CTAs.
- **Linear** — near-black background, hairline-border elevation, geometric headlines, pill controls.
- **GitHub** (dark) — achromatic palette, monospace accents, instrument-panel badge/tab aesthetic.
