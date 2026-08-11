---
name: ember-dsgn-hero
description: |
  Fullscreen split-panel hero for **EMBER.dsgn**, a fictional digital design
  studio. A mirrored, muted ambient video loops behind two full-height
  columns: the left column is a frosted-glass panel with the word "EMBER"
  cut clean through it as an SVG mask, letting the raw footage show through
  the letterforms while the rest of the glass stays blurred; the right
  column closes with a solid white "STUDIO" wordmark stretched to fill the
  column width, floating in front of two concentric decorative rings. A
  fixed nav (logo, link row, language pill, contacts pill, burger) sits on
  top, and the burger opens a full-black mobile menu with staggered link
  reveals.
tags:
  - "landing-page"
  - "motionsites"
  - "hero-section"
  - "video-background"
  - "glassmorphism"
  - "split-panel"
  - "dark-mode"
  - "typography"
triggers:
  - "ember"
  - "ember.dsgn"
  - "design studio"
  - "split panel hero"
  - "split screen hero"
  - "cutout text mask"
  - "letter mask reveal"
  - "frosted glass hero"
  - "video background hero"
  - "mirrored video"
  - "concentric circles"
  - "wordmark hero"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=ember-dsgn-hero"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build EMBER.dsgn — Split-Panel Studio Hero as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage to swap in."
---

# EMBER.dsgn — Split-Panel Studio Hero

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single fullscreen hero for EMBER.dsgn, a fictional digital design studio.
A mirrored, muted ambient video (a slow-rotating abstract rock render,
color-graded darker for legibility) plays behind two full-height columns
that split the viewport. The left column is a translucent, 20px-blurred
glass panel with the word "EMBER" cut clean through it via an SVG mask —
the letterforms reveal the sharp footage underneath while the surrounding
glass stays soft and frosted. Below that cutout, an "About" eyebrow, a
two-line mission statement, and a footer row (an "Explore Our Work" link,
two social links, and a studio address) sit on top of the glass. The right
column closes with a giant white "STUDIO" wordmark — stretched via SVG
`textLength` to span the full column width — floating above two overlapping
decorative rings, pinned to the bottom of the column. A fixed nav (a
four-square orange logo mark, a desktop link row, a language pill, a
contacts pill, and a mobile burger) spans the top; the burger opens a
full-black overlay menu with staggered link reveals.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real studio name, nav
   links, mission statement, social links, and address. Swap
   `assets/hero-bg.mp4` for footage of a similar mood (abstract, slow,
   dark-graded) and re-extract `assets/hero-poster.jpg` from the new clip's
   first frame.
3. **Preserve the design system.** The pure-black backdrop, the frosted-glass
   letter-cutout on the left column, the solid oversized wordmark on the
   right column, the concentric-ring motif, and the single orange accent are
   the identity — do not add a second accent color, swap the cutout for a
   plain heading, or recolor the panels without being asked.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. This template ships one two-column hero by design; if
   the user wants more sections below it, design them from scratch in this
   template's own vocabulary (black background, glass/cutout treatment,
   orange accent).
5. **Keep motion accessible.** The load-in stagger, the mobile-menu slide
   and link stagger, every hover/active transition, and the video itself
   must all stay behind `prefers-reduced-motion`, exactly as the build spec
   below requires.

## Build spec

### Palette tokens

All chromatic color lives on `:root` so the recolor tooling can retint the
page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#000000` | Page background, mobile-menu fill |
| `--fg` | `#ffffff` | Headline, wordmark, primary text |
| `--line` / `--line-strong` | `rgba(255,255,255,0.08)` / `rgba(255,255,255,0.2)` | Panel divider, vertical rule, ring borders, pill borders |
| `--muted` / `--muted-2` / `--muted-3` | `rgba(255,255,255,0.4/0.7/0.9)` | Eyebrow / secondary links / mission statement text |
| `--accent` | `#FF5C35` | Logo mark squares, link hover, mobile-menu link hover |
| `--accent-soft` | `rgba(255,92,53,0.35)` | Contacts-pill hover glow, mobile-menu link hover text-shadow |

`--accent` and `--accent-soft` are the page's only chromatic tokens — every
other surface (glass, rings, scrims) is neutral by design so the recolor
knob has one clear brand color to act on.

### Typography

**Inter** (Google Fonts, weights 400/500/600/700/800/900) — matches the
source prompt's own `@import` exactly, so no substitution was needed. The
"EMBER" and "STUDIO" wordmarks both use weight 900 at a size driven by SVG
`textLength="100%"` + `lengthAdjust="spacingAndGlyphs"`, stretching the
glyphs to fill the full column width regardless of viewport size.

### Layout

A fixed `<header class="nav">` and a fixed full-black `<div class="mobile-menu">`
overlay sit above a `<main class="split">` of two `<section class="panel">`
columns, all layered over a fixed, mirrored `<video>` background:

1. **Background video** — `position:fixed`, `object-fit:cover`,
   `transform:scaleX(-1)` (mirrored), muted/looping/autoplaying, JS sets
   `playbackRate = 0.7` on load. A `.nav-scrim` gradient darkens the top
   ~13rem for nav legibility.
2. **Left panel ("EMBER")** — `.ember-mask` is an `inset:0` layer
   (`rgba(131,131,131,0.3)` fill + `backdrop-filter: blur(20px)`) masked by
   an inline SVG `<mask>` (`objectBoundingBox` units) containing a white
   rect and a black-filled "EMBER" `<text>` — the letterforms punch a clean
   hole through the blur, revealing the sharp video beneath. Two mask
   variants (`emberMaskMobile` / `emberMaskDesktop`) swap at the 1024px
   breakpoint with different text size/position tuned to each column's
   proportions. On top: a spacer matching the cutout's reserved height, a
   1px vertical rule that grows to fill the remaining column height, then a
   footer block — an "About" eyebrow, a two-line mission-statement `<h1>`,
   and a bottom row (an "Explore Our Work" link with an arrow icon, an
   Instagram/Telegram list, and an address hidden below 640px).
3. **Right panel ("STUDIO")** — two absolutely-positioned decorative rings
   (`border: 1px solid`, sized in `vh` units, larger and more visible at the
   1024px breakpoint) plus a bottom-to-top black gradient scrim for
   legibility, with the "STUDIO" SVG wordmark pinned to the column's bottom
   edge via `justify-content: flex-end`.
4. **Nav** — fixed, `pointer-events:none` on the row with `pointer-events:auto`
   on each group: a four-square orange logo mark + "EMBER.dsgn" wordmark and
   a desktop-only link row (Works/Services/About/Team) on the left; an
   `EN | RU` language pill, a burger button, and a "Contacts" pill on the
   right (pills hidden below 640px, link row hidden below 1024px).
5. **Mobile menu overlay** — `position:fixed`, slides in from the right
   (`translateX(100%→0)`) below 1024px, full black, with a header (logo +
   close), five staggered links (Works/Services/About/Team/Contacts), and a
   footer (`EN | RU` + "Ukraine / London"). Background content (`.nav`,
   `.split`) gets `inert` while open; focus moves to the close button on
   open and returns to the burger on close; `Escape` closes it too.

### Motion inventory

- **Load-in fade-up**: the nav groups, left-panel content block, and the
  STUDIO wordmark each animate `opacity 0→1` with `translateY(20px)→0` over
  900ms, staggered `0.05s`→`0.35s`, easing `cubic-bezier(0.23, 1, 0.32, 1)`.
- **Mobile menu**: the overlay slides in with a snappy
  `cubic-bezier(0.16, 1, 0.3, 1)` transform over 420ms; its five links fade
  and slide up with a 60ms stagger once the overlay is open.
- **Hover/active states**: nav links, the explore-work link (with its arrow
  icon nudging up-right), the contacts pill (inverts to white + a warm
  accent-glow shadow), and mobile-menu links (accent color + soft
  text-shadow) all transition over 200ms; the contacts pill settles to
  `scale(0.98)` over 140ms on press. Never scales from 0.
- **Ambient loop**: the background video autoplays, loops, and plays at
  0.7× speed via a small inline script — the only continuous motion on the
  page.
- **`prefers-reduced-motion: reduce`**: the video is hidden in favor of its
  vendored poster-frame fallback (the "EMBER" cutout still shows the frozen
  poster through the letterforms, since the mask is a static layer, not
  motion), every load-in and hover/press transition is skipped or disabled,
  and the mobile menu opens/closes instantly with its links fully visible —
  a fully static page.

### Assets

- `assets/hero-bg.mp4` (~1MB) — the prompt's Mux HLS stream (a rotating
  abstract rock/asteroid render) downloaded and transcoded locally with
  `ffmpeg` to a muted, 720p, H.264 MP4 loop, referenced with a plain
  `<video>` tag — no hls.js. The source stream serves a light-gray-backdrop
  clip; it was color-graded darker (`eq` brightness/contrast/saturation +
  a `vignette`) during transcode so white text stays legible against it,
  matching the black-background mood the prompt describes.
- `assets/hero-poster.jpg` (~50KB) — a poster frame pulled from the graded
  clip, used as `<video poster>` and as the full fallback image under
  `prefers-reduced-motion` / video-load failure.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="ember-dsgn-hero" type="text/html" title="EMBER.dsgn — Split-Panel Studio Hero">
<!doctype html>
<html>...</html>
</artifact>
```
