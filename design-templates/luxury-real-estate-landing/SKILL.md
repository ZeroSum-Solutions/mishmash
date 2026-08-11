---
name: luxury-real-estate-landing
description: |
  Warm, editorial single-page landing for **Velar.**, a fictional luxury
  real-estate brand. A deep-teal typewriter preloader gives way to a
  sky-backdrop hero ("Live in Irreplaceable") with a cutout building image
  that rises from below on load, then a scroll-driven centerpiece: as the
  user scrolls, that same building drifts upward and scales to 1.45x while
  pinning toward the bottom of a sticky black statement section with
  count-up stats. A hover-expand five-tile video gallery slides up over the
  statement section, and a bronze-gradient "Inquire" close finishes the
  page. Syne (display) pairs with Inter (body) throughout, on a warm
  off-white ground with one chromatic bronze accent.
tags:
  - "landing-page"
  - "motionsites"
  - "real-estate"
  - "luxury"
  - "editorial"
  - "scroll-driven"
  - "video-gallery"
triggers:
  - "velar"
  - "luxury real estate landing"
  - "real estate landing page"
  - "property landing page"
  - "scroll-driven hero"
  - "hover expand gallery"
  - "estate agency landing"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=luxury-real-estate"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Velar. — Luxury Real Estate Landing as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any property imagery/footage to swap in."
---

# Velar. — Luxury Real Estate Landing

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Warm, editorial single-page landing for **Velar.**, a fictional luxury
real-estate brand. A deep-teal typewriter preloader gives way to a
sky-backdrop hero ("Live in Irreplaceable") with a cutout building image
that rises from below on load, then a scroll-driven centerpiece: as the
user scrolls, that same building drifts upward and scales to 1.45x while
pinning toward the bottom of a sticky black statement section with
count-up stats. A hover-expand five-tile video gallery slides up over the
statement section, and a bronze-gradient "Inquire" close finishes the
page. Syne (display) pairs with Inter (body) throughout, on a warm
off-white ground with one chromatic bronze accent.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headline,
   statement copy, stats, and property imagery/footage. Match existing
   image/video dimensions when swapping assets.
3. **Preserve the design system.** The warm off-white/deep-teal/black
   palette, the Syne + Inter type pairing, the preloader typewriter, and the
   scroll-driven house centerpiece in the build spec below are the identity
   — do not substitute fonts, recolor the neutral scaffolding, or strip the
   scroll-linked motion.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. If a section is missing, design it from scratch in this
   template's own vocabulary.
5. **Keep motion accessible.** Every animation must stay behind
   `prefers-reduced-motion`, as the build spec requires.

## Build spec

### Palette

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f5f0ea` | Page background (warm off-white) |
| `--ink` | `#213138` | Headlines, nav logo (default), body text |
| `--dark` | `#1a1a1a` | Statement section and gallery background |
| `--paper` / `--paper-dim` | `#e8e4df` / `rgba(255,255,255,.6)` | Statement copy / stat labels on dark |
| `--accent` / `--accent-2` | `#a9835a` / `#dcbd8e` | The one chromatic token family — eyebrow divider, gallery hover glow, Inquire CTA gradient |
| `--line` | `rgba(255,255,255,.2)` | Stat-column dividers on dark |

The near-black (`--dark`) and warm off-white (`--bg`) scaffolding stays
literal by design — that is the neutral surface the recolor filter is meant
to leave alone. The bronze `--accent`/`--accent-2` pair is what actually
retints on a client recolor: the small divider bar above "The Velar
Standard," the radial hover glow on gallery tiles, and the Inquire button's
gradient fill.

### Typography

Two Google Fonts, an exact match to the source spec:

- **Syne** (700/800/900) — nav wordmark, hero headline ("Live in
  Irreplaceable"), preloader typewriter, section eyebrows, gallery ticker
  wordmark, mobile menu links, Inquire heading.
- **Inter** (300/400/500/600) — body copy, statement paragraph, stat
  numbers/labels, footer.

### Layout

1. **Preloader** — a fixed full-viewport `#213138` overlay that types out
   "Velar." letter by letter (a trailing cursor blinks after the last typed
   letter), then lifts away (`translateY(-100%)`) to reveal the hero.
2. **Nav** — fixed, transparent, logo left / hamburger right. The logo and
   hamburger bars cross-fade from ink to white whenever the dark statement
   or gallery section sits at the top of the viewport. The hamburger opens
   a full-screen off-white menu (Residences, Story, Listings, Inquire).
3. **Hero** — full-bleed sky-photo background, `min-height: 100vh`. A top
   row pairs "LIVE IN" (left) with a two-line right-aligned subhead (desktop
   only), followed by the oversized "IRREPLACEABLE" headline and a
   mobile-only subhead. Type sizes step through three explicit breakpoints
   via `clamp()`/`vw` per the source spec.
4. **Scroll-driven house (centerpiece)** — a single `position: fixed`
   element holding the cutout building image. It rises from below the
   viewport when the preloader lifts, rests bottom-centered, then — once
   30% of the hero has scrolled past — drifts toward `top:0; left:0` and
   scales to 1.45x as the user keeps scrolling, easing with a
   double-applied smoothstep, until it pins near the bottom of the dark
   statement section.
5. **Statement + stats (sticky)** — a 200vh wrapper holding a
   `position: sticky` black panel: an eyebrow ("The Velar Standard") over a
   four-line statement, then a three-column stat row (120+ Portfolio
   Holdings, 12 Global Locations, 98% Patron Loyalty Rate) that counts up
   once each number is 30% in view.
6. **Hover-expand gallery** — a `margin-top: -100vh` section that slides up
   over the statement panel. Five muted looping property videos sit in an
   accordion row; hovering one grows it to `flex: 4` while its neighbors
   compress, over a giant faint "Velar." word-mark ticker in the
   background. Collapses to a 2-column grid (the fifth, odd tile centered
   full-width below) under 1024px.
7. **Inquire (close)** — an off-white closing panel: headline, one-line
   subhead, a bronze-gradient "Inquire with Velar" mailto CTA, and a small
   footer (in-page links + copyright).

### Motion inventory

- **Preloader typewriter**: letters are inserted one at a time (140ms
  apart, starting at 600ms) before a blinking cursor; the whole overlay then
  slides up (`1.5s cubic-bezier(0.45,0,0.15,1)`) while the hero text
  fade-slides in behind it.
- **Scroll-driven house**: a `scroll`/`resize`-driven, `requestAnimationFrame`-throttled
  recompute of the house's translate + scale, easing via `smoothstep`
  applied twice for a slow-in/slow-out feel.
- **Nav color cross-fade**: `color 0.35s ease` on the logo/hamburger bars,
  toggled by an `IntersectionObserver`-free `getBoundingClientRect` check
  against the two dark sections, throttled with `requestAnimationFrame`.
- **Stat count-up**: `IntersectionObserver` (30% threshold) triggers a
  2000ms `requestAnimationFrame` count from 0 to each target, eased with
  `1 - (1-t)^3`.
- **Gallery hover-expand**: `flex 0.5s cubic-bezier(0.4,0,0.2,1)` on the
  hovered tile (and its neighbors, via the shared flex row); a soft bronze
  radial-gradient glow fades in over the hovered tile at the same time.
- **`prefers-reduced-motion: reduce`**: the entire preloader sequence
  collapses to its end state instantly (no typewriter delay, no lift
  animation) instead of merely speeding up; the scroll-driven house is
  never wired to scroll at all and stays parked in its resting,
  bottom-centered position; stat numbers render at their final value
  immediately instead of counting up; and all remaining transitions
  (hamburger bars, mobile menu, gallery hover, Inquire CTA) drop to a
  near-zero duration.

### Assets

- `assets/hero-bg.webp` — the prompt's `images.higgs.ai` sky background,
  fetched at its serving resolution (1920×1080, ~22KB webp).
- `assets/house.webp` — the prompt's Cloudinary building cutout PNG
  (4096×2304, ~5MB), resized to 1600px wide and re-encoded as lossy webp
  with a lossless alpha channel (~64KB) to keep transparency at a fraction
  of the original weight.
- `assets/gallery-1.mp4` … `assets/gallery-5.mp4` — the prompt's five
  CloudFront property MP4s (1928×1072, 4s, 8–14 Mbps H.264), each
  transcoded to a muted 720p H.264 loop with `ffmpeg` (156KB–300KB apiece,
  ~1MB combined vs. ~26MB source).

### Deviations from the literal prompt spec

- **Single fixed element for the house**, not an outer/inner div pair. The
  source spec describes an outer `position: fixed` wrapper plus an inner
  div that separately handles the "rise from below" entrance and the later
  scroll-driven repositioning. This build merges both into one element
  (CSS class toggle for the entrance, direct inline-style writes for the
  scroll phase) — same visual result, fewer moving parts.
- **Reduced-motion house behavior**: rather than keep the scroll listener
  wired and merely shortening its transition durations, this build treats
  the whole scroll-driven parallax as decorative motion and skips wiring it
  at all under `prefers-reduced-motion: reduce`, per this repo's "dignified
  static fallback" rule — the house stays parked at rest.
- **Statement text wraps on mobile.** The source spec sets
  `white-space: nowrap` on every statement line unconditionally; at the
  smallest supported width that produces horizontal overflow, so this build
  only applies `nowrap` at `≥1024px` and lets lines wrap naturally below
  that (`prompt-fixed`, not a content change).
- **Ticker background is static**, matching the source spec's own note that
  its reference implementation leaves the giant "Velar." word-mark as a
  static layered backdrop rather than animating it.
- **Icon translation.** The hamburger/close control is built as two plain
  CSS bars that morph into an X (no `lucide-react` available outside a
  React build); functionally and visually equivalent to the source spec's
  Lucide `X` swap.
- **Inquire section is new.** The source prompt's spec stops at the
  gallery and never describes a closing/contact section, but the nav's
  mobile menu includes an "Inquire" link with nowhere to land. This build
  adds a short, on-brand closing panel (headline, subhead, mailto CTA,
  footer links) so the page has a real destination and a natural close.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="luxury-real-estate-landing" type="text/html" title="Velar. — Luxury Real Estate Landing">
<!doctype html>
<html>...</html>
</artifact>
```
