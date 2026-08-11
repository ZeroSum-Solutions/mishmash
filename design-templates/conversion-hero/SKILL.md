---
name: conversion-hero
description: |
  Fullscreen conversion-focused hero for the fictional dev tool **Wireloop.Dev**, built as a single self-contained HTML page. A looping wildflower-meadow film fills the viewport behind a glass navigation bar and a centered content stack: an uppercase display headline, a supporting subhead, and a green QR-code card driving a download. Navigation and hero content fade/slide in on load with staggered delays; a slide-down mobile menu and a bouncing scroll chevron round out the interaction. Motion collapses to a static poster frame under `prefers-reduced-motion`.
tags:
  - "landing-page"
  - "motionsites"
  - "hero"
  - "saas"
  - "video-background"
  - "mobile-menu"
triggers:
  - "wireloop"
  - "conversion hero"
  - "download hero"
  - "qr code cta"
  - "video background hero"
  - "mesh network"
  - "developer tool hero"
  - "full-screen hero"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=conversion"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build a fullscreen conversion hero like this one, in this template's own visual system, but for my real product. Follow the build spec exactly — palette, typography, section composition, and motion are part of the identity. Ask only for the missing essentials first: brand name, real headline/subhead copy, and a background video or QR destination to swap in."
---

# Conversion Hero — Wireloop.Dev

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single, full-viewport hero for the fictional developer tool **Wireloop.Dev**. A looping
wildflower-meadow film (a green ridge of daisies rolling under a bright white sky) sits behind
a fixed glass navigation bar and a centered content stack. The uppercase display headline,
subhead, and a green QR-code download card each fade up in sequence as the page loads, and a
slide-down mobile menu and a bouncing scroll chevron complete the interaction surface.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, nav links, headline,
   subhead, and QR destination. Swap `assets/hero-bg.mp4` (and its poster) for the user's own
   footage, keeping the same behavior (`object-fit: cover`, muted, looping, poster fallback).
3. **Preserve the design system.** The light neutral scaffold, the green accent pair, the
   type scale, and the choreography (nav slide-down → headline → subhead → QR card) are the
   identity — do not substitute a different accent palette or strip the staggered reveal.
4. **Extend by duplicating sections**, never by importing a layout from another template. This
   page is intentionally hero-only (`height: 100dvh; overflow: hidden`, matching the source's
   own `h-screen overflow-hidden` scope); if a second section is needed, design it from scratch
   in this template's own vocabulary (same tokens, same easing) and drop the `overflow: hidden`
   lock on `html`/`body`.
5. **Keep motion accessible.** Every animation collapses under `prefers-reduced-motion`, as the
   build spec below requires.

## Build spec

### Palette

- `--ink` / `--ink-soft` / `--ink-mute` (`#111827` / `#374151` / `#4b5563`) — near-black to
  mid-grey text on a white scaffold (`--surface`). Literal neutrals, protected from the recolor
  pass by design.
- `--accent` (`#4caf50`) and `--accent-dark` (`#43a047`) — the two genuinely chromatic root
  tokens, matching the source spec's green CTA. They drive the primary button and the QR card
  background, both as `linear-gradient(…, var(--accent), var(--accent-dark))` so a recolor pass
  swaps them cleanly.

### Type

Google Fonts **Poppins** (weight 900, upright and italic) stands in for the prompt's non-Google
"Qanelas-Heavy" (a paid onlinewebfonts.com proxy font). Both are geometric sans faces with a
high x-height and true circular bowls, so the substitution keeps the intended bold, rounded
display character. **Inter** (400–700) is used exactly as specified for body/UI text. Sizes are
fluid via `clamp()`: headline 40–110px at 0.95 line-height, subhead 14–20px, nav/body text
13–15px.

### Layout

One `<section>` fills the viewport (`height: 100dvh`, `overflow: hidden`):

1. **Background film** — `<video>` absolutely positioned, `object-fit: cover`, muted/looped/
   autoplaying, with a poster frame for the pre-play and reduced-motion states, plus a soft
   white top-to-bottom overlay gradient for text legibility.
2. **Navigation bar** — brand wordmark "Wireloop." (italic, weight 900) + "Dev" (regular, muted)
   on the left; four anchor links (Overview, Docs, Our Team, Upgrade) centered on desktop; a
   language indicator ("DE" swatch + "EN") and a green "Get It Today" download-icon button on
   the right; a hamburger toggle (crossfading Menu/X icons) replaces the links/actions below
   768px width.
3. **Mobile menu** — an absolutely positioned glass panel under the nav, opening/closing via a
   slide + fade with five staggered children (four links + a language/CTA row), matching the
   source's `0.06s/0.1s/0.14s/0.18s/0.22s` stagger.
4. **Centered hero content** — uppercase display headline "Push.Route.Deploy", a supporting
   subhead about mesh data streams and UDP hole punching, and a green QR-code card ("Try Now")
   whose primary CTA and nav CTA both link to it via `#try-now`, so the conversion action always
   resolves to a real in-page target.
5. **Scroll indicator** — a bouncing chevron pinned to the bottom center.

### Motion inventory

- **Nav fade-down** — pure CSS `@keyframes`, 600ms, `cubic-bezier(0.16, 1, 0.3, 1)`,
  translateY(-20px) → 0 with a fade, delay 0.1s, runs once on load.
- **Hero fade-up ×3** — headline, subhead, and QR card each use the same keyframe
  (translateY(30px) → 0 with a fade), 800ms, same easing, delays 0.2s / 0.45s / 0.7s.
- **Mobile menu slide** — enter: 350ms slide+fade from -12px, same ease-out-expo curve as the
  source. Five staggered `menu-item-in` reveals inside, matching the source's delay list.
- **Icon crossfade** — the hamburger's Menu/X glyphs cross-fade with a 90°/-90° rotation over
  300ms on toggle.
- **Scroll chevron bounce** — a small vertical bounce loop, 1.6s, infinite.
- **`prefers-reduced-motion: reduce`** — the background video is paused and swapped for its
  static poster image; the nav, headline, subhead, QR card, scroll chevron, and mobile-menu
  transitions all land in their final state immediately with no motion.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="conversion-hero" type="text/html" title="Conversion Hero — Wireloop.Dev">
<!doctype html>
<html>...</html>
</artifact>
```

## Source note

Derived from a MotionSites prompt originally written for a brand called "Zipwire.Dev" —
"Zipwire" is used as a real trademark by more than one company in software and financial
services (an IVR/telephony product, a UK retirement-finance platform, a medical guidewire), so
this build uses the fictional name **Wireloop.Dev** throughout instead. The background film and
QR-code artwork are vendored locally from the prompt's CloudFront/higgs.ai URLs; the QR image is
a generic, unbranded code with no logo baked in. The prompt's non-Google "Qanelas-Heavy" font is
swapped for the closest Google Fonts equivalent, Poppins (900). The mobile menu's exit
transition uses the SPEC-mandated ease-out family instead of the prompt's specified
`cubic-bezier(0.7, 0, 0.84, 0)` ease-in curve, shortened to ~180ms for a decisive close.
