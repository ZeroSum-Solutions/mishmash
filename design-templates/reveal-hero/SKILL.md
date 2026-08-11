---
name: reveal-hero
description: |
  Full-viewport product hero for the fictional wearable air-purifier
  **PureFlow One**. A calm bare-faced portrait fills the frame; wherever the
  visitor's cursor lingers, a soft circular spotlight parts the image to
  reveal a second portrait of the same model wearing the product, so the
  device only "appears" inside the pointer's halo. A faint 48px grid drifts a
  few pixels against the cursor for depth, a fixed nav floats a dark pill
  menu and a pulsing status-dot CTA above the photo, and minimal hero copy
  sits low-left with a two-line headline and two calls to action.
tags:
  - "landing-page"
  - "motionsites"
  - "hero-section"
  - "cursor-interaction"
  - "product-reveal"
  - "spotlight-mask"
  - "minimalist"
triggers:
  - "pureflow"
  - "pureflow one"
  - "reveal hero"
  - "cursor spotlight"
  - "mask reveal"
  - "spotlight cursor effect"
  - "before after reveal"
  - "product hero"
  - "air purifier"
  - "wearable tech hero"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=reveal-hero"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build PureFlow One — Cursor Reveal Hero as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and the cursor-driven reveal mask are part of the identity. Ask only for the missing essentials first: brand name, real copy, and the two before/after product photos to swap in."
---

# PureFlow One — Cursor Reveal Hero

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single full-viewport hero for PureFlow One, a fictional wearable
air-purifier mask. A bare-faced portrait of a model sits on the base layer;
a second portrait of the same model wearing the product sits on a layer
above it, masked so only a soft circular window around the cursor shows it
through — moving the pointer across the photo "puts the mask on" wherever it
travels. A faint 48px line grid drifts a few pixels against the cursor for
depth. A fixed header floats a dark pill nav and a pulsing-dot reserve
button above the photo; the hero copy sits low and left with a short
eyebrow, a two-line headline, and two calls to action.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headline
   lines, nav labels, and CTA text. Swap the two vendored photos for a
   before/after pair of the *same* subject, framing, and lighting — one
   without the product, one wearing/using it — so the reveal reads as one
   continuous image rather than a jump cut.
3. **Preserve the design system.** The white/near-black neutral palette with
   a single green accent, and the spotlight-mask mechanic itself (base photo
   underneath, second photo revealed only inside a circular cursor-following
   mask) are the identity — do not swap in a colored backdrop, a different
   accent hue, or replace the mask with a plain hover-swap.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. This template ships one hero by design; if the user
   wants sections below it, design them from scratch in this template's own
   vocabulary (white/near-black neutrals, one chromatic accent, Inter type).
5. **Keep motion accessible.** The cursor-tracked reveal, the grid drift, the
   CTA dot pulse, and the load-in fade must all stay behind
   `prefers-reduced-motion`, exactly as the build spec below requires.

## Build spec

### Palette tokens

All chromatic color and the CTA glow gradient live on `:root` so the recolor
tooling can retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#ffffff` | Page background |
| `--fg` | `#111827` | Logo, headline, nav pill fill, primary button fill |
| `--fg-soft` | `#374151` | "View Specs" ghost label |
| `--eyebrow` | `#4b5563` | Eyebrow label |
| `--nav-inactive` | `#d1d5db` | Inactive desktop pill items |
| `--grid-line` | `#64748b` | Background grid stroke |
| `--accent` | `#4ade80` | The one chromatic token — status dot, CTA hover glow |
| `--accent-soft` / `--accent-strong` | `rgba(74,222,128,0.35)` / `rgba(74,222,128,0.55)` | Resting vs. hover radial glow behind the "Reserve Yours" pill |

The `.nav-cta::before` radial glow is the page's one visible
`radial-gradient`; both its resting and hover states reference
`var(--accent-soft)` / `var(--accent-strong)` so a client recolor retints the
glow. The reveal mask is also a `radial-gradient`, but its stops are
white/transparent alpha values with no hue — pure neutral scaffolding for
the mask channel, not a brand surface — so it stays literal by design, per
the recolor contract's neutral-scaffolding exception.

### Typography

**Inter** (Google Fonts, weights 300–700) exactly as specified — no
substitution needed. Headline is weight 700 at `1.5rem` → `1.875rem` (640px)
→ `2.25rem` (768px), line-height `1.25`. Eyebrow is weight 600, `10px` →
`11px`, `0.18em` letter-spacing, uppercase.

### Layout

**Fixed header** (`z-index: 50`): a 28×28 inline-SVG mark on the left; a
centered dark pill (`Device` active, `Real Stories` / `Science` / `Plans` /
`Reach Us`) visible from 768px; a "Reserve Yours" pill with a pulsing green
status dot on the right, also from 768px; a hamburger toggle below 768px
that swaps to an X and opens a full-width dropdown (`z-index: 40`) with the
same five items plus the CTA.

**Hero** (`<section>`, `height: 100vh`, `min-height: 480px`), four layered
children:

1. **Grid** — an inline `<svg>` at `opacity: 0.1`, a `<pattern>` of 48px
   cells with a single L-shaped stroke path, tiled behind everything.
2. **Base photo** — the bare-faced portrait, full-bleed `background-image`,
   `cover`, positioned `center 30%` to keep the face in frame across aspect
   ratios.
3. **Reveal layer** — the same portrait wearing the product, same
   background treatment, clipped by a CSS `mask-image` radial gradient
   (`circle 260px at var(--reveal-x) var(--reveal-y)`) that follows the
   smoothed cursor position.
4. **Hero copy** — bottom-left, `max-width: 260px` → `320px` (640px), pinned
   at `bottom: 3rem` on mobile/tablet and `bottom: 14rem` from 768px per the
   source spec: eyebrow, two-line `<h1>`, then a filled "Discover" button and
   a ghost "View Specs" button with a small play-triangle icon.

### Motion inventory

- **Cursor reveal (the star effect)**: on `pointermove` inside the hero, a
  raw cursor position is eased toward with factor `0.1` per animation frame;
  the eased position is written to `--reveal-x` / `--reveal-y` every frame,
  which drives the mask's `radial-gradient` center. The gradient's stops
  (`0/40/60/75/88/100%` → alpha `1/1/0.75/0.4/0.12/0`) reproduce the source
  design's canvas-drawn spotlight falloff exactly. On pointer leave, the
  target recenters so the mask eases back to the middle instead of sticking
  off-screen.
- **Grid parallax**: from the same eased cursor position, a secondary offset
  is eased toward `(cursor − center) × 16` with factor `0.06` and written to
  the SVG `<pattern>`'s `x`/`y` attributes each frame — a few px of drift
  that reads as depth without competing with the reveal.
- **CTA status dot**: a continuous ring pulse (`scale(0.9)→scale(1.9)`,
  fading out, 2200ms, `ease-out`, infinite) plus a blurred radial backglow
  that appears on hover of "Reserve Yours" (`opacity 0→1`, 300ms).
- **Load-in fade-up**: the eyebrow, headline, and action row each animate
  `opacity 0→1` with `translateY(16px)→0` over 700ms, staggered `0.1s` apart,
  easing `cubic-bezier(0.23, 1, 0.32, 1)`.
- **Mobile menu**: opacity/transform/visibility transition, 200ms opening,
  140ms closing (asymmetric per the repo's motion defaults — exit reads
  quicker since the user already chose to dismiss it).
- **`prefers-reduced-motion: reduce`**: the pointer/rAF loop never starts, so
  the reveal mask stays parked at its CSS-default center (`50% 50%`) and the
  grid stays at its default `x=0 y=0` — a static "product already revealed
  in the middle" composition rather than a moving one. The dot's pulse ring
  is hidden, the mobile menu's transition is removed, and the load-in
  fade-up renders fully visible with no transform.

### Assets

- `assets/hero-face-bare.webp` — the bare-faced base portrait (1280×724,
  ~29KB), vendored from the prompt's `BG_IMAGE_1` CDN URL.
- `assets/hero-face-masked.webp` — the same model wearing the product
  (1280×724, ~39KB), vendored from the prompt's `BG_IMAGE_2` CDN URL.

**Translation note:** the source prompt computes the spotlight via a hidden
`<canvas>` — drawing a radial gradient every frame and re-encoding it with
`toDataURL()` as a CSS `mask-image`. This build reproduces the identical
visual falloff with a CSS `radial-gradient` positioned by two CSS custom
properties (`--reveal-x`/`--reveal-y`) updated straight from the rAF loop —
same stops, same 260px radius, same per-frame cursor tracking, but no canvas
element and no per-frame image re-encoding. It is a lighter vanilla
implementation of the same motion character, not a different effect.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="reveal-hero" type="text/html" title="PureFlow One — Cursor Reveal Hero">
<!doctype html>
<html>...</html>
</artifact>
```
