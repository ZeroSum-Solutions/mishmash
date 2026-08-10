---
name: lexington-brightlight
description: |
  Brightlight is a multi-page SaaS landing template for an email delivery platform aimed at developers. It ships as plain HTML, CSS, and vanilla JavaScript , no build step required. The design uses a clean neutral palette with an oklch-based orange accent, Geist variable font, and Noto Serif for headings. Four pages cover every angle of the product: a fully-featured home page with hero, logo marquee, SDK code switcher, 8-feature card grid, email editor mockup, contact management analytics, monthly/annual pricing toggle with a full comparison table, and testimonial; a blog listing page; a centred sign-in card with Google and GitHub social login; and a live system-status page with per-service uptime bars and an incident history.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "brightlight , developer email delivery platform template"
  - "brightlight"
  - "developer"
  - "email"
  - "delivery"
  - "platform"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/brightlight"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Brightlight , Developer Email Delivery Platform Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Brightlight , Developer Email Delivery Platform Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Brightlight is a multi-page SaaS landing template for an email delivery platform aimed at developers. It ships as plain HTML, CSS, and vanilla JavaScript , no build step required. The design uses a clean neutral palette with an oklch-based orange accent, Geist variable font, and Noto Serif for headings. Four pages cover every angle of the product: a fully-featured home page with hero, logo marquee, SDK code switcher, 8-feature card grid, email editor mockup, contact management analytics, monthly/annual pricing toggle with a full comparison table, and testimonial; a blog listing page; a centred sign-in card with Google and GitHub social login; and a live system-status page with per-service uptime bars and an incident history.

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
<artifact identifier="lexington-brightlight" type="text/html" title="Brightlight , Developer Email Delivery Platform Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> THIS IS A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE BRIGHTLIGHT TEMPLATE BY LEXINGTON THEMES. REFERENCE: `https://lexingtonthemes.com/viewports/brightlight`

## SUMMARY

BRIGHTLIGHT IS A PREMIUM SAAS EMAIL MARKETING / EMAIL API LANDING PAGE TEMPLATE. IT FEATURES A CLEAN, MINIMAL WHITE DESIGN WITH DASHED BORDERS, SERIF HEADINGS, AND A WARM ORANGE ACCENT COLOR. THE TEMPLATE TARGETS DEVELOPERS AND EMAIL PLATFORM PRODUCTS WITH HUMOROUS, CONVERSATIONAL COPY. IT INCLUDES A HOME PAGE, BLOG LISTING, SIGN-IN PAGE, AND A DESIGN SYSTEM OVERVIEW PAGE.

## STYLE

### PALETTE
- BACKGROUND: #FFFFFF (WHITE)
- ACCENT-500: OKLCH(64.47% .167 35.21) , WARM ORANGE/RED, USED FOR PRIMARY BUTTONS AND ICON HIGHLIGHTS
- ACCENT-600: OKLCH(55.96% .174 34.81) , DARKER ACCENT FOR HOVER STATES
- BASE-200: OKLCH(92.2% 0 0) , LIGHT GRAY, USED FOR DASHED BORDERS
- BASE-500: OKLCH(55.6% 0 0) , MEDIUM GRAY, USED FOR BODY TEXT
- BASE-800/900: DARK GRAY/NEAR-BLACK FOR HEADINGS
- SAND-50: OKLCH(98.73% .004 106.47) , OFF-WHITE/CREAM
- SAND-100: OKLCH(97.03% .007 88.64) , LIGHT SAND, USED FOR CARD BACKGROUNDS
- SAND-950: NEAR-BLACK SAND, USED FOR SECONDARY BUTTONS

### FONTS
- HEADINGS: "NOTO SERIF" , SERIF FONT, MEDIUM WEIGHT (500), TIGHT TRACKING
- BODY: "GEIST" , SANS-SERIF, VARIABLE WEIGHT, 400 NORMAL
- MONO: "GEIST MONO" , FOR CODE BLOCKS

### TYPE SCALE
- HERO HEADING: TEXT-4XL (2.25REM) TO TEXT-7XL (4.5REM) RESPONSIVE
- SECTION HEADING: TEXT-3XL (1.875REM) AT LG
- BODY: TEXT-BASE (1REM), BASE-500 COLOR
- SMALL/CAPTION: TEXT-XS (0.75REM) TO TEXT-SM (0.875REM)

### RADII
- CARDS: ROUNDED-XL (0.75REM)
- BUTTONS: ROUNDED-FULL (FULLY ROUNDED PILL SHAPE)
- CODE PANELS: ROUNDED-XL

### ANIMATION/EFFECTS
- MARQUEE ANIMATION: 12S LINEAR INFINITE SCROLL FOR LOGO STRIPS
- CARD HOVER: SHADOW-2XL + ICON ROTATE-12 AND TRANSLATE-Y-2 (300MS EASE)
- BUTTON HOVER: COLOR SHIFT 300MS DURATION
- MOBILE NAV: OPACITY + TRANSLATE-Y TRANSITION 300MS EASE-IN-OUT

### LAYOUT
- MAX-W-5XL (1024PX) CONTENT CONTAINER WITH BORDER-X DASHED BORDERS ON SIDES
- SECTIONS SEPARATED BY BORDER-T DASHED BORDERS
- PADDING: PT-12/PT-32 TOP, PX-4 SIDES

## LAYOUT & STRUCTURE

### PAGE 1: HOME (INDEX.HTML)
1. HEADER/NAV , LOGO LEFT, NAV LINKS (OVERVIEW, BLOG) + BUTTONS (SIGN IN, GET STARTED) RIGHT; MOBILE HAMBURGER MENU
2. HERO SECTION , CENTERED HEADLINE, SUBTITLE, TWO CTA BUTTONS, DASHBOARD SCREENSHOT IMAGE
3. LOGOS MARQUEE , SCROLLING STRIP OF 12 COMPANY LOGOS WITH WHITE GRADIENT FADE
4. CODE SECTION "PLUG IT IN BEFORE YOUR COFFEE GETS COLD" , TABBED CODE SNIPPETS (NODE, SERVERLESS, RUBY, PYTHON, PHP, GO, RUST, JAVA, ELIXIR, .NET, REST, SMTP); SDK ICON GRID BELOW
5. FEATURES GRID "BUILT BY DEVELOPERS WHO WERE SICK OF BROKEN EMAIL APIS" , 8 FEATURE CARDS (4-COL GRID AT LG) WITH ICON + TITLE + DESCRIPTION; HOVER CARD EFFECT
6. WRITE SECTION "WRITE LIKE A HUMAN, NOT A HACKER" , EMAIL EDITOR MOCKUP + CUSTOMER QUOTE IMAGE
7. CONTACT MANAGEMENT SECTION , TWO FEATURE BLOCKS WITH STATS VISUALS
8. CTA SECTION "EMAIL, BUT ACTUALLY GOOD" , ORANGE BACKGROUND CARD WITH CTA BUTTONS
9. PRICING SECTION , 3 PLAN CARDS + FEATURE COMPARISON TABLE
10. TESTIMONIAL SECTION , SINGLE LARGE QUOTE
11. LOGOS MARQUEE (REPEATED)
12. FOOTER , LOGO + TAGLINE; LINKS IN 4 COLUMNS

### PAGE 2: BLOG (BLOG.HTML)
1. HEADER/NAV
2. BLOG HERO , HEADING + SUBTITLE
3. BLOG POST CARDS GRID
4. FOOTER

### PAGE 3: SIGN-IN (SIGN-IN.HTML)
1. HEADER/NAV
2. CENTERED SIGN-IN FORM CARD
3. FOOTER

### PAGE 4: SYSTEM/OVERVIEW (SYSTEM/OVERVIEW.HTML)
1. HEADER/NAV
2. DESIGN SYSTEM OVERVIEW , COLORS, TYPOGRAPHY, COMPONENTS
3. FOOTER

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/brightlight).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
