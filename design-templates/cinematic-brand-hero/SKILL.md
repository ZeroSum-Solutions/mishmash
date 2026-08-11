---
name: cinematic-brand-hero
description: |
  Full-screen cinematic brand hero for the fictional tech brand **VERAXIS**, built as a single self-contained HTML page. A looping ember-to-cyan energy-ring film fills the viewport behind a glass navbar and a centered hero stack: a gradient-accented eyebrow line, a character-by-character reveal headline, a soft subheading, and a glowing primary CTA paired with a ghost secondary CTA. Motion is staggered IntersectionObserver-driven fades plus a per-character typing reveal, all collapsible under `prefers-reduced-motion`.
tags:
  - "landing-page"
  - "motionsites"
  - "hero"
  - "cinematic"
  - "dark-mode"
  - "video-background"
triggers:
  - "veraxis"
  - "cinematic hero"
  - "cinematic brand"
  - "full-screen video hero"
  - "typing headline"
  - "character reveal"
  - "brand hero"
  - "glass navbar"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=cinematic-brand"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build a full-screen cinematic brand hero like this one, in this template's own visual system, but for my real brand. Follow the build spec exactly — palette, typography, section composition, and motion are part of the identity. Ask only for the missing essentials first: brand name, real headline/subhead copy, and a background video or image to swap in."
---

# Cinematic Brand Hero — VERAXIS

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single, full-viewport hero landing page for the fictional brand **VERAXIS**. A
looping cinematic energy-ring film (warm ember top, electric cyan bottom, drifting
through a starfield) sits behind a fixed glass navbar and a centered content stack.
The headline reveals itself one character at a time as the page loads, followed by
a staggered fade-up of the subheading and both call-to-action buttons.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, eyebrow line,
   headline, subheading, and CTA labels. Swap `assets/hero-bg.mp4` (and its poster)
   for the user's own footage, keeping the same aspect/crop behavior (`object-fit:
   cover`, muted, looping).
3. **Preserve the design system.** The near-black scaffold, the ember-to-cyan
   accent pair, the type scale, and the choreography (nav slide-in → eyebrow →
   typing headline → subhead → buttons) are the identity — do not substitute a
   different accent palette or strip the staggered reveal.
4. **Extend by duplicating sections**, never by importing a layout from another
   template. This page is intentionally hero-only; if a second section is needed,
   design it from scratch in this template's own vocabulary (same tokens, same
   easing).
5. **Keep motion accessible.** Every animation collapses under
   `prefers-reduced-motion`, as the build spec below requires.

## Build spec

### Palette

- `--bg` / `--ink` (`#050506` / `#0b0c10`) — near-black scaffold, used for the
  page background and the solid navbar/CTA buttons. Literal neutral, protected
  from the recolor pass by design.
- `--fg`, `--fg-dim`, `--fg-dimmer` — white text at full, 62%, and 50% opacity.
- `--accent-a` (`#ff5a36`, ember) and `--accent-b` (`#2fd0ff`, electric cyan) —
  the two genuinely chromatic root tokens, sampled from the background film's own
  energy-ring gradient. They drive the eyebrow's short accent line, a subtle
  `mix-blend-mode: overlay` color-grade wash over the video, and the focus-visible
  outline color. Every gradient built from them (`.eyebrow-line`, `.hero-grade`)
  reads its stops through `var()`, so a recolor pass swaps them cleanly.

### Type

Google Fonts **Sora** (weights 300–700) stands in for the prompt's non-Google
custom font "Quire Sans Pro" — both are geometric, humanist sans faces with a
similar even x-height, so the substitution keeps the intended clean, modern tone.
Sizes are fluid via `clamp()`: eyebrow 10–14px at 0.25–0.3em tracking, headline
28–72px at 1.15 line-height, subheading 12–18px, button labels 14–18px.

### Layout

One `<section>` fills the viewport (`min-height: 100vh`, `overflow: hidden`,
near-black background):

1. **Background film** — `<video>` absolutely positioned, `object-fit: cover`,
   muted/looped/autoplaying, with a poster frame for the pre-play and
   reduced-motion states.
2. **Color-grade + scrim overlays** — two absolutely positioned layers above the
   video: a soft `overlay`-blended ember→cyan wash tying the UI to the footage,
   and a black radial/linear scrim for text legibility.
3. **Fixed glass navbar** (`z-index: 50`) — hexagon logomark + "VERAXIS" wordmark
   on the left (icon rotates 30° on hover); a ghost "Contact" button and a
   glow-outlined solid "Sign Up" button on the right. Slides down from -24px with
   a fade on load.
4. **Centered hero content**, shifted up slightly on larger screens to balance
   against the fixed nav:
   - Eyebrow: short gradient rule + "The future is unfolding" in tracked
     uppercase.
   - Headline (`<h1>`): "Innovation that reshapes the fabric of experience",
     revealed one character at a time.
   - Subheading: a single sentence of supporting copy at reduced opacity.
   - Button row: a solid glow "Begin Now" button with a circular play glyph,
     next to a ghost "Watch the story" button. Stacks vertically under 640px,
     sits side-by-side above it.

### Motion inventory

- **Nav slide-in** — pure CSS `@keyframes`, 600ms, `cubic-bezier(0.25, 0.46,
  0.45, 0.94)`, translateY(-24px) → 0 with a fade, runs once on load.
- **Character-reveal headline** — JS splits the heading into per-character
  `<span>`s (word-wrapped, screen-reader text kept separately via a visually
  hidden duplicate), each with an inline `transition-delay` of `index × 45ms`;
  an `IntersectionObserver` toggles one class that fires every char's opacity
  transition (150ms) in staggered sequence. A plain-text fallback is what
  no-JS visitors and reduced-motion visitors see instead — never removed from
  the DOM, only toggled.
- **Staggered fade-up** — eyebrow, subheading, and both CTAs each carry
  `data-reveal` with their own `--delay` (0s / 2.4s / 2.8s / 3.0s, matching the
  source choreography), driven by the same `IntersectionObserver` plus a CSS
  `opacity`/`translateY(24px)→0` transition.
- **Hover micro-interactions** — buttons scale to 1.05 on hover/1 on press; the
  hexagon logomark rotates 30°. Both use the UI-interaction easing
  `cubic-bezier(0.23, 1, 0.32, 1)`, distinct from the art-directed hero easing
  above.
- **`prefers-reduced-motion: reduce`** — the nav keyframe, every `data-reveal`
  transition, and the per-character transitions are neutralized (elements land
  in their final state immediately); the background video is paused on load so
  its poster frame stands in as a static, dignified fallback.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="cinematic-brand-hero" type="text/html" title="Cinematic Brand Hero — VERAXIS">
<!doctype html>
<html>...</html>
</artifact>
```

## Source note

Derived from a MotionSites prompt originally written for a brand called "VERTX" —
a real tactical-apparel trademark (Fechheimer/Berkshire Hathaway) — so this build
uses the fictional name **VERAXIS** throughout instead. The background film is
vendored locally from the prompt's CloudFront URL and transcoded to a muted 720p
loop; the prompt's non-Google "Quire Sans Pro" font is swapped for the closest
Google Fonts equivalent, Sora.
