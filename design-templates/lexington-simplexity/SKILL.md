---
name: lexington-simplexity
description: |
  Simplexity is a static reproduction of a focused personal portfolio and publishing website. The project contains all 43 valid HTML routes from the current reference, including articles and tag archives, projects, store content, authentication forms, legal pages, and system pages.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "simplexity portfolio and blog template"
  - "simplexity"
  - "portfolio"
  - "blog"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/simplexity"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "site-theme"
  scenario: "marketing"
  example_prompt: "Build Simplexity Portfolio and Blog Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Simplexity Portfolio and Blog Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Simplexity is a static reproduction of a focused personal portfolio and publishing website. The project contains all 43 valid HTML routes from the current reference, including articles and tag archives, projects, store content, authentication forms, legal pages, and system pages.

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
<artifact identifier="lexington-simplexity" type="text/html" title="Simplexity Portfolio and Blog Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE SIMPLEXITY TEMPLATE BY LEXINGTON THEMES, REBUILT AS PLAIN HTML + CSS + VANILLA JS. REFERENCE: `https://lexingtonthemes.com/viewports/simplexity`

## SUMMARY

SIMPLEXITY IS A MINIMAL, CONTENT-FOCUSED PERSONAL PORTFOLIO / BLOG TEMPLATE BUILT WITH ASTRO AND TAILWIND CSS. IT IS A CLEAN, TYPOGRAPHIC DESIGN WITH A NARROW CENTERED COLUMN LAYOUT (MAX-WIDTH ~42REM / 672PX), INTER VARIABLE FONT, VERY SUBTLE DIVIDERS, AND A STRONG LIGHT/DARK MODE TOGGLE. IT TARGETS DEVELOPERS AND DESIGNERS WHO WANT A SIMPLE PERSONAL SITE WITH BLOG, PROJECTS, AND STORE SECTIONS.

## STYLE

### PALETTE

- LIGHT MODE BACKGROUND: `#FAFAFA` (--color-white)
- DARK MODE BACKGROUND: `oklch(0.13 0.028 261.692)` (base-900)
- PRIMARY TEXT (LIGHT): `#12161D` (--color-black)
- PRIMARY TEXT (DARK): `#FAFAFA`
- MUTED TEXT: `oklch(0.552 0.016 285.938)` (base-500)
- MUTED TEXT DARK: `oklch(0.442 0.016 285.938)` (base-400 in dark)
- BORDER: `rgba(0,0,0,0.10)` LIGHT / `rgba(255,255,255,0.10)` DARK
- BUTTON BG LIGHT: `oklch(0.967 0.001 286.375)` (base-100)
- BUTTON HOVER LIGHT: `oklch(0.92 0.004 286.32)` (base-200)
- BUTTON BG DARK: `oklch(0.21 0.034 264.665)` (base-800)
- BUTTON HOVER DARK: `oklch(0.269 0.044 264.364)` (base-700)

### FONTS

- FONT FAMILY: `InterVariable, sans-serif` (loaded from rsms.me/inter)
- FONT FEATURE SETTINGS: `cv02`, `cv03`, `cv04`, `cv11` (Inter alternate digits and forms)
- BODY FONT SIZE: 1REM / LINE-HEIGHT 1.5
- H1/H4 HEADING: `text-base` (1REM), `font-medium`
- SMALL/META TEXT: `text-xs` (0.75REM), `text-sm` (0.875REM)

### TYPE SCALE

- XS: 0.75REM
- SM: 0.875REM
- BASE: 1REM
- LG: 1.125REM

### RADII

- BUTTONS/INPUTS: `rounded-lg` (0.5REM)
- CARDS/IMAGES: `rounded-xl` (0.75REM), `rounded` (0.25REM) FOR INNER IMAGES

### ANIMATION EASINGS

- HOVER TRANSITIONS: `duration-200` (200MS), DEFAULT EASE
- NO ENTRANCE ANIMATIONS — CONTENT IS STATIC ON LOAD
- SEARCH MODAL: `transition-opacity` BACKDROP, SLIDE-IN PANEL

### LAYOUT

- CENTERED NARROW COLUMN: `max-w-2xl` (42REM) WITH `2xl:max-w-3xl` (48REM) BREAKPOINT
- HORIZONTAL PADDING: `px-8` (2REM)
- PAGE TOP PADDING: `pt-14` (3.5REM) FOR HEADER
- SECTIONS: `py-12` (3REM) STANDARD, `xl:py-54` ON HERO

## LAYOUT & STRUCTURE

### SHARED CHROME

**HEADER:**
- NARROW CENTERED CONTAINER (MAX-W-2XL)
- LEFT: SVG LOGO (SIMPLEXITY ICON — THREE OVERLAPPING CIRCLES)
- RIGHT: SEARCH BUTTON (FIXED BOTTOM-LEFT, CMD+K SHORTCUT), DARK MODE TOGGLE

**FOOTER:**
- 3-COLUMN GRID (1 COL ON MOBILE): NAV LINKS (BLOG, STORE, PROJECTS, PRICING) + SYSTEM LINKS (OVERVIEW, COLORS, BUTTONS, TYPOGRAPHY)

**SEARCH MODAL:**
- FIXED OVERLAY, FUSE.JS POWERED SEARCH ACROSS POSTS/PROJECTS/STORE
- INPUT WITH LIVE RESULTS DROPDOWN

### PAGES

1. **HOME (`index.html`)**
   - HERO SECTION: LARGE H1 "PRODUCT DESIGNER CREATING THOUGHTFUL, INTUITIVE INTERFACES"
   - INTRO SECTION WITH BORDER-TOP DIVIDER, PARAGRAPH BIO TEXT
   - LATEST BLOG POSTS SECTION: 2 MOST RECENT POSTS AS SIMPLE LIST WITH DATE/READ-TIME + TITLE

2. **BLOG (`blog/index.html`)**
   - HERO: "ME AND MY THOUGHTS"
   - TAG FILTER PILLS: 3D, DESIGN, DEVELOPMENT, GROWTH, GUIDES, ILLUSTRATION, PERFORMANCE, UIUX
   - POST LIST: 10 POSTS, EACH WITH THUMBNAIL (SIZE-16 TO SIZE-28), DATE, TITLE, EXCERPT

3. **STORE (`store/index.html`)**
   - HERO: "THE STORE"
   - SUBTEXT: "LOOK AROUND AND FIND OUT"
   - 2 PRODUCT CARDS (STUDIO MAX, CARBON): IMAGE CARD WITH DARK/LIGHT BG, TITLE, DESCRIPTION, "→ READ MORE" LINK

4. **PROJECTS (`projects/index.html`)**
   - HERO: "SELECTED PROJECTS"
   - BIO PARAGRAPH ABOUT PROJECT EXPERIENCE
   - 2 PROJECT ENTRIES WITH LARGE IMAGES, 3-COLUMN GRID INFO (TITLE | DESCRIPTION + LINK)

5. **SYSTEM OVERVIEW (`system/overview.html`)**
   - HERO: "A QUICK OVERVIEW OF ALL PAGES INCLUDED ON SIMPLEXITY"
   - OVERVIEW GRID: MAIN PAGES, FORMS, SYSTEM, RESOURCES (4-COLUMN GRID OF LINKS)
   - CONTENT COLLECTIONS GRID: BLOG PAGES, PROJECTS, STORE ENTRIES

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/simplexity).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
