---
name: technical-specs-tabs
description: |
  Dark "Technical Specifications" data section for the fictional aerospace propulsion
  company **EngineTech**, built as a single self-contained HTML page. A two-column header
  (editorial headline + supporting summary) sits above a four-way ARIA tablist (Cities &
  Infrastructure, Materials & Manufacturing, Fuels & Upstream, H2 Hydrogen) that drives an
  animated horizontal bar chart — range-envelope indicators, glowing fill bars, spark-trace
  markers, and a 0–100 axis — with a staggered entrance replay on every tab switch. Full
  ARIA tablist/tab/tabpanel semantics, roving tabindex, and Left/Right/Home/End keyboard
  navigation.
tags:
  - "component"
  - "motionsites"
  - "tabs"
  - "data-visualization"
  - "dark-mode"
  - "aerospace"
  - "bar-chart"
triggers:
  - "enginetech"
  - "technical specifications"
  - "spec tabs"
  - "stats tabs"
  - "bar chart tabs"
  - "aerospace stats"
  - "data tabs"
  - "operating envelope"
  - "range indicator chart"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=technical-specifications"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build a dark technical-specifications tabs section like this one, in this template's own visual system, but for my real product. Follow the build spec exactly — palette, typography, chart composition, and motion are part of the identity. Ask only for the missing essentials first: company name, the four category labels, and the bar data (label, value, target, operating range, note) for each."
---

# Technical Specifications — EngineTech Stats Tabs

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A dark data-visualization section for the fictional aerospace propulsion company
**EngineTech**. A two-column header pairs a thin editorial headline with a right-aligned
supporting paragraph. Below it, a four-way ARIA tablist switches between four datasets —
Cities & Infrastructure, Materials & Manufacturing, Fuels & Upstream, and H2 Hydrogen —
each rendering into the same animated horizontal bar chart: an operating-range envelope,
a glowing gradient fill bar, six spark-trace markers along each bar, a right-aligned value
label, and a 0–100 axis strip. Switching tabs cross-fades the summary text and fully
replays the chart's staggered entrance animation for the new dataset.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real company name, headline, summary
   copy, tab labels, and the four datasets (each bar needs `label`, `value`, `target`,
   `rangeStart`/`rangeEnd`, `unit`, `note`, and a 6-point `trace` array of x-positions).
   The `DATA` object near the top of the inline `<script>` is the single source of truth —
   edit it there and both the initial paint and every tab switch stay in sync.
3. **Preserve the design system.** The palette, type scale, spacing rhythm, chart
   mechanics, and motion in the build spec below are the identity — do not substitute
   fonts, recolor the palette, or strip the range/spark decorations.
4. **Extend by duplicating a bar row or a tab**, never by importing a layout from another
   template. Keep the 4-column tab grid and the label/track two-column bar-row grid intact.
5. **Keep motion accessible.** Every animation stays behind `prefers-reduced-motion`, and
   the tablist keeps full roving-tabindex keyboard support, as the build spec requires.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="technical-specs-tabs" type="text/html" title="Technical Specifications — EngineTech Stats Tabs">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished page in `example.html`.

### Palette tokens (`:root`)

- `--hero-blue: #7191d0` / `--hero-blue-soft: #aab8d5` — the tab-underline gradient and
  the base of every accent alpha token. Both are fully opaque, parseable, chromatic colors
  so MishMash's recolor knob visibly retints the underline and fill-bar gradients.
- `--hero-blue-fill: #8fb0ef` / `--hero-blue-pale: #d6e3ff` — the mid and end stops of the
  bar-fill gradient.
- Eight `rgb(… / alpha)` alpha tokens (`--hero-blue-a05` … `--hero-blue-soft-a62`) hold the
  exact translucent stops used in the background radials, the range-indicator fill/border,
  the fill-bar glow, and the spark-point crosshair — each gradient references one of these
  instead of a literal color, per the recolor-compatibility rule.
- Neutral scaffolding (`#111414`, `#171a1a`, `#f7f8f8`, and all `rgb(255 255 255 / …)`
  whites) stays literal — it is protected by the recolor pass's chromatic filter by design.

### Typography

`"Geist", "Inter", ui-sans-serif, system-ui, …` — Geist is not on Google Fonts, so **Inter**
(variable, `wght@100..900`) is loaded from the Google Fonts CDN as the nearest equivalent;
`Geist` stays first in the font stack for fidelity but resolves straight through to Inter in
every browser. Headline is weight 300 at `clamp(29px, 3.2vw, 54px)`; the tab bar, chart
head labels, bar labels, and axis all use fine-grained weight steps (430–760) exactly as
specified, sized with `clamp()` throughout for fluid type.

### Layout, section by section

1. **Page chrome** — a single-line dark nav strip (`EngineTech` wordmark only) so the
   section reads as placed on a page rather than stranded on a blank canvas. No invented
   hero, no extra sections.
2. **`.stats` section** — full-bleed dark card, `min-height: 100vh`, a layered background
   of two radial accent washes over a near-black linear gradient.
3. **`.stats__header`** — two-column grid (`1.08fr` / `0.72fr`, collapsing to one column at
   980px): thin-weight headline on the left, a fade/slide-in summary paragraph on the right
   whose text swaps per active tab.
4. **`.stats__tabs`** — a 4-column ARIA tablist with a bottom border and a gradient
   underline (`::after`) that scales in on the active tab.
5. **`.statschart`** — the bordered, rounded data card: a faint repeating vertical grid,
   a chart head (uppercase dataset title + "Operating envelope" label), four bar rows, and
   a 0–100 axis strip. Its inner markup (head + bars + axis) is fully rebuilt on every tab
   switch from the same `DATA` object that renders the initial paint.
6. **Each bar row** — a label/track two-column grid containing a range-envelope indicator,
   a glowing gradient fill bar sized to `value%`, a right-aligned value label, and six
   spark-trace points (alternating 34%/62% vertical position, cycling through three size
   variants) positioned along the bar per the dataset's `trace` array.

### Motion inventory

- `stats-row-in` — bar rows fade/slide up, staggered 0/90/180/270ms per row.
- `stats-range-in` — the range-envelope box scales in from `0.6`, delayed 60ms past the row.
- `stats-fill` — the value bar scales in from `0`, delayed 110ms past the row (the visually
  dominant animation).
- `stats-point-in` — each of the 6 spark points fades/scales in, delayed 260ms past the row
  plus 70ms per point, for a left-to-right "scanning" feel.
- Summary paragraph cross-fades (420ms) independently of the chart on every tab switch.
- Tab switch sequence: clear `is-visible`/`is-ready` → 140ms delay → swap text/markup → next
  `requestAnimationFrame` → re-add the classes, replaying every animation above from zero.
- `prefers-reduced-motion: reduce` disables every keyframe/transition and snaps straight to
  the settled state (summary visible, bars filled, ranges and sparks at rest) — including on
  tab switch, which becomes instant instead of staged.

### Accessibility (additive, per the manifest's binding note)

- `.stats__tabs` is `role="tablist"`; each button is `role="tab"` with `aria-selected`,
  `aria-controls` pointing at the single `role="tabpanel"` chart, and roving `tabindex`
  (`0` on the active tab only).
- `ArrowRight`/`ArrowLeft` move focus and activate the adjacent tab with wraparound;
  `Home`/`End` jump to the first/last tab. All four are real keyboard interactions, not
  just click handlers.
- The chart panel carries `aria-live="polite"` and its `aria-labelledby` is repointed to
  the newly active tab's id on every switch, so assistive tech announces the dataset change.
  Each bar row is `role="group"` with a composed `aria-label` (label, value, target,
  operating range) so the numbers are available even though the value/track elements
  themselves are `aria-hidden`.
- Focus-visible outlines on the tabs and the chart panel are additive only — they change
  nothing about the resting-state render.

### Responsive breakpoints

- **980px** — header collapses to one column; tabs become a horizontally scrollable flex
  row (`flex: 0 0 min(260px, 76vw)` each); bar rows and the axis collapse to a single
  column, hiding the empty axis spacer cell.
- **620px** — headline shrinks to `clamp(26px, 8vw, 42px)`; the chart's fixed min-height is
  dropped in favor of natural height; the axis grid drops from 11 ticks to 6 by hiding every
  even-indexed tick (`0, 20, 40, 60, 80, 100` remain).
- Holds at 375px width with no page-level horizontal scroll (the tab strip's own scroll
  region is deliberate and contained).

## Verification

Rendered headlessly at 1440×900 against the prompt's `preview_url` reference capture:
header proportions, tab underline, chart card border/grid, bar gradient direction and
stops, range-indicator box position, and spark placement all matched. Tab click and
keyboard switching (`ArrowRight`/`ArrowLeft`/`Home`/`End`) were driven directly in a
Playwright-launched Chromium and verified via `aria-selected`, roving `tabindex`, and
chart-content assertions; `prefers-reduced-motion: reduce` was verified to apply instantly
with no animation delay; 375px mobile viewport confirmed no page-level horizontal scroll.
