---
name: codercrest-saas-hero
description: |
  Full-viewport dark SaaS hero for the fictional engineering-talent platform
  **CoderCrest**. A muted equalizer-style video fills the black backdrop
  behind a light, wide three-line headline that fades from grey to white,
  interrupts itself with two small circular autoplay clips (a fingerprint for
  "human", a crystalline spark for "AI"), and closes on a glowing green
  outline button. Motion is a single staggered fade-up on load plus a
  hover/active glow on the call-to-action; everything degrades to a static
  poster frame under reduced motion.
tags:
  - "landing-page"
  - "motionsites"
  - "saas"
  - "hero-section"
  - "dark-mode"
  - "video-background"
triggers:
  - "codercrest"
  - "coder crest"
  - "saas hero"
  - "dark hero section"
  - "video background hero"
  - "gradient text headline"
  - "human and ai"
  - "talent platform"
  - "green glow cta"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=codercrest-hero"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build CoderCrest — SaaS Hero Section as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage to swap in."
---

# CoderCrest — SaaS Hero Section

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single full-viewport hero for CoderCrest, a fictional talent-mapping SaaS
for the GenAI era. The page is one `<section>` on a pure-black backdrop: a
muted, looping equalizer-bar video fills the frame edge to edge with no
overlay, a light three-line headline sits low in the viewport, and a single
outlined button closes the section with a soft green glow that intensifies
on hover.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headline
   lines, subhead copy, and CTA label. Swap the three vendored clips
   (background loop, "human" icon, "AI" icon) for footage of matching
   dimensions and mood — keep the background muted/looped and the two icon
   clips square and short.
3. **Preserve the design system.** The black backdrop, the light wide
   headline weight, the grey-to-white gradient treatment on the first two
   lines, and the green CTA glow are the identity — do not swap in a bright
   background, a heavier headline weight, or a different accent hue without
   being asked.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. This template ships one hero section by design; if the
   user wants more sections below it, design them from scratch in this
   template's own vocabulary (black/white/grey neutrals, one chromatic
   accent, wide light type).
5. **Keep motion accessible.** Every animation — the load-in fade-up and the
   CTA glow — must stay behind `prefers-reduced-motion`, exactly as the build
   spec below requires.

## Build spec

### Palette tokens

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#000000` | Section background, CTA fill |
| `--fg` | `#ffffff` | Headline inline text, subhead-adjacent labels |
| `--muted` | `#999999` | "is" / "+" connector words |
| `--subhead` | `#cccccc` | Body copy under the headline |
| `--gradient-a` / `--gradient-b` | `#666666` / `#d0d0d0` | Grey headline gradient stops (neutral, left literal by design) |
| `--accent` | `#27f3a9` | The one chromatic token — CTA glow, outline tint |
| `--accent-outline` | `#30463c` | CTA border color |
| `--accent-glow-soft` / `--accent-glow-strong` | `rgba(39,243,169,0.15)` / `rgba(39,243,169,0.22)` | Resting vs. hover CTA shadow and the radial glow behind it |

The CTA's radial backglow (`.cta::before`) and the headline's grey gradient
are the two `gradient()` declarations on the page; the CTA one references
`var(--accent-glow-strong)` so a client recolor changes the glow hue, while
the headline gradient stays on the literal greys since it's neutral
scaffolding, not a brand accent.

### Typography

Headline font is **Outfit** (Google Fonts, weights 300/400/500), substituted
for the prompt's original `YDYoonche` — a Korean display face not on Google
Fonts. Outfit was chosen as the nearest open equivalent: a light, wide,
geometric-humanist sans that reads clean at font-weight 300 the way the
original brief intended. Body copy shares the same family. Headline size is
`clamp(2.2rem, 7vw, 6.5rem)` at weight 300, letter-spacing `-0.01em`,
line-height `1.1`.

### Layout

One `<section class="hero">`, pure black, flex column, centered, `min-height:
100vh` (grows instead of clipping if content needs more room on short
viewports):

1. **Background video** — full-bleed `<video>` (`position: absolute; inset:
   0; object-fit: cover; z-index: 0`), no overlay, full opacity. A poster
   `<img>` fallback sits behind it for the reduced-motion path.
2. **Content column** — `z-index: 10`, centered text, `max-width: 64rem`,
   pushed down `margin-top: 380px` on desktop (matching the source brief
   exactly), stepping down to `140px` / `96px` under `780px` width or
   `700px` height and `480px` width respectively so the copy stays on-screen
   on phones instead of clipping.
3. **Headline (`<h1>`)** — three stacked lines:
   - `The vision` — grey-to-white gradient text.
   - `of engineering` — same gradient.
   - An inline flex row: `is` (muted grey) → a 110px circular clip (human /
     fingerprint) → `human` (white) → `+` (muted grey, nudged up
     `0.15em`) → a second 110px circular clip (AI / crystalline spark) →
     `AI` (white).
4. **Subhead (`<p>`)** — one sentence, `max-width: 36rem`, `#ccc`,
   `clamp(0.95rem, 2.2vw, 1.2rem)`.
5. **CTA (`<button>`)** — black fill, 1px `--accent-outline` border inset by
   `-1px`, soft green box-shadow at rest, brighter glow plus a blurred
   radial backglow on hover, `scale(1.03)` on hover / `scale(0.98)` on
   active.

### Motion inventory

- **Load-in fade-up**: the three headline lines, the subhead, and the CTA
  each animate `opacity 0 → 1` with a `translateY(24px) → 0` over 800ms,
  staggered `0.1s` apart (`0.1s` → `0.5s`), easing
  `cubic-bezier(0.23, 1, 0.32, 1)`.
- **CTA hover/active**: `transform` and `box-shadow` transition over 300ms
  on hover (scale to 1.03, brighter glow), 140ms on active (scale to 0.98).
  Never scales from 0.
- **Ambient loops**: the background video and both circular icon clips
  autoplay, loop, and stay muted via HTML attributes; a small inline script
  calls `.play()` defensively and is the only script on the page.
- **`prefers-reduced-motion: reduce`**: the load-in animation is skipped
  (content renders fully visible, no transform), the CTA's hover/active
  transitions and radial backglow are disabled, and all three `<video>`
  elements are hidden and paused in favor of their vendored poster-frame
  `<img>` fallbacks — a fully static page.

### Assets

- `assets/hero-bg.mp4` — the Mux HLS stream transcoded locally to a muted,
  720p, ~9.4s H.264 loop (~1.1MB), referenced with a plain `<video>` tag
  (no hls.js).
- `assets/hero-poster.jpg` — poster frame for the background video and its
  reduced-motion fallback.
- `assets/video-human.mp4`, `assets/video-ai.mp4` — the two CloudFront clips
  downloaded and downscaled to 320×320 (~60–100KB each) for the circular
  icons.
- `assets/video-human-poster.jpg`, `assets/video-ai-poster.jpg` — poster
  frames for the two icon clips' reduced-motion fallback.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="codercrest-saas-hero" type="text/html" title="CoderCrest — SaaS Hero Section">
<!doctype html>
<html>...</html>
</artifact>
```
