---
name: sencha-atelier-h12
description: |
  A multi-section landing page for Sencha Atelier, a fictional artisanal Japanese tea atelier. The named design language is "Wabi Editorial" — a quiet, gallery-like composition that reads like a printed monograph about tea: warm paper backgrounds, deep pine/moss green as the structural color, and a single warm saffron-amber accent used sparingly, with generous negative space and oversized editorial serif type.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "sencha atelier"
  - "sencha"
  - "atelier"
  - "ceremonial"
  - "japanese"
  - "tea"
  - "house"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/sencha-atelier-h12"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Sencha Atelier — Ceremonial Japanese Tea House Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Sencha Atelier — Ceremonial Japanese Tea House Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A multi-section landing page for Sencha Atelier, a fictional artisanal Japanese tea atelier. The named design language is "Wabi Editorial" — a quiet, gallery-like composition that reads like a printed monograph about tea: warm paper backgrounds, deep pine/moss green as the structural color, and a single warm saffron-amber accent used sparingly, with generous negative space and oversized editorial serif type.

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
<artifact identifier="sencha-atelier-h12" type="text/html" title="Sencha Atelier — Ceremonial Japanese Tea House Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# SENCHA ATELIER — CEREMONIAL TEA HOUSE LANDING PAGE

## AESTHETIC IDENTITY

BUILD A FULL, MULTI-SECTION LANDING PAGE FOR AN ARTISANAL JAPANESE TEA ATELIER NAMED **SENCHA ATELIER**. THE NAMED DESIGN LANGUAGE IS "WABI EDITORIAL" — A QUIET, EXPENSIVE, GALLERY-LIKE COMPOSITION THAT FEELS LIKE A PRINTED MONOGRAPH ABOUT TEA RATHER THAN A SAAS SITE. THE MOOD IS CALM, ARTISANAL, AND PRECISE: WARM PAPER BACKGROUNDS, DEEP PINE/MOSS GREEN AS THE STRUCTURAL COLOR, AND A SINGLE WARM SAFFRON-AMBER ACCENT USED SPARINGLY. EVERYTHING IS DELIBERATELY PLACED WITH GENEROUS NEGATIVE SPACE, HAIRLINE RULES, OVERSIZED EDITORIAL SERIF DISPLAY TYPE, AND SOFT ROUNDED IMAGE CARDS. NO GENERIC GRADIENTS, NO GLASSMORPHISM, NO NEON.

## COLOR PALETTE

- PAPER / BACKGROUND: WARM BONE `#F4F0E6` (PRIMARY CANVAS), SECONDARY PAPER `#EDE7D6`.
- INK / STRUCTURAL GREEN: DEEP PINE `#1E2A1F`, MOSS `#2E3D2A`.
- ACCENT: SAFFRON-AMBER `#D9893B` (USED ONLY FOR SMALL ACCENTS, ARROWS, ACTIVE STATES).
- SOFT ACCENT: SAGE `#9FB08A` FOR SUBTLE TEXT, BORDERS, AND TAGS.
- CONTRAST PANEL TEXT: WARM CHARTREUSE-CREAM `#E7EAC9` ON THE DARK GREEN PANELS.

## TYPOGRAPHY

- DISPLAY / HEADINGS: A HIGH-CONTRAST EDITORIAL SERIF (E.G. "FRAUNCES" OR "PLAYFAIR DISPLAY"), WEIGHTS 400 AND 600, USED AT MASSIVE SIZES WITH TIGHT LEADING (LINE-HEIGHT 0.85–0.95) AND NEGATIVE LETTER-SPACING FOR THE HERO WORDMARK.
- BODY / UI / LABELS: A NEUTRAL GROTESQUE (E.G. "INTER TIGHT" OR "INTER"), WEIGHTS 400/500/600, WITH UPPERCASE WIDE-TRACKED LABELS (LETTER-SPACING ~0.2EM) FOR NAV AND EYEBROWS.
- VENDOR THE FONTS LOCALLY (WOFF2) — DO NOT HOTLINK GOOGLE FONTS AT RUNTIME.

## LAYOUT & SECTION BREAKDOWN

1. **FIXED HEADER / NAV** — TRANSPARENT OVER THE PAPER, BECOMES A BLURRED PAPER BAR WITH A HAIRLINE BOTTOM RULE AFTER SCROLLING ~50PX. LEFT NAV LINKS (MENU, OUR CRAFT), CENTERED CIRCULAR LEAF-MARK LOGO WITH WORDMARK, RIGHT LINK (JOURNAL) PLUS A PILL "RESERVE A SEAT" BUTTON IN PINE GREEN WITH CREAM TEXT.

2. **HERO** — OVERSIZED SERIF WORDMARK "SENCHA" (CLAMP FROM ~96PX TO ~300PX) BOTTOM-ALIGNED WITH A RIGHT-SIDE TAGLINE "CEREMONIAL GRADE MATCHA & A QUIET TEA HOUSE IN KYOTO DISTRICT". A SMALL EYEBROW LABEL ABOVE ("EST. 2014 · STONE-GROUND DAILY"). EVERYTHING ON THE PAPER CANVAS, NO BACKGROUND IMAGE.

3. **SHOWCASE GRID** — A FLUSH ROW OF FOUR CARDS THAT TUCK UP TO A SHARED BASELINE WITH ROUNDED TOP CORNERS: TWO TALL PHOTO CARDS (CEREMONIAL MATCHA BOWL/WHISK, ICED MATCHA LATTE), ONE DEEP-PINE INFO CARD WITH A SAFFRON "EXPLORE THE MENU" BUTTON (ARROW NUDGES ON HOVER) AND THE ADDRESS IN CREAM, AND A FOURTH PHOTO CARD (MINIMAL TEA HOUSE INTERIOR). CARDS STAGGER IN ON SCROLL.

4. **PHILOSOPHY / CRAFT** — A TWO-COLUMN EDITORIAL BLOCK: LEFT A LARGE SERIF STATEMENT ABOUT STONE-GROUND, SINGLE-ORIGIN MATCHA; RIGHT A SHORT PARAGRAPH PLUS THREE NUMBERED CRAFT STEPS (01 SHADE-GROWN, 02 HAND-PICKED, 03 STONE-MILLED) DIVIDED BY HAIRLINE RULES.

5. **MENU / OFFERINGS** — A LIST OF TEA OFFERINGS AS EDITORIAL ROWS (NAME · TASTING NOTE · PRICE) SEPARATED BY HAIRLINES, EACH ROW HIGHLIGHTING ON HOVER WITH A SAFFRON MARKER.

6. **STATS / RIBBON** — A FULL-WIDTH DEEP-PINE BAND WITH THREE OR FOUR LARGE NUMBER STATS IN CREAM (E.G. SINGLE-ORIGIN FARMS, GRAMS STONE-MILLED, YEARS OF CRAFT) WITH SAFFRON UNITS, PLUS A SLOW MARQUEE OF TEA TERMS.

7. **GALLERY / ATMOSPHERE** — AN ASYMMETRIC IMAGE MOSAIC OF THE TEA HOUSE AND PREPARATION, REINFORCING THE ATELIER FEEL.

8. **RESERVE / CTA** — A CENTERED CLOSING BLOCK ON PAPER WITH A LARGE SERIF INVITATION AND A SAFFRON-ACCENTED PILL BUTTON.

9. **FOOTER** — PINE-GREEN, MULTI-COLUMN (NAVIGATE, VISIT, FOLLOW) WITH THE LEAF-MARK, HOURS, ADDRESS, AND A FINE-PRINT BASELINE.

## MOTION / ANIMATION / INTERACTION SPEC

- ON-SCROLL REVEAL: ELEMENTS FADE UP (OPACITY 0 → 1, TRANSLATEY 30PX → 0) WITH A CUBIC-BEZIER(0.22, 1, 0.36, 1) EASE OVER ~1.1S, USING AN INTERSECTIONOBSERVER. SHOWCASE CARDS USE STAGGERED TRANSITION-DELAYS (100/250/400/550MS).
- HEADER COLOR/BLUR TRANSITION ON SCROLL.
- BUTTON ARROW ICONS TRANSLATE DIAGONALLY ON HOVER; MENU ROWS SLIDE A SAFFRON MARKER IN ON HOVER.
- STATS NUMBERS COUNT UP WHEN SCROLLED INTO VIEW.
- A SLOW INFINITE MARQUEE OF TEA TERMS IN THE RIBBON.
- RESPECT `PREFERS-REDUCED-MOTION` — DISABLE TRANSFORMS AND COUNT-UPS FOR USERS WHO REQUEST IT.

## RESPONSIVE BEHAVIOR

- DESKTOP (≥1024PX): MULTI-COLUMN LAYOUTS, FOUR-CARD FLUSH SHOWCASE ROW, HERO WORDMARK AND TAGLINE SIDE BY SIDE BOTTOM-ALIGNED.
- TABLET: SHOWCASE COLLAPSES TO TWO COLUMNS, PHILOSOPHY STACKS.
- MOBILE (<640PX): SINGLE COLUMN, WORDMARK SCALES DOWN GRACEFULLY, NAV CONDENSES, CARDS STACK FULL-WIDTH WITH ROUNDED CORNERS, ALL TYPE REMAINS LEGIBLE.

## TECHNICAL NOTES

- PLAIN STATIC HTML + CSS + VANILLA JS (NO BUILD STEP REQUIRED), OR A LIGHT VITE SETUP — EITHER IS FINE.
- VENDOR ALL ASSETS LOCALLY: FONTS (WOFF2) AND ALL PHOTOGRAPHY DOWNLOADED INTO AN `ASSETS/` FOLDER AND REFERENCED BY RELATIVE PATHS, SO THE PROJECT RUNS FULLY OFFLINE.
- SEMANTIC, ACCESSIBLE MARKUP; SUFFICIENT COLOR CONTRAST; KEYBOARD-FOCUSABLE INTERACTIVE ELEMENTS.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/sencha-atelier-h12).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
