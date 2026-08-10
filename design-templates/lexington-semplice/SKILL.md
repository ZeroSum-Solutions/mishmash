---
name: lexington-semplice
description: |
  Semplice is a static reproduction of a minimal editorial photography portfolio. The project contains all 54 HTML routes from the current reference, including gallery collections, articles and tag archives, store pages, studio and team profiles, legal content, and system pages.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "semplice photography portfolio template"
  - "semplice"
  - "photography"
  - "portfolio"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/semplice"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "site-theme"
  scenario: "marketing"
  example_prompt: "Build Semplice Photography Portfolio Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Semplice Photography Portfolio Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Semplice is a static reproduction of a minimal editorial photography portfolio. The project contains all 54 HTML routes from the current reference, including gallery collections, articles and tag archives, store pages, studio and team profiles, legal content, and system pages.

The upstream theme ships a full multi-page site. `example.html` is its home page; the remaining routes (about, blog, pricing, help centre, auth, and design-system pages) stay upstream — rebuild them from the build spec when a project needs them.

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
<artifact identifier="lexington-semplice" type="text/html" title="Semplice Photography Portfolio Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE LEXINGTON THEMES "SEMPLICE" TEMPLATE — A MINIMAL PHOTOGRAPHY/GALLERY PORTFOLIO BUILT WITH CLEAN TYPOGRAPHY, SERIF + SANS FONT PAIRING, AND AN EDITORIAL AESTHETIC. REFERENCE: `https://lexingtonthemes.com/viewports/semplice`

## SUMMARY

SEMPLICE IS A MINIMAL, EDITORIAL PHOTOGRAPHY PORTFOLIO TEMPLATE BY LEXINGTON THEMES. IT FEATURES A FULL-WIDTH SVG WORDMARK, A GRID-BASED NAVIGATION BAR, AND A CLEAN GALLERY LAYOUT. THE TEMPLATE USES TWO FONTS — INTER (SANS) AND NEWSREADER (SERIF) — AND A MUTED, WARM PALETTE. THREE PAGES ARE CLONED: HOME (GALLERY LISTING), GALLERY DETAIL, AND SYSTEM OVERVIEW.

## STYLE

- PALETTE: BASE-50 (#F7F7F7), BASE-900 (#101010 APPROX), WHITE (OKLCH 95.81% 0 0), GALLERY-1 (#DEDAD0), GALLERY-2 (#3F7996), GALLERY-3 (#DCC679), GALLERY-4 (#D2CDC7), GALLERY-5 (#B0875D)
- FONTS: INTER (SANS-SERIF, FROM RSMS.ME/INTER), NEWSREADER (SERIF, FROM GOOGLE FONTS)
- TYPE SCALE: XS=0.75REM, SM=0.875REM, BASE=1REM, LG=1.125REM, XL=1.25REM, 2XL=1.5REM
- RADII: SHARP/NONE (0PX THROUGHOUT)
- SPACING: 4PX BASE UNIT (TAILWIND SCALE), 32PX (PX-8) HORIZONTAL PADDING
- ANIMATIONS: TRANSITION-COLORS ON HOVER LINKS (150MS, EASE-IN-OUT), NO ENTRANCE ANIMATIONS

## LAYOUT & STRUCTURE

### PAGE 1: HOME (index.html)
- LARGE SVG WORDMARK "SEMPLICE" SPANNING FULL WIDTH AT TOP (ABOVE HEADER)
- HEADER: 4-COLUMN GRID — LOGO SVG (COL 1), TAGLINE H1 IN NEWSREADER SERIF (COL 2-3), NAV LINKS (COL 4)
- MAIN: SINGLE IMAGE IN A FIGURE ELEMENT, FULL-WIDTH, LINKED TO GALLERY
- FOOTER: SAME LARGE "SEMPLICE" SVG WORDMARK + EXHIBITION DETAILS IN SERIF UPPERCASE

### PAGE 2: GALLERY DETAIL (gallery/posts/1/index.html)
- NO HEADER/FOOTER NAV (gallery-specific layout)
- HERO: BACK LINK, TITLE AND CATEGORY IN SERIF UPPERCASE, DESCRIPTION
- GRID OF 5 IMAGES: 1 LARGE (COL-SPAN-3 ROW-SPAN-2) + 4 SMALLER IN 6-COLUMN GRID
- BACKGROUND: GALLERY-1 (#DEDAD0)

### PAGE 3: SYSTEM OVERVIEW (system/overview/index.html)
- SAME HEADER AS HOME
- OVERVIEW HEADING + TWO GROUPS: "STATIC" AND "CONTENT COLLECTIONS"
- LISTS OF INTERNAL LINKS ORGANIZED IN 4-COLUMN GRID
- SAME FOOTER AS HOME

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/semplice).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
