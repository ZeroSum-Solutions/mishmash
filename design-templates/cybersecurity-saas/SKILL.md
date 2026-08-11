---
name: cybersecurity-saas
description: |
  Full-viewport dark SaaS hero for the fictional threat-detection platform
  **Korvid Lab**. A looping abstract video of a rippling magenta-and-blue
  ribbon fills a near-black backdrop behind a colossal, tight-leading DM
  Sans headline whose last word is masked with an animated horizontal
  scan-line effect. A dashboard-style stat cluster floats on the right —
  a small "risk surface: critical" tag and a large card with a rAF-driven
  count-up to 187,941 captured events — closing on a solid magenta
  "Request demo" button. Motion is a staggered load-in fade-up, an ambient
  scanning stripe on the masked word, a pulsing risk icon, and the counter
  animation, all degrading to a static poster frame under reduced motion.
tags:
  - "landing-page"
  - "motionsites"
  - "saas"
  - "hero-section"
  - "dark-mode"
  - "video-background"
triggers:
  - "korvid lab"
  - "cybersecurity saas"
  - "cybersecurity hero"
  - "saas hero"
  - "dark hero section"
  - "video background hero"
  - "scan line text effect"
  - "threat detection"
  - "security dashboard card"
  - "count up stat"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=cybersecurity"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Korvid Lab — Cybersecurity SaaS Hero as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage or live metrics to swap in."
---

# Korvid Lab — Cybersecurity SaaS Hero

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single full-viewport hero for Korvid Lab, a fictional anomaly-detection SaaS
built around the idea of "tracing the unseen." The page is one `<section>`
over a near-black backdrop: a muted, looping video of an abstract rippling
ribbon fills the frame edge to edge with no dark overlay, a huge tight-leading
headline sits at the left, and a two-card stat cluster floats at the right —
closing with a solid magenta call-to-action.

The brand name in the source prompt ("Vektis Lab") matches a real Dutch
healthcare-data company, so it was replaced with the fictional "Korvid Lab"
(a nod to corvids — the watchful birds — fitting the "tracing the unseen"
theme) before this template was built.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headline
   lines, subhead copy, nav links, and CTA labels. Swap the vendored
   background clip for footage of a similar dark, abstract, non-distracting
   mood, and swap the stat-card numbers for real metrics.
3. **Preserve the design system.** The near-black backdrop, the oversized
   tight-leading DM Sans headline, the JetBrains Mono label/body voice, the
   scan-line text mask, and the single magenta accent are the identity — do
   not swap in a bright background, a different display face, or a second
   chromatic accent without being asked.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. This template ships one hero section by design; if the
   user wants more sections below it, design them from scratch in this
   template's own vocabulary (near-black neutrals, one magenta accent, mono
   labels, oversized display type).
5. **Keep motion accessible.** The load-in fade-up, the scan-line stripe, the
   risk-icon pulse, and the count-up counter must all stay behind
   `prefers-reduced-motion`, exactly as the build spec below requires.

## Build spec

### Palette tokens

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0a0a0a` | Page/video backdrop |
| `--fg` | `#ffffff` | Headline, stat numbers, nav logo |
| `--fg-muted-60/70/80/90` | `rgba(255,255,255,0.6–0.9)` | Nav links, subhead, card labels (neutral, left literal) |
| `--card-border` | `rgba(255,255,255,0.85)` | Stat-card borders |
| `--accent` | `#a6439e` | The one chromatic token — CTA fill, glow tint |
| `--accent-hover` | `#b854b0` | CTA hover fill |
| `--accent-glow-soft` / `--accent-glow-strong` | `rgba(166,67,158,0.28)` / `rgba(166,67,158,0.4)` | CTA hover shadow and its radial backglow |

The CTA's radial backglow (`.cta::before`) is the one brand-accent gradient on
the page and references `var(--accent-glow-strong)`, so a client recolor
changes the glow hue. The headline's scan-line mask
(`repeating-linear-gradient` of white/transparent stripes) stays literal —
it's a neutral text-clip effect, not a brand-color surface.

### Typography

Both fonts from the source prompt are already on Google Fonts, so no
substitution was needed: **DM Sans** (weights 400/700/900) for the headline,
**JetBrains Mono** (weights 400/500/700) for the nav, subhead, button labels,
and every stat-card string. Headline size scales `3.75rem → 4.5rem → 9.2rem →
11rem` at the 640/768/1024px breakpoints, weight 700, `line-height: 0.72`,
`letter-spacing: -0.029em` — deliberately overlapping and dramatic, matching
the source brief's exact Tailwind scale.

### Layout

One `<section class="hero">` over a near-black page, `min-height: calc(100vh
- nav height)`, flex column on mobile and flex row (`justify-content:
space-between`) from 1024px up:

1. **Background video** — full-bleed `<video>` (`position: absolute; inset:
   0; object-fit: cover; z-index: 0`), no overlay, full opacity. A poster
   `<img>` fallback sits behind it for the reduced-motion path.
2. **Header/nav** — logo `KORVID LAB` (mono, bold, white) at left; `Platform
   / Outcomes / Research / Deploy` links plus a plain-text `Request demo`
   button at right on desktop; a hamburger button that swaps to an X icon and
   opens a full-screen `fixed` overlay menu on mobile (vanilla JS toggle, no
   framework).
3. **Hero copy (left column)** — an `<h1>` of two stacked lines (`Tracing®` /
   `the unseen`), where "unseen" is wrapped in `.line-mask`: a
   `repeating-linear-gradient` background clipped to the text as 4px-on/5px-
   off horizontal white stripes, giving the word a scanned/interlaced look.
   Below it, a mono subhead sentence, then a solid `--accent`-filled
   "Request demo" button.
4. **Stat cluster (right column)** — two absolutely-stacked `<dl>` cards,
   2px white border, black/blur background: a small "Risk surface / Critical"
   tag with two stacked chevron-up icons, overlapping the top-right corner of
   a larger "Captured events: 187,941 / Verified anomaly flagged ./" card.

### Motion inventory

- **Load-in fade-up**: the two headline lines, the subhead, the CTA, and both
  stat cards each animate `opacity 0 → 1` with `translateY(28px) → 0` over
  800ms, staggered `0.1s → 0.5s`, easing `cubic-bezier(0.23, 1, 0.32, 1)`.
- **Scan-line stripe**: `.line-mask`'s background-position animates
  vertically one full 18px tile every 1.4s, linear, infinite — a slow
  "scanning" read on the masked word.
- **Risk-icon pulse**: the stacked chevron icons on the small stat card
  breathe opacity `0.55 ↔ 1` over 1.8s, ease-in-out, infinite.
- **Captured-events counter**: an `IntersectionObserver` fires once when the
  large stat card enters the viewport (40% threshold), then a
  `requestAnimationFrame` loop counts `0 → 187,941` over 1400ms with a cubic
  ease-out, formatting with thousands separators every frame.
- **CTA hover/active**: background-color, a 2px lift, and a blurred magenta
  radial backglow transition over 200ms on hover, 140ms on active. Never
  scales from 0.
- **Mobile menu**: the full-screen overlay fades and its link stack
  translates up 20px → 0 over 260ms, easing `cubic-bezier(0.23, 1, 0.32, 1)`.
- **`prefers-reduced-motion: reduce`**: the load-in animation, the scan-line
  stripe, the risk-icon pulse, and the CTA's hover transform/glow are all
  disabled (content renders fully visible, static); the counter is set
  directly to its final value with no animation; the background `<video>` is
  hidden in favor of its vendored poster-frame `<img>`.

### Assets

- `assets/hero-bg.mp4` — the source CloudFront MP4 transcoded locally to a
  muted, 720p, ~10s H.264 loop (~730KB), referenced with a plain `<video>`
  tag (no hls.js).
- `assets/hero-poster.jpg` — a extracted poster frame for the background
  video and its reduced-motion fallback.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="cybersecurity-saas" type="text/html" title="Korvid Lab — Cybersecurity SaaS Hero">
<!doctype html>
<html>...</html>
</artifact>
```
