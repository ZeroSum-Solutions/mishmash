---
name: portfolio-about-section
description: |
  Dark "About Me" section for a freelance designer's portfolio, built as a
  single self-contained HTML page. A gradient headline reading "About me"
  sits above a bio paragraph whose characters brighten left-to-right as the
  page scrolls, framed by four glassy 3D corner icons (moon, brick, smiley,
  cursor) that slide in from the left and right on load, with a
  magenta-to-orange gradient pill button beneath.
tags:
  - "component"
  - "motionsites"
  - "about"
  - "portfolio"
  - "bio"
triggers:
  - "about me section"
  - "portfolio about"
  - "designer bio section"
  - "scroll reveal text"
  - "about section dark"
  - "gradient headline about"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=portfolio-about"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build an About Me section like this one, in this template's own visual system, but for my real bio. Follow the build spec exactly — the gradient headline, the scroll-brightened paragraph, and the four floating corner icons are part of the identity. Ask only for the missing essentials first: my real bio copy and where the contact button should link."
---

# Portfolio About Me — Scroll-Brightened Bio

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Dark "About Me" section for a freelance designer's portfolio, built as a
single self-contained HTML page. A gradient headline reading "About me"
sits above a bio paragraph whose characters brighten left-to-right as the
page scrolls, framed by four glassy 3D corner icons (moon, brick, smiley,
cursor) that slide in from the left and right on load, with a
magenta-to-orange gradient pill button beneath. The section is `min-height:
100vh` and centered on both axes, so it fills the page by itself with no
extra chrome — this page's only reason to exist is this section.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace the bio paragraph** with the user's real copy. The
   scroll-brightening script re-splits whatever plain text sits in
   `#about-copy` into characters at load, so no other markup changes are
   needed — just edit the sentence.
3. **Swap the four corner icons** in `assets/` (or drop new ones in and
   repoint the `src` attributes) if the user wants different glyphs; keep
   the four-corner composition and the alternating slide-in directions.
4. **Preserve the design system.** The near-black background, the
   steel-gradient headline text, the four-corner icon frame, and the
   magenta-to-orange button gradient are the identity — do not recolor by
   hand or drop the character-reveal effect.
5. **Point the button at a real destination.** It links to `#contact` by
   default (matching the source prompt); repoint `href` once the user has
   an actual contact section or page.
6. **Keep motion accessible.** Both the mount fade-ins and the
   scroll-brightening effect collapse to a fully visible, static state
   under `prefers-reduced-motion`, as the build spec requires.

## Build spec

### Palette

- `--bg: #0c0c0c` — page and section background (the source prompt inherits
  this from the page, so it is set once on `html, body`).
- `--paragraph-color: #d7e2ea` — bio paragraph text.
- `--heading-grad-top: #646973` / `--heading-grad-bottom: #bbccd7` — the
  top-to-bottom gradient clipped to the "About me" headline text.
- `--accent-1: #18011f`, `--accent-2: #b600a8`, `--accent-3: #7621b0`,
  `--accent-4: #be4c00` — the four stops of the contact button's gradient
  (`linear-gradient(123deg, ...)`). This is the section's one genuinely
  chromatic surface in the source design — not an invented accent — so the
  gradient stops are declared as real parseable root colors and the
  gradient itself is written with `var()` stops, satisfying this repo's
  recolor-pass contract without changing a single rendered pixel.
- `--focus-ring: #b600a8` — reuses `--accent-2` for the keyboard focus ring
  on the button and corner icons; only visible on `:focus-visible`, never
  in the resting render.

### Type

`Kanit` (Google Fonts, weights 300–900) is the only font, applied to the
whole page via `html, body`.

### Layout

One `<section id="about">`, `min-height: 100vh`, flex column, centered on
both axes, `padding: 80px 20px` stepping to `80px 32px` / `80px 40px` at
640px / 768px:

1. **Four decorative corner images** (`position: absolute`, `z-0`,
   `aria-hidden`) — moon (top-left), a smiley-face glyph (bottom-left), a
   Lego-style brick (top-right), and a cursor-arrow glyph (bottom-right).
   Each has its own responsive width (120px → 160px → 210px for the two
   larger corners, 100px → 140px → 180px and 130px → 170px → 220px for the
   other two) and percentage-based inset that also steps at the same two
   breakpoints.
2. **Centered content column** (`max-width: 896px`, `z-10`), holding:
   - **Text group** — the gradient `<h1>` "About me" (`clamp(3rem, 12vw,
     160px)`, `font-weight: 900`, uppercase) above the bio paragraph
     (`clamp(1rem, 2vw, 1.35rem)`, `max-width: 560px`, centered).
   - **CTA group** — the "Contact Me" pill button, `href="#contact"`.

### Motion inventory

- **Mount fade-ins** — the four corner icons and the heading and button all
  start `opacity: 0` with a per-element translate offset (corner icons
  ±80px horizontal; heading `y: 40px`; button `y: 20px`) and animate to
  their resting position on a shared `cubic-bezier(0.25, 0.1, 0.25, 1)`
  curve. Each element carries its own delay/duration as CSS custom
  properties (`--fade-delay`, `--fade-duration`) so one shared `.fade-in`
  rule drives all six: corner icons at `0.1s`/`0.15s`/`0.25s`/`0.3s` delay
  and `0.9s` duration, heading at `0s` delay, button at `0.3s` delay, both
  at the `0.7s` default duration. A single `IntersectionObserver`
  (`rootMargin: 50px`, `threshold: 0`, fires once per element) triggers the
  reveal — since the section fills the initial viewport, this fires
  almost immediately on load.
- **Scroll-brightened paragraph** — the bio paragraph is split into one
  `<span>` per character at load. Each character's "resting" scroll
  position is compared against a progress value computed from the
  paragraph's own `getBoundingClientRect()` on every scroll/resize tick
  (batched through `requestAnimationFrame`), using the same math as the
  source's `useScroll({ offset: ['start 0.8', 'end 0.2'] })` +
  per-character `useTransform` window (`charProgress ± 0.1/0.05`, output
  range `[0.2, 1]`). Because the section is vertically centered and taller
  than its content, the paragraph already sits partway through that scroll
  window on first load — which is why a subset of characters starts
  brighter than the rest even before the user scrolls, matching the
  reference capture exactly.
- **Button hover/active** — `opacity: 0.9` on hover, `0.75` on active,
  `200ms` transition, matching the source spec digit-for-digit.

### Accessibility

- The page has exactly one heading (`<h1>About me</h1>`), so the hierarchy
  is trivially correct for a single-section page.
- All four corner images carry `alt=""` and `aria-hidden="true"` — they are
  purely decorative and contribute nothing to the page's meaning.
- The bio paragraph's real text always lives in `#about-copy`. The
  character-split version (`#about-copy-animated`) is a purely decorative
  duplicate: it starts `hidden` and `aria-hidden="true"`, and is only
  populated and revealed once JavaScript confirms motion is allowed. When
  it takes over visually, the original plain paragraph is switched to
  `.sr-only` rather than removed, so a screen reader always announces the
  one real sentence — never 237 individual character nodes, and never
  nothing if JavaScript fails to run.
- The "Contact Me" button is a real `<a>` with visible text and a
  `:focus-visible` outline in `--focus-ring`; the corner images also carry
  a focus-visible style as defense-in-depth even though they are
  non-interactive (`aria-hidden`, unfocusable by default).

### Reduced motion

`prefers-reduced-motion: reduce` is checked once at load and short-circuits
both motion systems at the source, not just via CSS: when set, every
`.fade-in` element is marked visible immediately (skipping the
`IntersectionObserver` entirely), and the character-split paragraph
enhancement returns before it ever builds a single `<span>` — leaving the
plain, fully opaque static paragraph as the permanent result. A companion
`@media (prefers-reduced-motion: reduce)` CSS block forces the fade-in
opacity/transform to their resting values as a defense-in-depth backstop
for any element that class-toggles before the media query is checked.

### Responsive

Breakpoints match the source's Tailwind `sm`/`md` scale (640px / 768px):
section padding, the two content-column gap tiers, the four corner icons'
size and inset, and the button's padding/font-size all step at both
breakpoints. The bio paragraph's `max-width: 560px` cap means its wrap
width is breakpoint-independent above that size. Verified in real (not
headless) Chrome at 1440×900 and 375×812: no horizontal scroll, no console
errors, all four images resolve.

Note on verification method: headless Chrome's `--screenshot` flag silently
clamps very narrow `--window-size` requests (375px was rendered at an
internal ~500px viewport, then downscaled into the requested output image),
which produced a false-positive "overflow" during QA. Confirming through a
real, correctly-sized Chrome window (`window.innerWidth` read back as
exactly 375) showed no overflow at all — `document.documentElement.scrollWidth`
equals `window.innerWidth` at both tested sizes.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="portfolio-about-section" type="text/html" title="Portfolio About Me — Scroll-Brightened Bio">
<!doctype html>
<html>...</html>
</artifact>
```

## Source note

Generated output under a MotionSites unlimited-plan subscription
(`https://motionsites.ai/?prompt=portfolio-about`). The upstream prompt text
is design evidence only and is not included in this repository or this file
— everything above describes the page actually built, in this project's own
words. No upstream license claim is made; this is not a `vendored_from`
entry, and there is no standalone `.js` file — all script is inline in
`example.html`.
