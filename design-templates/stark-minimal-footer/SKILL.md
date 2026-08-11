---
name: stark-minimal-footer
description: |
  Pure black-and-white site footer for a fictional aerospace company
  ("EngineTech"), built as a single self-contained page. An animated
  horizontally-drifting dot band tops a four-column grid — a large regular
  headline beside three plain-text nav columns — above an oversized
  "EngineTech" wordmark brand row with a circular striped mark, and a small
  legal line. No color anywhere except a focus ring that never appears at
  rest.
tags:
  - "component"
  - "motionsites"
  - "footer"
  - "monochrome"
  - "aerospace"
triggers:
  - "site footer"
  - "minimal footer"
  - "black and white footer"
  - "footer nav columns"
  - "brand wordmark footer"
  - "enginetech"
  - "aerospace footer"
  - "dotted marquee footer"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=stark-minimal-footer"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build the EngineTech stark-minimal footer as a self-contained page in this template's own visual system. Follow the build spec below exactly — the pure black/white palette, the four-column grid, and the dot-band motion are part of the identity. Ask only for the missing essentials first: brand name, real nav link destinations, and social handles."
---

# EngineTech — Stark Minimal Footer

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single-section page built to stand alone: a slim one-line page label and a
short heading sit above the footer itself, so the footer reads as placed at
the bottom of a real page rather than stranded on a blank canvas. The footer
is the deliverable — full width, pure black-and-white, with an animated dot
band, a four-column top grid, a giant wordmark brand row, and a legal line.
No invented hero, no filler sections.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headline,
   nav link destinations, and social handles. The three-column nav shape
   (5 links / 4 links / 2 links) is a convention from the source design, not
   a hard limit — add or remove `<li>` entries inside any `.site-footer__nav
   ul` freely; each column's `<ul>` already handles its own flex-column
   layout.
3. **Preserve the design system.** This footer is deliberately monochrome —
   pure `#000000` background, pure `#ffffff` text, and the specific
   `rgb(255 255 255 / …)` alpha steps used for the dot band, muted nav-adjacent
   text, and the legal line. Do not introduce a color accent anywhere in the
   resting render; that would break the design's entire premise.
4. **Extend by duplicating a nav `<li>` or a whole `<nav>` column**, never by
   importing a footer layout from another template. The brand row's circular
   mark and giant wordmark are a matched pair (flex row, mark first, wordmark
   filling the rest) — keep that structure if you resize either piece.
5. **Keep motion accessible.** The dot band's drift is decorative and must
   freeze under `prefers-reduced-motion`; nav-link hover (color shift +
   `translateX`) must stay reachable by keyboard focus, not only by mouse.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="stark-minimal-footer" type="text/html" title="EngineTech — Stark Minimal Footer">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished page — see `example.html` for the exact values.

### Palette

Deliberately monochrome — no purple, no violet, no brand hue anywhere in the
resting render.

- `#000000` — page and footer background (`html`, `body`, `.site-footer`,
  `.footer-dots`), used literally throughout as neutral scaffolding.
- `#ffffff` — heading, wordmark, and default text color.
- `rgb(255 255 255 / 0.88)` — nav-link resting color (brightens to solid
  `#ffffff` on hover/focus).
- `rgb(255 255 255 / 0.55)` / `0.45` / `0.35` — the three layered dot-pattern
  opacities in the animated top band.
- `rgb(255 255 255 / 0.52)` — page-chrome eyebrow labels and the footer's
  legal line.
- `--hero-max-width: 1820px` — the one shared root token bounding both the
  page chrome and the footer's inner container width.
- `--focus-ring: #2563eb` — the required chromatic root token. It powers
  only the `:focus-visible` outline on links; it never appears in the
  resting render, on hover, or anywhere else. See Deviations for why a
  visible accent was not used instead.

### Type

Geist (400/650/760 by way of the loaded 100–900 variable range) with Inter as
fallback, then the system sans stack. Both are genuine Google Fonts — no
substitution was needed.

### Layout

- **Page chrome** (`.page-shell-header` / `.page-shell-main`): a one-line
  uppercase label, then a flex-centered eyebrow + `<h1>` filling the space
  above the footer. Same `width: min(100% - Npx, var(--hero-max-width))`
  formula as the footer's own inner container, at the same three breakpoints,
  so the page chrome and the footer share one visual margin line.
- **`.site-footer`** — `position: relative`, `z-index: 100`, `overflow:
  hidden`, `background: #000000`.
- **`.footer-dots`** — a 120px `aria-hidden` band with one absolutely
  positioned `.footer-dots__line` (200% width, 70px tall, three layered
  `radial-gradient` dot patterns) drifting via `footerDotsMove`.
- **`.site-footer__inner`** — `width: min(100% - 96px, var(--hero-max-width))`
  (48px / 32px at the 980px / 560px breakpoints), padding
  `clamp(34px,4vw,66px) 0 clamp(18px,2vw,34px)`.
- **`.site-footer__top`** — CSS grid, `minmax(320px,1.25fr) repeat(3,
  minmax(150px,0.42fr))`, gap `clamp(28px,4vw,76px)`, `min-height:
  clamp(220px,24vw,330px)`: an `<h2>` ("Proven Advanced Propulsion
  Technology") beside three `<nav>` columns (5 / 4 / 2 links).
- **`.site-footer__brand-row`** — a full-width link containing a circular
  `.site-footer__mark` (white circle, `clip-path` wave stripe cut into an
  oversized `::before`) beside a `.site-footer__wordmark` ("EngineTech") at
  `clamp(58px,11.1vw,214px)`, weight 760, `letter-spacing: -0.055em`.
- **`.site-footer__legal`** — a 9px, low-opacity flex row: copyright line plus
  Privacy Policy / Terms of Use links.

### Motion inventory

- **Dot-band drift** — `.footer-dots__line { animation: footerDotsMove 18s
  linear infinite; }`, `@keyframes footerDotsMove { from { transform:
  translate3d(0,-50%,0); } to { transform: translate3d(-50%,-50%,0); } }`. A
  continuous horizontal drift, never resetting visibly because the layer is
  200% width against a periodic dot pattern.
- **Nav-link hover** — `transition: color 180ms ease, transform 180ms ease;`
  on `:hover`: color brightens to `#ffffff`, `transform: translateX(3px)`.
- **Legal-link hover** — color brightens to `#ffffff`, no transition
  specified in the source, none added.
- **`prefers-reduced-motion: reduce`** — `.footer-dots__line { animation:
  none; }` and the nav-link `transition` drops to `none`; the hover color/
  position change still happens on interaction, it simply snaps instead of
  easing, and the dot band holds still instead of merely slowing down.

### Accessibility affordances

- **Landmarks:** `<header>`, `<main>`, `<footer>`, and three `<nav>` elements
  with their exact source `aria-label`s ("Footer navigation", "Company
  links", "Social links").
- **Semantic lists:** each nav column's links sit in a `<ul>`/`<li>` (the
  source specifies a plain flex column of anchors with no list wrapper). The
  flex-column layout moved onto the `<ul>` with `list-style: none; margin: 0;
  padding: 0;` so the render is pixel-identical to the source's plain
  anchors — only the accessibility tree gained list semantics.
- **Real heading:** the footer's headline is the source's own `<h2>`; the
  page-chrome heading above it is a real `<h1>`. The source has no visible
  per-column title text for the three nav groups (only the `aria-label` on
  each `<nav>` — see the prompt's own copy), so none was invented; adding one
  would change the rendered look, which fidelity forbids.
- **Visible focus:** every link (`<a>`) gets a `:focus-visible` outline in
  `var(--focus-ring)`, `2px solid`, `3px` offset — additive, never shown at
  rest.
- **Decorative elements marked inert:** `.footer-dots` and `.site-footer__mark`
  both carry `aria-hidden="true"`; the brand link's own accessible name comes
  from `aria-label="EngineTech home"` on the anchor, not from the decorative
  mark or the visual wordmark text alone.
- No form, no tabs, no accordion, no slider, and no hover-gated content exist
  in this footer — nav-link hover only enhances (color + a 3px shift), it
  never gates visibility, so no separate touch/focus reveal path was needed.

## Deviations from the source prompt

- **Plain flex column of anchors → `<ul>`/`<li>` per nav column:** additive
  semantic-list upgrade per this batch's accessibility requirement
  (SPEC-BATCH2 §4). The flex/gap/alignment properties moved onto the new
  `<ul>` with `list-style: none; margin: 0; padding: 0;`, so the rendered
  result is unchanged; only the accessibility tree differs.
- **`:focus-visible` ring** (`var(--focus-ring)`) is additive accessibility
  with no source equivalent — required so keyboard users can see which link
  is focused. It never appears in the resting render or on hover.
- **No chromatic accent was introduced into the visible design.** The source
  is explicit — "No purple or violet... pure black background, pure white
  text" — so this design is genuinely monochrome. Per the batch's
  chromatic-root-token rule, the one required parseable chromatic custom
  property (`--focus-ring: #2563eb`) is scoped entirely to the
  `:focus-visible` outline, which is invisible until a keyboard user tabs to
  a link. Fidelity to the monochrome source wins over adding a visible
  accent.
- **Page chrome above the footer** (`.page-shell-header`, `.page-shell-main`)
  has no source equivalent — SPEC-BATCH2 §2 requires enough content above a
  standalone section build that it reads as placed, not stranded. Its copy
  is a plain, honest label ("Component preview") rather than invented
  marketing claims, and it borrows the footer's own palette and width
  formula so it reads as one page, not a mismatched wrapper.
- Multi-file source structure ("Project structure" / Vite scaffold implied by
  the prompt's class-name conventions) collapses into one self-contained
  `example.html` with inline `<style>` — a permitted translation. No React or
  Tailwind was present in the source prompt to translate; it is already
  described as plain CSS classes and native elements, so no JavaScript was
  needed to reproduce it — the entire design (grid, dot-band motion,
  hover states, reduced-motion fallback) is expressed in CSS alone.
- No real trademark was found in the prompt copy. "EngineTech" reads as a
  fictional aerospace brand coined for this design (in the same vein as
  other fictional MotionSites brand names); it was kept as-is per SPEC.md's
  rule that fictional brand names stay.
- No image, video, icon, or font asset needed vendoring — the dot band is
  pure CSS `radial-gradient`, and the brand mark is a CSS circle with a
  `clip-path`-cut pseudo-element. `assets/` was left out of this template
  folder entirely rather than shipped empty.



