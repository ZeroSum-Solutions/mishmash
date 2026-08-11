---
name: synapse-dark-hero
description: |
  Full-viewport dark SaaS hero for the fictional dev-platform **Synapse**. A
  fixed glass navbar sits above a solid-black section where a chrome-liquid
  video panel floats up from the bottom edge with no overlay, a tight white
  headline and two-line subtext sit in the black space above it, three glass
  integration badges and a black/glass button pair stagger into view on load,
  and a static grayscale wordmark strip closes the section. One nav link
  carries a violet-to-cyan gradient border for its active state; another is
  permanently struck through as a deliberate design flourish.
tags:
  - "landing-page"
  - "motionsites"
  - "saas"
  - "hero-section"
  - "dark-mode"
  - "video-background"
  - "glassmorphism"
triggers:
  - "synapse"
  - "saas hero"
  - "dark hero section"
  - "video background hero"
  - "glass navbar"
  - "floating video panel"
  - "innovation meets execution"
  - "gradient border nav"
  - "logo strip"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=7"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Synapse — Dark SaaS Hero as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage to swap in."
---

# Synapse — Dark SaaS Hero

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single full-viewport hero for Synapse, a fictional SaaS platform for
testing and deployment automation. A fixed, blurred glass navbar spans the
top of a solid-black section. Behind the centered content, a looping
chrome-liquid video panel floats up from the bottom edge of the viewport at
full opacity — no dark scrim — so the lower half of the page reads as a
glossy, moving surface while the headline stays legible in the pure-black
space above it. Three glass integration badges, a large tight-tracking
headline, a two-line subhead, and a two-button CTA pair stagger into view on
load; a static, grayscale wordmark strip closes out the section.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, nav
   links, headline, subhead copy, CTA labels, and integration/partner names.
   Swap `assets/hero-bg.mp4` for footage of a similar mood (abstract,
   dark, slow-moving) at a similar aspect ratio.
3. **Preserve the design system.** The solid-black backdrop, the
   glass-navbar/glass-badge treatment, the floating (not full-bleed) video
   panel with no overlay, and the violet-to-cyan accent on interactive
   states are the identity — do not add a dark scrim over the video, swap in
   a light background, or recolor the accent pair without being asked.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. This template ships one hero section by design; if the
   user wants more sections below it, design them from scratch in this
   template's own vocabulary (black background, glass surfaces, one
   violet/cyan accent pair).
5. **Keep motion accessible.** The load-in stagger, every button hover/active
   transition, and the video itself must all stay behind
   `prefers-reduced-motion`, exactly as the build spec below requires.

## Build spec

### Palette tokens

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#000000` | Section, navbar, and solid-CTA fill |
| `--fg` | `#ffffff` | Headline, logo, active nav text, solid-CTA border |
| `--muted` / `--muted-2` | `#9a9aa2` / `#6b6b73` | Inactive nav links / struck-through nav link |
| `--subhead` | `#b8b8c0` | Badge and subhead copy |
| `--glass` / `--glass-strong` | `rgba(255,255,255,0.06)` / `rgba(255,255,255,0.12)` | Badge and glass-button fill, resting vs. hover |
| `--line` | `rgba(255,255,255,0.14)` | Navbar bottom border, badge/glass-button border |
| `--gradient-a` / `--gradient-b` | `#f5f5f7` / `#c7c7cf` | Neutral white-to-gray navbar CTA gradient (left literal by design) |
| `--accent` / `--accent-2` | `#7c6cff` / `#38bdf8` | The two chromatic tokens — active nav gradient border, badge icon stroke, logo mark, solid-CTA hover glow |
| `--accent-soft` | `rgba(124,108,255,0.22)` | Solid-CTA hover box-shadow |

The active "Features" nav pill is the page's one literal gradient border
(`linear-gradient(90deg, var(--accent), var(--accent-2))` painted into the
border-box behind a solid `var(--bg)` padding-box), and the solid CTA's
hover glow references `var(--accent-soft)` — both retint together under the
color knob. The navbar CTA's white-to-gray gradient and the wordmark strip
stay on literal neutrals since they're scaffolding, not a brand accent.

### Typography

**Inter** (Google Fonts, weights 400/500/600/700) — the prompt didn't name a
specific typeface, so Inter was chosen as a clean, tight-tracking geometric
sans that reads well at both the ~80px headline size and the 13px badge
size. Headline is `clamp(2.75rem, 7vw, 5rem)` at weight 600, letter-spacing
`-0.03em`, line-height `1.05`.

### Layout

One `<header class="navbar">` (fixed) plus one `<section class="hero">`
(`position: relative; min-height: 100vh; overflow: hidden`) on a solid-black
backdrop:

1. **Navbar** — fixed top, `backdrop-filter: blur(18px) saturate(140%)` over
   `rgba(0,0,0,0.55)`, 1px bottom border. Three zones: the "Synapse"
   wordmark with a small two-node connector-line SVG mark, a five-item
   `<nav><ul>` (Features active with the gradient-border pill; Case Studies
   permanently `text-decoration: line-through`), and a white-to-gray
   gradient "Get Started for Free" pill with dark text. Links collapse below
   900px, leaving the logo and CTA.
2. **Video panel** — `.hero-video-wrap` is `position: absolute; bottom:
   35vh; height: 80vh; width: 100%`, full opacity, no overlay, `<video
   autoplay loop muted playsinline>` with `object-fit: cover`. Because the
   panel's top edge sits above the section's own top edge at this
   height/offset combination, the section's `overflow: hidden` crops it into
   a "floating, rising from the bottom" shape rather than a full-bleed
   background. A poster-image fallback (`.hero-video-fallback`) sits in the
   same position for the reduced-motion path.
3. **Content column** (`z-index: 10`, centered, `max-width: 56rem`,
   `padding-top: clamp(6.5rem, 14vh, 9rem)` to clear the fixed navbar):
   - **Badges** — three glass pills (`Integrated with Cloud` / `CI/CD` /
     `Data`), each with a small accent-stroked icon.
   - **Headline (`<h1>`)** — `Where Innovation Meets Execution`, solid
     white, no gradient treatment.
   - **Subhead (`<p>`)** — one two-line sentence about automated testing and
     deployment, `max-width: 34rem`, `var(--subhead)`.
   - **Buttons** — `Get Started for Free` (`.btn-solid`: solid black fill,
     1px white border) and `Let's Get Connected` (`.btn-glass`: translucent
     glass fill, blurred, 1px `var(--line)` border).
4. **Logo strip** — a static (non-animated) row of six grayscale wordmarks
   (`NORTHPEAK`, `VERTA`, `HALCYON`, `ORBITAL`, `MERIDIAN`, `COBALT LABS`) at
   `opacity: 0.4`, pinned to the bottom of the hero via `margin-top: auto`.

### Motion inventory

- **Load-in fade-up**: the badge row, headline, subhead, and button row each
  animate `opacity 0 → 1` with `translateY(24px) → 0` over 800ms, staggered
  `0.1s` → `0.46s`, easing `cubic-bezier(0.23, 1, 0.32, 1)`. The logo strip
  and navbar are intentionally excluded from this stagger — the brief calls
  the logo row out as static.
- **Button hover/active**: the navbar CTA and both hero buttons lift
  `translateY(-1px/-2px)` with a brightened shadow/background over 200ms,
  and settle to `scale(0.98)` over 140ms on active. Never scales from 0.
- **Ambient loop**: the background video autoplays, loops, and stays muted
  via HTML attributes; a small inline script calls `.play()` defensively and
  is the only script on the page.
- **`prefers-reduced-motion: reduce`**: the load-in stagger is skipped
  (content renders fully visible, no transform), every button's
  hover/active transform and shadow is disabled, and the `<video>` is hidden
  in favor of its vendored poster-frame `<img>` fallback — a fully static
  page.

### Assets

- `assets/hero-bg.mp4` — the prompt's Mux HLS stream (a ~5s abstract
  chrome-liquid loop) transcoded locally with `ffmpeg` to a muted, 720p,
  H.264 MP4 (~206KB), referenced with a plain `<video>` tag — no hls.js.
- `assets/hero-poster.jpg` — a poster frame pulled from the transcoded clip,
  used as the `<video poster>` and as the full image fallback under
  `prefers-reduced-motion`.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="synapse-dark-hero" type="text/html" title="Synapse — Dark SaaS Hero">
<!doctype html>
<html>...</html>
</artifact>
```
