---
name: codenest-hero
description: |
  High-end, dark-themed hero section for the fictional coding education platform **CodeNest**. A full-screen Mux HLS background video plays at 60% opacity under layered left and bottom `#070b0a` gradients, while a 200×200px liquid glass card (luminosity blend, 4px backdrop blur, 1.4px XOR-masked gradient border) floats 50px above a bold uppercase headline. Desktop grid lines and an SVG ellipse glow in cyan/dark-green complete the cinematic atmosphere. Includes a functional mobile hamburger menu with a full-screen dark overlay.
tags:
  - "hero-section"
  - "hero-sections"
  - "claude-directory"
triggers:
  - "codenest"
  - "cinematic"
  - "dark"
  - "hero"
  - "section"
  - "hero-section"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/hero-sections/codenest-hero"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "hero-section"
  scenario: "marketing"
  example_prompt: "Build CodeNest — Cinematic Dark Hero Section as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# CodeNest — Cinematic Dark Hero Section

> Hero section vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

High-end, dark-themed hero section for the fictional coding education platform **CodeNest**. A full-screen Mux HLS background video plays at 60% opacity under layered left and bottom `#070b0a` gradients, while a 200×200px liquid glass card (luminosity blend, 4px backdrop blur, 1.4px XOR-masked gradient border) floats 50px above a bold uppercase headline. Desktop grid lines and an SVG ellipse glow in cyan/dark-green complete the cinematic atmosphere. Includes a functional mobile hamburger menu with a full-screen dark overlay.

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
<artifact identifier="codenest-hero" type="text/html" title="CodeNest — Cinematic Dark Hero Section">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# CodeNest — Cinematic Dark Hero Section

## Overview

Build a high-end, dark-themed hero section for a coding-education platform called **CodeNest**, using React and Tailwind CSS. The page layers a full-screen HLS background video, an SVG glow, a "liquid glass" floating card, and bold uppercase typography over a near-black `#070b0a` canvas. The design must be fully responsive, including a functional mobile hamburger menu.

## Tech Stack

- **Framework:** React with TypeScript.
- **Styling:** Tailwind CSS.
- **Icons:** `lucide-react` — `ArrowRight`, `Menu`, `X`.
- **Video streaming:** `hls.js` for the HLS background stream (instantiated with `enableWorker: false` for stability in sandboxed environments).
- **Fonts (Google Fonts):** Inter, Plus Jakarta Sans, and Instrument Serif (italic).

## Background & Layout

### Background video

- Implement a full-screen background video using the HLS stream: `https://stream.mux.com/tLkHO1qZoaaQOUeVWo8hEBeGQfySP02EPS02BmnNFyXys.m3u8`.
- Use `hls.js` and set `enableWorker: false` to ensure stability in sandboxed environments.

### Overlays

- Set the video to **60% opacity**.
- Add a dark linear gradient from the left (`#070b0a` to transparent).
- Add a bottom-up gradient for readability.

### Grid system

- Add three thin vertical grid lines (white at 10% opacity) at the **25%, 50%, and 75%** marks across the screen (visible on desktop).

### Central glow

- Place a large horizontal SVG ellipse glow in the center-top area with a cyan / dark-green hue, using a **25px Gaussian blur** filter.

## The Liquid Glass Card

### Component

- Create a **200×200px** floating card positioned above the main headline, shifted exactly **50px upwards** using `translate-y-[-50px]`.

### CSS styling (liquid glass)

- **Background:** `rgba(255, 255, 255, 0.01)` with `background-blend-mode: luminosity`.
- **Backdrop filter:** `blur(4px)`.
- **Box shadow:** `inset 0 1px 1px rgba(255, 255, 255, 0.1)`.
- **Border effect:** a `::before` pseudo-element with `inset: 0`, `padding: 1.4px`, and a 180-degree white linear gradient. Use `-webkit-mask-composite: xor` and `mask-composite: exclude` to create a sharp, high-end border frame.

### Content

- A `[ 2025 ]` tag (14px).
- A `TAUGHT BY INDUSTRY PROFESSIONALS` headline (18px, using Instrument Serif italic for the word `INDUSTRY`).
- A small description (11px).

## Hero Content & Typography

- **Eyebrow:** `CAREER-READY CURRICULUM` in Plus Jakarta Sans, bold, 11px, color `#5ed29c`.
- **Main headline:** `LAUNCH YOUR CODING CAREER.` in Inter Extra Bold, uppercase, `tracking-tight`. Scale from 40px (mobile) to 72px (desktop). The final period must be green (`#5ed29c`).
- **Description:** `MASTER IN-DEMAND CODING SKILLS...` in Inter, 14px, 70% white opacity, max-width 512px.
- **Primary CTA:** a `GET STARTED` button with an `ArrowRight` icon. Rounded-full, background `#5ed29c`, text `#070b0a`, uppercase, bold.

## Global Navigation

### Header

- Sticky / absolute header with a white minimalist logo.

### Desktop menu

- Links for `PROJECTS`, `BLOG`, `ABOUT`, `RESUME` in Inter, 16px. Hover state: `#5ed29c`.

### Mobile menu

- A functional hamburger menu that toggles a full-screen dark overlay.

## Required Imports

- **Fonts:** Inter, Plus Jakarta Sans, and Instrument Serif (italic).
- **Icons:** `lucide-react` — `ArrowRight`, `Menu`, `X`.
- **Library:** `hls.js` for video streaming.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/hero-sections/codenest-hero).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
