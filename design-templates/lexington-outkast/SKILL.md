---
name: lexington-outkast
description: |
  Outkast is a complete static HTML reproduction of the Outkast creative agency website by Lexington Themes. Its bold visual system combines oversized type, saturated accent colors, rounded editorial cards, and energetic portfolio presentation.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "outkast: creative agency website template"
  - "outkast"
  - "creative"
  - "agency"
  - "website"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/outkast"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "site-theme"
  scenario: "marketing"
  example_prompt: "Build Outkast: Creative Agency Website Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Outkast: Creative Agency Website Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Outkast is a complete static HTML reproduction of the Outkast creative agency website by Lexington Themes. Its bold visual system combines oversized type, saturated accent colors, rounded editorial cards, and energetic portfolio presentation.

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
<artifact identifier="lexington-outkast" type="text/html" title="Outkast: Creative Agency Website Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE OUTKAST TEMPLATE BY LEXINGTON THEMES, BUILT AS PLAIN HTML + CSS + VANILLA JS WITH NO BUILD STEP REQUIRED.

REFERENCE: `https://lexingtonthemes.com/viewports/outkast`

## SUMMARY

OUTKAST IS A DARK-MODE-FIRST, AGENCY-STYLE MULTI-PAGE WEBSITE TEMPLATE BY LEXINGTON THEMES, BUILT ON ASTRO. THE CLONE REPRODUCES ALL EIGHT PAGES (HOME, SERVICES, WORK, TEAM, PRICING, BLOG, CONTACT, SYSTEM OVERVIEW) AS SELF-CONTAINED HTML FILES, SHARING A SINGLE STYLESHEET AND JS FILE. ALL ASSETS ARE VENDORED LOCALLY. THE TEMPLATE FEATURES A STICKY NAV WITH A HAMBURGER DRAWER, A MARQUEE TICKER, SCROLL-TRIGGERED ENTRANCE ANIMATIONS VIA INTERSECTIONOBSERVER, A KEEN-SLIDER CAROUSEL, AND HOVER TRANSITIONS ON CARDS AND BUTTONS.

## STYLE

### PALETTE

- BACKGROUND PRIMARY: `oklch(14% 0.01 325)` (VERY DARK NEAR-BLACK, BASE-950 REGION)
- BACKGROUND SECONDARY: `oklch(20% 0.012 325)` (DARK CARD SURFACE, BASE-900 REGION)
- BORDER COLOR: `oklch(27.6% 0.012 325)` (BASE-950 / CARD EDGES)
- TEXT PRIMARY: `#FFFFFF` / `oklch(97.7% 0.002 325)` (BASE-50)
- TEXT SECONDARY: `oklch(67.2% 0.025 323.7)` (BASE-400, MUTED)
- TEXT TERTIARY: `oklch(57.7% 0.028 323.9)` (BASE-500)
- ACCENT COLOR: `oklch(38.6% 0.014 149.5)` (ACCENT-700, A MUTED GREEN)
- ACCENT LIGHT: `oklch(72.4% 0.018 145.4)` (ACCENT-300)
- ACCENT HOVER: `oklch(51.8% 0.022 147.6)` (ACCENT-500)

### FONTS

- PRIMARY FAMILY: `Geist, sans-serif` (LOADED VIA GOOGLE FONTS)
- WEIGHTS USED: 100–900 (VARIABLE FONT)
- HEADINGS: FONT-WEIGHT 600–700, TRACKING TIGHT TO TIGHTER
- BODY: FONT-WEIGHT 400, LINE-HEIGHT 1.5–1.75

### TYPE SCALE

- XS: 0.75REM / LH 1.333
- SM: 0.875REM / LH 1.429
- BASE: 1REM / LH 1.5
- LG: 1.125REM / LH 1.556
- XL: 1.25REM / LH 1.4
- 2XL: 1.5REM / LH 1.333
- 3XL: 1.875REM / LH 1.2
- 4XL: 2.25REM / LH 1.111
- 5XL–7XL: 3REM–4.5REM / LH 1

### RADII

- MD: 0.375REM
- LG: 0.5REM
- XL: 0.75REM
- 2XL: 1REM

### ANIMATION EASINGS

- DEFAULT TRANSITION: `cubic-bezier(0.4, 0, 0.2, 1)` AT 150MS
- MARQUEE: `linear 12s infinite` (LOGO STRIP), `linear 300s infinite` (SLOW SCROLL TICKER)
- ENTRANCE REVEAL: OPACITY 0→1, TRANSLATEY 24PX→0, DURATION 600MS, EASE-OUT
- DRAWER SLIDE: `transform translateX(100%)→0`, 300MS EASE

## LAYOUT & STRUCTURE

### SHARED CHROME

- STICKY TOP NAV: LOGO (SVG WORDMARK IN ACCENT COLOR) LEFT; SEARCH ICON + HAMBURGER RIGHT. ALL NAVIGATION IS HIDDEN IN THE HAMBURGER DRAWER (NO DESKTOP NAVLINKS IN THIS TEMPLATE — ALL LINKS LIVE INSIDE THE DRAWER).
- DRAWER: FULL-HEIGHT RIGHT PANEL WITH LINKS (OVERVIEW, SERVICES, WORK, TEAM, PRICING, BLOG, CONTACT) PLUS CTA BUTTONS (BUY OUTKAST / BOOK A CALL).
- SEARCH MODAL: CENTERED OVERLAY WITH A SEARCH INPUT.
- FOOTER: LOGO + TAGLINE + NAVIGATION LINKS GROUPED BY SECTION, COPYRIGHT LINE.

### PAGE: HOME (INDEX.HTML)

1. HERO — LARGE H1 "WEB DEVELOPMENT AND CREATIVE AGENCY", BODY TEXT, ARROW-LINK CTA "LET'S BUILD SOMETHING GREAT". RIGHT SIDE: HERO BACKGROUND IMAGE WITH DECORATIVE GLOW CIRCLES.
2. LOGOS MARQUEE — CONTINUOUS SCROLLING STRIP OF CLIENT LOGOS (4 SVG LOGOS).
3. SERVICES TEASER — LEFT LABEL "WHAT WE DO", RIGHT EXPANDABLE LIST OF SERVICES WITH HOVER UNDERLINE.
4. FEATURED WORK — "OUR WORK" LABEL + 3-COLUMN GRID OF WORK CARDS (IMAGE, TITLE, CATEGORY TAG, YEAR).
5. TESTIMONIALS — QUOTE + AVATAR STRIP OF 3 TESTIMONIALS WITH AUTHOR NAME/ROLE.
6. BLOG PREVIEW — "LATEST ARTICLES" LABEL + 3 BLOG CARD PREVIEWS (IMAGE, DATE, TITLE, EXCERPT).
7. CTA BANNER — FULL-WIDTH DARK SECTION WITH HEADLINE + "CONTACT US" BUTTON.

### PAGE: SERVICES (SERVICES.HTML)

1. PAGE HEADER — "SERVICES" LABEL + H1 + DESCRIPTION.
2. SERVICES LIST — FULL-WIDTH BORDERED ROWS, EACH ROW: SERVICE NUMBER, TITLE, DESCRIPTION, TECH TAGS. HOVER REVEALS BACKGROUND TINT.
3. PROCESS SECTION — NUMBERED STEPS (01–04) IN A 2-COLUMN GRID.
4. TECH STACK — LOGOS/NAMES OF TOOLS USED.
5. CTA BANNER.

### PAGE: WORK (WORK.HTML)

1. PAGE HEADER.
2. WORK GRID — MASONRY-STYLE OR EQUAL-HEIGHT GRID OF PROJECT CARDS WITH IMAGE, TITLE, CATEGORY, YEAR.
3. CTA BANNER.

### PAGE: TEAM (TEAM.HTML)

1. PAGE HEADER — "TEAM" LABEL + H1 "MEET THE PEOPLE BEHIND OUTKAST".
2. TEAM GRID — CARDS WITH AVATAR, NAME, ROLE, BIO SNIPPET, SOCIAL LINKS.
3. MARQUEE TICKER — SLOW-SCROLLING TEXT STRIP "JOIN OUR TEAM…".
4. CTA BANNER.

### PAGE: PRICING (PRICING.HTML)

1. PAGE HEADER.
2. PRICING CARDS — 3 TIERS (STARTER, PRO, ENTERPRISE) WITH FEATURE LISTS AND CTA BUTTON.
3. FAQ ACCORDION.
4. CTA BANNER.

### PAGE: BLOG (BLOG.HTML)

1. PAGE HEADER.
2. FEATURED POST — LARGE CARD.
3. POSTS GRID — 3-COLUMN ARTICLE CARDS.
4. CTA BANNER.

### PAGE: CONTACT (CONTACT.HTML)

1. PAGE HEADER.
2. CONTACT FORM — NAME, EMAIL, MESSAGE FIELDS + SUBMIT BUTTON.
3. CONTACT DETAILS — ADDRESS, EMAIL, PHONE.
4. CTA BANNER.

### PAGE: SYSTEM OVERVIEW (SYSTEM-OVERVIEW.HTML)

1. PAGE HEADER.
2. DESIGN SYSTEM TOKENS SHOWCASE — COLOR PALETTE SWATCHES, TYPOGRAPHY SCALE, COMPONENT LIBRARY SAMPLES (BUTTONS, BADGES, INPUTS, CARDS).
3. CTA BANNER.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/outkast).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
