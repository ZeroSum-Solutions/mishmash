---
name: tide-table-h82
description: |
  **Tide & Table** is a refined, editorial landing page for a fictional high-end coastal seafood and oyster bar. The mood is quiet luxury meets Atlantic maritime — bright, airy, salt-washed, with deep-navy ink on a clean off-white page, art-directed like a Michelin-level restaurant magazine spread. High-contrast uppercase serif headlines against a tight grotesque sans, with a fine grain overlay for tactile print feel — an ideal restaurant landing page for upscale dining, coastal cuisine, and seasonal seafood brands.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "tide & table"
  - "tide"
  - "table"
  - "coastal"
  - "seafood"
  - "oyster"
  - "bar"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/tide-table-h82"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Tide & Table — Coastal Seafood & Oyster Bar Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Tide & Table — Coastal Seafood & Oyster Bar Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

**Tide & Table** is a refined, editorial landing page for a fictional high-end coastal seafood and oyster bar. The mood is quiet luxury meets Atlantic maritime — bright, airy, salt-washed, with deep-navy ink on a clean off-white page, art-directed like a Michelin-level restaurant magazine spread. High-contrast uppercase serif headlines against a tight grotesque sans, with a fine grain overlay for tactile print feel — an ideal restaurant landing page for upscale dining, coastal cuisine, and seasonal seafood brands.

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
<artifact identifier="tide-table-h82" type="text/html" title="Tide & Table — Coastal Seafood & Oyster Bar Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# TIDE & TABLE — COASTAL SEAFOOD & OYSTER BAR LANDING PAGE

## AESTHETIC IDENTITY

BUILD A REFINED, EDITORIAL LANDING PAGE FOR A FICTIONAL HIGH-END COASTAL SEAFOOD AND OYSTER BAR CALLED **TIDE & TABLE**. THE MOOD IS QUIET LUXURY MEETS ATLANTIC MARITIME: BRIGHT, AIRY, SALT-WASHED, WITH DEEP-NAVY INK ON A CLEAN OFF-WHITE PAGE. THINK A MICHELIN-LEVEL RESTAURANT THAT ALSO READS LIKE A WELL-ART-DIRECTED MAGAZINE SPREAD. THE NAMED IDENTITY IS "TIDE TO TABLE" — A LIVING, SEASONAL MENU DRIVEN BY WHAT THE OCEAN GIVES THAT DAY.

## COLOR PALETTE

- DEEP NAVY INK (PRIMARY TEXT / DARK SECTIONS): `#16324F`
- SOFT SKY / SEAFOAM ACCENT: `#9DD3D4`
- SALT CREAM (PAGE BACKGROUND): `#F6F5F0`
- PURE WHITE (CARDS): `#FFFFFF`
- MUTED STEEL BLUE (SECONDARY TEXT): `#4A7A93`
- WARM SAND HAIRLINE / DIVIDERS: NAVY AT 8–12% OPACITY
- A FINE GRAIN/NOISE TEXTURE OVERLAY AT ~4–5% OPACITY ACROSS THE WHOLE PAGE FOR TACTILE PRINT FEEL.

## TYPOGRAPHY

- DISPLAY / HEADLINES: A HIGH-CONTRAST SERIF (PLAYFAIR DISPLAY OR SIMILAR), WEIGHTS 700–800, UPPERCASE, VERY TIGHT LEADING (~0.85) AND TIGHT TRACKING.
- BODY / UI / LABELS: A TIGHT GROTESQUE SANS (INTER TIGHT / INTER), WEIGHTS 400–700.
- EYEBROW LABELS: SANS, UPPERCASE, 9–11PX, LETTER-SPACING ~0.35–0.4EM, BOLD.
- HERO HEADLINE SCALES FLUIDLY VIA CLAMP FROM ~44PX MOBILE TO ~150PX DESKTOP.
- VENDOR FONTS LOCALLY (WOFF2) — DO NOT HOTLINK GOOGLE FONTS.

## LAYOUT & SECTION BREAKDOWN

1. **STICKY TOP BAR**: LEFT WORDMARK "TIDE & TABLE" IN SERIF UPPERCASE; RIGHT A COMPACT NAVY "STATUS PANEL" PILL SHOWING A SMALL TWO-CELL INFO GRID ("MENU / LOCATIONS" + "OCEAN FRESH" TAGLINE) AND A HAMBURGER GLYPH WITH ASYMMETRIC BARS THAT ANIMATE ON HOVER.

2. **HERO** (MIN 90VH, ON CREAM): FIVE RHYTHMIC VERTICAL IMAGE STRIPS RISING FROM THE BOTTOM EDGE, ROUNDED TOPS, IMAGES DESATURATED/MULTIPLY-BLENDED INTO THE NAVY TINT SO THEY READ AS A TEXTURED BACKDROP RATHER THAN PHOTOS. STRIPS STAGGER-REVEAL UPWARD ON LOAD. CENTERED HERO HEADLINE "TIDE & TABLE / COASTAL." IN GIANT SERIF, WITH A SPACED UPPERCASE SUBLINE "REFINED DINING — TIDE TO TABLE".

3. **PHILOSOPHY** (TWO-COLUMN, CREAM): LEFT = EYEBROW "OUR PHILOSOPHY", BIG SERIF "THE DEEP / ATLANTIC.", A PARAGRAPH, AND AN UNDERLINED ARROW LINK "EXPLORE HERITAGE". RIGHT = A TALL 4:5 ROUNDED IMAGE WITH A SLOW KEN-BURNS PAN.

4. **SEASONAL HARVEST MENU** (NAVY SECTION, SEAFOAM ACCENTS): SECTION HEAD "SEASONAL / HARVEST." WITH A SEAFOAM "FULL LIST" PILL BUTTON. BELOW, A TWO-COLUMN INTERACTIVE MENU LIST OF SIX DISHES (CATEGORY EYEBROW, DISH NAME, PRICE, HAIRLINE). HOVERING A ROW NUDGES IT, COLORS THE NAME SEAFOAM, AND FLOATS A SMALL ROTATED IMAGE CARD ABOVE THE ROW THAT STRAIGHTENS ON HOVER.

5. **ATMOSPHERE** (EDITORIAL OVERLAP, CREAM): A WIDE 16:9 TERRACE IMAGE WITH A NAVY BOTTOM GRADIENT, AND AN OVERLAPPING WHITE CARD PULLED LEFT OVER IT CONTAINING "SUNSET / VESTIGE.", COPY, AND AN OUTLINE PILL "EXPLORE SPACE".

6. **RESERVATION** (ARCHITECTURAL SPLIT CARD, NAVY): A SINGLE ROUNDED NAVY CARD SPLIT IN TWO. LEFT = "JOIN THE / TABLE.", COPY, HOURS WITH A HAIRLINE RULE. RIGHT = A GLASSY RESERVATION FORM (DATE, GUESTS SELECT, NAME, "SECURE TABLE" BUTTON) WITH UNDERLINE-STYLE INPUTS THAT FOCUS TO SEAFOAM. SUBMIT SHOWS A GRACEFUL INLINE CONFIRMATION.

7. **FOOTER** (NAVY): GIANT SERIF "TIDE & TABLE." WORDMARK, MISSION PARAGRAPH IN SEAFOAM, EXPLORE + VISIT COLUMNS, AND A BOTTOM HAIRLINE ROW WITH COPYRIGHT AND LEGAL LINKS.

8. **FLOATING "RESERVE" PILL**: FIXED BOTTOM-RIGHT NAVY PILL WITH AN ARROW THAT SLIDES ON HOVER.

9. **FULL-SCREEN MENU OVERLAY**: HAMBURGER OPENS A NAVY FULL-SCREEN PANEL SLIDING IN FROM THE RIGHT WITH GIANT SERIF NAV LINKS (MENU, WINES, OUR STORY, RESERVATION) THAT TINT SEAFOAM ON HOVER, AND A CLOSE "X" THAT ROTATES ON HOVER.

## MOTION / ANIMATION / INTERACTION

- ON-LOAD: HERO STRIPS RISE FROM TRANSLATEY(110%) TO 0 WITH STAGGERED DELAYS AND A SMOOTH EASE (CUBIC-BEZIER(0.16,1,0.3,1)).
- SCROLL REVEAL: ALL MAJOR BLOCKS FADE+RISE 30PX INTO PLACE VIA INTERSECTIONOBSERVER, ONCE.
- MENU ROWS: HOVER NUDGE + COLOR SHIFT + FLOATING ROTATED IMAGE CARD THAT STRAIGHTENS.
- KEN-BURNS SLOW PAN ON THE PHILOSOPHY IMAGE (~20S ALTERNATE).
- HAMBURGER BARS, ARROW LINKS, AND THE FLOATING PILL ALL HAVE MICRO HOVER TRANSITIONS.
- RESPECT `PREFERS-REDUCED-MOTION` BY DISABLING TRANSFORM ANIMATIONS.

## RESPONSIVE BEHAVIOR

- MOBILE: HERO STRIPS SHRINK, HEADLINE CLAMPS DOWN, MENU AND PHILOSOPHY COLLAPSE TO SINGLE COLUMN, RESERVATION CARD STACKS VERTICALLY, STATUS-PANEL INFO GRID HIDES LEAVING JUST THE HAMBURGER.
- KEEP COMFORTABLE PADDING AND GENEROUS WHITESPACE AT ALL BREAKPOINTS.

## TECHNICAL NOTES

- SELF-CONTAINED: VANILLA HTML + CSS + A LITTLE JS, NO BUILD STEP REQUIRED (STATIC SERVE).
- VENDOR ALL ASSETS LOCALLY: FONTS (WOFF2), ALL IMAGERY, AND THE NOISE TEXTURE. REFERENCE WITH RELATIVE PATHS SO IT RUNS FULLY OFFLINE.
- POLISHED, DISTINCTIVE, NON-GENERIC: TREAT EVERY HAIRLINE, SHADOW, AND SPACING DECISION WITH CARE.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/tide-table-h82).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
