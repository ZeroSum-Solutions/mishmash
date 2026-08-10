---
name: lexington-sandstone
description: |
  Sandstone is a static reproduction of a contemporary interior design studio website. The project contains all 50 HTML routes from the current reference, including projects, services, articles and tag archives, team profiles, legal pages, and system pages.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "sandstone interior design template"
  - "sandstone"
  - "interior"
  - "design"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/sandstone"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Sandstone Interior Design Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Sandstone Interior Design Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Sandstone is a static reproduction of a contemporary interior design studio website. The project contains all 50 HTML routes from the current reference, including projects, services, articles and tag archives, team profiles, legal pages, and system pages.

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
<artifact identifier="lexington-sandstone" type="text/html" title="Sandstone Interior Design Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE SANDSTONE TEMPLATE BY LEXINGTON THEMES — A MINIMALIST INTERIOR DESIGN STUDIO SITE WITH FULL-VIEWPORT VIDEO HEROES, MARQUEE TICKER, ANIMATED HOVER LINKS, KEEN SLIDER TESTIMONIALS, AND A DARK GRAYSCALE PALETTE USING OKLCH COLOR TOKENS.
> REFERENCE: `https://lexingtonthemes.com/viewports/sandstone`

## SUMMARY

SANDSTONE IS A PREMIUM ASTRO-BASED INTERIOR DESIGN STUDIO TEMPLATE BY LEXINGTON THEMES. THE CLONE REPRODUCES ALL 13 PAGES AS PLAIN HTML/CSS/JS WITH ASSETS VENDORED LOCALLY. THE TEMPLATE FEATURES A NEUTRAL GRAYSCALE OKLCH PALETTE, INTER VARIABLE FONT, FLOATING PILL NAV WITH ANIMATED MOBILE MENU, FULL-VIEWPORT VIDEO/IMAGE HEROES, MARQUEE TICKER, KEEN SLIDER TESTIMONIALS CAROUSEL, STACKED STICKY SERVICE ROWS, SCROLL-REVEAL ANIMATIONS, AND ANIMATED "SLIDE-UP" HOVER LINKS THROUGHOUT.

## STYLE

- **PALETTE**: OKLCH GRAYSCALE — BASE-50 (98.5%), BASE-100 (97%), BASE-200 (92.2%), BASE-300 (87%), BASE-400 (70.8%), BASE-500 (55.6%), BASE-600 (43.9%), BASE-700 (37.1%), BASE-800 (26.9%), BASE-900 (20.5%), BASE-950 (14.5%). PURE BLACK (#000) AND WHITE (#FFF) AS ACCENTS.
- **FONTS**: INTER VARIABLE (PRIMARY, ALL TEXT), TIMES (DISPLAY ITALIC ACCENTS)
- **TYPE SCALE**: XS (0.75REM), SM (0.875REM), BASE (1REM), LG (1.125REM), XL (1.25REM), 2XL (1.5REM), 3XL (1.875REM), 4XL (2.25REM), 5XL (3REM), 6XL (3.75REM), 7XL (4.5REM)
- **RADII**: XL (0.75REM), 2XL (1REM), 3XL (1.5REM) — CARDS AND HERO CONTAINERS USE ROUNDED-3XL
- **ANIMATION EASINGS**: CUBIC-BEZIER(0.22,1,0.36,1) — MOBILE MENU; CUBIC-BEZIER(0,0,0.2,1) — EASE-OUT; 0.5S DURATION FOR HOVER LINK SLIDE-UP; MARQUEE 92S LINEAR INFINITE
- **SPACING**: TAILWIND V4 SPACING SCALE (0.25REM BASE)
- **SHADOWS**: NONE (FLAT DESIGN)
- **THEME**: LIGHT BY DEFAULT (BASE-100 BACKGROUND, BASE-900 TEXT). DARK MODE TOKENS DEFINED VIA :ROOT.DARK WITH INVERTED SCALE.

## LAYOUT & STRUCTURE

### PAGES DISCOVERED AND CLONED

1. **HOME** (`index.html`) — HERO SECTION WITH FULL-VIEWPORT VIDEO + MARQUEE TICKER + "SNDS" SVG LOGO OVERLAY; ABOUT PARAGRAPH (LARGE TEXT); LATEST WORKS (PROJECT CARDS WITH KEEN SLIDER); STATS SECTION (500+ PROJECTS, 15 YEARS, ETC.); PROCESS STEPS (01-04, STICKY SCROLL); TESTIMONIALS (KEEN SLIDER CAROUSEL); JOURNAL/BLOG PREVIEW (3 ARTICLES); FOOTER (SERVICES INTERACTIVE PANEL WITH IMAGE SWITCHER)
2. **PROJECTS** (`projects/index.html`) — PAGE HEADER + GRID OF PROJECT CARDS (4 PROJECTS WITH IMAGES)
3. **PROJECT DETAIL** (`projects/1.html`, `2.html`, `3.html`, `4.html`) — HERO IMAGE, PROJECT METADATA, BODY TEXT, IMAGE GALLERY
4. **SERVICES** (`services/index.html`) — INTRO HEADLINE; STICKY LEFT SIDEBAR ("THE PROCESS"); ACCORDION-STYLE STACKED SERVICE ROWS WITH IMAGES (ECO-MATERIALS, ENERGY-EFFICIENT, ENVIRONMENTAL IMPACT)
5. **STUDIO** (`studio.html`) — INTRO HEADLINE; MULTI-COLUMN ABOUT TEXT; FULL-VIEWPORT VIDEO SECTION; TEAM SECTION WITH PHOTOS
6. **CONTACT** (`contact.html`) — FULL-VIEWPORT VIDEO HERO WITH OVERLAID CONTACT CARD (EMAIL, PHONE, SOCIAL MEDIA)
7. **BLOG** (`blog/index.html`) — HEADLINE + 3-COLUMN ARTICLE GRID WITH COVER IMAGES, DATES, TITLES, DESCRIPTIONS, HOVER LINKS
8. **BLOG POST** (`blog/posts/1.html`, `2.html`, `4.html`) — ARTICLE HEADER, COVER IMAGE, PROSE BODY TEXT
9. **SYSTEM OVERVIEW** (`system/overview.html`) — DESIGN SYSTEM REFERENCE PAGE: PAGES, SYSTEM LINKS, CONTENT COLLECTIONS LISTED

### SHARED CHROME

- **HEADER/NAV**: FIXED, TOP-8, FLOATING PILL (BG-WHITE, ROUNDED-XL, P-4) MAX-W-SM. LOGO "SANDSTONE&CO®" LEFT. HAMBURGER (9-DOT GRID ICON) RIGHT. MOBILE MENU BELOW: 2-COLUMN GRID (NAVIGATION + CONNECT LINKS) + CONTACT ROW. OPENS VIA HEIGHT ANIMATION + OPACITY TRANSITION.
- **FOOTER**: FULL-VIEWPORT CONTAINER WITH BACKGROUND IMAGE SWITCHER; OVERLAID SERVICES PANEL RIGHT SIDE; SERVICE BUTTONS UPDATE IMAGE AND DESCRIPTION ON CLICK.
- **SEARCH BUTTON**: FIXED BOTTOM-RIGHT CIRCLE BUTTON → OPENS FULL-SCREEN SEARCH MODAL WITH FUSE.JS.
- **BACK-TO-TOP**: FIXED BOTTOM-RIGHT (ABOVE SEARCH) ON SOME PAGES.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/sandstone).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
