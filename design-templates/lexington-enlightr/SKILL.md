---
name: lexington-enlightr
description: |
  Enlightr is a five-page educational platform and online course template. It combines a white canvas with green accents, Inter Variable body copy, Instrument Serif display type, Clash Grotesk labels, and Space Mono details. It includes a testimonial carousel, pricing comparison, FAQ disclosures, responsive navigation, floating search, authentication, and a complete route overview.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "enlightr: multi-page online course website template"
  - "enlightr"
  - "multi-page"
  - "online"
  - "course"
  - "website"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/enlightr"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Enlightr: Multi-Page Online Course Website Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Enlightr: Multi-Page Online Course Website Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Enlightr is a five-page educational platform and online course template. It combines a white canvas with green accents, Inter Variable body copy, Instrument Serif display type, Clash Grotesk labels, and Space Mono details. It includes a testimonial carousel, pricing comparison, FAQ disclosures, responsive navigation, floating search, authentication, and a complete route overview.

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
<artifact identifier="lexington-enlightr" type="text/html" title="Enlightr: Multi-Page Online Course Website Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE ENLIGHTR TEMPLATE BY LEXINGTON THEMES, REBUILT AS PLAIN HTML + CSS + VANILLA JS WITH NO BUILD STEP REQUIRED.
> REFERENCE: `https://lexingtonthemes.com/viewports/enlightr`

## SUMMARY

ENLIGHTR IS A PREMIUM MULTI-PAGE EDUCATIONAL PLATFORM / ONLINE COURSE TEMPLATE BUILT WITH ASTRO AND TAILWIND CSS. IT PRESENTS AN ONLINE LEARNING PLATFORM FOR ASTRO WEB DEVELOPMENT COURSES, FEATURING A CLEAN, TYPOGRAPHICALLY-RICH DESIGN WITH A WHITE BASE, ACCENT COLORS, AND A DISTINCTIVE DISPLAY TYPEFACE. THE TEMPLATE INCLUDES A HOME PAGE, PRICING PAGE, COURSES LISTING, SIGN-IN FORM, AND DESIGN SYSTEM REFERENCE PAGES.

## STYLE

### PALETTE
- BASE WHITE: `#ffffff` (rgb(255, 255, 255))
- BASE-50: `#f9f9f9`
- BASE-100: `#f3f4f4`
- BASE-200: `#e8e8e8`
- BASE-500: `#6b7280`
- BASE-600: `#4b5563`
- BASE-700: `#374151`
- BASE-800: `#1f2937`
- BASE-900: `#111827`
- BASE-950: `#030712`
- ACCENT-100: `#f0fdf4` (light green tint — accent color is green-adjacent)
- ACCENT-200: `#bbf7d0`
- ACCENT-400: `#4ade80`
- ACCENT-500: `#22c55e`
- ACCENT-600: `#16a34a`
- ACCENT-800: `#166534`
- ACCENT-900: `#14532d`
- ACCENT-950: `#052e16`
- VIOLET-200: `#ddd6fe`
- VIOLET-950: `#2e1065`
- BLUE-100: `#dbeafe`
- BLUE-200: `#bfdbfe`
- BLUE-700: `#1d4ed8`
- BLUE-900: `#1e3a8a`
- YELLOW-200: `#fef08a`
- YELLOW-950: `#422006`

### FONTS
- BODY / UI: `InterVariable, sans-serif` (via rsms.me/inter)
- DISPLAY (HEADINGS, LOGO, UPPERCASE LABELS): `"Instrument Serif"` italic (Google Fonts) — used for italic display text
- MONOSPACE: `"Space Mono", monospace` (Google Fonts)
- DISPLAY UPPERCASE: `Clash Grotesk` (via fontshare.com) — used for uppercase section headings
- ACCENT DECORATIVE: `"Love Ya Like A Sister"` (Google Fonts) — rare accent use

### TYPE SCALE
- H1 (HERO): 4XL → 6XL RESPONSIVE (2.25REM → 3.75REM), UPPERCASE, FONT-DISPLAY, FONT-MEDIUM
- H2 (SECTION): LG → 3XL RESPONSIVE (1.125REM → 1.875REM), UPPERCASE, FONT-DISPLAY, FONT-MEDIUM
- H3 (CARD): BASE → XL RESPONSIVE, FONT-DISPLAY, TRACKING-TIGHT
- BODY: SM (0.875REM), LINE-HEIGHT 24PX, COLOR BASE-500/600
- LABELS/TAGS: 10PX → XS, UPPERCASE, LETTER-SPACING WIDE
- STAT NUMBERS: 3XL → 5XL ITALIC FONT-DISPLAY

### RADII
- BUTTONS: FULL (ROUNDED-FULL / PILL SHAPE)
- CARDS: NONE (SHARP CORNERS)
- INPUT FIELDS: ROUNDED-MD

### ANIMATION EASINGS
- BUTTON TRANSITIONS: DURATION-500, EASE-IN-OUT
- NAV TRANSITIONS: DURATION-300, EASE-IN-OUT
- CAROUSEL (KEEN SLIDER): DURATION 1000MS DEFAULT ANIMATION, 3S AUTOPLAY
- SCROLL BEHAVIOR: SMOOTH

## LAYOUT & STRUCTURE

### PAGES DISCOVERED

1. **HOME** (`index.html`) — Landing page
   - FIXED NAVIGATION BAR (TRANSPARENT → BLUR ON SCROLL) WITH LOGO + LINKS + CTA
   - HERO SECTION WITH H1, DESCRIPTION, CTA LINKS, AND 9-COLUMN PHOTO GRID OF CUSTOMERS/STATS
   - "EVERYTHING YOU NEED" TEXT SECTION WITH LONG DESCRIPTION
   - "WHO IT'S FOR" SECTION — ACCENT-100 BG, 3-COL GRID, STICKY SIDEBAR, LIST OF AUDIENCE TYPES
   - "COURSE EXPERIENCE" SECTION — BLUE-100 BG, 3-COL GRID, STICKY SIDEBAR, FEATURE LIST
   - "LATEST COURSES" SECTION — COURSE CARDS GRID (2 COURSES SHOWN)
   - STATS ROW — 4 STAT BOXES (4200+ STUDENTS, 4.9/5 RATING, 48 LESSONS, 12+ HOURS)
   - "OUR STUDENTS" TESTIMONIALS — KEEN SLIDER CAROUSEL WITH PREV/NEXT CONTROLS
   - FOOTER — LOGO, DESCRIPTION, 4-COLUMN LINK GRID

2. **PRICING** (`pricing.html`) — Pricing plans
   - NAVIGATION (SAME AS HOME)
   - PRICING HEADER + PLAN CARDS (FREE VS PRO)
   - FAQ ACCORDION SECTION
   - FOOTER

3. **COURSES** (`courses.html`) — Course catalog
   - NAVIGATION
   - COURSES LISTING GRID WITH FILTER/SEARCH
   - COURSE CARDS (PRICE, DATE, DURATION, LESSONS, TEACHER, ENROLL CTA)
   - FOOTER

4. **SIGN IN** (`sign-in.html`) — Authentication form
   - CENTERED FORM WITH EMAIL + PASSWORD + SUBMIT
   - LOGO AT TOP
   - LINK TO SIGN UP / FORGOT PASSWORD

5. **SYSTEM/OVERVIEW** (`system-overview.html`) — Design system reference page
   - BUTTONS, COLORS, TYPOGRAPHY SHOWCASE

### SHARED CHROME
- FIXED TOPBAR NAV: MAX-W-6XL CONTAINER, LOGO LEFT, NAV LINKS CENTER/RIGHT, CTA BUTTON
- MOBILE: HAMBURGER MENU TOGGLE → FULL-SCREEN OVERLAY NAV
- FLOATING SEARCH BUTTON (BOTTOM-RIGHT, FUSE.JS POWERED)
- FOOTER: 3-COL GRID (LOGO + DESC | NAV LINKS | SOCIALS/MORE)

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/enlightr).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
