---
name: datacore-saas-hero
description: |
  Full-viewport dark SaaS hero for the fictional network-operations platform
  **Datacore**. A cinematic purple-glass abstract loop fills the black
  backdrop behind a 60%-black overlay and a centered radial glow, topped by a
  glassmorphism navbar (white square logo mark, center links, glass "Sign
  In" + solid purple "Get Started"). The hero content stacks a glass "New"
  badge, a two-line Inter headline that closes on an italic Instrument Serif
  accent word, a Manrope subhead, and dual purple/navy CTA buttons. Motion is
  a staggered load-in fade-up plus a full-screen mobile nav overlay;
  everything degrades to a static poster frame under reduced motion.
tags:
  - "landing-page"
  - "motionsites"
  - "saas"
  - "hero-section"
  - "dark-mode"
  - "video-background"
  - "glassmorphism"
triggers:
  - "datacore"
  - "data core"
  - "saas hero"
  - "dark hero section"
  - "video background hero"
  - "glassmorphism navbar"
  - "network operations platform"
  - "italic serif accent headline"
  - "purple glow cta"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=4"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Datacore — SaaS Hero Section as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage to swap in."
---

# Datacore — SaaS Hero Section

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single full-viewport hero for Datacore, a fictional SaaS platform for
network admins. The page is one `<section>`: a looping abstract purple-glass
video fills the frame edge to edge under a 60%-black overlay and a soft
purple radial glow, a glassmorphism navbar sits on top, and the centered
hero column stacks a "New" badge, a two-line headline with an italic serif
closing word, a subhead, and two call-to-action buttons.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, badge
   text, headline lines, subhead copy, nav links, and CTA labels. Swap the
   vendored background loop for footage of matching mood (dark, abstract,
   slow-moving) and matching aspect ratio.
3. **Preserve the design system.** The black backdrop with the purple radial
   glow, the glassmorphism nav/badge treatment, the Inter/Instrument Serif
   headline pairing, and the purple-primary / navy-secondary CTA pair are the
   identity — do not swap in a bright background, a sans-only headline, or a
   different accent hue without being asked.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. This template ships one hero section by design; if the
   user wants more sections below it, design them from scratch in this
   template's own vocabulary (black/white/grey neutrals, one chromatic
   purple accent, glass surfaces).
5. **Keep motion accessible.** Every animation — the load-in fade-up, the
   poster-to-video crossfade, and the mobile menu transition — must stay
   behind `prefers-reduced-motion`, exactly as the build spec below requires.

## Build spec

### Palette tokens

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#05030a` | Section background |
| `--fg` | `#ffffff` | Headline, button labels, brand name |
| `--subhead` | `#c7c2d6` | Body copy under the headline, nav link color |
| `--muted` | `#9b93ad` | Reserved neutral for secondary text |
| `--purple` | `#7b39fc` | Primary CTA fill, brand-mark stroke, ambient glow |
| `--purple-hover` | `#6a2ce0` | Primary CTA hover fill |
| `--navy` | `#2b2344` | Secondary CTA fill |
| `--navy-hover` | `#352b54` | Secondary CTA hover fill |
| `--orange` | `#f87b52` | "New" badge tag fill |
| `--glass-border` | `rgba(164,132,215,0.5)` | Glass button / badge / mobile-toggle border |
| `--glass-bg` | `rgba(85,80,110,0.4)` | Glass button / badge background |
| `--glow-a` / `--glow-b` | `rgba(123,57,252,0.55)` / `rgba(123,57,252,0)` | Ambient radial glow behind the hero copy |

The one gradient on the page (`.hero-glow`, a `radial-gradient`) references
`var(--glow-a)`/`var(--glow-b)` so a client recolor changes the glow hue with
the rest of the purple accent.

### Typography

Four Google Fonts, matching the source brief's stack exactly:

- **Manrope** — global/body font (subhead, mobile-menu labels' base).
- **Inter** — headings (`<h1>` headline, brand wordmark, desktop/mobile nav
  links).
- **Cabin** — buttons and badges (CTA labels, "New" tag, badge text).
- **Instrument Serif** (italic) — the accent word "Interface." in the
  headline's second line.

Headline size is `clamp(2.4rem, 7vw, 4.75rem)` (~76px desktop) at weight 600,
letter-spacing `-0.02em`, line-height `1.08`.

### Layout

One `<section class="hero">`, black backdrop, flex column, `min-height:
100vh`:

1. **Background video** — full-bleed `<video>` (`position: absolute; inset:
   0; object-fit: cover`), crossfades in from a poster `<img>` once playback
   actually starts (`opacity: 0 → 1` on the `playing` event) so there is no
   black flash; a `60%`-black `.hero-overlay` and a blurred purple
   `.hero-glow` radial sit above it for text contrast.
2. **Navbar** — logo (white rounded-square mark with an inline "brackets"
   glyph + "Datacore" wordmark), center desktop links ("Home", "Services"
   with a chevron, "Reviews", "Contact us"), right-side "Sign In" (glass
   button) and "Get Started" (purple button), collapsing at `860px` to a
   hamburger toggle that opens a full-screen black overlay with vertical
   links and stacked CTA buttons.
3. **Hero content (centered)** — a glass "New" badge pill, the two-line
   headline (`Your Networks.` / `One Rapid *Interface.*`), a subhead
   sentence, and two CTA buttons ("Book a Free Demo" purple, "Get Started
   Now" navy).

### Motion inventory

- **Load-in fade-up**: the badge, both headline lines, the subhead, and the
  CTA row each animate `opacity 0 → 1` with `translateY(22px) → 0` over
  800ms, staggered `0.1s` apart (`0.1s` → `0.5s`), easing
  `cubic-bezier(0.23, 1, 0.32, 1)`.
- **Poster-to-video crossfade**: the `<video>` starts at `opacity: 0`; a
  `playing` listener adds `.is-playing`, cross-fading to the live loop over
  900ms while the poster `<img>` fades out beneath it.
- **Nav/CTA hover**: glass, purple, and navy buttons lift `translateY(-1px)`
  and shift fill color on hover (220ms), scale to `0.97` on active (140ms).
  Never scales from 0.
- **Mobile menu**: the full-screen overlay fades and slides in
  (`opacity`/`translateY`, 260ms) on hamburger click; closes on the X button,
  a nav-link click, or `Escape`; toggling locks body scroll.
- **`prefers-reduced-motion: reduce`**: all load-in animations are skipped
  (content renders fully visible, no transform), the video is hidden in
  favor of its poster fallback, the ambient glow is hidden, and every
  hover/active/menu transition is disabled — a fully static page.

### Assets

- `assets/hero-bg.mp4` — the Mux HLS stream (`stream.mux.com/....m3u8`)
  transcoded locally with `ffmpeg` to a muted, 720p, ~12s H.264 loop
  (~1.1MB), referenced with a plain `<video>` tag (no hls.js).
- `assets/hero-poster.jpg` — a poster frame extracted from the same
  transcode with `ffmpeg`, used both as the `<video poster>` and as the
  reduced-motion static fallback. The prompt's original Cloudflare Stream
  thumbnail URL returned `404`, so this locally-extracted frame replaces it.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="datacore-saas-hero" type="text/html" title="Datacore — SaaS Hero Section">
<!doctype html>
<html>...</html>
</artifact>
```
