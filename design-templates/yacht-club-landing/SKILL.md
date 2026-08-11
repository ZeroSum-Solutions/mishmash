---
name: yacht-club-landing
description: |
  A single-viewport, dark-luxury landing experience for a fictional yacht club
  called **Meridian**. A fixed hero sits over a layered CSS "open water"
  backdrop (drifting radial gradients plus a film-grain overlay), with a huge
  uppercase Instrument Serif headline, a GSAP-style off-canvas navigation
  drawer translated to vanilla CSS/JS, an interactive liquid cursor-ripple
  trail driven by an SVG displacement filter, and a full-screen "Our Fleet"
  overlay with three hover-revealed yacht columns (video, spec sheet, CTA).
tags:
  - "landing-page"
  - "motionsites"
  - "luxury"
  - "yacht"
  - "dark-theme"
  - "editorial"
triggers:
  - "yacht club"
  - "yacht"
  - "sailing"
  - "marina"
  - "nautical"
  - "luxury landing"
  - "fleet"
  - "membership"
  - "meridian"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=yacht-club-hero"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Meridian — Yacht Club Landing as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: club/brand name, real fleet copy, and any footage to swap in."
---

# Meridian — Yacht Club Landing

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single-viewport, dark-luxury landing experience for a fictional yacht club called **Meridian**. A fixed hero sits over a layered CSS "open water" backdrop (drifting radial gradients plus a film-grain overlay), with a huge uppercase Instrument Serif headline, a GSAP-style off-canvas navigation drawer translated to vanilla CSS/JS, an interactive liquid cursor-ripple trail driven by an SVG displacement filter, and a full-screen "Our Fleet" overlay with three hover-revealed yacht columns (video, spec sheet, CTA).

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real club/brand name, headline
   copy, subtext, fleet roster, and footage. Keep the spec-sheet `<dl>` shape
   (label/value pairs) when swapping fleet entries — it drives both the visual
   layout and the reveal stagger.
3. **Preserve the design system.** The palette, uppercase-serif type system,
   spacing rhythm, and motion in the build spec below are the identity — do
   not substitute fonts, recolor the palette, or strip decorative elements.
4. **Extend by duplicating sections**, never by importing a layout from another
   template. If a section is missing (e.g. a real booking flow), design it
   from scratch in this template's own vocabulary.
5. **Keep motion accessible.** Every animation stays behind
   `prefers-reduced-motion`, and the liquid cursor trail is gated to
   hover-capable pointers only — never let a replacement effect break either
   guard.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="yacht-club-landing" type="text/html" title="Meridian — Yacht Club Landing">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The page is a fixed, non-scrolling "app shell" (matching the source prompt's
absolutely/fixed-positioned React overlay structure) rather than a long
scrolling marketing page — everything lives in one viewport, with two
full-screen overlays (nav drawer, fleet viewer) layered on top.

### Palette

- `--background:#0b0c0d`, `--background-2:#050607` — near-black neutral
  scaffolding (literal, protected from the recolor pass).
- `--accent:#93c5fd` — the design's one true chromatic signature: a
  water-glass blue lifted directly from the source spec's own ring
  `box-shadow` (`rgba(147,197,253,…)`) and its menu color pair. Used for
  hover states, the "MERIDIAN" and offcanvas accents, and one `ocean-glow`
  gradient layer.
- `--accent-deep:#123047` — a dark hull-teal blended into the hero backdrop
  gradient for depth.
- `--accent-gold:#c9a463` — brass/gold trim (matches the "gold detailing"
  fleet spec), used for the second `ocean-glow` layer and the off-canvas
  drawer's leading wipe band.
- `--menu-panel:#161616` — the off-canvas drawer surface, close to the
  source's own `#1a1a1a`.

### Type

**Instrument Serif** (Google Fonts, italic + normal — an exact match for the
source's `@fontsource-variable/geist`-imported-but-effectively-overridden
serif system; the source forces `font-serif uppercase` globally, so Geist
never actually renders and is dropped here). Nearly all copy renders
uppercase with wide tracking, including the long-form subtext paragraph — a
deliberate luxury-editorial choice carried over from the source spec.

### Sections (top to bottom / z-order)

1. **Ocean backdrop** (`z:0`) — the source's Vimeo background iframe
   (`player.vimeo.com/video/…`) is not vendorable (external host, and
   third-party iframes are disallowed in this template format). Translated to
   a layered-CSS fallback: a base linear-gradient blending
   `--background-2 → --accent-deep → --background`, two slow-drifting
   `radial-gradient` "glow" layers (`--accent`, `--accent-gold`) with a
   28–34s alternate drift animation, and a faint moving diagonal sheen. A
   film-grain `<div>` (inline SVG `feTurbulence` data URI, `mix-blend-mode:
   overlay`) sits above it for texture.
2. **Fixed header** — small "MERIDIAN / Yacht Club" wordmark top-left; a
   hamburger ("+" that rotates 225° into "×") plus a slot-machine
   "Menu"/"Close" label top-right.
3. **Hero copy** (absolute, `top:96px`, `left:20px`/`96px` at `md:`) — the
   four-line display headline ("Master the / *Elements.* / Embrace the /
   *Ocean*", italic on lines 2 and 4) at `clamp(3rem, 3rem + 5vw, 8.75rem)`,
   staggered fade/rise-in on load; a narrow 260px subtext paragraph beneath it
   (pushed `+100px` on desktop, per the source spec).
4. **Floating CTA** ("Join the *Club*", bottom-right, `z:50`) — glass pill
   button that slides left by `clamp(260px, 38vw, 420px)` on desktop whenever
   the nav drawer is open, so it never sits under the panel.
5. **Liquid cursor trail** (`z:3`, hover-capable pointers only) — a hidden SVG
   `<filter id="liquid-trail">` (`feTurbulence` + `feDisplacementMap`, exact
   values from the source) drives `backdrop-filter: url(#liquid-trail)
   blur(1px)` on a rotating pool of ring `<div>`s. `mousemove` spawns a ring
   past a 25px travel threshold; a `requestAnimationFrame` loop steps each
   active ring's age (`+0.012`/frame), sizing it `20 + age·280` and fading it
   `1 − age^1.2` until it retires. Pool size is 40, not the source's 80 — at
   full growth each ring is a ~300px backdrop-filter region, and 80
   simultaneous large filtered regions was heavier than the visual needed;
   every other constant (threshold, age step, size/opacity formulas, rotating
   index) is kept exact.
6. **Off-canvas nav drawer** — two `prelayer` wipe bands (a thin gold leading
   edge + the dark panel fill) slide in from the right staggered 70ms apart,
   then the real `<nav>` panel follows (650ms). Six items (Home, Our Fleet,
   Membership, Regattas & Events, Academy, Contact) enter with a
   translateY+rotate-to-flat stagger; "Our Fleet" opens the fleet overlay
   instead of navigating. A social row (Instagram/Facebook/Twitter as plain
   text links, no logo marks) sits at the panel's foot.
7. **Fleet overlay** (`z:80`, full-screen) — three yacht columns
   (`flex-col` on mobile → `flex-row` on desktop, matching the source),
   each a `<button>` wrapping a muted looping video, a tint layer, and a
   hover/focus/tap-revealed content stack (ship name, a `<dl>` spec sheet,
   a "View" affordance). Columns slide in from `100vw` staggered `i·100ms`
   over 1.56s when the overlay opens; the backdrop blurs to `100px` over the
   same 1.56s (and back to `0` over 1.3s on close) — both durations lifted
   directly from the source spec. On mobile the overlay scrolls vertically
   (`overflow-y:auto`) so all three stacked columns stay reachable.

### Motion

Vanilla CSS transitions/keyframes plus three small `requestAnimationFrame`/
`IntersectionObserver`-free interaction scripts (menu state, fleet state,
cursor-ripple stepping) — no animation library. Repo-standard ease-out
(`cubic-bezier(0.23, 1, 0.32, 1)`) throughout, asymmetric enter/exit timing,
nothing scales from 0. `@media (prefers-reduced-motion: reduce)` collapses
every transition/animation to ~1ms and disables the cursor-ripple pool
entirely, while leaving the underlying open/close state logic untouched so
nothing gets stuck mid-transition.

### Fleet data (fictional, no real trademarks)

- **Ocean Eclipse** — 28m (92ft), 22kt cruising, up to 12 guests, 4 en-suite
  cabins, advanced gyro stabilization.
- **Black Sovereign** — 24m (78ft), 45kt top speed, carbon fiber & Kevlar
  hull, twin V12 2000hp, bespoke gold detailing.
- **Azure Horizon** — 32m (105ft), 1,500nm range, 14 guests + 5 crew, sun
  deck with jacuzzi, full water-toys garage.

### Assets

Three aerial yacht clips (5s, 736×1248, muted, ~6.6MB combined) fetched
directly from the krea.ai URLs in the source spec and re-encoded with
`ffmpeg` (`libx264`, `crf 26`, faststart) for web delivery, each with a
matching JPEG poster frame extracted from the clip. All three were
frame-checked for logos/watermarks before vendoring — clean, AI-generated
footage with no baked-in branding.
