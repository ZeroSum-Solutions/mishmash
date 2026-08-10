---
name: scroll-film-hero
description: |
  PERIHELION — the hardened Lane-A scroll-film reference. A flagship landing
  page whose hero is a pinned, scroll-scrubbed cinematic sequence (orbital
  instrument motion, char-split wordmark reveal, chapter readout) built with
  vendored GSAP/ScrollTrigger/Lenis, dissolving into a horizontal specimen
  run, clip-path craft reveals, counters, a velocity-skewed marquee, and full
  static content sections below. Self-contained: zero network requests at
  render time, every hardening property (reduced-motion, no-JS, small
  viewport, no external assets, resize/refresh) implemented and verified.
tags:
  - "hero-section"
  - "scroll-film"
  - "gsap"
  - "cinematic"
triggers:
  - "scroll film"
  - "scroll-scrubbed hero"
  - "cinematic scroll site"
  - "pinned scroll hero"
  - "scrollytelling landing page"
od:
  category: "landing-page"
  mode: prototype
  platform: desktop
  scenario: marketing
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  example_prompt: "Build a scroll-film landing page in the vocabulary of this template — one continuous cinematic shot that plays as the visitor scrolls, then dissolves into normal content sections. Follow this template's technical law exactly: vendored GSAP/ScrollTrigger/Lenis (no CDN), a `.js` class gate so JS-disabled visitors get the full static composition, a prefers-reduced-motion collapse to a single elegant static viewport, and a resize/refresh handler. Design a fresh brand world from the brief — do not reuse PERIHELION's palette, type, or copy."
---

# PERIHELION — Scroll-Film Hero (hardened reference)

This is the **hardened reference implementation** for MishMash's scroll-film
lane: a complete, original landing page (fictional precision-instrument
brand "PERIHELION") whose hero is a pinned, scroll-scrubbed cinematic
sequence built per `.claude/skills/scroll-film-studio/SKILL.md` Lane A
(pure-code GSAP + Lenis motion — no generated video, no external footage).
Treat this template as the pipeline's load-bearing example of what a
production-grade scroll-film build must satisfy: the motion vocabulary, the
file layout, and — non-negotiably — the five-point hardening matrix below.

## Workflow

1. **Clone `example.html`** (and `assets/vendor/`) into the user's workspace
   as the working files.
2. **Replace placeholder content** — brand name, copy, palette, instrument
   art, stats, footer links — with the user's real brand. Never carry
   PERIHELION's identity into a client build; design a fresh world per the
   brief, matching only the *technique*, not the *look*.
3. **Preserve the technical law**: the `.js` class gate, the
   `prefers-reduced-motion` CSS + JS gate pair, the vendored (never CDN)
   motion libraries, the pinned-scenes-before-ambient-triggers creation
   order, and the `?jump=<y>` / `window.__ready` dev contract. These are
   structural, not stylistic — swapping them out breaks the hardening
   guarantees this template exists to prove.
4. **Extend by duplicating scenes** from the motion vocabulary already
   present (pinned scrub, horizontal pinned run, clip-path reveal, counters,
   velocity-skew marquee, char-split reveal) rather than inventing new
   scroll-jacking mechanisms from scratch.
5. **Re-run the hardening check** (`scripts/check-scroll-hero-hardening.mjs`
   in the repo root) against the derived file before shipping.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="scroll-film-hero" type="text/html" title="PERIHELION — Scroll-Film Hero">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

### Concept & art direction

**PERIHELION** — a fictional workshop of hand-finished orbital instruments
(orreries, chronometers, astrolabes, meridian rings), positioned as "instruments
for what moves." The hero opens on a void-black stage with concentric brass
orbital rings and a serif wordmark that reveals letter-by-letter; scrolling
rotates the rings, recedes the wordmark, and dissolves the film into the
collection below. Palette: void black (`#06070a`), warm paper
(`#f4efe3`), brass (`#c9a15f`), a single ember accent reserved for emphasis.
Type: system serif stack (`ui-serif, Georgia, ...`) for display, system sans
for body/labels, monospace for eyebrow/readout labels — no webfonts, so the
page never makes a font network request.

### Scene-by-scene motion vocabulary

1. **Char-split hero reveal** — the wordmark ships pre-split into `<span
   class="char">` elements in markup (so it degrades to plain visible text
   with zero JS); GSAP staggers `yPercent:120 → 0, opacity:0 → 1` on load.
2. **Pinned scrubbed hero** — `.film-stage` pins for `+=240%` of scroll;
   orbital ring groups rotate, the wordmark recedes, a bottom-edge veil fades
   in as the seam into the next scene, and a chapter-readout progress bar
   tracks pin progress.
3. **Horizontal pinned specimen run** — `.scene-collection` pins and
   translates `.specimen-track` by `-(scrollWidth - innerWidth)` as the user
   scrolls vertically; without JS it is a native horizontal-scroll-snap row
   (`overflow-x:auto`), not a hidden/broken layout.
4. **Clip-path craft reveals** — three `.reveal-row` rows open from
   `inset(0 0 100% 0)` to `inset(0)` on scroll, gated entirely behind `.js`
   (default state is fully visible).
5. **Counters** — `.stat-num` elements count up once via a `once:true`
   ScrollTrigger; the markup's resting value is already the real number.
6. **Velocity-skew marquee** — a pure-CSS `@keyframes` drift (works with zero
   JS, and is itself wrapped in `prefers-reduced-motion:no-preference`) plus
   a JS layer that skews the viewport by clamped scroll velocity.

### Vendored libraries (no CDN, pinned versions)

`assets/vendor/gsap.min.js` (GSAP 3.12.7), `assets/vendor/ScrollTrigger.min.js`
(3.12.7), `assets/vendor/lenis.min.js` (Lenis 1.1.18) — fetched once from the
official CDN mirrors at authoring time and committed as local files, loaded
via relative `<script src="assets/vendor/...">` tags. Per
`docs/decisions/gsap-licensing.md`: code-generation use of GSAP is the
sanctioned path, and versions are pinned per that decision's condition 3.
Lenis is MIT-licensed. No script tag in this template points at a remote
host; the hardening check enforces that mechanically.

## Hardening matrix (implemented, not aspirational)

| # | Requirement | Implementation |
|---|---|---|
| 1 | `prefers-reduced-motion` | An inline `<head>` script runs the `matchMedia('(prefers-reduced-motion: reduce)').matches` check SYNCHRONOUSLY, before first paint, and only then adds `.js` to `<html>` — so the tall pinned-film layout and every `.js`-scoped initial hidden state are what the browser paints on frame one, never a post-load shift. The body script's motion-library loader re-checks `html.classList.contains('js')` and early-returns before touching GSAP/Lenis if it's absent. A CSS `@media (prefers-reduced-motion:reduce)` backstop also collapses the layout structurally in case `.js` is ever present anyway. |
| 2 | Mobile / small viewport | `clamp()` type scale, responsive grid/flex breakpoints tested down to 390px, and Lenis smoothing is skipped on `(pointer: coarse)` so native touch scroll drives `ScrollTrigger` directly. |
| 3 | JS disabled | Default CSS state (no `.js` class) renders every scene fully visible in normal document flow — hero text, craft rows, specimen cards (as a native horizontal scroller) — nothing is hidden behind a JS-only initial state. The `<noscript>` block is a REAL functional backstop, not a formality: it force-restores every gated property (`opacity`, `transform`, `clip-path`) with `!important` and collapses `.film-scroll`/`.film-stage` back to plain static flow. It is redundant with the CSS default today (the `.js` class can only be added by JS), which is precisely why it's cheap insurance — it still fires correctly if a future edit ever adds an unscoped hidden state or the gate is satisfied some other way. |
| 4 | Missing/slow assets | Zero external assets: every visual is inline SVG or CSS: no images, no video, no font/CDN requests. Nothing to fail to load. |
| 5 | Resize mid-scroll | A debounced `resize` listener plus an `orientationchange` listener both call `ScrollTrigger.refresh()`; the pinned hero and the horizontal run both set `invalidateOnRefresh:true`. |

## Verification

Run `node scripts/check-scroll-hero-hardening.mjs` from the repo root — it
statically asserts all five properties above against `example.html` and
exits non-zero on any regression. Then `node scripts/validate-design-catalog.mjs`
to confirm `od.category`/`description` stay valid against the shared
taxonomy.

## Source & license

Original build, authored for this repository — not vendored from any
external template gallery. Motion libraries: GSAP + ScrollTrigger 3.12.7
(Webflow, Standard "No Charge" License — code-generation use, see
`docs/decisions/gsap-licensing.md`), Lenis 1.1.18 (MIT, Darkroom Engineering).
