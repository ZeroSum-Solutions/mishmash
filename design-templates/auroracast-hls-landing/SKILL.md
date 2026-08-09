---
name: auroracast-hls-landing
description: |
  A modern React landing page for a fictional broadcast-grade live video platform featuring a full-screen adaptive HLS video background, a glassmorphic navigation header, and hero content pinned to the bottom-left corner. Dark cinematic aesthetic with Gloock display serif, Archivo body, JetBrains Mono telemetry labels, and an aurora-green signal accent — ideal as a live streaming platform or video SaaS landing page template.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "auroracast"
  - "hls"
  - "video"
  - "streaming"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/auroracast-hls-landing"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Auroracast — HLS Video Streaming Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Auroracast — HLS Video Streaming Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A modern React landing page for a fictional broadcast-grade live video platform featuring a full-screen adaptive HLS video background, a glassmorphic navigation header, and hero content pinned to the bottom-left corner. Dark cinematic aesthetic with Gloock display serif, Archivo body, JetBrains Mono telemetry labels, and an aurora-green signal accent — ideal as a live streaming platform or video SaaS landing page template.

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
<artifact identifier="auroracast-hls-landing" type="text/html" title="Auroracast — HLS Video Streaming Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# Prompt

Create a modern React landing page with a full-screen HLS video background, glassmorphic navigation header, and hero content positioned in the bottom-left corner.

## Overview

Build a single landing page in React. The page should feature:

- A **full-screen HLS video background** that fills the viewport.
- A **glassmorphic navigation header**.
- **Hero content positioned in the bottom-left corner** of the page.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/auroracast-hls-landing).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
