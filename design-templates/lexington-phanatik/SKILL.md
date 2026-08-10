---
name: lexington-phanatik
description: |
  Phanatik is a complete static HTML reproduction of the Phanatik editorial publishing website by Lexington Themes. Its dense but disciplined layout combines newspaper-inspired typography, clear content hierarchy, compact navigation, subscription surfaces, and dedicated podcast presentation.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "phanatik: editorial news and podcast template"
  - "phanatik"
  - "editorial"
  - "news"
  - "podcast"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/phanatik"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "site-theme"
  scenario: "marketing"
  example_prompt: "Build Phanatik: Editorial News and Podcast Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Phanatik: Editorial News and Podcast Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Phanatik is a complete static HTML reproduction of the Phanatik editorial publishing website by Lexington Themes. Its dense but disciplined layout combines newspaper-inspired typography, clear content hierarchy, compact navigation, subscription surfaces, and dedicated podcast presentation.

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
<artifact identifier="lexington-phanatik" type="text/html" title="Phanatik: Editorial News and Podcast Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE PHANATIK TEMPLATE BY LEXINGTON THEMES. ALL PAGES, SECTIONS, INTERACTIONS, AND ANIMATIONS ARE REPRODUCED AS PLAIN HTML + CSS + VANILLA JAVASCRIPT — NO BUILD STEP REQUIRED.
>
> REFERENCE: `https://lexingtonthemes.com/viewports/phanatik`

## SUMMARY

PHANATIK IS A PREMIUM NEWS AND MAGAZINE TEMPLATE BUILT FOR MODERN DIGITAL PUBLISHERS. IT FEATURES A SOPHISTICATED EDITORIAL LAYOUT WITH MULTI-SECTION HOMEPAGE (FEATURED, BREAKING, TOP STORIES, CATEGORY GRIDS), A SCROLLING HEADLINE TICKER, A MEGA-MENU NAVIGATION WITH TOP STORIES AND LATEST PODCAST EPISODES, A FULL BLOG POST READER, AND AN ABOUT PAGE. THE TEMPLATE IS DESIGNED FOR CONTENT-RICH PUBLICATIONS COVERING CATEGORIES LIKE SPORTS, TECH, BUSINESS, FINANCE, HEALTH, AND ECONOMICS. IT USES A RESTRAINED TYPOGRAPHIC PALETTE PAIRING INTER (BODY) WITH STIX TWO TEXT (DISPLAY/HEADINGS) FOR AN AUTHORITATIVE, EDITORIAL FEEL.

## STYLE

### COLOR PALETTE

- BASE-50: OKLCH(98.5% 0.002 247.839) — PAGE BACKGROUND (NEAR WHITE)
- BASE-100: OKLCH(96.7% 0.003 264.542) — SUBTLE SURFACE, BUTTON FILLS
- BASE-200: OKLCH(92.8% 0.006 264.531) — BORDERS, DIVIDERS
- BASE-300: OKLCH(87.2% 0.01 258.338)
- BASE-400: OKLCH(70.7% 0.022 261.325)
- BASE-500: OKLCH(55.1% 0.027 264.364)
- BASE-600: OKLCH(44.6% 0.03 256.802) — MUTED BODY TEXT, METADATA
- BASE-700: OKLCH(37.3% 0.034 259.733)
- BASE-800: OKLCH(27.8% 0.033 256.848)
- BASE-900: OKLCH(21% 0.034 264.665) — HEADINGS, DARK TEXT
- BASE-950: OKLCH(13% 0.028 261.692) — FOOTER BACKGROUND, SECTION DECORATORS
- ACCENT-50: OKLCH(94.1% 0.03 285.86)
- ACCENT-500: OKLCH(45.2% 0.313 264.05) — INTERACTIVE ACCENT (BLUE)
- ACCENT-900: OKLCH(20.5% 0.142 264.05)
- ACCENT-950: OKLCH(16.3% 0.113 264.05) — SIGN UP BUTTON BACKGROUND

### FONTS

- BODY: INTER (LOADED FROM RSMS.ME/INTER)
- DISPLAY / HEADINGS: STIX TWO TEXT (LOADED FROM GOOGLE FONTS), ITALIC CAPABLE
- MONO: UI-MONOSPACE (SYSTEM FALLBACK)

### TYPE SCALE

- XS: 0.75REM / 1REM LINE-HEIGHT
- SM: 0.875REM / 1.25REM
- BASE: 1REM / 1.5REM
- LG: 1.125REM / 1.75REM
- XL: 1.25REM / 1.75REM
- 2XL: 1.5REM / 2REM
- LOGO: 1.5REM (LG: 2XL), FONT-WEIGHT 500, UPPERCASE, STIX TWO TEXT

### SPACING / RADII / SHADOWS

- BASE SPACING UNIT: 0.25REM (4PX)
- CONTAINER MAX-WIDTH: 100REM (2XL SCREENS), PADDED 32PX SIDES
- SECTION PADDING: PY-12 (48PX VERTICAL), PY-8 (32PX)
- CARD RADIUS: ROUNDED-XL (0.75REM) ON IMAGES, ROUNDED-LG (0.5REM) ON THUMBNAILS
- SEARCH MODAL RADIUS: ROUNDED-XL
- SHADOWS: MINIMAL — ONLY ON MEGA-MENU (BOX-SHADOW)

### ANIMATION EASINGS

- DEFAULT TRANSITION: CUBIC-BEZIER(0.4, 0, 0.2, 1) OVER 500MS (BUTTONS/LINKS)
- MARQUEE TICKER: LINEAR 32S INFINITE (translateX FROM 0 TO -50%)
- MARQUEE PAUSES ON HOVER (animation-play-state: paused)

## LAYOUT & STRUCTURE

### PAGE: INDEX.HTML (HOME)

1. NAVIGATION HEADER
   - TOP BAR: LIVE CLOCK (LEFT) | PHANATIK® LOGO (CENTER) | SEARCH ICON + SIGN IN + SIGN UP + HAMBURGER (RIGHT)
   - SECOND BAR: BUY PHANATIK LINK | LATEST NEWS CATEGORY LINKS (HIDDEN ON MOBILE) | OVERVIEW LINK
   - MEGA-MENU (COLLAPSED BY DEFAULT): COMPANY LINKS + CATEGORIES + TOP STORIES + LATEST EPISODES
   - SCROLLING TICKER: INFINITE MARQUEE OF ARTICLE HEADLINES

2. MAIN CONTENT (4-COLUMN GRID: 3 CONTENT + 1 SIDEBAR)
   - FEATURED SECTION: LARGE HERO ARTICLE (CATEGORY + TITLE + DESCRIPTION + AUTHOR + DATE, IMAGE RIGHT)
   - BREAKING SECTION: 3-COLUMN CARD GRID (5 ARTICLES, IMAGES + METADATA + TITLE)
   - TOP STORIES SECTION: 1 LARGE HERO CARD (WITH GRADIENT OVERLAY) + 3 VERTICAL LIST ITEMS
   - BRIEFS SECTION: HORIZONTAL 3-COLUMN GRID OF COMPACT ARTICLE ROWS

3. SIDEBAR (RIGHT COLUMN)
   - FINANCE SECTION WITH AUTHOR AVATAR CARD (FEATURED ARTICLE)
   - ADVERTISEMENT PLACEHOLDER (ASIDE SVG)
   - PODCAST EPISODES LIST

4. CATEGORY SECTIONS (FULL WIDTH BELOW MAIN GRID)
   - BUSINESS: 5-ARTICLE GRID
   - FINANCE: 2-ARTICLE HORIZONTAL LIST
   - TECH: 4-ARTICLE GRID
   - HEALTH: 4-ARTICLE GRID
   - SPORTS: 3-ARTICLE GRID

5. FOOTER
   - DARK BACKGROUND (BASE-950)
   - NEWSLETTER SIGNUP (PHANATIK® HEADING + DESCRIPTION + EMAIL FORM)
   - 4-COLUMN LINKS GRID (COMPANY, CATEGORIES, COMPANY SOCIALS, SOCIAL LINKS)
   - COPYRIGHT LINE

### PAGE: ABOUT.HTML

1. SAME NAVIGATION HEADER
2. TWO-COLUMN LAYOUT
   - LEFT: OUR STORY HEADING + DESCRIPTION, OUR VISION HEADING + DESCRIPTION, GET IN TOUCH CTA, TEAM PHOTO
   - RIGHT: LONG EDITORIAL TEXT WITH SUBHEADINGS (STIX TWO TEXT) — ABOUT PHANATIK'S MISSION
3. SAME FOOTER

### PAGE: BLOG-POST.HTML (SINGLE POST)

1. SAME NAVIGATION HEADER
2. ARTICLE LAYOUT
   - CATEGORY BADGE + HERO TITLE (STIX TWO TEXT, LARGE)
   - AUTHOR BYLINE WITH AVATAR, DATE, READ TIME
   - FULL-WIDTH HERO IMAGE (ASPECT 16:9)
   - ARTICLE BODY (PROSE TYPOGRAPHY — STIX TWO TEXT)
   - SUBSCRIBER PAYWALL TEASER (THIS POST IS FOR SUBSCRIBERS ONLY)
   - LOG IN / SUBSCRIBE NOW BUTTONS
3. SIDEBAR (STICKY)
   - FEATURED ARTICLES LIST
   - ADVERTISEMENT (ASIDE SVG)
4. RELATED POSTS GRID (3 CARDS AT BOTTOM)
5. SAME FOOTER

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/phanatik).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
