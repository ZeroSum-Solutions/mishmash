---
name: finlytic-ai-hero
description: |
  Full-viewport dark SaaS hero for the fictional AI-agent platform **Finlytic**.
  A purple-glowing globe video fills a tall black section, bottom-anchored and
  scaled past its frame so the effect intensifies toward the base; a soft
  black blur pill sits behind the headline for contrast. A pill navbar carries
  a bar-chart wordmark, four nav links, and glass/purple auth buttons. The
  headline pairs a wide grey-white sans line with an italic serif line, above
  two CTAs and a glassmorphic dashboard preview that floats over the tail of
  the video. Motion is a staggered load-in fade-up plus a scroll-triggered
  reveal on the dashboard; everything degrades to a static poster frame and a
  fully visible layout under reduced motion.
tags:
  - "landing-page"
  - "motionsites"
  - "saas"
  - "hero-section"
  - "dark-mode"
  - "video-background"
  - "dashboard-preview"
triggers:
  - "finlytic"
  - "ai agent hero"
  - "saas hero"
  - "dark hero section"
  - "video background hero"
  - "globe video hero"
  - "glassmorphic dashboard"
  - "purple accent hero"
  - "automation platform landing"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=finlytic-hero"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Finlytic — AI Agent Hero as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage or dashboard screenshot to swap in."
---

# Finlytic — AI Agent Hero

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single tall hero for Finlytic, a fictional AI-agent platform that automates
lead generation, customer support, and data entry. The section is pure black
with a looping, muted globe video scaled to 120% of its container and pinned
to the bottom edge, so its glow is faint behind the navbar and headline and
grows dramatic near the base of the page. A pill-shaped navbar, a two-line
headline mixing a sans and an italic serif face, dual call-to-action buttons,
and a glassmorphic dashboard preview all sit above the video at a shared
z-index, with a blurred black pill glowing softly behind the headline for
legibility.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headline
   lines, subhead copy, CTA labels, and nav links. Swap the vendored globe
   video for footage of a similar mood (dark, slow, centered subject) and
   swap the dashboard SVG for a real product screenshot at a similar aspect
   ratio.
3. **Preserve the design system.** The pure-black backdrop, the bottom-anchored
   oversized video treatment, the sans/serif headline pairing, and the single
   purple accent are the identity — do not swap in a light background, a
   different type pairing, or a second chromatic accent without being asked.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. This template ships one hero (with its dashboard
   preview) by design; if the user wants more sections below it, design them
   from scratch in this template's own vocabulary (black background, one
   purple accent, glass panels).
5. **Keep motion accessible.** The load-in fade-up, the dashboard's
   scroll-reveal, and every hover transition must stay behind
   `prefers-reduced-motion`, exactly as the build spec below requires.

## Build spec

### Palette tokens

All chromatic colors and gradient stops live on `:root` so the recolor
tooling can retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#000000` | Section background (neutral, literal per spec) |
| `--fg` | `#ffffff` | Headline sans line, nav text, button labels |
| `--subtext` | `#f6f7f9` | Subhead copy (at 90% opacity), demo-button label |
| `--accent` | `#7b39fc` | The primary chromatic token — Get Started buttons, CTA glow, active nav icon |
| `--accent-hover` | `#6a2ce0` | Hover state for every purple-filled button |
| `--accent-glow-a` / `--accent-glow-b` | `rgba(123,57,252,.55)` / `rgba(123,57,252,0)` | Radial glow stops behind the primary CTA's shadow |
| `--navy` | `#2b2344` | "Watch 2min Demo" button fill — a secondary purple-family surface |
| `--navy-hover` | `#352a54` | Hover state for the navy button |
| `--signin-bg` / `--signin-text` / `--signin-border` | `#ffffff` / `#171717` / `#d4d4d4` | Sign In button (neutral, literal per spec) |
| `--glass-bg` / `--glass-border` | `rgba(255,255,255,.05)` / `rgba(255,255,255,.14)` | Dashboard panel's glassmorphic fill and inset edge highlight |

The primary CTA's resting/hover box-shadow is the page's one `var()`-driven
gradient use (`radial` glow via `--accent-glow-a`), so a client recolor of
`--accent` also retints that glow.

### Typography

Four Google Fonts families, matching the source spec exactly (all four exist
natively on Google Fonts, no substitution needed):

- **Inter** (weight 500) — headline line 1 ("Automate repetitive.").
- **Instrument Serif** (italic) — headline line 2 ("Focus on growth.").
- **Manrope** (400/500/600) — nav links, subhead, and both auth button labels.
- **Cabin** (weight 500) — both hero CTA button labels.

Headline size is `clamp(2.4rem, 8vw, 4.75rem)` (4.75rem ≈ the source's 76px),
weight 500 sans / italic serif, letter-spacing `-0.025em` (a relative
approximation of the source's literal `-2px` at 76px, so the tracking scales
correctly at smaller clamp sizes instead of over-tightening), line-height
`1.15`.

### Layout

One `<section class="hero">`, pure black, `overflow: hidden`, sized to grow
past `100vh` (nav + hero content + dashboard preview together are usually
taller than one viewport):

1. **Background video** — `<video class="hero-bg">`, `position: absolute`,
   `width`/`height: 120%`, horizontally centered (`left: 50%` +
   `translateX(-50%)`), `bottom: 0` (anchored to the section's bottom edge),
   `z-index: 0`. Because the section is taller than the video's natural
   height × 1.2, the section's `overflow: hidden` clips the video's *top*
   overflow — which pushes the video's dramatic content (the glowing globe)
   toward the *bottom* of the tall section, exactly per the source spec's
   "focal point anchored to the bottom." A poster `<img>` fallback sits behind
   it for the reduced-motion path.
2. **Blurred glow pill** — an empty `<div class="hero-glow-pill">`, pure
   black, `801px × 384px` pill (`clamp()`-scaled on narrow viewports),
   `filter: blur(77.5px)`, absolutely centered with `top: clamp(120px, 22vw,
   215px)`, `z-index: 1` — a soft vignette behind the headline for contrast
   against the video.
3. **Content wrapper** (`z-index: 2`) — everything below is a normal-flow
   child of this wrapper:
   - **Navbar** — `max-width: 1440px`, centered, `16px` vertical /
     `clamp(1.25rem, 7vw, 7.5rem)` horizontal padding, `min-height: 102px`,
     flex row, `space-between`. Left group (`80px` gap): a 3-bar ascending
     wordmark + "Finlytic," then nav links (`10px` gap) — Home, Services
     (with a chevron-down icon), Reviews, Contact us — each Manrope medium
     14px/22px with `10px`/`4px` padding. Right group (`12px` gap): a white
     "Sign In" button (dark text, light grey border) and a purple "Get
     Started" button, both Manrope semibold 14px/22px, `8px` radius. Below
     `860px` the nav links and Sign In button hide behind a hamburger toggle
     that opens a full-screen overlay menu with the same links and actions.
   - **Hero content** — flex column, centered text, `max-width: 871px`,
     `margin-top: 162px` (stepping down on short/narrow viewports), `24px`
     gap to the CTA row. Inside, a heading block (`10px` gap): the Inter line,
     the Instrument Serif line, and an `18px`/`26px` Manrope subhead at 90%
     opacity, `max-width: 613px`. The CTA row (`22px` gap): "Get Started
     Free" (purple fill, Cabin medium 16px, `10px` radius, `24px`/`14px`
     padding) and "Watch 2min Demo" (navy fill, same type/padding, with a
     small play-triangle icon).
   - **Dashboard preview** — `margin-top: 80px`, `40px` bottom padding, a
     glassmorphic panel (`min(1163px, 90vw)` wide, `24px` radius, `10px`
     backdrop-blur, `rgba(255,255,255,.05)` fill, `22.5px` inner padding)
     containing the vendored dashboard image at full width / auto height /
     `8px` radius.

### Motion inventory

- **Load-in fade-up**: the two headline lines, the subhead, and the CTA row
  each animate `opacity 0 → 1` with `translateY(24px) → 0` over 800ms,
  staggered `0.1s` apart, easing `cubic-bezier(0.23, 1, 0.32, 1)`. The navbar
  itself is static (unanimated), matching the sibling SaaS-hero templates in
  this catalog.
- **Dashboard scroll reveal**: an `IntersectionObserver` (threshold 0.15)
  adds `.is-visible` to the dashboard wrapper the first time 15% of it enters
  the viewport, cross-fading it in with the same translateY/opacity pair over
  900ms — appropriate since the panel usually starts below the fold.
- **Button hovers**: the primary CTA lifts 1px and brightens its radial
  purple glow; the navy CTA and both nav buttons lift 1px / darken slightly;
  all transition over ~220ms, never scaling from 0.
- **Ambient loop**: the background video autoplays, loops, and stays muted
  via HTML attributes, fading in via an `is-playing` class once the
  `playing` event fires; a small inline script also calls `.play()`
  defensively. It is the only script logic beyond the mobile menu toggle.
- **`prefers-reduced-motion: reduce`**: the load-in animation is skipped
  (content renders fully visible, no transform), the dashboard reveal is
  skipped (visible immediately, no transition), all hover transforms are
  disabled (color-only feedback remains), and the background video is hidden
  and paused in favor of its vendored poster-frame fallback — a fully static
  page.

### Assets

- `assets/hero-bg.mp4` — the source CloudFront clip (a slowly rotating,
  glowing purple globe on black) downloaded and transcoded locally to a
  muted, 720p (964×720), ~5s H.264 loop (~800KB), referenced with a plain
  `<video>` tag (no hls.js — the source was already a direct MP4, not an
  HLS stream).
- `assets/hero-poster.jpg` — a poster frame extracted from the transcoded
  clip, used as the `<video poster>` and as the full reduced-motion
  fallback image.
- `assets/finlytic-dashboard.svg` — the source prompt specified the
  glassmorphic panel's styling but supplied no dashboard screenshot URL, so
  this is an original vendored asset: a hand-built SVG mockup of a Finlytic
  agent console (KPI cards, an automation-volume chart, a live activity
  feed, and coverage/accuracy rings) styled in the page's own black/purple
  palette.

### Deviations from the literal prompt spec

- The prompt's "chevron-down icon" for the Services nav link is specified at
  24×24px; rendered literally next to 14px/22px text that reads as
  disproportionately large, so it ships at 16×16px instead — a scale
  judgment call, not a color/spacing change.
- The prompt names no font-family substitutions were needed: Inter, Instrument
  Serif, Manrope, and Cabin are all available natively on Google Fonts.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="finlytic-ai-hero" type="text/html" title="Finlytic — AI Agent Hero">
<!doctype html>
<html>...</html>
</artifact>
```
