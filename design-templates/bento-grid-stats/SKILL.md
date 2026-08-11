---
name: bento-grid-stats
description: |
  Dark, six-tile "Why Us?" bento grid section built as a single self-contained
  HTML page. An asymmetric explicit six-column CSS grid on desktop (each tile
  spans different column/row ranges) collapses to one stacked column on
  mobile. Four of the six tiles carry a stat: an income figure over a
  hand-built ascending dot chart, a speed multiplier over a concentric-circle
  icon diagram, a project count over scattered squares, and a client count
  laid over a dimmed photo with a rating and a small brand mark. Every tile
  fades and scales in on scroll, staggered by a per-tile delay.
tags:
  - "component"
  - "motionsites"
  - "stats"
  - "bento"
  - "why-us"
triggers:
  - "bento grid stats"
  - "why us section"
  - "stats grid"
  - "bento grid"
  - "company stats section"
  - "dark stats grid"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=bento-grid-stats"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build a 'Why Us?' bento stats grid like this one, in this template's own visual system, but for my real business. Follow the build spec exactly — the six-tile asymmetric grid, the staircase dot chart, the concentric-circle diagram, and the staggered scroll-in reveal are part of the identity. Ask only for the missing essentials first: brand name, real stats/copy, and a background photo to swap in."
---

# Bento Grid Stats — Why Us? Section

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Dark, six-tile "Why Us?" bento grid section built as a single self-contained
HTML page. An asymmetric explicit six-column CSS grid on desktop (each tile
spans different column/row ranges) collapses to one stacked column on mobile.
Four of the six tiles carry a stat: an income figure over a hand-built
ascending dot chart, a speed multiplier over a concentric-circle icon diagram,
a project count over scattered squares, and a client count laid over a dimmed
photo with a rating and a small brand mark. Every tile fades and scales in on
scroll, staggered by a per-tile delay.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand headline, the
   four stat values and their captions, the two body paragraphs, and the
   background photo. Keep the icon-diagram/chart/scatter decoration next to
   the stat it illustrates.
3. **Preserve the design system.** The six-column asymmetric grid placements,
   the staircase dot chart, the concentric-circle icon diagram, the scattered
   squares, and the staggered scroll-in reveal are the identity — do not
   recenter the grid, drop a tile, or make the reveal uniform.
4. **Extend by duplicating a stat tile**, never by importing a different grid
   pattern. A seventh stat needs its own explicit `grid-column`/`grid-row`
   placement in the same idiom as the existing six.
5. **Keep motion accessible.** The entrance fade/scale collapses to a fully
   visible, motion-free state under `prefers-reduced-motion`, as the build
   spec requires.

## Build spec

### Palette

Monochrome by design — the prompt specifies no chromatic color of its own,
only near-black, white, and a photograph:

- Section background `#0f0f0f`; the dark "text" card sits on `#1a1a1a`.
- White text at three opacities on dark surfaces: full white (headings),
  `rgba(255,255,255,.7)` (eyebrow label), `rgba(255,255,255,.6)` (body copy).
- Black text on the white stat cards, with `#666` (dim heading lines), `#777`
  (subtitles/descriptions), and `#aaa` (chart year labels) as the grey scale.
- `--accent: #4e85bf` — **not** part of the original design. The prompt is
  strictly monochrome, so there is nothing to recolor without breaking
  fidelity. This token exists solely as the `:focus-visible` outline color,
  satisfying this repo's "at least one genuinely chromatic root token"
  requirement through an additive accessibility affordance. **It never
  appears in the resting-state render — and on this page it currently has no
  attachment point at all**: the prompt defines zero interactive elements
  (no links, buttons, or form controls anywhere in the six tiles; the "+"
  glyphs are decorative `<span>`s, never buttons). The rule ships anyway as
  forward-compatible boilerplate consistent with the rest of this repo's
  templates, not because a keyboard user can currently trigger it.

### Type

One Google Font, delivered via the prompt's own CDN query string, verbatim:

- **DM Sans**, requested as `https://fonts.googleapis.com/css?family=DM+Sans:500,400`
  (weights 400 and 500 only). The design itself sets `font-weight: 300` on
  every heading and stat number — an inconsistency in the prompt's own font
  request, not something this build corrects. Per the fidelity standard, the
  CDN URL ships exactly as specified rather than "fixed" to also request 300;
  a browser without a true light-weight DM Sans file falls back the same way
  the original design would.

### Layout

The section is the entire deliverable — one full-width `<section>`,
`background:#0f0f0f`, `padding:96px 24px` (`40px`/`64px 128px` side/vertical
padding at the `640px`/`1024px` breakpoints), containing a `1280px`
max-width, centered inner wrapper.

Six tiles, in the prompt's own card order, wrapped in a single `<ul
role="list">` so the grid reads as one list of info tiles:

1. **Header** (no background) — bottom-aligned eyebrow "why us?" plus a
   three-line headline: "Seamless" (white) / "Brand, Identity," (`#666`) /
   "and Web" (`#666`).
2. **Income** (white) — "32M +" with a dark plus-glyph beside it, a subtitle,
   and a hand-built staircase dot chart (26 columns × 15 rows) with year
   labels `2016`/`2018`/`2022`/`2024`/`2026` below it.
3. **Speed** (white) — an inline SVG diagram (three concentric circles plus
   four small icon squares) over "5x" and a subtitle.
4. **Text** (`#1a1a1a`) — a light plus-glyph top right, two body paragraphs
   pinned to the bottom.
5. **Projects** (white) — seven scattered black squares over "200 +" and a
   description.
6. **Photo** (dark overlay on a vendored photo) — a small "N" brand mark and
   a "4.9 / 5" star rating top, two ghost rectangles mid-left, "100 +" and a
   subtitle bottom-left, a plain white square bottom-right.

Desktop (`≥768px`) places all six on an explicit `grid-template-columns:
repeat(6,1fr)` / `grid-template-rows: repeat(10,minmax(46px,auto))` grid —
Header `1/3 · 1/5`, Speed `3/5 · 1/6`, Text `5/7 · 1/5`, Income `1/3 · 5/11`,
Photo `3/5 · 6/11`, Projects `5/7 · 5/11` (column/row). Below `768px` the same
`<ul>` becomes a single stacked column, `gap:16px`, in source order — the
prompt's own two-tree `md:hidden`/`md:grid` mobile-vs-desktop duplication is
translated into one set of markup with CSS-only responsive placement, since
that reads identically and avoids duplicating six tiles' worth of content in
the DOM.

The income staircase dot chart is generated at load by porting the prompt's
own formula exactly: for column `c` (0–25), `base = floor(c * 0.55)`; the lit
rows are `{base}`, plus `base + 1` when `c` is odd, plus `base − 1` when
`c > 4` (negative rows dropped). The 26 columns lay out `flex-direction:
column-reverse` so row 0 renders at the bottom, producing the rising
staircase.

### Motion inventory

- **Tile entrance** — all six tiles animate `opacity:0→1` and
  `transform:scale(0.95)→scale(1)`, `0.65s cubic-bezier(0.22,1,0.36,1)`,
  triggered once per tile by an `IntersectionObserver` (`rootMargin:'-60px'`,
  `threshold:0`), matching the prompt's Framer Motion `useInView({once:true,
  margin:'-60px'})`. Per-tile `transition-delay` is ported directly from the
  prompt's stagger: Header `0s`, Income `0.08s`, Speed `0.12s`, Text `0.18s`,
  Projects `0.22s`, Photo `0.28s`.
- **No numeric count-up.** The prompt specifies only the entrance
  fade/scale above for every tile — nowhere does it describe an animated
  counter ticking up to `32M`, `5x`, `200`, or `100`. Per the fidelity
  standard this build does not invent one; the stat numbers are plain static
  text, present and announced correctly from first paint.

### Accessibility

- A single real `<h1>` (the "Seamless / Brand, Identity, / and Web" headline)
  gives the standalone page its heading hierarchy; nothing else on the page
  needs a heading, since the remaining tiles are stat/description pairs, not
  sub-sections.
- The six tiles sit in one `<ul role="list">`, one `<li class="card">` each.
- Where a stat and its caption are DOM-adjacent with nothing between them
  (Speed, Projects, and the Photo card's bottom stat), they are marked up as
  a `<dl><dt>value</dt><dd>caption</dd></dl>` pair — a genuine term/definition
  relationship. The Income card's stat and caption are not adjacent (a
  decorative plus-glyph sits between the stat row and the caption in the
  prompt's own layout), so it stays a plain `<p>`/`<p>` pair rather than
  forcing an awkward split `<dl>`.
- The income dot chart's 390 decorative cells are collapsed into one
  `role="img"` with a text `aria-label` describing the trend; the year labels
  below stay real, readable text outside that role. The Speed card's SVG
  diagram, the Projects card's scattered squares, the Photo card's star row,
  and its "N" brand mark are all `aria-hidden="true"` — each is purely
  decorative and its meaning is already carried by adjacent visible text
  ("5x" / "200 +" / "4.9 / 5").
- The background photo's `<img alt="">` is decorative (the informative
  content — rating, stat, brand mark — is separate text layered on top, not
  conveyed by the photo itself).
- The four "+" plus-glyphs are exactly what the prompt specifies: plain
  `<span aria-hidden="true">` ornaments, not buttons. The prompt gives them
  no click behavior, so this build does not invent one.

### Reduced motion

A `@media (prefers-reduced-motion: reduce)` block forces every tile to its
resting `opacity:1`/`transform:none` state with `transition:none`. The
`<script>` checks `matchMedia('(prefers-reduced-motion: reduce)')` once at
load and, when it matches, adds the visible state to every tile directly and
returns before ever creating the `IntersectionObserver` — belt-and-suspenders
with the CSS override.

### Responsive

The prompt's own breakpoints (Tailwind `sm`/`md`/`lg` = 640/768/1024px):
section padding `24px`→`40px`(`sm`)→`64px/128px`(`lg`), chart cells
`5px`→`7px`(`sm`), the six-column explicit grid only applies at `md` and
above. Verified with headless Playwright at 1440×900 and 375×812:
`document.documentElement.scrollWidth === window.innerWidth` at both sizes,
no horizontal overflow, no console errors, every tile reveals correctly on
scroll at both sizes.

## Deviations

1. **The lightning-bolt icon is a small inline SVG path, not the prompt's
   `⚡` emoji character.** The prompt names it literally as "lightning bolt
   emoji" with a white fill. Rendering that exact Unicode character inside an
   `<svg><text fill="#fff">` reliably comes out as a full-color emoji glyph in
   real browsers (verified in this build's own headless render) — the
   platform's color-emoji font overrides the SVG `fill`, breaking the strictly
   monochrome design the prompt's own reference preview shows. A hand-drawn
   white vector bolt, sized and centered in the same 20×20 icon square,
   reproduces the reference screenshot's actual appearance with certainty
   instead of gambling on emoji-presentation support. This is a like-for-like
   glyph → inline-vector translation, not a design change — the other two
   glyphs ("+", "−") are plain ASCII and carry no such risk, so they ship as
   literal text exactly as specified.
2. **Multi-file React + Vite + Tailwind + Framer Motion → one HTML file.**
   The prompt's stack (`React`, `TypeScript`, `Tailwind CSS 3`, `Framer
   Motion`) collapses into semantic HTML with inline `<style>`/`<script>`,
   per this repo's authoring rules. `useInView` + `motion.div` become an
   `IntersectionObserver` and CSS transitions with the same easing, durations,
   and per-tile delays; the dot-chart formula is ported to plain JS untouched.
3. **The Pexels photo is vendored locally**, not hotlinked. Same URL, same
   crop (`assets/team-meeting.jpg`, 800×533, ~60KB) — only the delivery
   mechanism changed.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="bento-grid-stats" type="text/html" title="Bento Grid Stats — Why Us? Section">
<!doctype html>
<html>...</html>
</artifact>
```

## Source note

Generated output under a MotionSites unlimited-plan subscription
(`https://motionsites.ai/?prompt=bento-grid-stats`). The upstream prompt text
is design evidence only and is not included in this repository or this file —
everything above describes the page actually built, in this project's own
words. No upstream license claim is made; this is not a `vendored_from`
entry, and there is no standalone `.js` file — all script is inline in
`example.html`. The background photo is vendored locally in `assets/` from
the prompt's own referenced Pexels source, same crop and framing.


