---
name: luminara-hero
description: |
  Full-viewport hero for the fictional creative-showcase brand **Luminara**. A
  looping ambient forest video — bioluminescent tree roots, drifting light
  shafts, and violet blossoms — fills the frame behind two floating glass nav
  pills, a glass badge, and a bottom-anchored headline that pairs Inter
  medium sans with a violet-to-teal gradient Instrument Serif italic accent
  word. A slow Ken Burns drift, rising light-mote particles, and a
  cursor-parallax background layer keep the frame alive without competing
  with the type.
tags:
  - "landing-page"
  - "motionsites"
  - "hero-section"
  - "video-background"
  - "glassmorphism"
  - "gradient-text"
  - "cinematic"
triggers:
  - "luminara"
  - "creative showcase"
  - "video hero"
  - "glass pill nav"
  - "forest hero"
  - "ambient video background"
  - "gradient italic headline"
  - "light particles hero"
  - "cinematic hero"
  - "showcase landing"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=luminara"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Luminara — Creative Showcase Hero as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and a looping background video or fallback image to swap in."
---

# Luminara — Creative Showcase Hero

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single full-viewport hero for Luminara, a fictional creative-showcase
studio. A muted, looping video of a glowing forest — spiraled roots, drifting
light shafts, rising motes — fills the entire viewport as the base layer. Two
frosted glass pills float in a fixed header (logo + nav links on the left,
ghost and solid CTAs on the right), a dark scrim gradient climbs from the
bottom for contrast, and the hero copy sits low: a glass badge, a two-line
headline whose last word renders in a gradient serif italic, and a short
description that mirrors the headline on the opposite side at desktop width.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, nav
   labels, badge text, headline, and description. Swap the background video
   (and its poster frame) for the client's own footage — keep it muted,
   looped, and ambient rather than fast-cutting, so it stays a backdrop and
   never fights the copy sitting on top of it.
3. **Preserve the design system.** The frosted glass pill nav, the
   violet-to-teal gradient accent, the Instrument Serif italic treatment on
   the headline's last word, and the bottom-anchored copy over a dark scrim
   are the identity — do not swap in an opaque nav bar, a different accent
   hue, or move the copy to the top of the frame.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. This template ships one hero by design; if the user
   wants sections below it, design them from scratch in this template's own
   vocabulary (dark ground, glass pills, the violet/teal accent pair, Inter +
   Instrument Serif type).
5. **Keep motion accessible.** The Ken Burns drift, the parallax background
   layer, the rising particles, and every entrance fade must stay behind
   `prefers-reduced-motion`, exactly as the build spec below requires.

## Build spec

### Palette tokens

All chromatic color lives on `:root` so the recolor tooling can retint the
page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#05070d` | Page background beneath the video/poster |
| `--fg` | `#f6f5ff` | Logo, headline, nav/badge text |
| `--fg-soft` | `rgba(246,245,255,0.84)` | Right-column description copy |
| `--fg-muted` | `rgba(246,245,255,0.6)` | Badge's `*` separator |
| `--pill-bg` | `rgba(6,8,16,0.42)` | Glass fill on both nav pills and the badge |
| `--pill-border` | `rgba(255,255,255,0.12)` | Glass pill/badge border |
| `--accent` | `#a78bfa` | Violet — gradient start on the headline accent word, one particle color, the solid CTA's hover glow, the badge's ambient pulse |
| `--accent-2` | `#5eead4` | Teal — gradient end on the headline accent word, the alternating particle color |
| `--accent-soft` | `rgba(167,139,250,0.35)` | Resting-state glow strength for the CTA hover halo and badge pulse |

The headline's italic accent word (`.heading-accent`) is a
`linear-gradient(90deg, var(--accent), var(--accent-2))` clipped to text; the
solid "Get a quote" button's hover halo and the seven ambient particles are
`radial-gradient`s built from the same two tokens. The bottom contrast scrim
and the glass pill fills are literal black/white alpha values — neutral
scaffolding with no hue, so they stay literal by design rather than
tokenized, per the recolor contract's neutral-scaffolding exception.

### Typography

**Inter** (Google Fonts, weights 400/500/600) for all body and UI text, and
**Instrument Serif** (Google Fonts, italic axis) for the headline's accent
word — both fonts loaded exactly as specified, no substitution needed. The
headline scales `clamp(1.9rem, 1.15rem + 3.6vw, 4.25rem)`, weight 500, line
height 1.05; the description scales `clamp(0.875rem, 0.8rem + 0.3vw, 1rem)`.

### Layout

A single `<section class="hero">` (`100svh`, `overflow: hidden`) stacks, back
to front:

1. **Background video** — a three-layer stack: an outer `.hero-parallax`
   wrapper (oversized by 16px on every edge, translated by the cursor-tracked
   script) contains `.hero-zoom` (scaled by the Ken Burns keyframe), which
   contains a poster `<div>` and the `<video>` itself (`autoplay muted loop
   playsinline`, `object-fit: cover`). Splitting the translate and the scale
   across two different elements keeps the CSS animation and the
   JS-driven parallax from fighting over the same `transform` property.
2. **Ambient particles** — seven absolutely-positioned `<span>`s drifting
   upward and fading, layered above the video, below the copy.
3. **Bottom scrim** — a `linear-gradient(to top, black 0%, black/40% 55%,
   transparent 100%)` covering the bottom 60% of the viewport for text
   contrast.
4. **Header** (`position: absolute; top: 0`) — a `<nav>` with two glass
   pills: left holds the inline-SVG mark plus `Work` / `Gallery` / `Plans` /
   `Story` links (hidden below 640px, matching the source's mobile
   treatment); right holds a ghost "Get Free" link and a solid "Get a quote"
   link with a violet hover glow.
5. **Bottom content** (`position: absolute; bottom: 0`) — a column on mobile,
   a row (`align-items: flex-end; justify-content: space-between`) from
   1024px up: left side carries the glass badge ("Luminara `*` Creative
   Showcase") and the two-line `<h1>`; right side carries the description,
   full-width and left-aligned on mobile and only gaining its `24rem`
   max-width and right alignment at the 1024px breakpoint — matching the
   source's `lg:max-w-sm lg:text-right`, which leaves the paragraph
   unconstrained below that breakpoint rather than narrowing it everywhere.

### Motion inventory

- **Ken Burns drift**: `.hero-zoom` scales `1 → 1.07` over 26s,
  `ease-out`, `alternate infinite`.
- **Cursor parallax**: a `pointermove`/`pointerleave` listener on the hero
  feeds a lerped `(x, y)` into `.hero-parallax`'s `translate3d`, capped at
  ±12px, driven by `requestAnimationFrame`; the wrapper's 16px oversize
  guarantees the video never reveals an edge at the offset extremes.
- **Rising light motes**: seven CSS-only particles at varying left offsets,
  sizes, durations (12–20s), and delays drift from the bottom edge to
  `-88vh` while fading in and back out — an echo of the glowing motes already
  drifting in the source footage.
- **Entrance stagger**: the two nav pills fade down (`0.1s` delay), the badge
  fades up with a soft ambient glow pulse (`0.2s` delay, glow loops every
  4.4s), the headline fades up (`0.35s`), the description fades up (`0.5s`) —
  all `translateY` + `opacity`, `cubic-bezier(0.23, 1, 0.32, 1)`.
- **Hover states**: nav links and the ghost button fade in a light tint; the
  solid CTA lifts 1px and blooms a violet radial glow behind it.
- **`prefers-reduced-motion: reduce`**: the `<video>` is hidden (its poster
  frame, already the base layer, remains as a static dignified fallback), the
  Ken Burns and parallax transforms are cleared, the particles are removed,
  and every entrance animation resolves to its end state instantly
  (`opacity: 1`, no transform) with button/link transitions disabled.

### Assets

- `assets/luminara-forest-bg.mp4` — the source CloudFront MP4 (1920×1080,
  ~17.6MB, 8s), vendored and transcoded with `ffmpeg` to 1280×720, muted,
  `faststart`, ~2.7MB.
- `assets/luminara-poster.jpg` — a frame extracted from the transcoded video,
  used as the `<video poster>` and as the full static background when
  `prefers-reduced-motion: reduce` hides the video element. Both assets were
  reviewed frame-by-frame; the footage is a generative forest scene with no
  logos, watermarks, or identifiable people.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="luminara-hero" type="text/html" title="Luminara — Creative Showcase Hero">
<!doctype html>
<html>...</html>
</artifact>
```
