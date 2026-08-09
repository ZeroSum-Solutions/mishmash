---
name: claywell-solene-h5
description: |
  A single-page landing site for **Solène**, a fictional high-end longevity and precision-movement clinic, built in a "Warm Clay Editorial" aesthetic — a calm, sun-washed, architectural luxury-wellness language built on terracotta (`#9F5434`) and cream. The page feels like a Mediterranean plaster villa crossed with a clinical performance lab: quiet, expensive, precise, and human, predominantly cream and clay with one dramatic ink-dark section for contrast. Sections include a floating pill nav, an asymmetric editorial split hero with an overlapping stat card, a disciplines marquee, an overlapping action-block method grid, a zig philosophy block, a four-column programs grid with grayscale-to-color images, a dark sticky science band, and a clay footer. Motion uses word-by-word heading reveals, directional scroll reveals, image hovers, and a custom clay scrollbar, all respecting `prefers-reduced-motion`.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "solène"
  - "sol"
  - "longevity"
  - "precision-movement"
  - "clinic"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/claywell-solene-h5"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Solène — Longevity & Precision-Movement Clinic Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Solène — Longevity & Precision-Movement Clinic Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A single-page landing site for **Solène**, a fictional high-end longevity and precision-movement clinic, built in a "Warm Clay Editorial" aesthetic — a calm, sun-washed, architectural luxury-wellness language built on terracotta (`#9F5434`) and cream. The page feels like a Mediterranean plaster villa crossed with a clinical performance lab: quiet, expensive, precise, and human, predominantly cream and clay with one dramatic ink-dark section for contrast. Sections include a floating pill nav, an asymmetric editorial split hero with an overlapping stat card, a disciplines marquee, an overlapping action-block method grid, a zig philosophy block, a four-column programs grid with grayscale-to-color images, a dark sticky science band, and a clay footer. Motion uses word-by-word heading reveals, directional scroll reveals, image hovers, and a custom clay scrollbar, all respecting `prefers-reduced-motion`.

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
<artifact identifier="claywell-solene-h5" type="text/html" title="Solène — Longevity & Precision-Movement Clinic Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# SOLÈNE — TERRACOTTA LONGEVITY & MOVEMENT CLINIC LANDING PAGE

## AESTHETIC IDENTITY

BUILD A SINGLE-PAGE, FULLY RESPONSIVE MARKETING LANDING PAGE FOR **SOLÈNE**, A HIGH-END LONGEVITY AND PRECISION-MOVEMENT CLINIC. THE NAMED AESTHETIC IDENTITY IS **"WARM CLAY EDITORIAL"** — A CALM, SUN-WASHED, ARCHITECTURAL LUXURY-WELLNESS LANGUAGE BUILT ON TERRACOTTA AND CREAM. IT SHOULD FEEL LIKE A MEDITERRANEAN PLASTER VILLA CROSSED WITH A CLINICAL PERFORMANCE LAB: QUIET, EXPENSIVE, PRECISE, AND HUMAN. AVOID GENERIC SAAS / AI-SLOP LOOKS — NO PURPLE GRADIENTS, NO GLASSMORPHISM, NO NEON.

## COLOR SYSTEM (EXACT)

- CLAY / BRAND PRIMARY: `rgb(159, 84, 52)` (`#9F5434`)
- DEEP CLAY (HOVER / PRESSED): `#7E3F26`
- CREAM / SURFACE: `rgb(254, 245, 240)` (`#FEF5F0`)
- PURE WHITE BACKGROUND: `#FFFFFF`
- INK / TEXT PRIMARY: `rgb(35, 31, 32)` (`#231F20`)
- TEXT SECONDARY: `rgba(35, 31, 32, 0.7)`
- SOFT BORDER: `rgba(159, 84, 52, 0.12)`
- A SINGLE WARM ACCENT FOR SMALL DETAILS: SAND `#E7C9B4`

THE PALETTE IS PREDOMINANTLY CREAM + CLAY ON LIGHT, WITH ONE DRAMATIC INK-DARK SECTION FOR CONTRAST.

## TYPOGRAPHY

- USE A SINGLE GROTESQUE / NEO-GROTESQUE SANS FAMILY (E.G. **ARCHIVO** OR A SIMILAR SELF-HOSTED GROTESK) ACROSS THE WHOLE PAGE, WEIGHTS 300–700.
- DISPLAY HEADINGS: LARGE (CLAMP UP TO ~8.5REM), WEIGHT 500–600, VERY TIGHT LINE-HEIGHT (~0.95) AND NEGATIVE LETTER-SPACING (~-0.03EM).
- EYEBROW / LABEL TEXT: UPPERCASE, BOLD, WIDE TRACKING (0.3EM), SMALL (11–12PX), IN CLAY.
- BODY: 17–19PX, RELAXED LINE-HEIGHT.

## LAYOUT & SECTION BREAKDOWN (TOP TO BOTTOM)

1. **FLOATING PILL NAV** — FIXED, CENTERED, FULL-WIDTH MAX ~1680PX. CREAM PILL WITH SOFT SHADOW, BACKDROP BLUR, ROUNDED-FULL. LEFT: WORDMARK "SOLÈNE" IN CLAY, WIDE TRACKING, UPPERCASE. CENTER: NAV LINKS (METHOD, PROGRAMS, SCIENCE, CLINICS) WITH SUBTLE CLAY-TINT HOVER. RIGHT: A SOLID CLAY "BOOK ASSESSMENT" PILL BUTTON. COLLAPSES TO A WORDMARK + BUTTON ON MOBILE.

2. **HERO — ASYMMETRIC EDITORIAL SPLIT (NOT A FULL-BLEED IMAGE HERO).** TWO-COLUMN ON DESKTOP: LEFT COLUMN (≈55%) HOLDS A GIANT DISPLAY HEADLINE ("MOVE LIKE THE BODY REMEMBERS" OR SIMILAR), AN EYEBROW, A SUPPORTING PARAGRAPH, AND TWO CTAS (SOLID CLAY + OUTLINED). RIGHT COLUMN HOLDS A TALL PORTRAIT IMAGE IN A SOFTLY-ROUNDED CLAY-BORDERED FRAME, WITH A SMALL FLOATING "STAT CARD" (E.G. "98% RETURN-TO-MOVEMENT") OVERLAPPING ITS LOWER-LEFT CORNER. A THIN HAIRLINE METADATA ROW SITS UNDER THE HEADLINE. THE WHOLE HERO SITS ON CREAM. INCLUDE A SUBTLE GRAIN / PLASTER TEXTURE FEEL VIA CSS.

3. **MARQUEE STRIP** — A SLOW, INFINITE HORIZONTAL TICKER IN CLAY-ON-CREAM (OR INVERTED) LISTING DISCIPLINES: "GAIT ANALYSIS • LONGEVITY • MANUAL THERAPY • FORCE PLATES • BREATHWORK • RECOVERY •" SEPARATED BY SMALL ASTERISK/DOT GLYPHS.

4. **METHOD — OVERLAPPING ACTION-BLOCK GRID.** THREE EQUAL CARDS IN A SINGLE ROUNDED CREAM PANEL WITH HAIRLINE DIVIDERS, EACH CARD: AN EYEBROW LABEL, A NORTH-EAST ARROW THAT NUDGES ON HOVER, A MEDIUM HEADING, AND AN IMAGE THAT SCALES SLIGHTLY ON HOVER. THE PANEL SHOULD READ AS A PRECISION INDEX OF THE CLINIC'S PILLARS.

5. **PHILOSOPHY — ZIG (CONTENT LEFT, IMAGE RIGHT).** EYEBROW + LARGE HEADING + TWO PARAGRAPHS + A ROW OF THREE NUMERIC STATS (E.G. "20+ PROTOCOLS", "98% RECOVERY", "05 LABS"). THE IMAGE IS A 4:5 PORTRAIT WITH A FLOATING PULL-QUOTE CARD OVERLAPPING ITS CORNER (CLAY ITALIC QUOTE + ATTRIBUTION).

6. **PROGRAMS — ZAG (FOUR-COLUMN SERVICE GRID).** ON CREAM. A HEADER ROW WITH EYEBROW + HEADING ON THE LEFT AND A "VIEW FULL MENU" UNDERLINED LINK ON THE RIGHT. FOUR EQUAL CELLS SEPARATED BY HAIRLINES, EACH: A NUMBERED CIRCLE (01–04), A TITLE, A SHORT DESCRIPTION, AND A SQUARE IMAGE THAT IS GRAYSCALE BY DEFAULT AND RESTORES TO COLOR ON HOVER.

7. **SCIENCE — DARK STICKY SECTION.** FULL INK-DARK (`#231F20`) MIN-HEIGHT-SCREEN BAND FOR DRAMATIC CONTRAST. CONTENT-LEFT / MEDIA-RIGHT. EYEBROW IN CREAM, LARGE CREAM HEADING ("DATA-DRIVEN HUMAN EVOLUTION"), A PARAGRAPH, AND TWO SMALL DATA CALL-OUTS UNDER A HAIRLINE. THE MEDIA IS A 16:9 FRAME WITH A CIRCULAR PLAY BUTTON OVERLAY.

8. **FINAL CTA** — CENTERED, ON CREAM/SAND, WITH A FAINT BACKGROUND IMAGE AT VERY LOW OPACITY. WIDE-TRACKED EYEBROW, A HUGE DISPLAY HEADLINE ("UNLOCK YOUR FULL KINETIC POTENTIAL"), TWO CTAS, AND A SMALL CLINICS-BY-CITY LINE.

9. **FOOTER** — SOLID CLAY BACKGROUND, CREAM TEXT. FOUR COLUMNS: BRAND BLURB, LOCATIONS, PROGRAMS, CONNECT. A BOTTOM HAIRLINE ROW WITH COPYRIGHT + LEGAL LINKS.

## MOTION / ANIMATION / INTERACTION SPEC

- **WORD-BY-WORD HEADING REVEAL**: SPLIT EVERY MAJOR HEADING INTO WORD SPANS THAT FADE + RISE (TRANSLATE-Y) WITH AN INCREMENTAL ~0.1S STAGGER WHEN THE SECTION ENTERS THE VIEWPORT.
- **DIRECTIONAL SCROLL REVEAL**: ALTERNATE SECTIONS SLIDE IN FROM LEFT / RIGHT (TRANSLATE-X ~100PX → 0) WITH OPACITY, EASED `cubic-bezier(0.2, 1, 0.3, 1)` OVER ~1S, USING AN INTERSECTIONOBSERVER, EACH ELEMENT REVEALED ONCE.
- **IMAGE HOVERS**: ACTION-BLOCK IMAGES SCALE TO ~1.05 OVER 0.6S, PROGRAM IMAGES TRANSITION GRAYSCALE→COLOR OVER ~0.7S.
- **NAV LINK HOVER**: SOFT CLAY-TINT BACKGROUND FADE.
- **MARQUEE**: CONTINUOUS, SEAMLESS, PAUSE-ON-HOVER OPTIONAL.
- **CUSTOM SCROLLBAR**: THIN, CLAY THUMB ON CREAM TRACK.
- RESPECT `prefers-reduced-motion` BY SHOWING CONTENT IN ITS FINAL STATE.

## RESPONSIVE BEHAVIOR

- DESKTOP (≥1024PX): MULTI-COLUMN HERO, 3-UP METHOD, 4-UP PROGRAMS, 2-COLUMN ZIG/ZAG/SCIENCE.
- TABLET: COLLAPSE TO 2 COLUMNS WHERE SENSIBLE.
- MOBILE (<768PX): EVERYTHING STACKS TO ONE COLUMN, NAV REDUCES TO WORDMARK + BUTTON, HEADINGS CLAMP DOWN GRACEFULLY, FLOATING CARDS REFLOW INLINE.

## TECH / DELIVERY CONSTRAINTS

- SELF-CONTAINED AND RUNNABLE OFFLINE. VANILLA HTML + CSS + A SMALL AMOUNT OF VANILLA JS IS ACCEPTABLE; NO REQUIRED BUILD STEP. ALL FONTS, IMAGES, AND TEXTURES MUST BE VENDORED LOCALLY AND REFERENCED VIA RELATIVE PATHS — NO REMOTE CDNS OR HOTLINKED ASSETS.
- CLEAN, SEMANTIC MARKUP; ACCESSIBLE COLOR CONTRAST; KEYBOARD-FOCUSABLE INTERACTIVE ELEMENTS.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/claywell-solene-h5).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
