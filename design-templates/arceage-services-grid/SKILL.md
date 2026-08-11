---
name: arceage-services-grid
description: |
  Full-bleed services section for the fictional farm-harvesting service
  **Arceage Ag**, built as a single self-contained HTML page. A blurred
  agricultural field photo fills the whole viewport; a bottom-aligned
  headline and "Schedule Service" button sit near the top, and a three-item
  service grid (crop care, machinery, pest management) sits low in the
  frame, each with a white line icon, a hairline divider, a title, and a
  description. Every text block reveals character-by-character on scroll.
tags:
  - "component"
  - "motionsites"
  - "services"
  - "typewriter"
  - "agriculture"
triggers:
  - "arceage"
  - "services grid"
  - "how it works section"
  - "typewriter services"
  - "farm harvesting services"
  - "full-bleed hero services"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=arceage-services"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build a full-bleed services section like this one, in this template's own visual system, but for my real business. Follow the build spec exactly — the bottom-aligned headline over a full-bleed photo, the three-item service grid, and the typewriter reveal are part of the identity. Ask only for the missing essentials first: brand name, real service copy, and a background photo to swap in."
---

# Arceage Ag Services — Full-Bleed Field Grid

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Full-bleed services section for the fictional farm-harvesting service
**Arceage Ag**, built as a single self-contained HTML page. A blurred
agricultural field photo fills the whole viewport; a bottom-aligned headline
and "Schedule Service" button sit near the top, and a three-item service grid
(crop care, machinery, pest management) sits low in the frame, each with a
white line icon, a hairline divider, a title, and a description. Every text
block reveals character-by-character on scroll.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand, headline,
   subheadline, background photo, and the three service titles/descriptions.
   Keep the icon → divider → title → description order inside each column.
3. **Preserve the design system.** The full-bleed photo, the bottom-aligned
   headline/button row, the low-set three-column grid, and the typewriter
   reveal are the identity — do not add a dark scrim the prompt never
   specified, recenter the grid, or drop the character reveal.
4. **Extend by duplicating a service column**, never by importing a
   different grid pattern. A fourth service is a fourth `<li>` in the same
   shape (icon, divider, title, description).
5. **Keep motion accessible.** The typewriter stagger and the entrance
   fade/slide both collapse to an instant, fully-visible state under
   `prefers-reduced-motion`, as the build spec requires.

## Build spec

### Palette

Monochrome by design — the prompt specifies no chromatic color of its own,
only a black page wrapper and white text over a photo:

- `body { background:#000000; color:#ffffff; }` — the prompt's own page
  wrapper (`bg-black font-sans text-white`); this section fills the entire
  page, so the black wrapper never shows except at the extreme edges.
- White text throughout, at three opacities: `#ffffff` (headline, titles),
  `rgba(255,255,255,.8)` (subheadline), `rgba(255,255,255,.7)` (descriptions),
  `rgba(255,255,255,.2)` (hairline dividers).
- `--accent: #4e85bf` — **not** part of the original design. The prompt is
  strictly monochrome (black/white text over a photograph), so there is
  nothing to recolor without breaking fidelity. This token exists solely as
  the `:focus-visible` outline color on the "Schedule Service" buttons,
  satisfying this repo's "at least one genuinely chromatic root token"
  requirement through an additive accessibility affordance rather than an
  invented brand color. It never appears in the resting-state render.

### Type

Two Google Fonts, both from the prompt's own `@import` line, delivered here
as `<link>` tags instead (same families/weights, different delivery
mechanism):

- **Barlow** (all weights/italics) — the primary UI font (`font-sans`).
- **Instrument Serif** (roman + italic) — the accent font (`font-dm-serif`
  in the prompt's Tailwind config), used only for the italicized phrase
  "Maximum Yield" inside the headline.

### Layout

The section is the entire deliverable — one full-bleed `<section
id="services">`, `min-height: 100vh` (the prompt gives no explicit section
height; `100vh` is the judgment call that reproduces the "content pinned to
top and bottom of the viewport" composition seen in the reference preview):

1. **Background** — `assets/agriculture-field.jpg`, a soft-focus aerial/field
   photo, `object-fit: cover`, absolutely positioned behind everything.
2. **Top row** (3-column grid, `items-end`) — a headline block spanning two
   columns (`<h2>` + subheadline `<p>`) and a "Schedule Service" pill button
   in the third column, bottom-aligned with the headline so both share the
   same baseline row. The button is `hidden md:flex` on desktop; an
   identical button re-appears `flex md:hidden` below the grid on mobile.
3. **Bottom row** (`<ul role="list">` of three `<li>`, 3-column grid at
   `md:`, pushed low in the frame by `justify-content: space-between` on the
   flex container plus a `200px` desktop-only top margin) — each `<li>` is
   icon → hairline divider → `<h3>` title → `<p>` description.

Headline (verbatim): "A Highly Efficient, Precision-Driven Harvesting
Process Built For *Maximum Yield*" (italic serif on the last two words).
Subheadline: "Precision in every pass." Button label: "Schedule Service"
(both copies scroll to `#contact`, which does not exist on this standalone
section page — see Deviations).

Three services, verbatim from the prompt:

| Icon | Title | Description |
| --- | --- | --- |
| leaf cluster | Sustainable Crop Care | Nurturing your fields with eco-friendly practices to ensure healthy growth and robust yields. |
| tractor | Advanced Machinery | Deploying state-of-the-art tractors and harvesters for maximum efficiency and speed. |
| beetle | Smart Pest Management | Protecting your harvest by monitoring and managing field ecosystems with precision. |

### Motion inventory

- **Entrance fade/slide** — six blocks (headline, desktop button, each of
  the three service columns, mobile button) animate `opacity 0→1`,
  `translateY(20px)→0`, `0.6s ease-out` (Motion's named `"easeOut"` is the
  same curve as the CSS `ease-out` keyword, so this is a direct port, not an
  approximation), triggered once by a single `IntersectionObserver` on the
  section (`rootMargin: -100px` on all sides, matching the prompt's
  `viewport={{ once: true, margin: "-100px" }}`). Per-block delays match the
  prompt's own `transition.delay` props: headline `0ms`, desktop button
  `100ms`, each service column `100ms`, mobile button `200ms`.
- **Typewriter reveal** — every heading/paragraph is split into
  per-character `<span>`s that fade in (`opacity 0→1`, `0.3s ease-out`) with
  a per-character delay ported from the prompt's `speed` prop (`12ms` for
  the headline/accent-span/subheadline, the component's default `15ms` for
  the three service titles/descriptions, which the prompt never overrides)
  plus each element's own `delay` prop (headline `0ms`, "Maximum Yield"
  `800ms`, subheadline `100ms`, service titles/descriptions `0ms` default).
- **Ambient icon loops** — each service icon has a small continuous CSS
  keyframe loop standing in for the prompt's `loop autoplay` Lottie player:
  the leaf cluster sways ±6°/3s, the tractor bobs ±2px/2s, the beetle
  scurries ±3°/1.2s. The three source Lottie files (`curry.json`,
  `tractor.json`, `beetle.json`) carry internal bezier keyframes that are not
  part of the prompt text and are not portable the way a JS formula would
  be — see Deviations.

### Accessibility

- A visually-hidden `<h1>` gives the standalone page a real top-level
  heading; the prompt's own `<h2>`/`<h3>` hierarchy is otherwise unchanged.
- The three service columns are a real list: `<ul role="list">` /
  `<li>` (Tailwind/CSS Grid renders identically either way; `role="list"`
  guards against Safari/VoiceOver's list-semantics-stripping on
  `list-style: none`).
- The animated per-character spans are `aria-hidden`; a paired
  visually-hidden (`sr-only`) sibling holds the full, un-split sentence, so
  a screen reader announces the real text once instead of dozens of
  character mutations.
- Both "Schedule Service" buttons are real `<button>` elements with a
  visible `:focus-visible` outline in the `--accent` token; the hover state
  (bg/text color swap) reveals no content that isn't already on screen, so
  no separate focus-reachable path was needed for it.

### Reduced motion

`prefers-reduced-motion: reduce` is checked once at load and short-circuits
the typewriter helper at its source (skips span-splitting, sets full text
directly) rather than only via CSS overrides. A companion `@media
(prefers-reduced-motion: reduce)` block forces every entrance
opacity/transform to its resting state and removes the three ambient icon
loops, so the section is fully visible, fully legible, and motion-free.

### Responsive

The prompt's own breakpoints (Tailwind `md`/`lg` = 768/1024px): section
padding `24px`→`96px`/`48px` (with `120px` side padding at `lg`), heading
`clamp(1.5rem, 4vw, 3.5rem)`, subheadline `18px`→`24px`, grids collapse to a
single column below `768px`, desktop/mobile buttons swap via `display`.
Verified with headless Playwright at 1440×900 and 375×812:
`document.documentElement.scrollWidth === window.innerWidth` at both sizes,
no horizontal overflow, no console errors.

## Deviations

1. **Icons are hand-built inline SVGs, not the prompt's Lottie files.** The
   prompt names three external Lottie JSON assets
   (`curry.json`/`tractor.json`/`beetle.json`, rendered via
   `@lottiefiles/react-lottie-player`) rendered white via `filter:
   brightness(0) invert(1)`. Per this repo's CDN-library-to-vanilla-
   equivalent rule, each was rebuilt as a plain white-stroke inline SVG
   matching the shape visible in the prompt's own preview screenshot (a
   5-petal leaf cluster, a line-art tractor, a beetle with legs and
   antennae) with a small ambient CSS loop standing in for the Lottie's
   `loop autoplay`. The internal Lottie bezier keyframes are not part of the
   prompt text and were not available to port exactly.
2. **The icon color comes from a native white stroke, not a CSS filter.**
   The prompt's `filter: brightness(0) invert(1)` exists to whiten a
   colored source asset; since the replacement SVGs are drawn white
   natively, the filter has nothing to act on and was dropped. The rendered
   result — a solid white 48×48 line icon — is identical either way.
3. **"Schedule Service" scrolls to `#contact`, which doesn't exist on this
   page.** The prompt's button scrolls the full site to its contact
   section. This deliverable is the services section alone (per this
   repo's section-as-a-page rule — no invented filler sections), so the
   click handler is a guarded no-op: `document.getElementById('contact')`
   returns `null` and nothing happens, rather than fabricating a contact
   section that isn't part of this prompt.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="arceage-services-grid" type="text/html" title="Arceage Ag Services — Full-Bleed Field Grid">
<!doctype html>
<html>...</html>
</artifact>
```

## Source note

Generated output under a MotionSites unlimited-plan subscription
(`https://motionsites.ai/?prompt=arceage-services`). The upstream prompt text
is design evidence only and is not included in this repository or this file —
everything above describes the page actually built, in this project's own
words. No upstream license claim is made; this is not a `vendored_from`
entry, and there is no standalone `.js` file — all script is inline in
`example.html`. The background photo is vendored locally in `assets/` from
the prompt's own referenced source
(`github.com/dsMagnatov/Acreage-landing-assets`), same crop and framing.
