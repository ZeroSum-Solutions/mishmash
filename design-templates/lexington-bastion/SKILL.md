---
name: lexington-bastion
description: |
  A pixel-faithful, self-contained clone of the Bastion premium construction company website template by Lexington Themes, rebuilt as plain HTML, CSS, and vanilla JavaScript with no build step required. The clone reproduces all 23 pages with a full-bleed video hero, a glass-pill fixed navigation that transitions from transparent to white on scroll, scroll-reveal animations, image hover scale effects, a live-filtered search modal, and a Keen Slider carousel. The dark-accented aesthetic uses an OKLCH-based steel-blue and grey palette against a white page body, with Inter Variable as the primary typeface.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "bastion , construction company website template clone"
  - "bastion"
  - "construction"
  - "company"
  - "website"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/bastion"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Bastion , Construction Company Website Template Clone as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Bastion , Construction Company Website Template Clone

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A pixel-faithful, self-contained clone of the Bastion premium construction company website template by Lexington Themes, rebuilt as plain HTML, CSS, and vanilla JavaScript with no build step required. The clone reproduces all 23 pages with a full-bleed video hero, a glass-pill fixed navigation that transitions from transparent to white on scroll, scroll-reveal animations, image hover scale effects, a live-filtered search modal, and a Keen Slider carousel. The dark-accented aesthetic uses an OKLCH-based steel-blue and grey palette against a white page body, with Inter Variable as the primary typeface.

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
<artifact identifier="lexington-bastion" type="text/html" title="Bastion , Construction Company Website Template Clone">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE BASTION TEMPLATE BY LEXINGTON THEMES, REBUILT AS PLAIN HTML + CSS + VANILLA JS WITH ALL ASSETS VENDORED LOCALLY AND NO BUILD STEP REQUIRED.
>
> REFERENCE: `https://lexingtonthemes.com/viewports/bastion`

## SUMMARY

BASTION IS A PREMIUM MULTI-PAGE CONSTRUCTION COMPANY WEBSITE TEMPLATE BY LEXINGTON THEMES, BUILT WITH ASTRO AND TAILWIND CSS. THE CLONE REPRODUCES EVERY PAGE AS SELF-CONTAINED HTML/CSS/JS WITH IDENTICAL LAYOUT, TYPOGRAPHY, COLOR, AND INTERACTIONS. THE TEMPLATE REPRESENTS A FICTIONAL CONSTRUCTION/ENGINEERING FIRM WITH A SOPHISTICATED DARK-ACCENTED AESTHETIC , A FULL-BLEED VIDEO HERO, GLAZED-CARD NAVIGATION, AND A COMPREHENSIVE SUITE OF INTERIOR PAGES.

THE SOURCE TEMPLATE IS HOSTED AT: `https://bastion-astro.pages.dev/`

## STYLE

### PALETTE
- ACCENT COLOR SCALE: OKLCH-BASED STEEL-BLUE/GREY FAMILY
  - `--color-accent-50`:  `oklch(95.7% .017 250.83)` , LIGHTEST TINT
  - `--color-accent-500`: `oklch(54.8% .09 241.91)` , MID ACCENT
  - `--color-accent-900`: `oklch(18.8% .031 241.68)` , DEEP DARK BLUE-GREY
  - `--color-accent-950`: `oklch(14.8% .024 241.32)` , DARKEST (BACKGROUND FOR HERO, FOOTER, DARK SECTIONS)
- BASE NEUTRAL SCALE: PURE OKLCH GREY (0 CHROMA)
  - `--color-base-100`: `oklch(97% 0 0)` , NEAR WHITE
  - `--color-base-400`: `oklch(70.8% 0 0)` , MID GREY (BODY TEXT ON DARK)
  - `--color-base-600`: `oklch(43.9% 0 0)` , DARK GREY (SUBTEXT ON LIGHT)
  - `--color-base-900`: `oklch(20.5% 0 0)` , NEAR BLACK (HEADINGS ON LIGHT)
- WHITE: `#fff`, BLACK: `#000`
- PAGE BODY: `bg-white` (light)
- DARK SECTIONS / HERO / FOOTER: `bg-accent-950` WITH VIDEO OVERLAY AT 60–75% OPACITY

### FONTS
- PRIMARY: `InterVariable` (VARIABLE FONT) VIA `https://rsms.me/inter/inter.css`
- MONOSPACE: SYSTEM STACK (`ui-monospace, SFMono-Regular, ...`)
- FALLBACK: `"Times New Roman"` (BROWSER DEFAULT SERIF, NOT INTENTIONALLY USED)

### TYPE SCALE
- XS: 0.75REM / SM: 0.875REM / BASE: 1REM / LG: 1.125REM / XL: 1.25REM
- 2XL: 1.5REM / 3XL: 1.875REM / 4XL: 2.25REM / 5XL: 3REM / 6XL: 3.75REM
- FONT WEIGHT: NORMAL (400), MEDIUM (500), BOLD (700)
- LETTER SPACING TIGHT: `-0.025em` (USED ON HEADINGS)
- LINE HEIGHT TIGHT: 1.2 (HEADINGS); RELAXED: 1.625 (BODY)

### RADII
- BASE ROUNDED: 0.25REM | MD: 0.375REM | LG: 0.5REM | XL: 0.75REM | FULL: 9999PX

### ANIMATION / EASINGS
- DEFAULT: `cubic-bezier(0.4, 0, 0.2, 1)` (EASE-IN-OUT)
- EASE-OUT: `cubic-bezier(0, 0, 0.2, 1)`
- DURATIONS: 300MS (STANDARD), 500MS (SLOW/HOVER), 600MS (SCROLL REVEALS)
- SCROLL REVEAL: `opacity 0 → 1` + `translateY(1.5rem → 0)` ON INTERSECTION
- NAV SCROLL TRANSITION: TRANSPARENT → `bg-white` OVER 300MS
- IMAGE HOVER: `transform: scale(1.05)` ON 500MS
- NAV LINK HOVER: UNDERLINE GROWS LEFT-TO-RIGHT VIA `::after` PSEUDO-ELEMENT
- KEEN SLIDER LIBRARY FOR CAROUSELS/SLIDERS (`cdn.jsdelivr.net/npm/keen-slider@6.8.6`)

## LAYOUT & STRUCTURE

### CONTAINER SYSTEM
- MAX-WIDTH: 80REM (1280PX) / 2XL SCREENS: 110REM
- HORIZONTAL PADDING: 2REM (PX-8)
- DESKTOP SECTIONS HAVE LEFT/RIGHT BORDERS AT 1PX `rgba(255,255,255,0.1)` ON DARK BACKGROUNDS

### NAV
- FIXED, FULL-WIDTH, Z-50
- TRANSPARENT OVER VIDEO HERO; TRANSITIONS TO WHITE ON SCROLL (>60PX)
- LEFT: BASTION SVG LOGO (COMPLEX PATH, WHITE ON DARK / BLACK ON SCROLLED)
- CENTER (DESKTOP): "GLASS" PILL WITH BACKDROP-BLUR, OUTLINE, AND 8 NAV LINKS
- RIGHT (DESKTOP): SEARCH ICON BUTTON + "GET IN TOUCH" CTA
- MOBILE: HAMBURGER THAT OPENS A FULL-SCREEN DARK OVERLAY MENU
- SEARCH MODAL: DIALOG WITH INPUT + LIVE-FILTERED RESULTS (BUILT WITH VANILLA JS)

### PAGES DISCOVERED AND CLONED

1. **HOME** (`index.html`) , VIDEO HERO, CONTACT STRIP, SERVICES PREVIEW, PROJECTS GRID, STATS SECTION, TEAM PREVIEW, BLOG TEASERS, FOOTER
2. **ABOUT** (`about.html`) , MISSION, TEAM LEADERS, HISTORY TIMELINE, VALUES
3. **SERVICES** (`services.html`) , GRID OF ALL SERVICE CARDS WITH IMAGES
4. **PROJECTS** (`projects.html`) , IMAGE GRID OF ALL PROJECTS WITH OVERLAY HOVER
5. **TEAM** (`team.html`) , 8-MEMBER TEAM GRID WITH PHOTOS AND ROLES
6. **CAREERS** (`careers.html`) , 5 JOB LISTING ACCORDIONS, CULTURE SECTION
7. **BLOG** (`blog.html`) , 6-ARTICLE CARD GRID
8. **CONTACT** (`contact.html`) , CONTACT INFO + FORM
9. **WHY US** (`why-us.html`) , DIFFERENTIATORS / REASONS TO CHOOSE
10. **PARTNERS** (`partners.html`) , PARTNER LOGO GRID
11. **MISSION** (`mission.html`) , MISSION STATEMENT, VALUES
12. **SERVICE DETAIL: CLIENT PARTNERSHIPS** (`services-client-partnerships.html`)
13. **SERVICE DETAIL: CONSTRUCTION MANAGEMENT** (`services-construction-management.html`)
14. **SERVICE DETAIL: INTERIOR FIT-OUT & FINISHES** (`services-interior-fit-out-and-finishes.html`)
15. **SERVICE DETAIL: MEP COORDINATION** (`services-mep-coordination-and-commissioning.html`)
16. **SERVICE DETAIL: PRECONSTRUCTION & ESTIMATING** (`services-preconstruction-estimating.html`)
17. **SERVICE DETAIL: PROJECT CONTROLS & SCHEDULING** (`services-project-controls-and-scheduling.html`)
18. **PROJECT DETAIL: REDWOOD TRANSIT HUB** (`projects-redwood-transit-hub.html`)
19. **PROJECT DETAIL: WESTFIELD COMMERCIAL COMPLEX** (`projects-westfield-commercial-complex.html`)
20. **LEGAL: PRIVACY** (`legal-privacy.html`)
21. **LEGAL: TERMS** (`legal-terms.html`)
22. **LEGAL: COOKIES** (`legal-cookies.html`)
23. **DESIGN SYSTEM OVERVIEW** (`system-overview.html`)

### FOOTER
- DARK BACKGROUND (ACCENT-950) WITH VIDEO OVERLAY
- TOP ROW: LOGO SVG + TAGLINE + "GET IN TOUCH" BUTTON
- LINKS GRID (4 COLUMNS): PAGES / ABOUT / SERVICES / LEGAL
- BOTTOM BAR: COPYRIGHT + PRIVACY/TERMS/COOKIES LINKS

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/bastion).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
