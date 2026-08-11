---
name: futuristic-cinematic-hero
description: |
  Full-viewport dark hero for the fictional brand **axentra**, translating a
  real-time WebGL shader background into a layered CSS/SVG equivalent:
  stacked animated radial and conic gradients, drifting particles, a
  cursor-reactive chromatic ripple, and SVG film grain. A liquid-glass pill
  navbar, a staggered slide-down mobile menu, and a centered two-line
  headline over a violet-to-blue glow deliver the same cinematic depth and
  slow drift as the original shader with zero WebGL.
tags:
  - "landing-page"
  - "motionsites"
  - "hero-section"
  - "dark-mode"
  - "cinematic"
  - "futuristic"
  - "glassmorphism"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=futuristic-cinematic"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Rebuild this futuristic cinematic hero for a real brand: swap axentra for the actual product name, replace the nav links and headline copy, and keep the layered violet-to-blue glow, drifting particles, and liquid-glass navbar as the visual identity."
triggers:
  - "axentra"
  - "futuristic"
  - "cinematic hero"
  - "dark hero"
  - "shader background"
  - "glow hero"
  - "sci-fi landing"
  - "liquid glass nav"
  - "saas hero"
  - "particle background"
---

# Axentra — Futuristic Cinematic Hero

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Full-viewport dark hero for the fictional brand **axentra**, translating a
real-time WebGL shader background into a layered CSS/SVG equivalent: stacked
animated radial and conic gradients, drifting particles, a cursor-reactive
chromatic ripple, and SVG film grain. A liquid-glass pill navbar, a staggered
slide-down mobile menu, and a centered two-line headline over a
violet-to-blue glow deliver the same cinematic depth and slow drift as the
original shader with zero WebGL.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace the brand and copy** — swap "axentra" for the real brand name,
   the nav links for the real product areas, and the headline/subtext for
   the real message. Keep line lengths close to the originals so the
   `clamp()` type scale and the forced desktop line break still read well.
3. **Preserve the design system.** The dark palette, the violet/blue/lavender
   accent trio, the liquid-glass nav treatment, and the layered background
   motion are the identity of this template — do not swap in a different
   color mood or flatten the background to a single gradient.
4. **Extend by duplicating layers**, not by importing a different
   background technique. If more depth is needed, add another
   `.bg-layer` div with its own `var()`-based gradient rather than reaching
   for an external effects library or canvas.
5. **Keep motion accessible.** Every animation — ambient drift, swirl
   rotation, flare pulse, particle float, cursor ripple, grain flicker, entry
   fades, and the mobile menu stagger — must keep working through the
   `prefers-reduced-motion` block already in the file.

## Build spec

### Palette tokens (`:root`)

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#060309` | Base near-black canvas (neutral, literal) |
| `--ink` | `#f6f4fb` | Primary text on dark |
| `--muted` | `rgba(246,244,251,0.62)` | Secondary/monospace copy |
| `--accent-blue` | `#a9cbe8` | Lens-flare highlight; CTA hover glow; ripple core |
| `--accent-lavender` | `#c5b7ed` | Floating particles; ripple outer ring; halo bloom |
| `--accent-plum` | `#1a0f2e` | Ambient ground glow; swirl gradient stop |
| `--accent-ink` | `#241338` | Secondary swirl stop, keeps the rotation from reading flat |

All four accents are real parseable hex colors and every non-neutral
gradient (`.bg-ambient`, `.bg-swirl`, `.bg-flare`, `.bg-halo`, `.particle`,
`.ripple`, the CTA hover glow) pulls its chromatic stops from these
`var()`s, so a recolor pass changes the whole background system in one
edit. Near-black/near-white scaffolding (the vignette, the nav-pill border
sheen, text colors) stays literal by design.

### Type

- **Inter** (Google Fonts, weights 400/500/600/700) for the brand mark, nav,
  headline, and buttons — matches the prompt's font choice exactly, no
  substitution needed.
- **Courier New** (system monospace, no webfont required) for the subtext
  line, giving it the "terminal readout" contrast the prompt calls for.
- Headline uses `clamp(1.75rem, 5vw, 2.6rem)` so it scales continuously
  from phone to desktop; the forced line break between the two clauses is
  desktop-only and collapses to natural wrapping under 640px.

### Layout

1. **Layered background (`.bg`)** — seven stacked absolutely-positioned
   layers, bottom to top: an ambient plum ground glow anchored low-center
   (`ambientDrift`, slow scale/opacity breathing), a blurred rotating conic
   "swirl" gradient (`swirlRotate`, 100s per revolution), a lens-flare blue
   bloom plus a secondary lavender halo (`flarePulse`, gentle 9s throb,
   offset by 3s from each other), a field of ~26 JS-generated floating
   particles that drift and twinkle, an SVG `feTurbulence` grain layer
   (`grainShift`, subtle 1.6s jitter), and a neutral vignette on top to
   darken the frame edges. All layers respond to a slow pointer-parallax
   (`--px`/`--py` custom properties set on `<html>` from `mousemove`).
2. **Navbar (`.nav`)** — brand mark left, a centered "liquid glass" pill nav
   (blurred, luminosity-blended, gradient-sheen border via a masked
   `::before`) with five links, a white "Join the wait" pill button right.
   Below 1024px the pill nav and ghost button hide behind a hamburger that
   opens a full-bleed `.mobile-menu` panel with a staggered reveal
   (`transition-delay: calc(var(--i) * 50ms)`) and a full-width CTA at the
   bottom; `Escape` and tapping a link both close it.
3. **Hero (`.hero`)** — centered column: two-line headline, a monospace
   subtext line, and a white pill CTA with a Lucide-style arrow icon that
   nudges right on hover. All three fade up on load with a staggered delay.

### Motion inventory

- Ambient glow breathing (`ambientDrift`, 22s, alternate)
- Swirl gradient slow rotation (`swirlRotate`, 100s, linear)
- Lens-flare / halo pulse (`flarePulse`, 9s, offset pair)
- Floating particle drift + twinkle (`particleDrift`, randomized 14–32s per particle)
- Film-grain flicker (`grainShift`, 1.6s, stepped)
- Cursor-triggered chromatic ripple (`rippleExpand`, spawned on throttled `mousemove`, blue-core/lavender-ring split)
- Background pointer-parallax (ambient/swirl/flare translate with `--px`/`--py`)
- Hero content entrance (`fadeUp`, staggered 0.15s/0.32s/0.48s)
- Mobile menu open/close + per-link staggered reveal
- CTA arrow nudge and accent-colored glow on hover

Every animation above is neutralized or replaced with a dignified static
state inside the file's `@media (prefers-reduced-motion: reduce)` block,
and the ripple/parallax listeners never attach when that media query
matches.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="futuristic-cinematic-hero" type="text/html" title="Axentra — Futuristic Cinematic Hero">
<!doctype html>
<html>...</html>
</artifact>
```
