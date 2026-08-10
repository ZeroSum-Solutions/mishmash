---
name: verdant-spine-clinic-h66
description: |
  A full, multi-section, fully responsive marketing landing page for **Verdant Spine**, a fictional high-end chiropractic and movement-science clinic, styled in the "Clinical Calm" aesthetic. The design collides medical precision with the grounded, botanical stillness of a wellness retreat — Scandinavian health-spa meets sports-medicine — carried by a single sage-green brand color (`rgb(97, 142, 100)`) across a soft warm-grey-green paper canvas. The signature feature is a **glassmorphic appointment card** floating over the rounded hero image. Display headlines use Schibsted Grotesk with tight negative tracking over Inter body type, both locally vendored.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "verdant spine"
  - "verdant"
  - "spine"
  - "precision"
  - "chiropractic"
  - "movement-science"
  - "clinic"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/verdant-spine-clinic-h66"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Verdant Spine — Precision Chiropractic & Movement-Science Clinic Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Verdant Spine — Precision Chiropractic & Movement-Science Clinic Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A full, multi-section, fully responsive marketing landing page for **Verdant Spine**, a fictional high-end chiropractic and movement-science clinic, styled in the "Clinical Calm" aesthetic. The design collides medical precision with the grounded, botanical stillness of a wellness retreat — Scandinavian health-spa meets sports-medicine — carried by a single sage-green brand color (`rgb(97, 142, 100)`) across a soft warm-grey-green paper canvas. The signature feature is a **glassmorphic appointment card** floating over the rounded hero image. Display headlines use Schibsted Grotesk with tight negative tracking over Inter body type, both locally vendored.

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
<artifact identifier="verdant-spine-clinic-h66" type="text/html" title="Verdant Spine — Precision Chiropractic & Movement-Science Clinic Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# VERDANT SPINE — PRECISION CHIROPRACTIC & MOVEMENT-SCIENCE CLINIC LANDING PAGE

BUILD A FULL, MULTI-SECTION, FULLY RESPONSIVE MARKETING LANDING PAGE FOR A FICTIONAL HIGH-END CHIROPRACTIC AND MOVEMENT-SCIENCE CLINIC NAMED **VERDANT SPINE**. THE NAMED AESTHETIC IDENTITY IS **"CLINICAL CALM"** — THE COLLISION OF MEDICAL PRECISION WITH THE GROUNDED, BOTANICAL STILLNESS OF A WELLNESS RETREAT. THE MOOD IS QUIET, EXPENSIVE, TRUSTWORTHY, AND RESTORATIVE: A MODERN REHABILITATION CLINIC WHERE EVERY EDGE IS SOFTLY ROUNDED, EVERY SURFACE BREATHES, AND THE SCIENCE FEELS LIKE A RITUAL. THINK SCANDINAVIAN HEALTH-SPA-MEETS-SPORTS-MEDICINE: RESTRAINT, GENEROUS NEGATIVE SPACE, AND A SINGLE SAGE-GREEN BRAND COLOR THAT CARRIES THE ENTIRE IDENTITY. STRICTLY AVOID GENERIC SAAS GRADIENTS, NEON, EMOJI, AND AI-SLOP AESTHETICS.

## DESIGN LANGUAGE & MOOD

- A CALM, EDITORIAL, ALMOST PRINT-LIKE COMPOSITION. EVERYTHING SITS ON A SOFT, WARM-GREY-GREEN PAPER BACKGROUND, NEVER PURE WHITE.
- OVERSIZED, TIGHTLY-TRACKED GROTESK DISPLAY TYPE FOR HEADLINES; CLEAN NEUTRAL SANS FOR BODY.
- ROUNDED-CORNER IMAGE CARDS (10–20PX RADIUS) WITH HAIRLINE BORDERS.
- A SIGNATURE **GLASSMORPHIC APPOINTMENT CARD** FLOATING OVER THE HERO IMAGE — FROSTED, SEMI-TRANSPARENT WHITE WITH BACKDROP-BLUR.
- ONE DEEP FOREST-GREEN PANEL ANCHORS THE SERVICES SECTION FOR HIGH CONTRAST.

## EXACT COLOR PALETTE

- BRAND PRIMARY (SAGE): `rgb(97, 142, 100)` — BUTTONS, ACCENTS, LINK HIGHLIGHTS.
- BRAND SECONDARY (DEEP FOREST): `rgb(62, 92, 64)` — DARK PANELS, LOGO, FOOTER.
- NEUTRAL BACKGROUND (PAPER): `rgb(236, 239, 236)` — PAGE CANVAS.
- TEXT PRIMARY: `rgb(51, 51, 51)`.
- TEXT SECONDARY: `rgb(96, 96, 96)`.
- TEXT ON BRAND: `rgb(255, 255, 255)`.
- HAIRLINE BORDERS: `#d0d0d0`.

## TYPOGRAPHY

- DISPLAY / HEADINGS: **SCHIBSTED GROTESK**, WEIGHTS 600 & 700, USED FOR THE LOGO (ITALIC), ALL H1–H3, OVERSIZED STAT NUMBERS, AND THE MARQUEE.
- BODY / UI: **INTER**, WEIGHTS 400/500/600, USED FOR PARAGRAPHS, LABELS, NAV, AND CAPTIONS.
- HEADLINES USE NEGATIVE LETTER-SPACING (-2PX TO -3PX) AND TIGHT LEADING (0.9–1.2). UPPERCASE MICRO-LABELS USE WIDE TRACKING (1.5PX) AND 12PX BOLD.

## LAYOUT & SECTION BREAKDOWN (TOP TO BOTTOM)

1. **THIN TOP BAR** — A SLIM DEEP-FOREST STRIP (~33PX) ACROSS THE TOP ON DESKTOP.
2. **NAVIGATION** — LOGO "VERDANT SPINE" (ITALIC GROTESK), CENTER NAV LINKS (HOME / ABOUT / SERVICES / A "PAGES" HOVER-DROPDOWN), AND AN OUTLINED "MAKE APPOINTMENT" PILL THAT FILLS FOREST-GREEN ON HOVER. COLLAPSES TO A FULL-SCREEN SLIDE-IN MOBILE MENU.
3. **HERO** — A SPLIT TITLE ROW (LARGE TWO-LINE HEADLINE LEFT, SHORT SUPPORTING PARAGRAPH RIGHT-ALIGNED) ABOVE A LARGE ROUNDED HERO IMAGE OF A CALM CLINIC INTERIOR. A FROSTED GLASS **APPOINTMENT FORM CARD** (NAME / EMAIL / MESSAGE / SUBMIT) FLOATS ON THE RIGHT EDGE OF THE IMAGE.
4. **ABOUT** — A LARGE EDITORIAL STATEMENT HEADLINE, TWO TALL GRADIENT-OVERLAID STAT CARDS (E.G. "95% SATISFIED CLIENTS", "15+ YEARS"), A SHORT BODY PARAGRAPH WITH A "LEARN MORE" BUTTON, AND A WIDE 16:9 VIDEO/IMAGE PANEL WITH A GLASS PLAY BUTTON.
5. **SERVICES** — A DEEP-FOREST FULL-WIDTH SECTION. AN INFINITE HORIZONTAL **MARQUEE** OF GIANT UPPERCASE TYPE ("EXPERT CARE • REAL RESULTS •"), A CENTERED SECTION TITLE, AND THREE WHITE SERVICE CARDS (TITLE + "READ MORE" + SQUARE IMAGE THAT ZOOMS ON HOVER).
6. **HOW IT WORKS** — A STICKY LEFT FOREST-GREEN PANEL BESIDE THREE SCROLLING NUMBERED STEPS (01 / 02 / 03) WITH GIANT NUMERALS AND HAIRLINE DIVIDERS.
7. **TESTIMONIALS** — A HORIZONTAL SCROLL-SNAP CAROUSEL OF TALL IMAGE CARDS WITH FROSTED GLASS QUOTE OVERLAYS, DRIVEN BY PREV/NEXT CIRCULAR BUTTONS.
8. **BLOG** — A THREE-COLUMN GRID OF ARTICLE CARDS (SQUARE IMAGE, DATE • CATEGORY META, BOLD TITLE THAT TURNS SAGE ON HOVER).
9. **FOOTER** — A LARGE ROUNDED DEEP-FOREST PANEL HOLDING A NEWSLETTER SIGN-UP (HEADLINE + EMAIL INPUT + SUBSCRIBE BUTTON) ABOVE LINK COLUMNS, PLUS A THIN COPYRIGHT ROW BELOW.

## HERO COMPOSITION DETAIL

- LEFT: H1 IN TWO LINES, SECOND LINE IN SAGE GREEN (E.G. "RESTORING MOTION, / EMPOWERING LIFE").
- RIGHT: A ~320PX SUPPORTING PARAGRAPH, BOTTOM-ALIGNED WITH THE HEADLINE BASELINE.
- BELOW: A FULL-WIDTH ROUNDED IMAGE (CLINIC INTERIOR) FILLING THE REMAINING VIEWPORT HEIGHT, WITH THE FROSTED GLASS APPOINTMENT CARD PINNED RIGHT.

## MOTION / ANIMATION / INTERACTION SPEC

- **SCROLL-REVEAL**: ELEMENTS FADE UP (OPACITY 0 → 1, TRANSLATEY 30PX → 0) VIA INTERSECTIONOBSERVER WITH A SOFT `cubic-bezier(0.16, 1, 0.3, 1)` EASE OVER ~0.8S.
- **MARQUEE**: SEAMLESS INFINITE LEFTWARD TRANSLATE LOOP (~20S LINEAR).
- **FLOAT**: A SUBTLE 6S EASE-IN-OUT VERTICAL FLOAT AVAILABLE FOR DECORATIVE ELEMENTS.
- **HOVER**: SERVICE/BLOG IMAGES SCALE TO 1.05; BUTTONS INVERT TO FOREST-GREEN; LINKS SHIFT TO SAGE.
- **TESTIMONIAL CAROUSEL**: SMOOTH `scrollBy` PER CARD WIDTH, WITH PREV/NEXT BUTTON OPACITY REFLECTING SCROLL BOUNDS.
- **STICKY**: THE "HOW IT WORKS" LEFT PANEL STICKS WHILE STEPS SCROLL PAST.
- **MOBILE MENU**: SLIDES IN FROM THE RIGHT (TRANSLATE-X), LOCKS BODY SCROLL.

## RESPONSIVE BEHAVIOR

- DESKTOP: MULTI-COLUMN GRIDS, FULL NAV, ~1400PX MAX CONTENT WIDTH, HERO ≈ FULL VIEWPORT HEIGHT.
- TABLET: STACKED GRIDS, REDUCED MARQUEE/HEADLINE SIZES.
- MOBILE: SINGLE COLUMN, HAMBURGER MENU, FULL-WIDTH CARDS, TESTIMONIALS BECOME A SWIPEABLE ONE-CARD SCROLLER, TOP BAR HIDDEN.

## DELIVERABLE

A SELF-CONTAINED, OFFLINE-RUNNABLE PROJECT WITH ALL ASSETS (FONTS + IMAGES) VENDORED LOCALLY. THE NAMED AESTHETIC IDENTITY IS **"CLINICAL CALM"**, AND THE BRAND IS **VERDANT SPINE — PRECISION CHIROPRACTIC & WELLNESS**.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/verdant-spine-clinic-h66).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
