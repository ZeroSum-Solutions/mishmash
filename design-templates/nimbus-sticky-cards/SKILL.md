---
name: nimbus-sticky-cards
description: |
  Scroll-driven "platform accordion" section for the fictional cloud storage brand **Nimbus Grid**, built as a single self-contained HTML page. A sticky viewport pins a two-column layout — four mono-label tabs on the left, a stack of four full-bleed cards on the right — while a plain scroll listener slides each card up from below and clips it down to a thin header strip as the next card takes over, so the four capabilities (programmable infra, data residency, elastic scaling, unified visibility) collapse into a readable stack by the end of the scroll. Wrapped in a slim header, a short text-only intro, and a one-line footer so the section reads as a placed page rather than a stranded fragment.
tags:
  - "component"
  - "motionsites"
  - "cards"
  - "tabs"
  - "scroll-driven"
  - "dark-mode"
  - "saas"
triggers:
  - "nimbus grid"
  - "nimbus sticky cards"
  - "sticky cards"
  - "sticky stack"
  - "platform accordion"
  - "scroll stack"
  - "tab accordion"
  - "card stack"
  - "storage platform"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=nimbus-sticky-cards"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build a scroll-driven platform accordion like this one, in this template's own visual system, but for my real product. Follow the build spec exactly — the sticky viewport, the tab list, and the card-stacking scroll math are part of the identity. Ask only for the missing essentials first: brand name, the four capability names, and their copy and code/metric panels."
---

# Nimbus Grid Platform — Sticky Stacking Cards

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Scroll-driven "platform accordion" section for the fictional cloud storage brand **Nimbus Grid**, built as a single self-contained HTML page. A sticky viewport pins a two-column layout — four mono-label tabs on the left, a stack of four full-bleed cards on the right — while a plain scroll listener slides each card up from below and clips it down to a thin header strip as the next card takes over, so the four capabilities (programmable infra, data residency, elastic scaling, unified visibility) collapse into a readable stack by the end of the scroll. Wrapped in a slim header, a short text-only intro, and a one-line footer so the section reads as a placed page rather than a stranded fragment.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, the four capability
   labels, their descriptions, and the code/metric panel contents. Keep panel line counts
   close to the originals so the stacking math still reads well.
3. **Preserve the design system.** The palette, type scale, spacing, and the scroll-driven
   card math are the identity — do not substitute fonts, recolour the palette, or change
   the collapsed-strip height without re-checking the JS constants that depend on it.
4. **Extend by duplicating cards**, keeping the tab/card pair count in sync — every
   `data-accordion-tab` needs a matching `data-accordion-card`, and the scroll math divides
   the section's scroll range by `cards.length - 1`.
5. **Keep the interaction accessible.** Tabs stay a real `role="tablist"`/`role="tab"`
   composite with roving `tabindex` and arrow-key navigation; cards stay real
   `role="tabpanel"`s that are never removed from the accessibility tree, even while
   visually clipped to a header strip.

## Build spec

### Palette and type

- `--bg: #17130d` (page), `--ink: #fff4d5` (primary text), `--muted: #dacaa1` (secondary
  text), `--accent: #ead09a` / `--accent-2: #ffd879` (the two chromatic gold tokens —
  MishMash's recolor pass targets these), `--deep: #4d3f24`, `--line`/`--glass`/
  `--glass-strong` as translucent off-white overlays at three opacities.
- `IBM Plex Sans` (400/500) for body and headings, `IBM Plex Mono` (400/500) for the tab
  labels and the code/metric panels — both via Google Fonts CDN, both weights loaded.
- The section's own background is a near-black `#050604` radial-gradient wash, distinct
  from the page's `--bg`; that contrast is original to the prompt and is kept.

### Layout

- **Page chrome (original to this build, not fidelity-bound):** a slim header (`Nimbus
  Grid` wordmark + a `Platform` label), a text-only intro block (kicker, one-line H1, one
  supporting paragraph, and a small bouncing "Scroll" cue), the section itself, and a
  one-line footer.
- **The section (`.platform-accordion`, fidelity-bound):** `min-height: 420svh` — the
  section is 4.2 screens tall so there is scroll room for the handoff between all four
  cards. `.accordion-inner` is `position: sticky; top: 0;` inside it, pinning a
  `100svh` viewport frame with a `0.22fr` tab column and a `0.78fr` card column.
- **Cards** are absolutely positioned inside `.accordion-stack` (`min(80svh, 820px)`
  tall) and stack via `transform: translateY(var(--card-y))` plus
  `clip-path: inset(0 0 var(--card-clip-bottom, 0px) 0)` — the active card is fully
  revealed with a two-column `copy | visual` grid (headline + description on the left,
  a gold gradient panel holding a dark macOS-style code window on the right); a completed
  card collapses to a ~84px header strip (96px on mobile) showing only its title, stacked
  above the newer card, separated by a hairline border.
- **Responsive:** at ≤820px the tab list becomes a 2-column grid above a full-width card
  stack, and cards switch to a single `copy` row above `visual`; at ≤520px the tab grid
  drops to one column and type sizes step down. Both breakpoints and every value inside
  them are copied verbatim from the prompt.

### Motion

- **Scroll-linked, not animated.** A `scroll`/`resize` listener computes the section's
  scroll progress (`0`→`1`), maps it to a float index across the four cards, and derives
  each card's `--card-y` / `--card-clip-bottom` directly from that progress — the stack
  moves exactly as fast as the user scrolls; there is no injected easing or duration on
  the core mechanism. The math (collapsed-height constants, segment-progress formula) is
  ported unchanged from the prompt's JS.
- **Decorative motion only:** the tab's `color`/`transform` transition (160ms ease) on
  activation, `translateX(2px)` nudge on the active tab, and the intro's bouncing scroll
  cue. All three are neutralized under `prefers-reduced-motion: reduce`; the scroll-linked
  stacking itself is left untouched there since disabling it would hide the section's
  content rather than just its decoration.
- Clicking a tab, or moving focus to it with the arrow keys, calls the same
  `scrollTo`-based jump the prompt specifies (now shared by both input paths); under
  reduced motion the jump uses `behavior: "auto"` instead of `"smooth"`.

### Accessibility (additive; SPEC-BATCH2 §4)

- **Tabs** carry the prompt's own `role="tablist"` / `role="tab"` / `aria-selected`, plus
  roving `tabindex` (only the last-focused tab is in the natural Tab order) and Left/Right
  **and** Up/Down/Home/End arrow-key navigation, since the nav is laid out as a vertical
  list.
- **Cards** are additionally marked `role="tabpanel"` with `aria-labelledby` back to their
  tab. They are never hidden from assistive tech — clip-path only changes what is visually
  cropped, so a screen reader can still reach a "collapsed" card's full copy. No
  `aria-hidden`/`inert` is applied to inactive cards for this reason.
- **Semantic list markup:** the card stack is a real `<ul>`/`<li>` (each `<li>` is
  `display: contents` so it adds no box and cannot disturb the absolute-positioning math
  the cards depend on) instead of the prompt's plain `<div>` wrapper — an assistive-tech
  user is told "list of 4" rather than four unrelated articles.
- **Visible focus:** a global `:focus-visible` ring in `var(--accent)` on every link and
  button, including the tabs.
- No images anywhere in this build (the section is text and code panels only), so there is
  no alt-text surface to get wrong.

### Deviations from the prompt (all permitted, none change the rendered page)

1. Two `rgba()` gradient stops that reproduce `--accent` at partial opacity
   (`rgba(234, 208, 154, …)`, the exact decimal RGB of `#ead09a`) are rewritten as
   `color-mix(in srgb, var(--accent) N%, transparent)` so MishMash's recolor pass can
   shift them with the token. Every other literal color (including the second, unrelated
   `rgba(106, 91, 52, 0.68)` gradient stop and every off-white overlay) is left exactly as
   written, since it doesn't correspond to a declared root token.
2. `.accordion-stack` changed from `<div>` to `<ul>` (children wrapped in
   `display: contents` `<li>`s) for semantic list markup — required additive `list-style:
   none; margin: 0; padding: 0;` resets keep the rendered box identical to the original
   bare `<div>`.
3. `id`/`aria-controls`/`aria-labelledby`/`role="tabpanel"` and roving `tabindex` added to
   the tabs and cards; keyboard handling added on the nav. None of it changes default
   appearance — the focus ring only appears on `:focus-visible`.
4. Multi-file Vite scaffold (`index.html` + `styles.css` + `script.js` +
   `package.json`) collapsed into one `example.html` with inline `<style>`/`<script>`, per
   the standing SPEC.md rule.
5. Page chrome (header, intro copy, scroll cue, footer) is original to this build — the
   prompt describes the section only. No hero, no extra sections; the copy is short and
   references the section's own four capability names.

No de-branding was needed: "Nimbus Grid" is already fictional, and the card copy (region
codes, storage figures) is invented example data, not a real vendor's claims.
