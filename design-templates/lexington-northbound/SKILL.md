---
name: lexington-northbound
description: |
  Northbound is a complete static HTML reproduction of the Northbound wedding website by Lexington Themes. Its editorial design combines expressive serif typography, restrained monochrome styling, full-bleed photography, and clear guest information.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "northbound: wedding website template"
  - "northbound"
  - "wedding"
  - "website"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/northbound"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "site-theme"
  scenario: "marketing"
  example_prompt: "Build Northbound: Wedding Website Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Northbound: Wedding Website Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Northbound is a complete static HTML reproduction of the Northbound wedding website by Lexington Themes. Its editorial design combines expressive serif typography, restrained monochrome styling, full-bleed photography, and clear guest information.

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
<artifact identifier="lexington-northbound" type="text/html" title="Northbound: Wedding Website Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE NORTHBOUND WEDDING TEMPLATE BY LEXINGTON THEMES — EVERY PAGE, EVERY SECTION, EVERY HOVER STATE AND INTERACTION, BUILT AS PLAIN HTML/CSS/JS WITH NO BUILD STEP REQUIRED.
>
> REFERENCE: `https://lexingtonthemes.com/viewports/northbound`

## SUMMARY

NORTHBOUND IS AN ELEGANT WEDDING WEBSITE TEMPLATE BY LEXINGTON THEMES, BUILT ON ASTRO WITH TAILWIND CSS V4. IT IS A WARM, MINIMAL, EDITORIAL DESIGN FOR COUPLES TO SHARE WEDDING DETAILS — RSVP, VENUE INFO, GALLERY, WEDDING PARTY, EVENTS SCHEDULE, FAQ, AND WISHLIST — WITH GUESTS. THE TYPOGRAPHY IS BOLD AND FASHION-EDITORIAL: NOTO SERIF DISPLAY (UPPERCASE DISPLAY HEADINGS), NOTO SERIF (BODY HEADINGS), AND INTER (SANS BODY). IMAGES ARE DESATURATED BY DEFAULT AND SATURATE ON HOVER. THE PALETTE IS A WARM OFF-WHITE BASE WITH A DEEP OLIVE-GREEN ACCENT. THE CLONE IS BUILT AS SELF-CONTAINED PLAIN HTML/CSS/JS — NO BUILD STEP — WITH ALL ASSETS VENDORED LOCALLY.

## STYLE

### PALETTE

- BG-BASE-50: `OKLCH(0.958 0.005 94.95)` — WARM OFF-WHITE (PRIMARY BACKGROUND)
- BG-BASE-100: `OKLCH(0.913 0.011 89.67)`
- TEXT-BASE-900: `OKLCH(0.223 0.002 67.71)` — NEAR-BLACK BODY TEXT
- TEXT-BASE-700: `OKLCH(0.398 0.007 95.17)`
- TEXT-BASE-600: `OKLCH(0.482 0.007 84.55)`
- TEXT-BASE-500: `OKLCH(0.569 0.009 91.5)`
- TEXT-BASE-200: `OKLCH(0.827 0.012 89.69)`
- ACCENT-950: `OKLCH(0.305 0.033 134.79)` — DEEP OLIVE GREEN (DARK PANELS)
- ACCENT-600: `OKLCH(0.554 0.06 134.52)`
- WHITE: `#FFFFFF`
- BLACK: `#000000`

### FONTS

- DISPLAY: "NOTO SERIF DISPLAY", SERIF — USED FOR HERO TITLE, LOGO, LARGE SECTION NUMBERS, GALLERY TITLES (UPPERCASE, ITALIC, FONT-LIGHT)
- SERIF: "NOTO SERIF", SERIF — USED FOR SECTION HEADINGS, ARTICLE TITLES, FAQ QUESTIONS (FONT-LIGHT)
- SANS: "INTER", SANS-SERIF — USED FOR NAVIGATION, BODY TEXT, LABELS, CAPTIONS

### TYPE SCALE

- HERO H1: `CLAMP(3REM, 8VW, 8REM)` — TEXT-5XL / SM:TEXT-7XL / MD:TEXT-8XL / LG:TEXT-9XL — NOTO SERIF DISPLAY, UPPERCASE, WHITE ON DARK OVERLAY
- SECTION HEADINGS: TEXT-3XL / SM:TEXT-3XL / MD:TEXT-4XL / LG:TEXT-5XL — NOTO SERIF, FONT-LIGHT, LEADING-SNUG, TRACKING-TIGHT
- ARTICLE HEADINGS: TEXT-LG / SM:TEXT-XL / MD:TEXT-2XL — NOTO SERIF, FONT-MEDIUM
- BODY: TEXT-BASE (1REM), INTER, FONT-400, LEADING-6
- CAPTIONS: TEXT-SM, TEXT-BASE-500, ITALIC
- NAV LINKS: TEXT-SM, UPPERCASE, INTER, FONT-400
- SCHEDULE NUMBERS: TEXT-6XL / SM:TEXT-9XL / MD:TEXT-[12REM] / LG:TEXT-[14REM] — NOTO SERIF DISPLAY, ITALIC, FONT-LIGHT

### RADII & SPACING

- NO BORDER RADIUS ON CARDS/IMAGES (SQUARE CORNERS THROUGHOUT)
- PADDING SYSTEM: MULTIPLES OF 0.25REM (TAILWIND SPACING SCALE)
- MAX-WIDTH CONTAINERS: MAX-W-6XL (72REM) FOR CONTENT, MAX-W-SCREEN FOR FULL-BLEED SECTIONS
- HORIZONTAL PADDING: PX-4 MOBILE / MD:PX-12 DESKTOP

### ANIMATIONS & INTERACTIONS

- IMAGE HOVER: `FILTER: SATURATE(50%)` AT REST → `SATURATE(100%)` ON HOVER, `TRANSITION-ALL DURATION-300`
- NAV LINK HOVER: COLOR TRANSITION VIA `TRANSITION-COLORS`
- MOBILE MENU: TOGGLE `HIDDEN` CLASS VIA JS; MENU POSITIONED BELOW HEADER DYNAMICALLY
- LINK HOVER: TEXT COLOR CHANGE (TEXT-BASE-600 ON HOVER)
- SCROLL-SMOOTH ON HTML

### DESIGN MOTIFS

- DECORATIVE AMPERSAND/MONOGRAM SVG (FROM THE ORIGINAL TEMPLATE) — APPEARS IN INTRO SECTION, RSVP PANEL, AND FOOTER
- IMAGES STYLED WITH `SATURATE-50` CLASS (DESATURATED) BY DEFAULT
- DARK PANEL CARDS (BG-ACCENT-950) FOR RSVP/INFO/WISHLIST CTAs ON HOME PAGE
- FOOTER: FULL-VIEWPORT-HEIGHT IMAGE WITH DARK OVERLAY AND MONOGRAM SVG

## LAYOUT & STRUCTURE

### PAGES DISCOVERED

1. **HOME** (`/`) — HERO FULL-BLEED IMAGE WITH "ARIA & DANIEL" TITLE; INTRO WITH MONOGRAM SVG + 3 PORTRAIT IMAGES; STORY PARAGRAPH (2-COLUMN); SCHEDULE (NUMBERED LIST 01–04); RSVP/INFO/WISHLIST CTA CARDS; GALLERY PREVIEW (3-COLUMN); FOOTER IMAGE
2. **RSVP** (`/rsvp`) — SPLIT LAYOUT: FULL-HEIGHT IMAGE LEFT + DARK GREEN PANEL RIGHT WITH RSVP FORM (NAME, EMAIL, ATTENDING Y/N, MEAL PREFERENCE, GUESTS, MESSAGE)
3. **INFO** (`/info`) — WIDE HEADER IMAGE; 3-COLUMN LAYOUT: STICKY SIDEBAR (TITLE + VENUE QUICK INFO) + MAIN CONTENT WITH VENUE ADDRESSES, MAPS, ACCOMMODATION, TRANSPORT, DRESS CODE SECTIONS
4. **GALLERY** (`/gallery`) — LARGE TITLE; 3-COLUMN GRID OF ALBUM CARDS (GETTING READY, CEREMONY, RECEPTION, PARTY, BRUNCH, PORTRAITS)
5. **GALLERY/GETTING-READY** (`/gallery/getting-ready`) — FULL-HEIGHT COVER IMAGE; 4-COLUMN LAYOUT: STICKY SIDEBAR WITH ALBUM INFO + MAIN PHOTO STACK (3 PHOTOS, EACH SATURATE-ON-HOVER)
6. **GALLERY/CEREMONY** (`/gallery/ceremony`) — SAME STRUCTURE AS GETTING-READY, WITH CEREMONY IMAGES
7. **GALLERY/RECEPTION** (`/gallery/reception`) — SAME STRUCTURE, RECEPTION IMAGES
8. **PEOPLE** (`/people`) — TITLE + 3-COLUMN GRID OF WEDDING PARTY MEMBERS (BRIDE, GROOM, MAID OF HONOR, BEST MAN, BRIDESMAIDS, GROOMSMEN)
9. **EVENTS** (`/events`) — WIDE HEADER IMAGE; 3-COLUMN LAYOUT: STICKY SIDEBAR + EVENT LIST (CEREMONY, COCKTAIL HOUR, DINNER, SPEECHES, FIRST DANCE, PARTY, BRUNCH)
10. **FAQ** (`/faq`) — WIDE HEADER IMAGE; 3-COLUMN LAYOUT: STICKY SIDEBAR WITH CONTACT INFO + MAIN CONTENT WITH FAQ SECTIONS (EVENT DETAILS, TRAVEL & ACCOMMODATION, FOOD & DRINK, PHOTOS, GIFTS)
11. **WISHLIST** (`/wishlist`) — HERO FULL-BLEED IMAGE; THEN GROUPED WISHLIST ITEMS BY CATEGORY (EXPERIENCES, KITCHEN, BEDROOM, OUTDOOR) IN 3-COLUMN GRID
12. **BLOG/JOURNAL** (`/blog`) — LARGE TITLE; FEATURED POST (LARGE IMAGE + TITLE); GRID OF REMAINING POSTS
13. **SYSTEM/OVERVIEW** (`/system/overview`) — DEVELOPER REFERENCE PAGE LISTING ALL PAGES AND COLLECTIONS WITH LINKS

### SHARED CHROME

- **HEADER**: FIXED, FULL-WIDTH, `BG-BASE-50`, `PY-2 LG:PY-8`, Z-50. THREE-COLUMN NAV: LEFT (RSVP, INFO, GALLERY, PEOPLE, EVENTS — HIDDEN ON MOBILE), CENTER (NORTHBOUND LOGO LINK — `TEXT-2XL LG:TEXT-6XL`, UPPERCASE, NOTO SERIF DISPLAY), RIGHT (FAQ, WISHLIST, JOURNAL, OVERVIEW, BUY — HIDDEN ON MOBILE), MOBILE (HAMBURGER "MENU" BUTTON → FULL-SCREEN DROPDOWN)
- **MOBILE MENU**: FIXED PANEL BELOW HEADER, BG-BASE-50, FULL-SCREEN, VERTICAL STACKED LINKS IN `TEXT-3XL`, FONT-DISPLAY, UPPERCASE
- **FOOTER**: FULL-VIEWPORT-HEIGHT IMAGE WITH `BG-BLACK/30` OVERLAY, CENTERED MONOGRAM SVG IN WHITE, AND SMALL DATE/COPY TEXT BELOW

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/northbound).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
