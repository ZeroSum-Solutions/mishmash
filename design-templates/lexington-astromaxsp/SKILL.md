---
name: lexington-astromaxsp
description: |
  A pixel-faithful clone of the AstroMax SP premium template by Lexington Themes, a bold, dark-themed creative agency and portfolio website. The clone reproduces all 21 pages including the home page with a full-width hero, continuous marquee ticker, testimonials grid, work carousel (Keen Slider), services grid, and a large CTA morph button; plus work case studies, a blog with 6 posts, a product store with 4 items, team profiles, a system overview page, and legal pages. Every section uses the Geist font family, a warm orange/amber accent (`oklch(62.2% .21 32.02)`), near-black backgrounds, and white/20 opacity grid border lines. Interactive features include a FuseJS-powered site-wide search modal, mobile hamburger menu, and Keen Slider work carousel with prev/next controls. Plain HTML/CSS/JS with no build step required.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "astromax sp: creative agency portfolio website clone"
  - "astromax"
  - "creative"
  - "agency"
  - "portfolio"
  - "website"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/astromaxsp"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build AstroMax SP: Creative Agency Portfolio Website Clone as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# AstroMax SP: Creative Agency Portfolio Website Clone

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A pixel-faithful clone of the AstroMax SP premium template by Lexington Themes, a bold, dark-themed creative agency and portfolio website. The clone reproduces all 21 pages including the home page with a full-width hero, continuous marquee ticker, testimonials grid, work carousel (Keen Slider), services grid, and a large CTA morph button; plus work case studies, a blog with 6 posts, a product store with 4 items, team profiles, a system overview page, and legal pages. Every section uses the Geist font family, a warm orange/amber accent (`oklch(62.2% .21 32.02)`), near-black backgrounds, and white/20 opacity grid border lines. Interactive features include a FuseJS-powered site-wide search modal, mobile hamburger menu, and Keen Slider work carousel with prev/next controls. Plain HTML/CSS/JS with no build step required.

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
<artifact identifier="lexington-astromaxsp" type="text/html" title="AstroMax SP: Creative Agency Portfolio Website Clone">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE ASTROMAX SP TEMPLATE , A DARK-THEMED CREATIVE AGENCY/PORTFOLIO WEBSITE BUILT WITH PLAIN HTML, CSS, AND VANILLA JS. EVERY PAGE, SECTION, HOVER STATE, AND INTERACTION IS REPRODUCED SAME-TO-SAME.
>
> REFERENCE: `https://lexingtonthemes.com/viewports/astromaxsp`

## SUMMARY

ASTROMAX SP IS A PREMIUM CREATIVE AGENCY PORTFOLIO TEMPLATE FROM LEXINGTON THEMES. IT FEATURES A BOLD, DARK-THEMED DESIGN WITH UPPERCASE TYPOGRAPHY, GRID-BASED BORDERS (WHITE/20 OPACITY VERTICAL/HORIZONTAL LINES), A WARM ORANGE/AMBER ACCENT COLOR, AND CLEAN GEOMETRIC LAYOUTS. THE SITE IS FOR A FREELANCE WEB DESIGNER/DEVELOPER AND INCLUDES CASE STUDIES, A BLOG, A STORE, AND A TEAM PAGE. KEY INTERACTIVE FEATURES INCLUDE A KEEN-SLIDER WORK CAROUSEL, A FUSEJS-POWERED SEARCH MODAL, A MARQUEE/TICKER STRIP, STICKY HEADER, AND MOBILE HAMBURGER MENU.

## STYLE

### PALETTE
- BACKGROUND: `oklch(23.5% 0 0)` (base-950, near-black)
- TEXT PRIMARY: `#e7e7d8` (--color-white, off-white/cream)
- TEXT SECONDARY: `oklch(54.2% .024 101.28)` (secondary-600, warm gray)
- ACCENT: `oklch(62.2% .21 32.02)` (accent-500, warm orange/amber)
- ACCENT HOVER: `oklch(70.1% .174 27.73)` (accent-400)
- BORDERS: `rgba(255,255,255,0.2)` (white/20)
- GRID BG: repeating-linear-gradient dots/lines pattern in light gray

### FONTS
- FONT FAMILY: `"Geist", sans-serif` (from Google Fonts , Geist + Geist Mono)
- WEIGHTS USED: 400 (normal), 500 (medium), 600 (semibold), 700 (bold), 900 (black)

### TYPE SCALE
- TEXT-XS: 0.75rem | TEXT-SM: 0.875rem | TEXT-BASE: 1rem
- TEXT-LG: 1.125rem | TEXT-XL: 1.25rem | TEXT-2XL: 1.5rem
- TEXT-3XL: 1.875rem | TEXT-4XL: 2.25rem | TEXT-5XL: 3rem
- TEXT-6XL: 3.75rem | TEXT-7XL: 4.5rem | TEXT-8XL: 6rem | TEXT-9XL: 8rem

### RADII
- RADIUS-MD: 0.375rem | RADIUS-XL: 0.75rem
- BUTTONS: ROUNDED-FULL (9999px)

### ANIMATION EASINGS
- EASE-IN-OUT: cubic-bezier(0.4, 0, 0.2, 1) , default transition
- DURATION: 200ms (colors), 500ms (transforms/bg)
- MARQUEE: infinite linear scroll animation
- KEEN-SLIDER: CAROUSEL SLIDE WITH PREV/NEXT BUTTONS

### INTERACTIONS
- STICKY HEADER: FIXED TOP, DARK BG, BORDER-B WHITE/20
- MOBILE MENU: HAMBURGER TOGGLE , SHOWS FULL-SCREEN OVERLAY WITH LINKS
- WORK CAROUSEL: KEEN-SLIDER WITH PREV/NEXT BUTTONS
- SEARCH: FLOATING BUTTON (BOTTOM-RIGHT) → MODAL WITH FUSEJS SEARCH
- HOVER: NAV LINKS → accent-500; CARDS → ELEVATED; CTA BUTTON → ROUNDED-NONE MORPH ON HOVER
- MARQUEE STRIP: CONTINUOUS HORIZONTAL SCROLL, DUAL COPY FOR SEAMLESS LOOP

## LAYOUT & STRUCTURE

### PAGE LIST (21 PAGES TOTAL)

1. **HOME** (`index.html`)
   - STICKY HEADER WITH NAV + MOBILE MENU
   - HERO: FULL-WIDTH BIG HEADLINE (8XL) WITH BG-GRID PATTERN
   - MARQUEE/TICKER STRIP: "SPOTS OPEN · NOW BOOKING · LIMITED SPACE..."
   - TESTIMONIALS: 4-COLUMN GRID OF QUOTES FROM CLIENTS
   - WORK CAROUSEL: KEEN-SLIDER WITH 7 WORK IMAGES + PREV/NEXT BUTTONS
   - ABOUT: FULL-WIDTH TEXT BLOCK
   - SERVICES: 4-COLUMN GRID (DESIGN IN FIGMA, REDESIGN EXISTING, CONVERT TO TAILWIND, FULL DEVELOPMENT)
   - CTA: FULL-WIDTH "GET A QUOTE" ANCHOR-LINK BUTTON (PILL → SQUARE MORPH ON HOVER)
   - FOOTER: LOGO, DESCRIPTION, EXPLORE LINKS, LEGAL LINKS, COPYRIGHT
   - SEARCH BUTTON (FIXED BOTTOM-RIGHT) + SEARCH MODAL WITH FUSEJS

2. **WORK** (`work/index.html`)
   - HERO: "SELECTED WORK"
   - 2-COLUMN GRID OF 4 CASE STUDIES WITH COVER IMAGES

3. **WORK/HELIO-GRID** (`work/helio-grid.html`)
   - HEADLINE + METADATA GRID (CLIENT, LOCATION, YEAR, SERVICES, INDUSTRIES)
   - FULL-WIDTH COVER IMAGE
   - PROSE CONTENT SECTION

4. **WORK/REVERIE** (`work/reverie.html`)
   - SAME STRUCTURE AS ABOVE

5. **WORK/MESA-HEALTH** (`work/mesa-health.html`)
   - SAME STRUCTURE AS ABOVE

6. **WORK/SIGNAL-NORTH** (`work/signal-north.html`)
   - SAME STRUCTURE AS ABOVE

7. **BLOG** (`blog/index.html`)
   - HERO: "WELCOME TO OUR BLOG"
   - 3-COLUMN GRID OF 6 BLOG POSTS WITH COVER IMAGES
   - FEATURED SECTION BELOW

8. **BLOG/POSTS/1–6** (`blog/posts/1.html` through `blog/posts/6.html`)
   - POST HEADER WITH DATE, TITLE, DESCRIPTION, AUTHOR
   - FULL-WIDTH COVER IMAGE
   - PROSE CONTENT SECTION

9. **STORE** (`store/index.html`)
   - HERO: "STORE"
   - 2-COLUMN GRID OF 4 PRODUCTS WITH COVER IMAGES, LABELS, PRICES

10. **STORE/1–4** (`store/1.html` through `store/4.html`)
    - PRODUCT DETAIL: TITLE, DESCRIPTION, PRICE, METADATA

11. **TEAM** (`team/index.html`)
    - HERO: "OUR TEAM"
    - 2-COLUMN GRID OF 2 TEAM MEMBERS (ALEX CHEN, DAVID LEE) WITH SQUARE IMAGES

12. **TEAM/ALEX-CHEN** (`team/alex-chen.html`)
    - TEAM MEMBER PROFILE WITH BIO, SKILLS, WORK HISTORY

13. **TEAM/DAVID-LEE** (`team/david-lee.html`)
    - SAME STRUCTURE

14. **SYSTEM/OVERVIEW** (`system/overview.html`)
    - DESIGN SYSTEM OVERVIEW PAGE

15. **LEGAL/PRIVACY** (`legal/privacy.html`)
    - LONG-FORM PRIVACY POLICY PROSE

16. **LEGAL/TERMS** (`legal/terms.html`)
    - LONG-FORM TERMS OF USE PROSE

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/astromaxsp).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
