---
name: lexington-molle
description: |
  Mølle is a pixel-faithful clone of the premium Lexington Themes template. Its Scandinavian visual system combines a strict five-column grid, dashed borders, uppercase Inter typography, a monochrome palette, and a focused purple accent.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "mølle: scandinavian prefab home website template"
  - "lle"
  - "scandinavian"
  - "prefab"
  - "home"
  - "website"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/molle"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Mølle: Scandinavian Prefab Home Website Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Mølle: Scandinavian Prefab Home Website Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Mølle is a pixel-faithful clone of the premium Lexington Themes template. Its Scandinavian visual system combines a strict five-column grid, dashed borders, uppercase Inter typography, a monochrome palette, and a focused purple accent.

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
<artifact identifier="lexington-molle" type="text/html" title="Mølle: Scandinavian Prefab Home Website Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE MØLLE TEMPLATE BY LEXINGTON THEMES. EVERY PAGE, EVERY SECTION, HOVER STATES, SLIDER INTERACTIONS, AND THE FULL SCANDINAVIAN MINIMALIST AESTHETIC ARE REPRODUCED AS PLAIN HTML + CSS + VANILLA JS — NO BUILD STEP REQUIRED.
>
> REFERENCE: `https://lexingtonthemes.com/viewports/molle`

## SUMMARY

MØLLE IS A SCANDINAVIAN-INSPIRED PREFAB HOME COMPANY TEMPLATE BUILT WITH ASTRO AND TAILWIND CSS. THE DESIGN IS CHARACTERISED BY STRICT FIVE-COLUMN GRID LAYOUTS, DASHED BORDERS AS DECORATIVE ELEMENTS, UPPERCASE TYPOGRAPHY, AND A MINIMAL BLACK-AND-WHITE PALETTE WITH A SINGLE PURPLE ACCENT COLOUR. THE CLONE REPRODUCES ALL 13 PAGES OF THE LIVE PREVIEW AT `HTTPS://MOLLE-ASTRO.PAGES.DEV/` AS STATIC HTML FILES WITH ALL ASSETS VENDORED LOCALLY.

## STYLE

### PALETTE
- `--COLOR-BASE-50: #F0F0F0` — LIGHTEST GREY
- `--COLOR-BASE-100: #E1E1E1` — PAGE BACKGROUND
- `--COLOR-BASE-200: #C7C7C7`
- `--COLOR-BASE-300: #B0B0B0`
- `--COLOR-BASE-400: #969696`
- `--COLOR-BASE-500: #7D7D7D` — PROGRESS BARS, SECONDARY TEXT
- `--COLOR-BASE-600: #636363` — BODY COPY
- `--COLOR-BASE-700: #4A4A4A`
- `--COLOR-BASE-800: #333333`
- `--COLOR-BASE-900: #1A1A1A` — HEADINGS, BUTTONS
- `--COLOR-BASE-950: #0D0D0D`
- `--COLOR-ACCENT-500: OKLCH(45.71% .31 264.13)` — PURPLE CTA BUTTON
- `--COLOR-ACCENT-600: OKLCH(38.85% .26 264.15)` — PURPLE HOVER

### FONTS
- BODY: INTER (VIA RSMS.ME/INTER)
- DISPLAY HEADINGS: INTERDISPLAY (VIA RSMS.ME/INTER)

### TYPE SCALE (TAILWIND DEFAULTS)
- XS: 0.75REM · SM: 0.875REM · BASE: 1REM · LG: 1.125REM · XL: 1.25REM
- 2XL: 1.5REM · 3XL: 1.875REM · 4XL: 2.25REM · 5XL: 3REM · 6XL: 3.75REM · 7XL: 4.5REM · 8XL: 6REM

### RADII / SHADOWS / EASINGS
- NO BORDER RADIUS ON MOST ELEMENTS (SHARP CORNERS)
- TRANSITION: 300MS EASE (ALL INTERACTIVE ELEMENTS)
- DASHED BORDERS (`BORDER-DASHED BORDER-BLACK/15`) USED THROUGHOUT AS DECORATION

### LAYOUT
- MAX-WIDTH: `2XL:MAX-W-[120REM]` CENTRED
- GRID: 5 COLUMNS (`GRID-COLS-5`) WITH `P-4` PADDING IN EACH CELL
- FIXED BACKGROUND GRID LINES (5 COLUMNS, DASHED, `BORDER-X`) VISIBLE ON DESKTOP

## LAYOUT & STRUCTURE

### PAGES DISCOVERED AND CLONED

1. **INDEX.HTML** — HOME PAGE
   - HERO: "CHOOSE YOUR MØLLE HOME" FULL-WIDTH HEADLINE, HERO IMAGE, CTA "SEE OUR CATALOGUE"
   - ABOUT SECTION: TEXT + LARGE IMAGE + STATS (95%, 72H, 1K, 87%, 99.6%)
   - WHY MØLLE: 5 FEATURE CARDS (PRECISION-BUILT, DELIVERED READY, TIMELESS DESIGN, NO FLUFF, START TO FINISH)
   - MODELS CAROUSEL: KEEN SLIDER WITH 8 PRODUCT CARDS (HALO X, LUMA VISTA, NOOK 360, RIDGE A1, RIDGEHAUS, SOLIS V4, SUMMIT HAUS, VERDANT)
   - PROCESS GANTT: 8 STEP GANTT-CHART TIMELINE
   - CUSTOMER GALLERY: 5 PHOTO GRID
   - ARTICLES: 3 LATEST BLOG POSTS
   - FOOTER: MØLLE WORDMARK SVG + NAVIGATION COLUMNS

2. **HOMES.HTML** — PRODUCT LISTING
   - ALL 8 CABIN MODELS IN A GRID (NAME, CATEGORY, PRICE, TAGS)

3. **PROCESS.HTML** — HOW IT WORKS
   - DETAILED GANTT-CHART TIMELINE OF ALL BUILD STEPS

4. **ABOUT.HTML** — ABOUT
   - MISSION STATEMENT + TEAM (KALLE BERGSTRÖM, JONAS MIKKELSEN) + STORY

5. **CUSTOMERS.HTML** — CUSTOMER GALLERY
   - PHOTO GRID OF CUSTOMER INSTALLATIONS

6. **CONTACT.HTML** — CONTACT FORM
   - CONTACT FORM WITH NAME, EMAIL, MESSAGE FIELDS

7. **SIGN-IN.HTML** — SIGN IN PAGE
   - EMAIL + PASSWORD SIGN-IN FORM

8. **SIGN-UP.HTML** — SIGN UP PAGE
   - REGISTRATION FORM

9. **BLOG.HTML** — BLOG LISTING
   - 6 BLOG ARTICLES IN LIST FORMAT

10. **HELPCENTER.HTML** — HELP CENTER HOME
    - FAQ / HELP CATEGORIES

11. **SYSTEM-OVERVIEW.HTML** — DESIGN SYSTEM OVERVIEW
    - TYPOGRAPHY, COLOUR, AND COMPONENT SHOWCASE

12. **PRODUCT.HTML** — PRODUCT DETAIL (REPRESENTATIVE: HALO X)
    - PRODUCT IMAGES, SPECS, FLOOR PLAN, INQUIRY FORM

13. **BLOG-POST.HTML** — BLOG POST (REPRESENTATIVE: LIVING LIGHTLY)
    - FULL ARTICLE TEXT + METADATA

### SHARED CHROME
- **NAVIGATION**: FIXED TOP BAR WITH MØLLE GRID SVG LOGO + NAV LINKS (OVERVIEW, HOMES, HOW IT WORKS, ABOUT, CUSTOMERS, CONTACT, SIGN IN). MOBILE HAMBURGER MENU WITH FULL-SCREEN OVERLAY ANIMATION.
- **SEARCH BUTTON**: FIXED BOTTOM-RIGHT BUTTON THAT OPENS A SEARCH MODAL WITH FUSE.JS FULL-TEXT SEARCH ACROSS BLOG POSTS AND PRODUCTS.
- **FOOTER**: LARGE "MØLLE" WORDMARK SVG, COPYRIGHT, NAVIGATION AND RESOURCES COLUMN LINKS.
- **BACKGROUND GRID**: FIXED 5-COLUMN DASHED VERTICAL LINES (DESKTOP ONLY).

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/molle).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
