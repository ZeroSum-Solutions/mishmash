---
name: saas-pricing-flow
description: |
  Full-bleed dark pricing section for a fictional creative-tools SaaS
  ("Kavessa AI"), built as a single self-contained page. A muted, boomerang-
  looping background video sits behind a glassy nav pill, a giant gradient
  "Pricing" wordmark clipped with an SVG noise filter, and a three-card grid
  (Free / Standard / Pro) with a real monthly/yearly billing switch and a
  single-select "Choose Plan" flow. The mobile layout turns the grid into a
  snap-scrolling row and the nav into a full-screen overlay drawer.
tags:
  - "component"
  - "motionsites"
  - "pricing"
  - "saas"
  - "dark-theme"
triggers:
  - "pricing"
  - "pricing page"
  - "pricing section"
  - "saas pricing"
  - "pricing cards"
  - "yearly toggle"
  - "kavessa"
  - "kavessa ai"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=saas-pricing-flow"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build the Kavessa AI pricing section as a self-contained page in this template's own visual system. Follow the build spec below exactly — palette, the three-tier card grid, and the boomerang video/noise-filter watermark are part of the identity. Ask only for the missing essentials first: brand name, real plan names/prices, and a background video or poster to swap in."
---

# Kavessa AI — SaaS Pricing Flow

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single pricing section built to stand alone as its own page. The section
itself — background video, watermark, three-card grid, and billing toggle —
is the deliverable; the page wrapper around it is only enough chrome (a slim
nav, generous vertical breathing room) to keep it from reading as a stranded
fragment. No invented hero, testimonials, or footer were added.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, plan
   names, prices, feature lists, and background video/poster. Keep the
   3-card shape (a free tier, a mid tier, a "pro"/dark-variant tier) unless
   the user explicitly wants more or fewer — the grid math and mobile
   scroll-snap widths assume three cards.
3. **Preserve the design system.** The near-black palette, the cyan/navy
   gradient wordmark, the glassy card treatment, and the motion in the build
   spec below are the identity — don't substitute fonts, recolor the
   gradient stops, or strip the noise-filtered watermark.
4. **Extend by duplicating the card markup**, never by importing a card
   layout from another template. If a fourth tier is needed, copy an
   `.c3-card` article and adjust its grid column count.
5. **Keep motion and controls accessible.** The boomerang video, the yearly
   toggle, and the mobile nav drawer all have `prefers-reduced-motion` and
   keyboard-operable fallbacks built in — preserve them when editing.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="saas-pricing-flow" type="text/html" title="Kavessa AI — SaaS Pricing Flow">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The finished page, described from what was actually built.

### Palette & type

- Background: `#000` (near-black) throughout, with a fixed full-viewport
  background video (`assets/pricing-bg.mp4`, muted, boomerang-looped)
  showing a soft blue orb/glow.
- Chromatic root tokens (recolor-compatible): `--pricing-grad-1: #091020`,
  `--pricing-grad-2: #0B2551`, `--pricing-grad-3: #A4F4FD`,
  `--pricing-grad-4: #00d2ff`. These four feed the giant "Pricing" wordmark's
  `linear-gradient(to right, ...)`, which is clipped to text and holds the
  exact original stops so MishMash's recolor pass can retint the brand
  gradient without touching the neutral black/white scaffolding.
- Typeface: **Inter** (Google Fonts, weights 400–800) — the prompt calls for
  Inter with a system-sans fallback; Inter is loaded explicitly so the
  headless/self-contained render matches the original weight and metrics
  instead of falling back to whatever sans-serif a given OS ships.
- Card surfaces use literal `rgba(0,0,0,...)` / white-overlay gradients —
  intentionally left as neutral scaffolding, not `var()`-ified, per the
  recolor contract (only brand-chromatic surfaces need `var()` stops).

### Layout, section by section

1. **Header (`.c3-header`)** — centered pill nav (`.c3-nav`, translucent
   dark, `backdrop-filter: blur`) with Home / Pricing (active) / FAQ /
   Contact links and a white "Download" button; a small logomark sits
   absolute-left (recolored to pure white via `filter: brightness(0)
   invert(1)`); a circular hamburger button is absolute-right and hidden
   above 1024px.
2. **Watermark** — an absolutely positioned, decorative "Kavessa AI" line
   over a 16rem "Pricing" wordmark. The wordmark's fill is the four-stop
   brand gradient clipped to text, then run through an inline SVG
   `feTurbulence`/`feComponentTransfer`/`feComposite`/`feBlend` filter
   (`#c3-noise`) for the grainy texture visible in the source screenshot. A
   visually-hidden `<h1>` carries the real "Kavessa AI pricing" heading for
   assistive tech, since the decorative wordmark is split across two styled
   elements rather than one semantic heading.
3. **Pricing grid (`.c3-grid`)** — three `<article class="c3-card">` cards
   (Free, Standard, Pro-with-darker-variant), each a tier label (`<h3>`),
   price (swaps between a monthly and a yearly `<span>` via the billing
   toggle), description, a 5-item checklist (custom check-circle SVG icons),
   and a "Choose Plan" button pinned to the card bottom.
4. **Yearly toggle (`.c3-toggle-wrap`)** — a native `role="switch"` button
   below the grid; toggling it swaps every plan's displayed price between
   monthly and yearly and updates `aria-checked`.

### Motion inventory

- **Background video boomerang** — the exact forward/reverse
  `requestAnimationFrame` seek loop from the source spec (`direction`,
  `currentTarget`, `seekPending`, throttled `doSeek`/`step`), so the clip
  plays forward once then reverses smoothly instead of hard-cutting on loop.
  Disabled under `prefers-reduced-motion` (video is paused on its first
  frame instead).
- **Card hover/focus** — `translateY(-12px) scale(1.01)` with a cyan border
  glow, `0.6s cubic-bezier(0.22,1,0.36,1)`, neutralized under reduced motion.
- **Button hover** — `scale(1.02)` with a soft shadow, `0.2s` ease-out.
- **Toggle knob** — slides 24px with a `cubic-bezier(0.4,0,0.2,1)` transition
  when the yearly switch is flipped.
- All transform/animation motion collapses under
  `@media (prefers-reduced-motion: reduce)` to a near-instant, dignified
  static state (video paused, no hover lift, no transition delay).

### Accessibility affordances

- Nav: `aria-current="page"` on the active "Pricing" link; hamburger button
  carries `aria-expanded`/`aria-controls`; opening the mobile drawer moves
  focus to the first link, closing it (via Escape, the close button, or a
  link click) returns focus to the hamburger.
- Yearly toggle: real `<button role="switch" aria-checked>` — keyboard
  operable by default, no custom key handling needed.
- Choose Plan: single-select across the three cards; clicking toggles
  `aria-pressed` and the button's own label ("Choose Plan" ↔ "Selected"),
  and a visually-hidden `aria-live="polite"` status region announces the
  selection change for screen-reader users.
- Checklist icons and the nav-close/hamburger glyphs are hand-built inline
  SVG (never emoji), so they stay monochrome and theme-safe.
- Every interactive element has a visible `:focus-visible` ring
  (`--accent-cyan`, additive — it does not alter any element's resting
  appearance).

### Responsive (≤1024px)

- Watermark drops out of absolute positioning into normal flow, centered;
  "Kavessa AI" shrinks to 2rem, "Pricing" to 6rem as a flat `#00d2ff` (no
  gradient, no noise filter).
- Grid becomes a horizontal `scroll-snap-type: x mandatory` row, full
  viewport width, hidden scrollbar, cards at `flex: 0 0 320px`.
- Nav hides by default; the hamburger opens it as a full-screen blurred
  overlay with 1.5rem links and a top-right close button.
- Verified with no page-level horizontal overflow at 375px viewport width.

## Deviations from the source prompt

- **Brand renamed.** The prompt's brand, "Forma AI", is a real company
  (Forma.ai, Toronto — enterprise sales-compensation software) unrelated to
  this fictional creator-tools product. Renamed to **Kavessa AI** throughout
  (copy, watermark, logo alt text) per the batch's de-branding rule; the
  layout, weight, and visual role are unchanged. The logomark itself is a
  generic abstract "logoipsum" placeholder mark, not a real trademark, and
  was kept as specified.
- **Pro card gradient darkness.** The prompt says the Pro variant uses "a
  slightly darker gradient" without exact stops; implemented as a modest
  alpha increase over the base card gradient (judgment call, prompt silent
  on exact values).
- **Choose Plan click behavior.** The prompt specifies the button's rest
  styling but not its click behavior. Added a single-select toggle
  (label swaps to "Selected", `aria-pressed`) as a reasonable, real
  interaction for a pricing card CTA — it does not alter any button's
  resting appearance and satisfies the batch's "drive the interactive
  states" requirement.

