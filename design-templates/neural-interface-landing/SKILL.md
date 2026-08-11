---
name: neural-interface-landing
description: |
  Cinematic single-page landing for the fictional neural-AI platform
  **SynapseX**. A fixed, full-viewport background video scrubs frame-by-frame
  as the page scrolls and progressively blurs, sitting behind a scramble-in
  split-corner hero headline, a 3D-tilted cinematic paragraph reveal, and a
  frosted-glass horizontal metrics carousel. Pure black-and-white scaffolding
  is punctuated by one neon-green "synaptic" accent that ties the UI to the
  glowing footage underneath it.
tags:
  - "landing-page"
  - "motionsites"
  - "cinematic"
  - "video-background"
  - "dark-mode"
  - "carousel"
triggers:
  - "synapsex"
  - "neural interface"
  - "neural ai"
  - "brain computer interface"
  - "scroll scrub video"
  - "cinematic hero"
  - "scramble text"
  - "metrics carousel"
  - "dark tech landing"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=neural-interface"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build SynapseX — Neural Interface Landing as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage to swap in."
---

# SynapseX — Neural Interface Landing

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A three-section cinematic landing page for SynapseX, a fictional neural-AI
interface brand. A fixed, full-bleed background video is the page's only
imagery: it never plays on its own timeline, instead its `currentTime` is
scrubbed directly from scroll position, and it blurs and scales up the
further the visitor scrolls. On top of it sit a split-corner hero headline
whose four words scramble in from random glyphs, a large 3D-tilted paragraph
that fades in and back out as it crosses the viewport, and a horizontally
scrollable row of six frosted-glass metric cards.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, the four
   hero words, the cinematic paragraph, and the six metric cards' titles,
   values, footers, and detail bullets. Swap `assets/synapse-bg.mp4` and
   `assets/bg-poster.jpg` for footage/a still of matching mood (dark,
   slow-moving, safe to blur heavily).
3. **Preserve the design system.** The black backdrop, Space Mono monospace
   type, the scroll-scrubbed video mechanic, and the single neon-green
   accent are the identity — do not swap in a light theme, a different
   typeface family, or a second competing accent hue without being asked.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. If the user wants more sections, design them from
   scratch in this template's own vocabulary (black/white/glass neutrals,
   one chromatic accent, monospace type, generous negative space).
5. **Keep motion accessible.** Every animation — video scrub/blur, scramble
   text, scroll-linked fades, the metrics reveal, and the carousel's
   coverflow-lite scaling — stays behind `prefers-reduced-motion`, exactly as
   the build spec below requires.

## Build spec

### Palette tokens

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#050505` | Page/video-stage background |
| `--fg` | `#ffffff` | Headlines, body text |
| `--muted` / `--muted-strong` | `rgba(255,255,255,0.62)` / `rgba(255,255,255,0.85)` | Description copy, nav-link resting/hover state |
| `--glass` / `--glass-strong` | `rgba(255,255,255,0.08)` / `rgba(255,255,255,0.15)` | Stat-card and header-pill frosted surfaces |
| `--line` | `rgba(255,255,255,0.12)` | Hairline borders (stat card inner border, carousel arrows) |
| `--accent` | `#4dffb4` | The one chromatic token — CTA gradient, stat-card values, active-card border, carousel dots, cinematic ambient glow. Picked to match the neon-green glow already present in the vendored footage. |
| `--accent-2` | `#22d3ee` | Second gradient stop (cyan) paired with `--accent` on the CTA button only |

The CTA button gradient (`linear-gradient(120deg, var(--accent), var(--accent-2))`)
and the cinematic section's ambient radial glow both reference the `--accent`
tokens directly, so a client recolor retints the CTA and the glow together.

### Typography

**Space Mono** (Google Fonts, weights 400/700, roman + italic) — used exactly
as specified in the source prompt, no substitution needed. Hero headline is
`clamp(50px, 8vw, 100px)` at weight 300, line-height `0.95`, letter-spacing
`-0.03em`. Cinematic paragraph is `clamp(22px, 3.5vw, 42px)`, weight 400,
line-height `1.35`. Stat values are `clamp(60px, 6vw, 76px)`, weight 400,
letter-spacing `-0.04em`.

### Layout

Header is `position: fixed`, containing a logo pill (abstract four-fold
vector mark + "SynapseX" wordmark), an expanding hamburger pill with two
in-page nav links (About → cinematic section, Metrics → carousel section),
and a CTA pill ("Request Access") that smooth-scrolls to the metrics
section. `<main>` holds three sections in document order:

1. **Hero** — a 2-column CSS grid split into a top row (h1 "Brain" / "And
   Body", top-left) and a bottom row (description paragraph left, h2 "One" /
   "Network" right-aligned). Collapses to a single column on mobile.
2. **Cinematic** — one large centered paragraph inside a `perspective: 400px`
   container; its inner wrapper tilts on `rotateX` and translates as the
   user scrolls through it, with an ambient `--accent`-tinted radial glow
   behind it.
3. **Stats/metrics carousel** — a full-bleed (`100vw`) frosted-glass card
   row: six `<article>` cards (title, big value, three detail bullets, a
   footer label), horizontally scrollable with CSS scroll-snap, arrow
   buttons, dot indicators, and pointer-drag on desktop.

### Motion inventory

- **Video entrance**: on `loadeddata` (or a 1.6s safety timeout), the video
  fades from `opacity 0` and zooms down from `scale(1.12)` to its resting
  scale over ~1.3s, `easeOutCubic`. Header and main content fade in once the
  entrance completes.
- **Video scroll-scrub**: the video never autoplays — its `currentTime` is
  set every frame to `scrollProgress * video.duration` (smoothed with a
  0.12 lerp), and it progressively blurs (`0px → ~45px`) and scales up
  (`1.03× → 1.11×`) the deeper the user scrolls.
- **Scramble-in text**: the four hero words reveal via a glyph-scramble
  effect (random ASCII characters resolving left-to-right into the real
  word) once the entrance completes, staggered ~140ms apart. Simplified
  from the source prompt's continuous scramble-out-on-scroll/scramble-in
  toggle to a single one-time reveal, for a calmer, more legible result.
- **Hero scroll fade**: the hero block fades and scales down slightly as the
  page scrolls through its first ~26%; the description paragraph fades and
  lifts independently over the first ~12%.
- **Cinematic 3D reveal**: the paragraph's `rotateX(24deg)` wrapper
  translates and fades in between ~8–22% scroll, holds fully visible to
  ~42%, then fades back out by ~65%.
- **Metrics reveal + carousel**: the whole carousel section fades/scales in
  once it enters the viewport (`IntersectionObserver`). Inside it, cards
  scale and dim based on distance from the track's center (a coverflow-lite
  effect), with arrow buttons, dot navigation, and desktop pointer-drag, all
  built on native CSS scroll-snap — no carousel library.
- **`prefers-reduced-motion: reduce`**: the background video is hidden in
  favor of its poster image, all scroll-linked transforms/opacities resolve
  to their settled state immediately, the scramble effect is skipped (words
  render as plain text), the metrics carousel keeps its scroll/drag/arrow
  interactions but drops the coverflow scaling, and every CSS
  transition/animation duration collapses to near-zero.

### Assets

- `assets/synapse-bg.mp4` — the vendored CloudFront source clip, transcoded
  locally with `ffmpeg` to a muted, 720p, ~4s H.264 loop (~770KB), referenced
  with a plain `<video>` tag (no HLS, no streaming library).
- `assets/bg-poster.jpg` — a extracted frame from the same clip (~61KB),
  used as the `<video poster>` and as the CSS background of the video stage
  for the reduced-motion fallback.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="neural-interface-landing" type="text/html" title="SynapseX — Neural Interface Landing">
<!doctype html>
<html>...</html>
</artifact>
```
