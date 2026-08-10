---
name: lexington-riflesso
description: |
  Riflesso is a static reproduction of the current Lexington Themes photography portfolio. It combines Hanken Grotesk typography, a full-screen navigation overlay, gallery and magazine grids, photographer profiles, product pages, search, and minimal editorial layouts.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "riflesso photography template"
  - "riflesso"
  - "photography"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/riflesso"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "site-theme"
  scenario: "marketing"
  example_prompt: "Build Riflesso Photography Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Riflesso Photography Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Riflesso is a static reproduction of the current Lexington Themes photography portfolio. It combines Hanken Grotesk typography, a full-screen navigation overlay, gallery and magazine grids, photographer profiles, product pages, search, and minimal editorial layouts.

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
<artifact identifier="lexington-riflesso" type="text/html" title="Riflesso Photography Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> THIS IS A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE RIFLESSO PHOTOGRAPHY TEMPLATE BY LEXINGTON THEMES — EVERY PAGE, SECTION, HOVER STATE, AND INTERACTION CLONED AS PLAIN HTML + CSS + VANILLA JS, NO BUILD STEP REQUIRED.
>
> REFERENCE: `https://lexingtonthemes.com/viewports/riflesso`

## SUMMARY

RIFLESSO IS A MINIMAL PHOTOGRAPHY PORTFOLIO AND MAGAZINE TEMPLATE BUILT FOR PHOTOGRAPHERS AND CREATIVE PROFESSIONALS. IT FEATURES A CLEAN, TYPOGRAPHY-DRIVEN DESIGN WITH A WHITE BACKGROUND, HANKEN GROTESK SANS-SERIF FONT, AND A FULL-OVERLAY NAVIGATION MENU. THE TEMPLATE INCLUDES PAGES FOR A GALLERY HOMEPAGE, MAGAZINE/BLOG LISTING, STORE PRODUCT LISTING, AND INDIVIDUAL DETAIL PAGES FOR GALLERY POSTS, BLOG ARTICLES, AND STORE PRODUCTS. A FUSE.JS-POWERED SEARCH MODAL IS BUILT IN.

## STYLE

### PALETTE
- BACKGROUND: #FFFFFF (WHITE)
- SURFACE: BASE-100 = OKLCH(98.5% .002 247.839) — VERY LIGHT GRAY
- TEXT PRIMARY: BASE-900 = OKLCH(21% .034 264.665) — NEAR BLACK
- TEXT SECONDARY: BASE-600 = OKLCH(44.6% .03 256.802) — MEDIUM GRAY
- TEXT MUTED: BASE-500 = OKLCH(55.1% .027 264.364) — LIGHT GRAY
- BORDER: BASE-200 = OKLCH(92.8% .006 264.531) — VERY LIGHT GRAY
- ACCENT (BUTTON): BLACK #000000 → HOVER: BASE-700 = OKLCH(37.3% .034 259.733)
- ACCENT COLOR SCALE: OKLCH PURPLE/INDIGO (ACCENT-50 THROUGH ACCENT-950)

### FONTS
- PRIMARY: "HANKEN GROTESK", SANS-SERIF (GOOGLE FONTS — VARIABLE WEIGHT 100..900, ITALIC)
- FALLBACK: TIMES (SERIF, USED AS SECONDARY FONT REFERENCE)
- TRACKING-TIGHT: -.025EM
- TRACKING-TIGHTER: -.05EM

### TYPE SCALE
- XS: 0.75REM / TEXT-XS
- SM: 0.875REM / TEXT-SM
- BASE: 1REM
- LG: 1.125REM
- XL: 1.25REM
- 5XL: 3REM (LARGE MENU ITEMS)
- 7XL: 4.5REM (LARGE MENU ITEMS ON LG)

### RADII
- ROUNDED-FULL: PILL SHAPE (USED ON BUY BUTTON)
- ROUNDED-LG: 0.5REM
- NO RADIUS ON CARDS/IMAGES (SHARP CORNERS)

### ANIMATION EASINGS
- DEFAULT: CUBIC-BEZIER(.4, 0, .2, 1) — EASE-IN-OUT
- EASE-OUT: CUBIC-BEZIER(0, 0, .2, 1)
- DURATION-300: 300MS TRANSITIONS ON HOVER STATES
- MENU OPEN: OPACITY FADE 300MS EASE-IN-OUT
- MENU NAV ITEMS: STAGGER 0.1S DELAY PER ITEM, TRANSLATE-Y 20PX → 0, OPACITY 0 → 1

## LAYOUT & STRUCTURE

### PAGES DISCOVERED AND CLONED

#### 1. HOME (index.html)
- HEADER: STICKY TOP BAR WITH LOGO ("RIFLESSO — PHOTOGRAPHY"), "BUY RIFLESSO" LINK, SEARCH ICON BUTTON, "MENU" TOGGLE BUTTON
- HERO: LARGE VIDEO ELEMENT (PHOTOSHOOT.MP4, AUTOPLAY MUTED LOOP) IN BASE-100 PADDED CONTAINER (16:7 ASPECT)
- GALLERY GRID: RESPONSIVE GRID (1 → 2 → 4 → 5 COLS) OF 10 GALLERY ITEMS, EACH WITH THUMBNAIL IMAGE + TITLE TEXT BELOW
- FULL-OVERLAY MENU: FIXED FULL-SCREEN WHITE OVERLAY WITH LARGE UPPERCASE NAV LINKS (BLOG, STORE, LINKS, BUTTONS, COLORS, OVERVIEW, TYPOGRAPHY), ADDRESS FOOTER
- SEARCH MODAL: FULL-SCREEN BACKDROP BLUR OVERLAY WITH SEARCH INPUT AND FUSE.JS RESULTS
- FOOTER: SIMPLE COPYRIGHT TEXT

#### 2. BLOG (blog.html)
- HEADER: SAME AS HOME
- MAIN: "MAGAZINE" HEADING, RESPONSIVE GRID (1 → 2 → 4 → 5 COLS) OF 10 BLOG ARTICLES WITH THUMBNAIL + TITLE
- FOOTER: SAME

#### 3. STORE (store.html)
- HEADER: SAME AS HOME
- MAIN: "DIGITAL PRODUCTS FOR YOUR BUSINESS" HEADING, RESPONSIVE GRID (1 → 2 → 4 → 5 COLS) OF 6 PRODUCTS WITH THUMBNAIL + NAME + PRICE
- FOOTER: SAME

#### 4. GALLERY POST DETAIL (gallery-post.html)
- HEADER: SAME AS HOME
- MAIN: TWO-COLUMN LAYOUT (LEFT: STICKY CATEGORY/TITLE/DESCRIPTION, RIGHT: MULTIPLE STACKED IMAGES)
- FOOTER: SAME

#### 5. BLOG POST DETAIL (blog-post.html)
- HEADER: SAME AS HOME
- MAIN: TAG + TITLE + AUTHOR/DATE HEADER ROW; LARGE HERO IMAGE; TWO-COL LAYOUT (ITALIC DESCRIPTION + PROSE CONTENT); RELATED POSTS GRID
- FOOTER: SAME

#### 6. STORE PRODUCT DETAIL (store-product.html)
- HEADER: SAME AS HOME
- MAIN: PRODUCT NAME + DESCRIPTION + BUY BUTTON; SPECS/INCLUDES/LICENSE GRID; PRODUCT IMAGE GRID (1 → 2 → 4 COLS); FAQ ACCORDION WITH NATIVE HTML DETAILS/SUMMARY ELEMENTS
- FOOTER: SAME

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/riflesso).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
