---
name: noctis-cinematic-hero
description: |
  A full-screen dark hero section built for an imagined independent picture house, featuring a Cloudinary background video framed in a letterboxed, film-graded cinematic treatment: animated film grain, vignette, viewfinder corner ticks, vertical credit rails, a live 24fps SMPTE timecode, and a staggered title-card entrance. Typography is Italiana (display), Cormorant italic (accent/body), and IBM Plex Mono (credit micro-labels) in champagne gold on near-black — a premium landing page aesthetic for cinematic brands.
tags:
  - "hero-section"
  - "hero-sections"
  - "claude-directory"
triggers:
  - "noctis"
  - "cinematic"
  - "film-grade"
  - "video"
  - "hero"
  - "section"
  - "hero-section"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/hero-sections/noctis-cinematic-hero"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "hero-section"
  scenario: "marketing"
  example_prompt: "Build NOCTIS — Cinematic Film-Grade Video Hero Section as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# NOCTIS — Cinematic Film-Grade Video Hero Section

> Hero section vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A full-screen dark hero section built for an imagined independent picture house, featuring a Cloudinary background video framed in a letterboxed, film-graded cinematic treatment: animated film grain, vignette, viewfinder corner ticks, vertical credit rails, a live 24fps SMPTE timecode, and a staggered title-card entrance. Typography is Italiana (display), Cormorant italic (accent/body), and IBM Plex Mono (credit micro-labels) in champagne gold on near-black — a premium landing page aesthetic for cinematic brands.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headlines,
   body copy, numbers, and imagery. Match existing image dimensions when
   swapping assets.
3. **Preserve the design system.** The palette, type scale, spacing rhythm, and
   motion in the build spec below are the identity — do not substitute fonts,
   recolour the palette, or strip decorative elements.
4. **Extend by duplicating sections**, never by importing a layout from another
   template. If a section is missing, design it from scratch in this template's
   own vocabulary.
5. **Keep motion accessible.** Every animation must stay behind
   `prefers-reduced-motion`, as the build spec requires.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="noctis-cinematic-hero" type="text/html" title="NOCTIS — Cinematic Film-Grade Video Hero Section">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# Noctis — Cinematic Hero Section

## Overview

Create a full-screen, dark hero section with a cinematic, premium aesthetic.

## Background Video

The hero uses a single background video:

`https://res.cloudinary.com/dfonotyfb/video/upload/v1775585556/DDS3_1_RQHG7X.MP4`

Implement it exactly as specified:

```tsx
<video autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover z-0">
  <source src="https://res.cloudinary.com/dfonotyfb/video/upload/v1775585556/DDS3_1_RQHG7X.MP4" type="video/mp4" />{" "}
</video>
```

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/hero-sections/noctis-cinematic-hero).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
