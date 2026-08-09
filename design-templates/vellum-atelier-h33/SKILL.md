---
name: vellum-atelier-h33
description: |
  A multi-section editorial landing page for **Vellum**, a fictional London high-end hair atelier, styled in the "Sculptural Serif Atelier" design language — a gallery-quiet, couture-editorial aesthetic where oversized display typography, generous negative space, and deep rounded image panels make the page feel like a printed lookbook. The warm paper canvas is punctuated by near-black ink type and a single gold accent; extremely large border radii (120–140 px on hero and CTA panels) are a signature detail. Typography pairs heavy geometric Unbounded for display with Figtree as a humanist body sans and flowing Sacramento script in gold for eyebrow labels, all locally vendored.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "vellum"
  - "sculptural"
  - "serif"
  - "atelier"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/vellum-atelier-h33"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Vellum — Sculptural Serif Atelier Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Vellum — Sculptural Serif Atelier Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A multi-section editorial landing page for **Vellum**, a fictional London high-end hair atelier, styled in the "Sculptural Serif Atelier" design language — a gallery-quiet, couture-editorial aesthetic where oversized display typography, generous negative space, and deep rounded image panels make the page feel like a printed lookbook. The warm paper canvas is punctuated by near-black ink type and a single gold accent; extremely large border radii (120–140 px on hero and CTA panels) are a signature detail. Typography pairs heavy geometric Unbounded for display with Figtree as a humanist body sans and flowing Sacramento script in gold for eyebrow labels, all locally vendored.

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
<artifact identifier="vellum-atelier-h33" type="text/html" title="Vellum — Sculptural Serif Atelier Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# VELLUM — SCULPTURAL SERIF ATELIER (LUXURY HAIR DESIGN LANDING PAGE)

BUILD A FULL, MULTI-SECTION, FULLY RESPONSIVE EDITORIAL LANDING PAGE FOR A FICTIONAL LONDON HIGH-END HAIR ATELIER NAMED **VELLUM**. THE NAMED DESIGN LANGUAGE IS **"SCULPTURAL SERIF ATELIER"**: A GALLERY-QUIET, COUTURE-EDITORIAL AESTHETIC WHERE OVERSIZED DISPLAY TYPOGRAPHY, GENEROUS NEGATIVE SPACE, AND DEEP ROUNDED IMAGE PANELS MAKE THE PAGE FEEL LIKE A PRINTED LOOKBOOK THAT BREATHES. THE MOOD IS PRECISE, CONFIDENT, TACTILE, AND UNHURRIED — "ARCHITECTURAL PRECISION MEETS FLUID ARTISTRY."

## DESIGN LANGUAGE & MOOD

- WARM PAPER CANVAS WITH NEAR-BLACK INK TYPOGRAPHY AND A SINGLE GOLD ACCENT; NOTHING SHOUTS, EVERYTHING IS CONSIDERED.
- VERY LARGE BORDER RADII ARE A SIGNATURE: HERO AND CTA PANELS USE EXTREME TOP-ROUNDED SECTION CORNERS (~120–140PX) SO DARK PANELS READ LIKE SOFT SCOOPS RISING OUT OF THE PAPER; IMAGE CARDS USE ~40PX RADIUS.
- A PILL-OUTLINED NAVIGATION BAR (FULL THIN INK BORDER, ~20PX RADIUS) SITS AT THE TOP, CENTERED LOGO FLANKED BY LINKS.
- NO GENERIC-AI-SLOP: NO PURPLE GRADIENTS, NO GLASSMORPHISM, NO NEON. JUST PAPER, INK, GOLD, AND PHOTOGRAPHY.

## COLOR PALETTE

- INK / CHARCOAL: `#0C0B08` (PRIMARY TEXT, BORDERS, DARK PANELS).
- PAPER / BACKGROUND: `#F4F1EA` (WARM OFF-WHITE PAGE BACKGROUND).
- SURFACE WHITE: `#FFFFFF` (FLOATING QUOTE CARD).
- GOLD ACCENT: `#C5A059` (SCRIPT EYEBROWS, HOVERS, KEY PRICES, DECORATIVE TYPE).
- HAIRLINE ON DARK: `#2E2E2E` (DIVIDERS INSIDE DARK PANELS).
- MUTED INK: ~70–80% OPACITY OF INK FOR SECONDARY COPY.

## TYPOGRAPHY

- DISPLAY / PRIMARY: A HEAVY GEOMETRIC DISPLAY FAMILY (E.G. **UNBOUNDED**, WEIGHTS 600/700) — USED FOR THE OVERSIZED HERO WORDMARK, SECTION HEADS, SERVICE NAMES, PRICES; ALWAYS UPPERCASE WITH TIGHT TRACKING.
- BODY / SECONDARY: A CLEAN HUMANIST SANS (E.G. **FIGTREE**, 400/600) — SUBHEADS, BODY COPY, NAV LINKS, FORM.
- SIGNATURE / SCRIPT: A FLOWING CURSIVE (E.G. **SACRAMENTO**) IN GOLD — USED FOR SMALL "EYEBROW" LABELS ABOVE SECTION HEADS ("THE ART OF THE CUT", "SECURE YOUR SESSION").
- THE HERO WORDMARK IS ENORMOUS — ~14VW, LINE-HEIGHT ~0.85 — AND SPANS THE FULL WIDTH.

## LAYOUT & SECTION BREAKDOWN (TOP TO BOTTOM)

1. **HEADER + HERO WORDMARK**: PILL NAV (LINKS LEFT/RIGHT OF A CENTERED "VELLUM" LOGO; MOBILE COLLAPSES TO A HAMBURGER THAT SLIDES A FULL-SCREEN MENU IN FROM THE RIGHT). BELOW IT, THE GIANT UPPERCASE WORDMARK "VELLUM" RENDERED CHARACTER-BY-CHARACTER, FOLLOWED BY A CENTERED MAX-WIDTH SUBHEAD ABOUT ARCHITECTURAL PRECISION AND FLUID ARTISTRY.
2. **HERO IMAGE PANEL**: ONE FULL-WIDTH, TALL (~900PX DESKTOP) IMAGE OF A LUXURY SALON INTERIOR INSIDE AN EXTREME TOP-ROUNDED CONTAINER, WITH A SLOW SCALE-IN ZOOM ON SCROLL.
3. **PHILOSOPHY (TWO-COLUMN)**: LEFT = GOLD SCRIPT EYEBROW "THE ART OF THE CUT", BIG UPPERCASE HEAD "EVERY STRAND IS A CANVAS.", A PARAGRAPH, AND AN OUTLINED PILL BUTTON. RIGHT = A PORTRAIT 4:5 IMAGE CARD WITH A WHITE FLOATING QUOTE CARD OVERLAPPING ITS BOTTOM-LEFT CORNER (FOUNDER PULL-QUOTE IN ITALIC + GOLD ATTRIBUTION).
4. **THE MENU (DARK PANEL)**: INK-BLACK SECTION WITH TOP-ROUNDED CORNERS. HEAD "THE MENU" + INTRO. THEN A LIST OF SERVICE ROWS SEPARATED BY THIN HAIRLINES; EACH ROW HAS A SERVICE NAME, ONE-LINE DESCRIPTION, A "FROM £X" PRICE, AND A CIRCULAR ARROW BUTTON. ON HOVER THE ROW GAINS HORIZONTAL PADDING, THE TEXT NUDGES RIGHT, THE ARROW CIRCLE INVERTS, AND A SMALL PREVIEW PHOTO FADES/FLOATS IN ON THE RIGHT (TRACKING THE CURSOR SLIGHTLY).
5. **THE PORTFOLIO**: CENTERED HEAD, THEN A 3-UP GRID OF TALL 3:4 IMAGE CARDS (MIDDLE CARD OFFSET DOWNWARD ON DESKTOP FOR RHYTHM); EACH CARD ZOOMS ON HOVER WITH A DARK OVERLAY REVEALING THE LOOK'S NAME, STAGGER-REVEALED ON SCROLL.
6. **BOOKING CTA (DARK PANEL)**: EXTREME-ROUNDED INK PANEL WITH A HUGE GHOSTED BACKGROUND LETTER "V" AT 5% OPACITY, GOLD SCRIPT EYEBROW, BIG HEAD "DEFINE YOUR LOOK", COPY, AND TWO BUTTONS (SOLID PAPER "BOOK ONLINE" + OUTLINED "CALL ATELIER").
7. **FOOTER (DARK)**: NEWSLETTER SIGNUP (UNDERLINE INPUT + "JOIN"), ADDRESS / PHONE / SOCIAL LINKS, A HUGE GHOSTED "VELLUM" WORDMARK AT ~10% OPACITY, AND A BOTTOM LEGAL BAR.

## MOTION / ANIMATION / INTERACTION SPEC

- **HERO WORDMARK**: EACH LETTER APPEARS WITH A STAGGERED RISE-IN + SLIGHT SCALE, THEN BRIEFLY "DANCES" (GENTLE FLOAT/ROTATE LOOP) FOR ~2.8S BEFORE SETTLING.
- **SCROLL REVEALS**: AN INTERSECTIONOBSERVER FADES + TRANSLATES SECTIONS UP (OPACITY 0→1, Y 40PX→0) WITH A CUBIC-BEZIER(0.22,1,0.36,1) EASE; IMAGES MARKED FOR ZOOM SCALE FROM 1.1→1 OVER ~2S.
- **STAGGERED CHILDREN**: PORTFOLIO GRID REVEALS ITS CARDS WITH INCREASING DELAY.
- **MENU HOVER**: PADDING EXPANSION, TEXT SHIFT, ARROW INVERSION, AND A CURSOR-TRACKED PREVIEW IMAGE THAT TRANSLATES/ROTATES SLIGHTLY WITH MOUSE X.
- **MOBILE MENU**: SLIDES IN FROM THE RIGHT (TRANSLATE-X), LOCKS BODY SCROLL, CLOSES ON LINK TAP.
- RESPECT `prefers-reduced-motion`.

## RESPONSIVE BEHAVIOR

- DESKTOP: MAX CONTENT WIDTH ~1440PX, TWO-COLUMN PHILOSOPHY, 3-UP PORTFOLIO WITH OFFSET MIDDLE CARD, MENU PREVIEW IMAGES VISIBLE.
- TABLET/MOBILE: SINGLE COLUMN; NAV COLLAPSES TO HAMBURGER + SLIDE-IN MENU; HERO WORDMARK SCALES WITH VIEWPORT; PORTFOLIO STACKS; FLOATING QUOTE CARD HIDES ON SMALL SCREENS; MENU PREVIEW IMAGES HIDE.

## AESTHETIC IDENTITY

THE NAMED IDENTITY IS **"SCULPTURAL SERIF ATELIER"** FOR THE FICTIONAL BRAND **VELLUM** — A QUIET, COUTURE, GALLERY-GRADE HAIR-DESIGN STUDIO WHERE TYPE IS ARCHITECTURE, PHOTOGRAPHY IS SCULPTURE, AND GOLD IS THE ONLY VOICE THAT EVER RAISES ABOVE A WHISPER. BUILD IT SELF-CONTAINED WITH ALL FONTS AND IMAGES VENDORED LOCALLY.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/vellum-atelier-h33).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
