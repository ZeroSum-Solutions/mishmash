---
name: auric-clinic-glow-h37
description: |
  A multi-section marketing landing page for **Auric**, a fictional luxury skincare and dermaceutical clinic, built in a "Clinical Warmth" aesthetic — the collision of medical precision with sun-warmed skin. The mood is calm, expensive, and trustworthy — Aesop-meets-dermatology — with warm terracotta-clay accents (`#9F5434`) on cream and white surfaces, a floating pill navbar, a full-bleed editorial hero, an overlapping three-column action-block grid, a value-prop marquee strip, a signature-treatments card grid, a split "Our Science" stats block with count-up animation, a pull-quote testimonial, and a deep-clay CTA band.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "auric"
  - "high-end"
  - "dermaceutical"
  - "clinic"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/auric-clinic-glow-h37"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Auric — High-End Dermaceutical Clinic Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Auric — High-End Dermaceutical Clinic Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A multi-section marketing landing page for **Auric**, a fictional luxury skincare and dermaceutical clinic, built in a "Clinical Warmth" aesthetic — the collision of medical precision with sun-warmed skin. The mood is calm, expensive, and trustworthy — Aesop-meets-dermatology — with warm terracotta-clay accents (`#9F5434`) on cream and white surfaces, a floating pill navbar, a full-bleed editorial hero, an overlapping three-column action-block grid, a value-prop marquee strip, a signature-treatments card grid, a split "Our Science" stats block with count-up animation, a pull-quote testimonial, and a deep-clay CTA band.

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
<artifact identifier="auric-clinic-glow-h37" type="text/html" title="Auric — High-End Dermaceutical Clinic Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# AURIC — PRECISION DERMACEUTICAL CLINIC LANDING PAGE

## AESTHETIC IDENTITY

BUILD A FULL, MULTI-SECTION LANDING PAGE FOR A FICTIONAL HIGH-END SKINCARE & DERMACEUTICAL CLINIC NAMED **AURIC**. THE NAMED AESTHETIC IDENTITY IS **"CLINICAL WARMTH"** — THE COLLISION OF MEDICAL PRECISION WITH SUN-WARMED SKIN. THE MOOD IS CALM, EXPENSIVE, AND TRUSTWORTHY: A QUIET LUXURY CLINIC WHERE EVERY EDGE IS ROUNDED, EVERY SURFACE GLOWS, AND THE SCIENCE FEELS LIKE A SPA RITUAL. THINK AESOP-MEETS-DERMATOLOGY: RESTRAINT, GENEROUS NEGATIVE SPACE, AND ONE WARM TERRACOTTA ACCENT THAT CARRIES THE ENTIRE BRAND.

## COLOR PALETTE

- **CLAY / BRAND PRIMARY:** `RGB(159, 84, 52)` — WARM TERRACOTTA-CLAY, USED FOR LOGOTYPE, HEADINGS ON LIGHT, PRIMARY BUTTONS, AND ALL ACCENTS.
- **DEEP CLAY (HOVER / DARK SECTIONS):** `RGB(111, 59, 36)`.
- **CREAM / BRAND SECONDARY:** `RGB(254, 245, 240)` — IVORY-CREAM, THE DOMINANT SURFACE FOR PILLS, CARDS, AND DARK-SECTION TEXT.
- **NEUTRAL BACKGROUND:** `RGB(255, 255, 255)` PURE WHITE FOR THE PAGE BODY.
- **TEXT PRIMARY:** `RGB(35, 31, 32)` NEAR-BLACK INK.
- **SOFT BORDER:** `RGBA(159, 84, 52, 0.12)` HAIRLINE CLAY BORDERS THROUGHOUT.
- **NAV SHADOW:** `RGBA(111, 59, 36, 0.05)` 0 4PX 24PX.

## TYPOGRAPHY

- SINGLE FAMILY: **ARCHIVO** (GOOGLE FONTS), WEIGHTS 400 / 500 / 600 / 700.
- HERO H1: CLAMP 3.5REM → 7.5REM, LINE-HEIGHT 0.96, LETTER-SPACING -0.03EM, WEIGHT 400.
- SECTION HEADINGS: 28–48PX, LINE-HEIGHT 1.04, LETTER-SPACING -0.02EM, WEIGHT 400.
- BODY: 15–18PX, WEIGHT 400, RELAXED LEADING.
- EYEBROWS / LABELS: 13PX, UPPERCASE, WIDE TRACKING, WEIGHT 500.

## SHAPE LANGUAGE

- BORDER RADII: SM 8PX, MD 16PX, LG 24PX, XL 32PX, AND `FULL` (1000PX) PILLS.
- EVERYTHING SOFTENED. NO HARD CORNERS. HAIRLINE CLAY BORDERS SEPARATE BLOCKS.

## LAYOUT & SECTION BREAKDOWN

1. **FLOATING PILL NAVIGATION** — A CREAM ROUNDED-FULL CAPSULE FLOATING AT THE TOP WITH SOFT SHADOW AND HAIRLINE BORDER. LEFT: "AURIC" LOGOTYPE IN CLAY, BOLD, WIDE TRACKING, UPPERCASE. CENTER: NAV LINKS (OUR SCIENCE / TREATMENTS / THE JOURNAL / CONTACT) WITH SUBTLE HOVER BACKGROUND TINT. RIGHT: A SOLID CLAY "BOOK CONSULTATION" PILL.

2. **HERO** — FULL-BLEED EDITORIAL PORTRAIT OF FLAWLESS GLOWING SKIN UNDER SOFT LIGHT, WITH A DARK GRADIENT OVERLAY FOR READABILITY. CENTERED HEADLINE IN CREAM: "ELEVATE YOUR GLOW WITH PRECISION SKINCARE" (TWO LINES). BELOW: TWO PILL CTAS — A SOLID CREAM "BOOK CONSULTATION" AND AN OUTLINE-CREAM "VIEW TREATMENTS". A SMALL SCROLL CUE / RATING ROW. THE HERO IMAGE BLOCK HAS GENEROUS HEIGHT.

3. **OVERLAPPING ACTION-BLOCK GRID** — A CREAM CARD WITH ROUNDED-LG CORNERS THAT OVERLAPS THE BOTTOM OF THE HERO, DIVIDED INTO THREE EQUAL COLUMNS BY HAIRLINE CLAY BORDERS. EACH COLUMN HAS: A TOP LABEL ROW WITH A DIAGONAL ARROW ICON THAT TRANSLATES ON HOVER, A SHORT CLAY HEADING, AND A TALL IMAGE THAT SCALES SLIGHTLY ON HOVER. THE THREE: "OUR SCIENCE — THE PURSUIT OF CLINICAL EXCELLENCE", "TREATMENTS — ADVANCED SOLUTIONS FOR LASTING RESULTS", "THE JOURNAL — INSIGHTS FROM OUR DERMATOLOGISTS".

4. **MARQUEE STRIP** — A THIN CLAY BAR WITH A SLOW INFINITE MARQUEE OF VALUE PROPS (DERMATOLOGIST-LED · CLINICALLY PROVEN · CRUELTY-FREE · BIOCOMPATIBLE) IN CREAM, SEPARATED BY SMALL DIAMOND GLYPHS.

5. **TREATMENTS / RITUAL SECTION** — A LIGHT SECTION WITH AN EYEBROW, A LARGE TWO-LINE HEADING, AND A 3- OR 4-CARD GRID OF SIGNATURE TREATMENTS (E.G. CLARITY PEEL, COLLAGEN INFUSION, AURIC FACIAL, LED LIGHT THERAPY) — EACH CARD A CREAM TILE WITH HAIRLINE BORDER, AN INDEX NUMBER, NAME, DURATION/PRICE META, AND A SHORT LINE. CARDS LIFT ON HOVER.

6. **SPLIT "OUR SCIENCE" SECTION** — A TWO-COLUMN BLOCK: ON ONE SIDE A ROUNDED IMAGE OF A CLEAN MODERN LAB, ON THE OTHER A HEADING, PARAGRAPH, AND A SHORT LIST OF STAT/CREDENTIAL ROWS (E.G. 98% SATISFACTION, 12 YEARS, 40+ DERMATOLOGISTS) WITH HAIRLINE DIVIDERS AND A COUNT-UP ANIMATION.

7. **TESTIMONIAL** — A QUIET CENTERED PULL-QUOTE ON CREAM, A SINGLE EXPENSIVE-FEELING REVIEW WITH A NAME AND ROLE, OPTIONAL SMALL STAR ROW.

8. **DARK CLAY CTA BAND** — A FULL-WIDTH DEEP-CLAY SECTION, CREAM TEXT, BIG HEADING ("BEGIN YOUR RITUAL"), SUPPORTING LINE, AND A CREAM PILL CTA.

9. **FOOTER** — CREAM BACKGROUND, MULTI-COLUMN LINK LISTS, LOGOTYPE, SMALL PRINT, ALL IN CLAY/INK ON CREAM WITH HAIRLINE DIVIDERS.

## MOTION / ANIMATION / INTERACTION SPEC

- ON LOAD: HERO HEADLINE WORDS AND CTAS RISE-AND-FADE IN WITH STAGGERED EASE-OUT.
- NAV PILL SUBTLY GAINS SHADOW / BACKGROUND ON SCROLL.
- ACTION-BLOCK IMAGES SCALE 1.05 OVER 0.6S ON HOVER; ARROW ICONS TRANSLATE UP-RIGHT.
- MARQUEE: SEAMLESS INFINITE HORIZONTAL SCROLL.
- SCROLL-REVEAL: SECTIONS FADE-UP VIA INTERSECTION OBSERVER.
- STATS COUNT UP WHEN SCROLLED INTO VIEW.
- TREATMENT CARDS LIFT WITH SHADOW ON HOVER; ALL TRANSITIONS EASED, 300–600MS.
- RESPECT `PREFERS-REDUCED-MOTION`.

## RESPONSIVE BEHAVIOR

- DESKTOP: WIDE MAX-WIDTH (~1280–1728PX), 3-COLUMN GRIDS, FULL FLOATING NAV.
- TABLET: 2-COLUMN GRIDS, HERO HEADLINE SCALES DOWN.
- MOBILE: SINGLE COLUMN, NAV COLLAPSES TO LOGO + HAMBURGER (OR LOGO + CTA), STACKED ACTION BLOCKS, FULL-WIDTH CTAS, REDUCED HERO HEIGHT.

## TECH / DELIVERY

- SELF-CONTAINED STATIC SITE: ONE `INDEX.HTML`, ONE `STYLES.CSS`, ONE `MAIN.JS`. NO BUILD STEP REQUIRED.
- VENDOR ALL ASSETS LOCALLY (FONTS, IMAGES) — NO REMOTE HOTLINKS — SO THE PROJECT RUNS FULLY OFFLINE.
- ACCESSIBLE, SEMANTIC HTML; KEYBOARD-FOCUSABLE CONTROLS; ALT TEXT ON ALL IMAGES.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/auric-clinic-glow-h37).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
