---
name: pixel-grid-case-studies
description: |
  Monochrome "Projects / Case Studies" section built as a single self-contained
  page. A centered header (badge + two-line heading) sits above a 2x2 grid of
  four case-study cards; each card reveals a 12x8 pixel-dissolve grid on
  hover, focus, and touch, plus small "magnetic" squares that spring toward
  the pointer. A footer pairs a CTA button with an infinite client-logo
  marquee. Fictional client names replace the source prompt's real companies.
tags:
  - "component"
  - "motionsites"
  - "case-studies"
  - "portfolio"
  - "monochrome"
triggers:
  - "pixel grid"
  - "case studies"
  - "case study grid"
  - "projects grid"
  - "portfolio grid"
  - "pixel dissolve"
  - "magnetic squares"
  - "hover reveal"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=pixel-grid-hover"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build the Pixel Grid case-studies section as a self-contained page in this template's own visual system. Follow the build spec below exactly — the 2x2 grid, the pixel-dissolve hover reveal, and the magnetic accent squares are part of the identity. Ask only for the missing essentials first: brand name, real case-study names/categories/years, and cover imagery."
---

# Pixel Grid Case Studies — Hover-Dissolve Projects Section

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A pure black-and-white case-studies grid built to stand alone as its own page.
The section is the deliverable: its own header gives it context, so the page
wrapper is nothing more than a plain white `<body>` around it — no invented
hero, nav, or filler sections.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace the four case studies** — title, category, year, and cover
   image — with the user's real client work. Keep the 2x2 / four-card shape
   unless the user explicitly wants more; the grid, the pixel counts, and the
   footer marquee all assume four cards.
3. **Preserve the design system.** The palette is deliberately grayscale;
   don't introduce brand color into the cards, badge, or CTA. The one
   chromatic token (`--accent`) is reserved for the keyboard focus ring — see
   Palette below — and should stay that way even when rebranding.
4. **Extend by duplicating a card**, never by importing a layout from another
   template. Update the card's markup (image, title, category, year) and its
   `MAGNETIC_DEFS` entry in the inline `<script>` together, or the new card's
   magnetic squares will render with a stale key and fall back to none.
5. **Keep motion accessible.** The pixel-dissolve reveal fires on `:hover`,
   `:focus-within`, and a `.is-touched` tap fallback alike, and everything
   respects `prefers-reduced-motion` — preserve all three when extending.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="pixel-grid-case-studies" type="text/html" title="Pixel Grid Case Studies — Hover-Dissolve Projects Section">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished page — see `example.html` for the exact values.

### Palette

- `--paper: #ffffff` / `--ink: #000000`, plus opacity steps used verbatim from
  the source: `--ink-10` (0.10, mobile marquee divider), `--ink-20` (0.20,
  footer button borders), `--ink-40` (0.40, muted heading words), `--ink-60`
  (0.60, category labels and footer copy), `--ink-80` (0.80, pixel-dissolve
  blocks and marquee name text), `--ink-85` (0.85, CTA hover), `--paper-30`
  (white at 0.30, card plus-button border).
- `--accent: #4a6cf7` — the one genuinely chromatic root token, used **only**
  as the `:focus-visible` outline color. The source design has no color
  anywhere in it (it's intentionally black-and-white), so this token is
  additive accessibility plumbing, not a design element: it never appears in
  the resting-state render, only on keyboard focus.
- No gradients anywhere in this design — every surface is a flat fill, so
  there is nothing to rewrite onto `var()` stops (permitted deviation 8 in
  `FIDELITY.md` doesn't apply here).

### Type

DM Sans (400/500) for all text, loaded from Google Fonts
(`family=DM+Sans:wght@400;500`), matching the source's
`fonts.googleapis.com/css?family=DM+Sans:500,400` request against the current
Google Fonts API.

### Layout

- `<section id="case-studies">`, full-width, white background, black text.
- **Top area:** 8 decorative floating squares (fixed positions/sizes ported
  verbatim from the source) parallax against scroll and bob in place
  independently; a centered header holds a black "Projects" badge and a
  two-line heading — "Insights from **Our**" / "**Case Studies**" — where the
  bold segments render at `black`, the muted segments ("Our", "Case Studies")
  at `--ink-40`.
- **Grid:** a semantic `<ul>` of four `<li>` cards, one column on mobile, two
  columns at `md:` (≥768px). Each card is a single focusable `<a href="#">`
  at a 4:3 aspect ratio containing: the cover photo; a 12x8 grid of
  pixel-dissolve blocks; 5-6 magnetic accent squares; a "+" badge (top
  right); and a white info plate (bottom left, `max-width: 70%`) with the
  case title (`<h3>`), category, and year.
- **Footer:** a left column (a "+" badge, a fixed paragraph of studio copy,
  and a "Let's work together" CTA with a diagonal-arrow badge that lifts on
  hover) beside a right column holding an infinite marquee of 8 client logos
  (SVG icon + name), doubled to 16 for a seamless loop, paused on hover.
- The four case studies (fictional, see Deviations): **CoraX** — Brand
  Strategy & Product Design, 2026; **Kelvae®** — Web Design & Identity, 2025;
  **Eduvane** — Brand Strategy & Web Design, 2023; **Verdalux** — Brand
  Strategy & Web Design, 2022.

### Motion inventory

All easing uses the source's exact cubic-bezier, `cubic-bezier(0.22, 1, 0.36,
1)` — an explicit prompt value, kept verbatim rather than the repo's own
default curve.

- **Floating header squares:** each of the 8 squares combines two motions
  simultaneously, matching the source's layered `useTransform` + `useSpring` +
  keyframe bob: an outer wrapper receives a scroll-linked parallax transform
  (`progress * -(80 + index * 30)`, `progress` derived the same way as this
  library's `useParallax` convention — `(viewportHeight - rect.top) /
  (viewportHeight + rect.height)`, clamped `[0, 1]`), smoothed frame-by-frame
  through a hand-rolled spring integrator with the source's exact constants
  (`stiffness: 40, damping: 20, mass: 1`); an inner wrapper runs an
  independent CSS `squareBob` keyframe (`translateY(0 → -10px → 0)`,
  `ease-in-out`, duration `3s + index * 0.4s`, delay `index * 0.3s`,
  infinite).
- **Header + card entrances:** `IntersectionObserver`-driven, fire once.
  Header: `opacity 0 → 1`, `translateY(24px → 0)`, `0.7s`, `rootMargin: 0px
  0px -60px 0px` (porting the source's `margin: "-60px"` inView option).
  Cards: same fade/translate shape over `30px`, `0.7s`, staggered
  `transition-delay: index * 0.1s`.
- **Pixel-dissolve hover reveal:** a 12x8 grid of blocks per card, each
  `scale(0)/opacity:0` at rest. Entering (`:hover`, `:focus-within`, or
  `.is-touched`) transitions to `scale(1)/opacity:1` over `0.25s` with a
  per-block `transition-delay` of `(row + col) * 0.018s` (diagonal wipe from
  top-left); leaving reverses over the same duration with delay `((8 - row) +
  (12 - col)) * 0.012s` (diagonal wipe toward bottom-right) — both formulas
  ported exactly from the source's stagger math.
- **Magnetic squares:** each card's 5-6 accent squares run a per-axis spring
  (`stiffness: 80, damping: 18, mass: 0.6`, the source's exact constants)
  toward `(pointerNorm - squareBaseNorm) * 40` px on `pointermove`, and back
  toward the same formula evaluated at a rest pointer of `(0.5, 0.5)` on
  `pointerleave` — matching the source's "pointer resets to 0.5, 0.5" rule
  literally, including for the squares' idle position before any interaction.
- **Marquee:** `.marquee-projects` / `@keyframes marqueeProjects` — injected
  verbatim from the prompt's own `<style>` block, `translateX(0 →
  -50%)`, `28s linear infinite`, paused on `:hover`.
- **CTA arrow badge:** `margin-bottom` steps from `1.5rem` to `2.25rem` over
  `0.3s` on hover/focus, matching the source's `mb-6 → mb-9` lift.
- **`prefers-reduced-motion: reduce`:** additive only, verified by driving the
  page under the media feature — header/cards render `opacity: 1` /
  `translate: none` immediately (no observer wait), the bob keyframe and
  scroll parallax transform are removed, the pixel grid's transition
  durations collapse to near-zero (so hover/focus/touch still work, just
  instantly), the magnetic squares stop transitioning, and the marquee holds
  still via `animation-play-state: paused` rather than merely slowing down.

### Accessibility affordances

- **Hover enhances, never gates.** Every case card's title, category, year,
  and "+" indicator are always visible in the resting state — nothing is
  hidden behind the pixel-dissolve overlay. The overlay and magnetic squares
  are decorative motion layered on top of already-visible content.
- **Keyboard parity, driven and verified with Playwright.** Each card is a
  single focusable `<a>`; `:focus-within` on the card triggers the identical
  pixel-dissolve transition that `:hover` does. Tabbing to a card in a
  Playwright session measurably brought its overlay to `opacity: 1`, and the
  visible `:focus-visible` ring (the one chromatic `--accent` token) is drawn
  around the whole card.
- **Touch parity.** A `touchstart` on a card toggles a `.is-touched` class
  that drives the same CSS rule as `:hover`/`:focus-within`; tapping outside
  any card, or tapping a different card, clears it. Verified in a
  Playwright session with `hasTouch: true` at a 390px viewport — the tap
  reveals the pixel grid exactly as hover does, and there is no horizontal
  overflow at 375px.
- **Semantic structure.** The grid is a real `<ul>`/`<li>` list; each case
  title is an `<h3>`; the section heading is an `<h2>`, referenced by
  `aria-labelledby` on the `<section>`. Each card's accessible name
  (`aria-label` on the `<a>`) states the title, category, and year together,
  since the visual title/category/year are three separate text nodes.
- **Meaningful alt text.** Each cover photo's `alt` describes what is
  literally depicted (e.g. "a dramatic coastal cliff and mountain landscape
  at dusk") rather than repeating the case title or inventing a claim about
  the fictional client's work.
- **Decorative elements hidden from assistive tech.** The floating header
  squares, the pixel grid, the magnetic squares, the "+" badges, and the
  marquee's icons/duplicate track are `aria-hidden="true"` — none carries
  information beyond what the visible headings, labels, and card
  `aria-label`s already state.

## Deviations from the source prompt

- **Translation, not redesign.** The source specifies React + TypeScript +
  Tailwind CSS 3 + Framer Motion; this is translated to semantic HTML,
  vanilla CSS, and vanilla JS producing the same visual result and the same
  motion math (multi-file → single file; React/Tailwind → semantic HTML +
  vanilla CSS/JS — both permitted translations).
- **`--accent` is an additive accessibility token** with no source
  equivalent (the source design has no color); see Palette above.
- **Six case-study/client names were real companies and were de-branded**
  (SPEC-BATCH2.md §5 / BUILD-BRIEF-BATCH2.md §4), verified by web search
  before building, layout and category/year left untouched:
  - The four case-study clients: **HeartX** → **CoraX** (HeartX is a
    recurring, PR-covered cardiovascular startup accelerator); **Swave®** →
    **Kelvae®** (Swave Photonics, a funded holographic-display
    semiconductor company; the ® flourish is kept for the same typographic
    effect); **EduSpark** → **Eduvane** (multiple real ed-tech companies
    trade under this name); **Greenergy** → **Verdalux** (Greenergy
    International Ltd, a large UK fuel/biofuel distributor).
  - Two of the eight decorative marquee "client logos": **AlphaWave** →
    **AlphaVane** (Alphawave Semi, a ~$2.4B semiconductor company acquired
    by Qualcomm in 2025) and **Clandestine** → **Clarendine** (Clandestine
    Industries, a real apparel brand). The other six marquee names
    (Codecraft_, ennLabs, GlobalBank, 45 Degrees°, Biosynthesis, Boltshift)
    read as generic/invented placeholder brand names in the same convention
    already used across this template library (Nimbus, Arceage, NexaCore,
    Taskora, …) and were kept.
- **The footer CTA has no destination.** The source's button has no `href`
  in the spec either; it's wired here as a `<button type="button">` with a
  click handler that calls `preventDefault()` as a belt-and-suspenders
  no-op, so nothing about extending it toward a real link is implied.
- **Framer Motion's `useSpring` is ported as a hand-rolled spring
  integrator** (semi-implicit Euler, same `stiffness`/`damping`/`mass`
  constants as the source) rather than a literal physics-engine port, since
  no such engine is vendored. This is the closest vanilla-JS equivalent to
  "port the math exactly" available under the single-file, no-library
  constraint; at normal scroll/pointer speeds it is visually
  indistinguishable from the source's spring.
