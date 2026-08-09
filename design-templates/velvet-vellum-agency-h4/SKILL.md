---
name: velvet-vellum-agency-h4
description: |
  A fully responsive, multi-section marketing agency landing page for **Velvet Vellum**, a fictional precision marketing consultancy, built in the "Velvet Precision" design language. The mood is quiet luxury meets surgical rigor: a warm near-white paper canvas (`#FBF9F6`) punctuated by deep oxblood/maroon (`#651C24`) panels, generous negative space, oversized editorial display type, and precise, restrained micro-interactions — a high-end consultancy prospectus, never playful or generic. Typography pairs geometric-elegant Josefin Sans for headlines with Space Grotesk body copy and a monospace family for the wordmark, footer labels, and uppercase eyebrows, all locally vendored.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "velvet vellum"
  - "velvet"
  - "vellum"
  - "precision"
  - "marketing"
  - "agency"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/velvet-vellum-agency-h4"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Velvet Vellum — Precision Marketing Agency Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Velvet Vellum — Precision Marketing Agency Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A fully responsive, multi-section marketing agency landing page for **Velvet Vellum**, a fictional precision marketing consultancy, built in the "Velvet Precision" design language. The mood is quiet luxury meets surgical rigor: a warm near-white paper canvas (`#FBF9F6`) punctuated by deep oxblood/maroon (`#651C24`) panels, generous negative space, oversized editorial display type, and precise, restrained micro-interactions — a high-end consultancy prospectus, never playful or generic. Typography pairs geometric-elegant Josefin Sans for headlines with Space Grotesk body copy and a monospace family for the wordmark, footer labels, and uppercase eyebrows, all locally vendored.

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
<artifact identifier="velvet-vellum-agency-h4" type="text/html" title="Velvet Vellum — Precision Marketing Agency Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# VELVET VELLUM — A "VELVET PRECISION" MARKETING-AGENCY LANDING PAGE

## AESTHETIC IDENTITY

BUILD A FULLY RESPONSIVE, MULTI-SECTION MARKETING-AGENCY LANDING PAGE NAMED **VELVET VELLUM** IN A DESIGN LANGUAGE CALLED **"VELVET PRECISION."** THE MOOD IS QUIET LUXURY MEETS SURGICAL RIGOR: A WARM, NEAR-WHITE PAPER CANVAS PUNCTUATED BY DEEP OXBLOOD/MAROON PANELS, GENEROUS NEGATIVE SPACE, OVERSIZED EDITORIAL DISPLAY TYPE, AND PRECISE, RESTRAINED MICRO-INTERACTIONS. IT SHOULD FEEL LIKE A HIGH-END CONSULTANCY PROSPECTUS — CONFIDENT, EXPENSIVE, AND ENGINEERED, NEVER PLAYFUL OR GENERIC.

## COLOR PALETTE (EXACT)

- BRAND PRIMARY (SIGNATURE MAROON): `RGB(101, 28, 36)` / `#651C24`
- BRAND DEEP (DARKER MAROON FOR HOVER/SHADOW): `#4A141A`
- BRAND INK (NEAR-BLACK TEXT): `#0B0A0A` / `#050505`
- TEXT SECONDARY (MUTED): `#4A4A4A`
- PAPER BACKGROUND (WARM WHITE): `#FBF9F6`
- SURFACE (OFF-WHITE CARD): `#F4F1EC`
- BORDER (HAIRLINE): `RGBA(11, 10, 10, 0.08)`
- ACCENT GOLD (SPARINGLY, FOR STARS/DOTS/RULES): `#C8A24B`
- WHITE: `#FFFFFF`

## TYPOGRAPHY

- DISPLAY / HEADINGS: A GEOMETRIC-ELEGANT SANS WITH LIGHT-TO-MEDIUM WEIGHTS — **JOSEFIN SANS** (300, 400, 600, 700). USE VERY TIGHT TRACKING (`-0.03EM`) AND TIGHT LINE-HEIGHT (0.85–1.1) FOR THE GIANT HEADLINES.
- BODY / UI: **SPACE GROTESK** (300, 400, 500, 600) FOR PARAGRAPHS, NAV, BUTTONS, CARD COPY.
- MONO / TERMINAL ACCENT: A MONOSPACE (E.G. **GEIST MONO** OR SYSTEM MONO) FOR THE LOGO WORDMARK, FOOTER LABELS, STATUS LINE, AND SMALL UPPERCASE EYEBROWS.
- VENDOR ALL FONTS LOCALLY (WOFF2) AND REFERENCE THEM VIA `@font-face` WITH RELATIVE PATHS — NO REMOTE FONT CDNS AT RUNTIME.

## LAYOUT & SECTION BREAKDOWN

CONTENT IS CENTERED IN A `MAX-WIDTH: 1200PX` COLUMN WITH 24PX GUTTERS. CORNERS ARE SOFT (RADIUS 12–16PX ON PANELS/CARDS, FULL PILLS ON BUTTONS).

1. **FIXED NAVBAR** — TRANSLUCENT WARM-WHITE BAR WITH BACKDROP BLUR AND A HAIRLINE BOTTOM BORDER, ~79PX TALL. LEFT: MONO WORDMARK `VELVET·VELLUM` WITH A MAROON DOT. CENTER (DESKTOP): TEXT LINKS — SERVICES, OUR WORK, METHOD, VOICES. RIGHT: A MAROON PILL CTA "LET'S TALK" WITH A WHITE CIRCULAR ARROW BADGE THAT NUDGES RIGHT ON HOVER. MOBILE: COLLAPSE CENTER LINKS, KEEP CTA.

2. **HERO** — A LARGE `RADIUS-16` MAROON PANEL INSET ON THE PAPER BACKGROUND. TWO-COLUMN: LEFT = EYEBROW ROW (FIVE GOLD/WHITE STARS + "THE NEW STANDARD IN PRECISION MARKETING"), A GIANT WHITE HEADLINE ("MARKETING THAT SCALES WITH SURGICAL PRECISION" OR EQUIVALENT) AT 48–60PX, A MUTED-WHITE SUBPARAGRAPH, AND TWO CTAS (A WHITE PILL "BEGIN ENGAGEMENT" WITH MAROON ARROW BADGE + A TEXT "VIEW CASE STUDIES" LINK). RIGHT = A TALL PORTRAIT IMAGE (~450×580) WITH `RADIUS-12` AND A SOFT SHADOW. BELOW THE PANEL: A "POWERING MARKET LEADERS" EYEBROW AND AN INFINITE HORIZONTAL MARQUEE OF WORDMARK LOGOS WITH FADED EDGES (CSS MASK).

3. **SERVICES / "THE FUTURE OF GROWTH"** — A SPLIT HEADER: A HUGE TWO-LINE DISPLAY HEADLINE ("THE FUTURE / OF GROWTH.") AT UP TO ~110PX ON THE LEFT, AND A LIGHT SUPPORTING PARAGRAPH + SMALL UPPERCASE MAROON CTA ON THE RIGHT. BENEATH A HAIRLINE RULE: THREE EQUAL CARDS (STRATEGY, BRAND ARCHITECTURE, MARKET SYNCHRONICITY). THE MIDDLE CARD IS A FILLED MAROON CARD (WHITE TEXT); THE OUTER TWO ARE OFF-WHITE SURFACE CARDS WITH HAIRLINE BORDERS THAT LIFT WITH A SUBTLE SHADOW ON HOVER. EACH CARD: SMALL UPPERCASE EYEBROW, BOLD TITLE, BODY PARAGRAPH.

4. **FEATURED WORK** — A PILL HEADER BAR ("SELECTED CASE HISTORY" / "SEE FULL PORTFOLIO"). A THREE-COLUMN BENTO GRID `[300PX | 1FR | 320PX]`: LEFT = TWO STACKED MINI FEATURE CARDS WITH LINE ICONS; CENTER = ONE LARGE IMAGE CARD WITH A DARK BOTTOM GRADIENT, EYEBROW, BIG UPPERCASE TITLE ("THE STERLING METHOD"), AND CAPTION (IMAGE DESATURATES→COLOR AND SCALES SLIGHTLY ON HOVER); RIGHT = THREE STACKED PROJECT ROWS, EACH A THUMBNAIL + TITLE + METRIC LINE THAT LIFTS ON HOVER.

5. **METHOD + STATS** — A FULL MAROON `RADIUS-16` PANEL WITH A FAINT SKEWED WHITE OVERLAY SHAPE. LEFT: "THE VELLUM METHOD" HEADLINE + THREE NUMBERED STEPS (DEEP DISCOVERY, AGILE STRATEGY, ITERATIVE EXECUTION) WITH RING-NUMBER BADGES. RIGHT: A 2×2 GRID OF GLASSY STAT TILES (E.G. `$450M+` REVENUE MANAGED, `4.2X` AVG ROAS, `24+` MARKET LEADERS, `10YR` EXPERTISE), ALTERNATE TILES OFFSET DOWNWARD FOR A STAGGERED RHYTHM.

6. **TESTIMONIAL SLIDER** — CENTERED ON THE OFF-WHITE SURFACE. A SHORT GOLD/MAROON RULE, A LARGE DISPLAY BLOCKQUOTE, A ROUND CLIENT AVATAR, NAME + TITLE, AND PAGINATION DOTS. AUTO-ROTATE THROUGH 3 TESTIMONIALS EVERY ~5S WITH A SOFT FADE-AND-RISE TRANSITION; THE ACTIVE DOT WIDENS INTO A MAROON PILL.

7. **FINAL CTA** — HUGE DISPLAY HEADLINE ("READY FOR THE ELITE TIER?") AT 64–80PX, A MUTED SUBLINE ABOUT LIMITED QUARTERLY SLOTS, AND ONE OVERSIZED MAROON PILL CTA WITH A WHITE ARROW BADGE.

8. **FOOTER** — OFF-WHITE WITH A FAINT ISOMETRIC GRID TEXTURE. FOUR COLUMNS (BRAND BLURB + SOCIAL ICON SQUARES; EXPERTISE; COMPANY; LEGAL) WITH MONO LABELS THAT HAVE A MAROON LEFT-BORDER AND LINKS THAT NUDGE RIGHT ON HOVER. A BOTTOM BAR WITH COPYRIGHT (MONO) AND A PULSING GREEN "GROWTH ENGINE ACTIVE" STATUS DOT. AT THE VERY BOTTOM: A DRAMATIC FAUX-3D PERSPECTIVE "FLOOR GRID" RECEDING TO THE HORIZON WITH A GIANT OUTLINED/STROKED WORDMARK ("VELLUM") LAID FLAT IN PERSPECTIVE AND MASK-FADED INTO THE FLOOR.

## MOTION / ANIMATION / INTERACTION SPEC

- **SCROLL REVEAL:** ELEMENTS TAGGED FOR ANIMATION START AT `OPACITY 0` + `TRANSLATEY(40PX)` AND EASE TO REST OVER ~1.2S WITH `CUBIC-BEZIER(0.22, 1, 0.36, 1)`, STAGGERED VIA PER-ELEMENT `TRANSITION-DELAY` (100/200/300/400MS). DRIVE WITH AN `INTERSECTIONOBSERVER` (THRESHOLD ~0.1, UNOBSERVE AFTER REVEAL).
- **LOGO MARQUEE:** SEAMLESS INFINITE `TRANSLATEX(0 → -50%)` LOOP OVER ~30S, LINEAR, WITH EDGE MASK FADE.
- **BUTTON ARROW BADGES:** ARROW ICON TRANSLATES RIGHT ~4PX ON HOVER WITH A SPRINGY `CUBIC-BEZIER(0.34, 1.56, 0.64, 1)` OVER ~0.5S.
- **CARDS / WORK ROWS:** SHADOW-LIFT AND/OR SLIGHT TRANSLATE ON HOVER; CENTER WORK IMAGE GOES GRAYSCALE→COLOR AND `SCALE(1.05)`.
- **TESTIMONIALS:** JS AUTO-ROTATE WITH FADE/RISE; ACTIVE DOT MORPHS WIDTH.
- **STATUS DOT:** GENTLE PULSE. SMOOTH ANCHOR SCROLLING (`SCROLL-BEHAVIOR: SMOOTH`).
- RESPECT `PREFERS-REDUCED-MOTION` BY DISABLING TRANSFORM-HEAVY MOTION.

## RESPONSIVE BEHAVIOR

- DESKTOP (≥1024PX): FULL MULTI-COLUMN LAYOUTS AS DESCRIBED; GIANT DISPLAY TYPE.
- TABLET (768–1023PX): HERO AND METHOD STACK TO SINGLE COLUMN; SERVICE CARDS GO 1–2 PER ROW; WORK BENTO COLLAPSES TO STACKED BLOCKS.
- MOBILE (<768PX): EVERYTHING SINGLE-COLUMN; HIDE CENTER NAV LINKS (KEEP CTA); SCALE DISPLAY TYPE DOWN (HERO ~40–48PX, FINAL CTA ~48–56PX); MARQUEE AND TESTIMONIAL REMAIN FUNCTIONAL; NO HORIZONTAL OVERFLOW.

## DELIVERY

- SELF-CONTAINED AND RUNNABLE OFFLINE: ALL FONTS, IMAGES, AND ICONS VENDORED LOCALLY WITH RELATIVE PATHS. NO RUNTIME CDN DEPENDENCIES.
- CLEAN, SEMANTIC HTML; ACCESSIBLE LANDMARKS AND `ALT` TEXT; KEYBOARD-FOCUSABLE INTERACTIVE ELEMENTS. POLISHED, DISTINCTIVE, NON-TEMPLATED EXECUTION WORTHY OF A FLAGSHIP AGENCY SITE.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/velvet-vellum-agency-h4).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
