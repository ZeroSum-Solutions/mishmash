---
name: nexacore-process-steps
description: |
  Dark, chromatic process section for a fictional infrastructure-delivery
  company ("NexaCore"), built as a single self-contained page. A centered
  gradient-accented header sits above a four-step ordered list — Planning,
  Procurement, Logistics, Commissioning — where each glassy step card
  reveals a top image glow, a dark gradient overlay, an upward text shift,
  and a tri-color gradient "Learn more" button on hover, keyboard focus, or
  touch. An ambient light-beam backdrop and a bottom white fade anchor the
  section so it reads as a deliberate, standalone page.
tags:
  - "component"
  - "motionsites"
  - "process"
  - "steps"
  - "how-it-works"
  - "cards"
triggers:
  - "process steps"
  - "how it works"
  - "process section"
  - "step cards"
  - "hover reveal cards"
  - "nexacore"
  - "planning procurement logistics commissioning"
  - "process timeline"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=nexacore-process"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build the NexaCore process-steps section as a self-contained page in this template's own visual system. Follow the build spec below exactly — palette, the four-step order, and the hover motion are part of the identity. Ask only for the missing essentials first: brand name, real step copy, and the CTA destination."
---

# NexaCore — Process Steps

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single-section page built to stand alone: a centered header ("Relied on by
enterprise teams / from groundbreak to go-live.") sits above a four-card
ordered process — Planning → Procurement → Logistics → Commissioning — on a
dark, ambient-lit backdrop. The section itself is the deliverable; the page
around it is only the padding and background needed for it to read as placed
rather than stranded, with no invented hero, nav, or filler.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real step names, headline
   fragments, and bullet copy. The four-step shape (badge + headline + two
   bullets + hover CTA) is the unit — add or remove `<li>` entries in
   `.cards-grid` to change the step count; the grid already reflows from 1
   column (mobile) to 2 (≥640px) to 4 (≥1024px).
3. **Preserve the design system.** The tri-color gradient
   (blue → purple → orange) on the button and the cooler blue → pink → orange
   heading gradient, the glass card surface (`rgba(10,5,20,0.88)` +
   `backdrop-filter: blur(36px)`), and the icon/bullet purple are the
   identity — don't recolor them into a house palette.
4. **Extend by duplicating a step `<li>`**, never by importing a card layout
   from another template. Swap the inline step icon's SVG paths for a new
   glyph if the step calls for one; keep `viewBox="0 0 16 16"` and the
   `fill="var(--icon-purple)"` wiring so recoloring still works.
5. **Keep motion accessible.** Every hover reveal (top image, dark overlay,
   text lift, CTA button) is also reachable by keyboard focus and by touch,
   and all of it collapses to an instant, static end-state under
   `prefers-reduced-motion` — preserve that when extending.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="nexacore-process-steps" type="text/html" title="NexaCore — Process Steps">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished page — see `example.html` for the exact values.

### Palette

- `--bg-page: #05010b` — html/body chrome color, matching the section
  background's dark corners so there's no visible seam if the viewport is
  taller than the section.
- `--accent-a: rgb(28,78,255)`, `--accent-b: rgb(172,36,255)`,
  `--accent-c: rgb(254,136,27)` — the button and card-CTA gradient stops
  (blue → purple → orange).
- `--accent-d: rgb(43,167,255)`, `--accent-e: rgb(202,69,255)` — the heading
  gradient's first two stops (paired with `--accent-c` for the third).
- `--icon-purple: rgb(200,111,255)` — step-icon fill.
- `--muted-lavender: rgb(189,174,231)` — subhead and bullet text.
- `--badge-bg: rgb(41,31,57)` — step-badge pill fill.
- `--card-surface: rgba(10,5,20,0.88)` — glass card fill (paired with
  `backdrop-filter: blur(36px)`).
- `--overlay-dark: rgba(10,5,20,0.95)` — the hover-reveal dark gradient over
  each card's lower half.
- `--fade-white: rgb(255,255,255)` — the section's bottom fade-to-white.
- `--focus-ring: rgb(172,36,255)` — additive `:focus-visible` outline color
  (reuses `--accent-b`, so it isn't a new hue).

### Type

Plus Jakarta Sans (400/500) from Google Fonts. The source prompt specifies
"Mazzard H", a non-Google font served from a third-party webfont CDN; Plus
Jakarta Sans is the nearest Google equivalent (same geometric-sans weight and
proportions) — see Deviations below.

### Layout

- `<section>` — full-bleed, `background-image: assets/bg-glow.webp` (cover,
  centered), `padding: clamp(100px,12vw,180px) clamp(16px,4vw,40px)
  clamp(100px,12vw,160px)`, `gap: 110px` between header and grid.
- **Header:** centered, `max-width: 1200px`, `<h2>` two-line headline (plain
  white line + gradient-clipped line), `<p>` subhead below.
- **Steps grid:** `<ol>` (ordered — this is a sequential process), `list-style:
  none` so no browser numerals show, `grid-template-columns: 1fr` → `repeat(2,
  1fr)` at ≥640px → `repeat(4,1fr)` at ≥1024px, `gap: 12px`.
- **Step card (`<article>`):** `border-radius: 36px`, `height:
  clamp(320px,32vw,500px)`, three stacked absolutely/relatively positioned
  layers — a top image (55% height), a bottom dark-gradient overlay (55%
  height), and the content layer (badge, spacer, title, bullets, CTA).
- **Bottom fade:** an absolutely positioned 180px gradient from transparent to
  `--fade-white` at the very bottom of the section.

### Motion inventory

- **Hover/focus/touch reveal**, all `transition: … 0.5s`, triggered by
  `:hover`, `:focus-within` (keyboard), or a `.is-touched` class (touch — see
  Accessibility below):
  - Top image: `opacity 0.7 → 1`, `translateY(-30%) → translateY(0)`.
  - Bottom overlay: `opacity 0 → 1`, `translateY(100%) → translateY(0)`.
  - Title + bullets block: `translateY(0) → translateY(-8px)`.
  - CTA wrapper: `max-height 0 → 80px`, `opacity 0 → 1`,
    `translateY(20px) → translateY(0)`, `pointer-events: none → auto`.
- **`prefers-reduced-motion: reduce`:** every transition above collapses to
  `.01ms`, so the reveal still happens on hover/focus/touch — it just snaps
  instead of animating.

### Accessibility affordances

- **`<ol>` for the four-step grid** (Planning → Procurement → Logistics →
  Commissioning is a sequence), with `list-style: none` so the visual is
  unchanged — no browser-drawn numerals.
- **Real headings:** each step's headline is an `<h3>` (the source prompt
  specifies a plain `<div>`; promoted to a heading with the same font-size,
  weight, and margin so the render is pixel-identical — see Deviations).
- **Hover-gated content is also reachable by focus and touch.** The CTA
  button, the top-image glow, and the text lift are hidden via
  `opacity`/`max-height`/`transform` only (never `display:none` or
  `visibility:hidden`), so the "Learn more" link stays in the natural tab
  order and its ancestor's `:focus-within` reveals the same state a mouse
  hover would. A small inline script adds a `.is-touched` toggle on
  `touchstart` for touch input, clearing it when a touch lands outside any
  card.
- **Visible `:focus-visible` ring** on every link, using `--focus-ring`
  (`rgb(172,36,255)`, the same purple already in the button gradient — no new
  hue introduced for accessibility).
- Decorative step icons and the top-image/overlay layers carry
  `aria-hidden="true"`; the CTA link's own text ("Learn more") is its
  accessible name.

## Deviations from the source prompt

- The source specifies two React + Tailwind components (`ServiceCard`,
  `TrustedSection`) with inline style objects and `useState`-driven hover;
  this is translated to semantic HTML, vanilla CSS (`:hover`/`:focus-within`
  selectors replace the `hovered` boolean), and a small vanilla-JS touch
  handler producing the same visual result (multi-file → single file;
  React/Tailwind → semantic HTML + vanilla CSS/JS — both permitted
  translations).
- **Font substitution:** the source registers "Mazzard H" from a third-party
  webfont CDN (`db.onlinewebfonts.com`), which is not a Google Font and not
  vendorable as a small local file (no open license found). Substituted with
  Plus Jakarta Sans (400/500) from Google Fonts — closest available match in
  weight and geometric proportions. Noted here per SPEC.md's font-substitution
  rule.
- **Card title `<div>` → `<h3>`, cards grid → `<ol>`:** additive semantic
  upgrades per this batch's accessibility requirement (SPEC-BATCH2 §4) — an
  ordered process gets real headings and list semantics. Both are styled to
  be pixel-identical to the source's plain `<div>`/unordered grid (explicit
  `margin: 0`, matching `font-size`/`font-weight`, and `list-style: none` on
  the `<ol>`), so the rendered page is unchanged; only the accessibility tree
  differs.
- **`:focus-visible` ring and the touch-reveal path** (`.is-touched`) are
  additive accessibility with no source equivalent — required so the
  hover-gated CTA, image glow, and text lift are reachable without a mouse.
  Neither appears in the resting-state render.
- Remote images (`hover_card_img.png`, the section background, the bullet
  checkmark SVG) are vendored to `assets/` at their original crop/position
  instead of hotlinked — same visual result, per SPEC.md's asset-vendoring
  rule.
- This design is not monochrome — the button/heading gradients and the
  purple icon/bullet color are genuinely chromatic root tokens already, so no
  accent color was hidden behind the focus ring to satisfy the chromatic-token
  rule; `--focus-ring` simply reuses an existing accent (`--accent-b`) rather
  than introducing a new one.
