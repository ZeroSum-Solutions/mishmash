---
name: nickel-payments-hero
description: |
  Floating-navbar SaaS hero for the fictional B2B payments platform
  **Groat**. A warm off-white page holds a white pill navbar (logo,
  product/company dropdown menus, pricing links, and a gradient CTA) above
  a two-column hero: a wide medium-weight headline and CTA pair on the
  left, and a rounded video panel filling the right 55% of the viewport on
  desktop. Motion is a staggered load-in fade for the nav and headline
  stack, hover/active states on every button, and small CSS dropdown
  panels under the two nav items; everything collapses to a static,
  video-free layout under reduced motion.
tags:
  - "landing-page"
  - "motionsites"
  - "saas"
  - "hero-section"
  - "light-mode"
  - "floating-navbar"
  - "video-background"
triggers:
  - "groat"
  - "payments hero"
  - "saas hero"
  - "floating navbar"
  - "fintech landing page"
  - "net terms"
  - "collections"
  - "gradient cta button"
  - "video panel hero"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=nickel-hero"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Groat — Payments SaaS Hero as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage to swap in."
---

# Groat — Payments SaaS Hero

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single-viewport marketing hero for Groat, a fictional B2B payments and
collections platform. A floating white navbar sits above a warm off-white
page; the hero below it splits into a left text column (headline, subhead,
two CTAs) and, on desktop, a full-height rounded video panel pinned to the
right 55% of the section.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, nav
   labels, headline, subhead, and CTA copy. Swap `assets/hero-video.mp4`
   (and its poster) for footage of matching aspect and mood — keep it
   muted, looped, and under roughly 10MB.
3. **Preserve the design system.** The off-white/near-black neutral base,
   the single warm-orange accent (used only on the primary CTA gradient,
   the active dropdown state, and focus rings), and the floating pill
   navbar are the identity — do not swap in a dark theme, a different
   accent hue, or a fixed/sticky navbar without being asked.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. This template ships one hero by design; additional
   sections should be designed from scratch in this template's own
   vocabulary (warm off-white neutrals, one orange accent, medium-weight
   wide type).
5. **Keep motion accessible.** The load-in fades, dropdown transitions, and
   button hover/active states must all stay behind
   `prefers-reduced-motion`, exactly as the build spec below requires.

## Build spec

### Palette tokens

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f1f0f5` | Page background |
| `--fg` | `#17171c` | Headline, logo wordmark, primary text |
| `--muted-fg` | `#6f6f7b` | Subhead copy, inactive nav-link tint |
| `--muted-bg` | `#e8e7ee` | Hover fill for the outline CTA and dropdown rows |
| `--border` | `#dddde3` | Outline-CTA border, dropdown-panel border |
| `--nav-bg` / `--secondary-bg` | `#ffffff` | Navbar pill, dropdown panel, outline CTA fill |
| `--primary` | `#f47825` | The core chromatic accent — active dropdown label, focus ring |
| `--primary-fg` | `#ffffff` | Text on the gradient CTA |
| `--hero-grad-a` / `--hero-grad-b` | `#ffa970` / `#fd5812` | Gradient CTA stops (top → bottom) |

The primary CTA's `linear-gradient(to bottom, var(--hero-grad-a),
var(--hero-grad-b))` is the page's one gradient declaration; both stops are
`var()` references, and `--focus-ring` is itself an alias for `var(--primary)`
so every focus outline and the open-dropdown label color recolor together
with the CTA.

### Typography

**Inter** (Google Fonts, weights 400/500/600/700), matching the prompt's
named font stack exactly — no substitution needed. Headline is weight 500,
`clamp(2.5rem, 3vw + 2rem, 4.5rem)`, letter-spacing `-0.02em`, line-height
`1.05`. Subhead is weight 400 at `clamp(1.125rem, 0.6vw + 1rem, 1.25rem)`,
line-height `1.65`, colored `var(--muted-fg)`.

### Layout

**Navbar** — a `<header>` with top-only padding (16px, 32px at ≥1024px)
holding one `<nav>`: white background, 12px radius, soft shadow, max-width
1280px, centered. Contents left-to-right:

1. **Logo** — a 28px black circle containing a 12px white rounded square,
   plus the wordmark "groat" at 1.5rem/700.
2. **Center links** (flex, hidden below 768px) — "Products" and "Company"
   as buttons with a chevron icon that open a small dropdown panel (3
   generic links each); "Pricing" and "For Accountants" as plain links.
3. **Right side** — "Log in" (hidden below 640px) and a gradient "Get
   started" button.

**Hero** — a `<section>` that fills the remaining viewport height
(`flex: 1 0 auto` on a full-height flex `<body>`, so it grows to fill
whatever space the navbar doesn't use, with a `60vh` floor for very short
viewports).

1. **Text column** (`max-width: 36rem`) — the `<h1>`, a `<p>` subhead, and a
   two-button row (`Get started` gradient, `Talk to a human` outline),
   both at the `xl` size (56px tall, 40px horizontal padding).
2. **Video panel** — absolutely positioned, `top/right: 0`, `width: 55%`,
   `height: 100%`, bottom-left corner rounded 24px, `object-fit: cover`,
   visible only at ≥1024px (matching the source's desktop-only video
   column); hidden entirely below that so the text column runs full width
   on mobile instead of clipping a cropped video sliver.

### Motion inventory

- **Load-in**: the navbar fades down (`translateY(-16px) → 0`) over 700ms;
  the headline, subhead, and button row each fade up
  (`translateY(24px) → 0`) over 800ms, staggered 150ms apart — all using
  `cubic-bezier(0.23, 1, 0.32, 1)`.
- **Nav dropdowns**: "Products" and "Company" toggle a small panel via a
  tiny inline script (click to open/close, outside-click and `Escape` to
  close); the panel fades and slides `translateY(-6px) → 0` over 200ms, and
  the trigger's chevron rotates 180° and its label tints orange while open.
- **Buttons**: every button transitions `transform`/`opacity`/`box-shadow`/
  `background` over 200ms on hover and scales to `0.97` over 120ms on
  active — never scaling from 0.
- **Ambient loop**: the hero video autoplays, loops, and stays muted via
  HTML attributes; a small inline script calls `.play()` defensively and
  is the only script beyond the dropdown toggle.
- **`prefers-reduced-motion: reduce`**: all load-in and dropdown animations
  are disabled (content renders fully visible, no transform), button
  active-state scaling is removed, and the `<video>` is hidden in favor of
  its vendored poster-frame `<img>` — a fully static page.

### Assets

- `assets/hero-video.mp4` — the source CloudFront clip re-encoded to a
  muted, 720×720, ~10s H.264 loop (~600KB), referenced with a plain
  `<video>` tag (no external player).
- `assets/hero-poster.jpg` — poster frame for the video and its
  reduced-motion fallback.

### Deviations from the prompt

- **Brand name.** The prompt's wordmark "nickel" collides with an existing
  registered fintech brand (a French neobank), so this build renames it to
  the fictional **Groat** (an old British coin denomination — a small
  aside on the headline's "growth" pun) per the de-branding rule. All other
  copy is unchanged.
- **Nav dropdown contents.** The prompt specifies chevron-bearing
  "Products"/"Company" buttons but no menu contents. This build adds three
  generic, non-branded links under each so the buttons aren't dead ends;
  swap them for the user's real product/company pages.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="nickel-payments-hero" type="text/html" title="Groat — Payments SaaS Hero">
<!doctype html>
<html>...</html>
</artifact>
```
