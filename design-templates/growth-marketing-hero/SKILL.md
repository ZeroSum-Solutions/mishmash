---
name: growth-marketing-hero
description: |
  Dark, cinematic single-hero landing page for **UI Rocket**, a fictional
  AI website-building course. A full-bleed night-garden video plays behind a
  centered badge/headline/CTA stack that fades and lifts away on scroll,
  while a liquid-glass "product" dashboard — an AI chat panel paired with a
  live, self-animating course-preview mockup — parallaxes upward beneath it.
  A translucent moss-and-wildflower silhouette drifts across the very bottom
  of the frame, in front of the dashboard, completing the depth stack. Motion
  is scroll-linked parallax plus a staggered load-in, fully neutralized under
  reduced motion.
tags:
  - "landing-page"
  - "motionsites"
  - "saas"
  - "hero-section"
  - "dark-mode"
  - "video-background"
  - "parallax"
  - "liquid-glass"
triggers:
  - "ui rocket"
  - "growth marketing hero"
  - "ai course landing page"
  - "liquid glass dashboard mock"
  - "parallax video hero"
  - "night garden hero"
  - "ai chat panel mockup"
  - "email capture pill"
  - "dark saas hero"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=growth-marketing-saas"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build UI Rocket — AI Website-Building Course Hero as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, layered parallax composition, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage to swap in for the two vendored loops."
---

# UI Rocket — AI Website-Building Course Hero

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single full-viewport hero for UI Rocket, a fictional course that teaches
designers and builders to ship websites with AI. A muted night-garden video
fills the backdrop behind a centered badge, headline, subhead, and pill CTA;
below that, a liquid-glass dashboard card splits into an AI chat panel and a
live, self-looping mockup of the course's own marketing site; and a
translucent moss-and-wildflower image drifts in front of the whole stack at
the bottom of the frame. Scrolling parallaxes the three layers apart —
content fades up and out, the dashboard glides upward, the foreground drifts
down — before the page ends (this template ships nav + hero only, no
sections below).

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headline,
   subhead, CTA label, chat transcript, and the nested mockup's copy. Swap
   the two vendored video loops for footage of a similar mood (ambient,
   non-distracting, dark) and the foreground image for artwork with a
   matching transparent silhouette shape.
3. **Preserve the design system.** The near-black backdrop, the
   amber-to-violet chromatic accent, the liquid-glass panel treatment, and
   the three-layer parallax depth stack (content / dashboard / foreground)
   are the identity — do not flatten the glass panels or drop the parallax
   without being asked.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. This template ships nav + hero only by design; if the
   user wants sections below it, design them from scratch in this template's
   own vocabulary (near-black neutrals, the amber/violet accent pair, liquid
   glass surfaces).
5. **Keep motion accessible.** The scroll-linked parallax, the load-in
   fade-up, the chat-message stagger reveal, and the mockup's video
   cross-fade loop must all stay behind `prefers-reduced-motion`, exactly as
   the build spec below requires.

## Build spec

### Palette tokens

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#08020e` | Body background (neutral, near-black) |
| `--fg` | `#ffffff` | Headline, mockup nav/heading text |
| `--fg-soft` / `--fg-muted` / `--fg-faint` | `rgba(255,255,255,.8/.6/.4)` | Body copy, secondary labels, placeholders |
| `--accent` | `#ffb648` | The primary chromatic token — logo mark, chat sparkle icon, gradient-text start |
| `--accent-2` | `#7c5cff` | Second chromatic token — gradient-text end, pairs with `--accent` |
| `--accent-soft` | `rgba(255,182,72,.18)` | Reserved accent tint for hover/glow states |
| `--surface` / `--surface-hover` | `rgba(255,255,255,.1/.16)` | Glass pill fills (nav CTA, badges) |
| `--border` / `--border-strong` | `rgba(255,255,255,.1/.2)` | Glass pill hairlines |

`--bg` and the `--fg-*` scale stay literal near-black/near-white neutral
scaffolding by design. `--accent` and `--accent-2` are the page's two
genuinely chromatic tokens — together they drive the gradient-text "AI" in
the headline, so the color knob has a real, visible surface to retint.

### Typography

- **Inter** (Google Fonts, weights 400–800) for all UI text — nav, badge,
  headline, body copy, chat transcript, buttons.
- **Instrument Serif** (Google Fonts, regular + italic) for the single
  "Built for the curious" headline inside the nested course-preview mockup,
  matching the prompt's serif-accent pairing exactly. Both fonts are the
  prompt's originals — no substitution was needed.
- Headline uses `clamp()` to scale from ~38px on mobile to 64px on desktop,
  `font-weight: 700`, `letter-spacing: -0.03em`.

### Layout

1. **Fixed transparent navbar** — logo mark (rocket icon + "UI Rocket"
   wordmark), four center links, a "Login" link plus a glass-pill "Get
   started" button on desktop (≥1024px), collapsing to a hamburger button
   that opens a right-side slide-in sheet with the same links below that.
2. **Hero section** (`min-height: 100vh`, `position: relative`):
   - **Background video** — full-bleed, muted/looped/autoplay, no dark
     overlay (matches the brief), with a poster-image fallback.
   - **Hero content** — centered column: a glass pill badge ("Founder member
     sale special"), an `<h1>` headline with a gradient-text "AI" accent
     word, a subhead, and a white pill "Get course" CTA. Fades up on load,
     then fades out and translates upward as the section scrolls.
   - **Dashboard mock** — a `liquid-glass` card (blurred fill + gradient
     hairline border via a masked `::before`) holding a two-column grid:
     - *Chat panel* (left, hidden below 640px): header with a sparkle icon
       and course title, a three-message seed transcript that reveals in a
       staggered fade as the panel scrolls into view, and a working textarea
       + send button that appends a user message and a canned reply.
     - *Live preview* (right): a second background video (the nested
       "product"), a mini-nav for the in-mockup demo brand "Asme", a serif
       "Built for the curious" headline, an email-capture pill, copy, a
       "Manifesto" glass button, and a row of three glass-circle icon links.
       (The prompt's real Instagram/Twitter glyphs were swapped for generic,
       non-trademarked icon marks — see de-branding note below.)
   - **Foreground image** — a translucent moss-and-wildflower silhouette
     pinned to the bottom of the section, in front of the dashboard, drifting
     downward as the user scrolls.

### Motion inventory

- **Load-in fade-up**: the badge, headline, subhead, and CTA each animate in
  with a staggered `opacity 0→1` / `translateY(24px)→0`, `cubic-bezier(0.23,
  1, 0.32, 1)` easing, never scaling from 0.
- **Scroll-linked parallax**: a single `rAF`-throttled scroll handler
  computes hero-section scroll progress (`0` at section top, `1` at section
  bottom reaching viewport top) and drives three transforms — dashboard
  `translateY` to `-25%`, foreground image to `+20%`, hero content to `-60%`
  with a matching opacity fade over the first 60% of progress — mirroring the
  prompt's `useScroll`/`useTransform` behavior with vanilla JS.
- **Chat stagger reveal**: an `IntersectionObserver` fires once when the chat
  panel enters view, revealing the three seed messages with a 120ms stagger.
- **Live-preview video cross-fade loop**: the nested mockup's background
  video fades in on `loadeddata`, fades out in the last ~0.55s before
  `ended`, then restarts and fades back in — a vanilla `requestAnimationFrame`
  opacity tween matching the prompt's spec.
- **Hover text-swap**: nav links and the "Login" link use a two-line
  `overflow: hidden` + `translateY` hover swap (CSS-only) in place of the
  prompt's `framer-motion` `AnimatedText`.
- **`prefers-reduced-motion: reduce`**: both videos are hidden in favor of
  vendored poster frames, all load-in/parallax/stagger animations resolve to
  their end state with no transform, and the live-preview cross-fade loop is
  skipped entirely — a fully static page.

### Assets

- `assets/hero-bg.mp4` — the prompt's CloudFront hero loop, downloaded and
  transcoded to a muted 720p H.264 MP4 (~1.3MB) with a matching
  `assets/hero-bg-poster.jpg` fallback frame.
- `assets/dashboard-preview.mp4` — the prompt's second CloudFront loop
  (used inside the nested mockup), transcoded the same way (~2.2MB) with
  `assets/dashboard-poster.jpg` as its fallback frame.
- `assets/hero-grass.webp` — the prompt's foreground PNG, which is hosted on
  a Supabase storage bucket rather than the usual CloudFront pipeline;
  downloaded via `curl` and re-encoded as a lossy WebP with alpha (~155KB,
  down from a 1.2MB source PNG).
- **De-branding note:** the nested mockup's two social-icon slots specified
  Instagram and Twitter/X marks in the source prompt. Both were swapped for
  generic, non-trademarked glyphs (a generic "community" glyph and an
  envelope "newsletter" glyph) alongside the existing generic globe icon —
  no real company logos ship in this template. The nested demo brand "Asme"
  is MotionSites' own recurring placeholder brand (also used elsewhere in
  this catalog) and was left as-is.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="growth-marketing-hero" type="text/html" title="UI Rocket — AI Website-Building Course Hero">
<!doctype html>
<html>...</html>
</artifact>
```
