---
name: voltline-automation-h60
description: |
  A single-page marketing site for **Voltline**, a fictional AI-automation company. The aesthetic identity is "Bone & Volt" — a clean, Swiss-industrial system on a warm off-white (bone) canvas, punctuated by hard graphite black and a single electric-lime accent (`rgb(152, 254, 0)`). The mood is engineering-forward and slightly retro-futurist: monospace slash-prefixed labels, tight geometric-sans headlines, orbiting 3D primitives, and tiny "space / starfield" reveals on hover. It feels like a precision instrument, not generic SaaS. Built with plain HTML, CSS, and Vanilla JS.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "voltline automation"
  - "voltline"
  - "automation"
  - "bone"
  - "volt"
  - "industrial"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/voltline-automation-h60"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Voltline Automation — \"Bone & Volt\" Industrial AI Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Voltline Automation — "Bone & Volt" Industrial AI Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A single-page marketing site for **Voltline**, a fictional AI-automation company. The aesthetic identity is "Bone & Volt" — a clean, Swiss-industrial system on a warm off-white (bone) canvas, punctuated by hard graphite black and a single electric-lime accent (`rgb(152, 254, 0)`). The mood is engineering-forward and slightly retro-futurist: monospace slash-prefixed labels, tight geometric-sans headlines, orbiting 3D primitives, and tiny "space / starfield" reveals on hover. It feels like a precision instrument, not generic SaaS. Built with plain HTML, CSS, and Vanilla JS.

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
<artifact identifier="voltline-automation-h60" type="text/html" title="Voltline Automation — 'Bone & Volt' Industrial AI Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# VOLTLINE AUTOMATION — INDUSTRIAL AI LANDING PAGE

## AESTHETIC IDENTITY

BUILD A SINGLE-PAGE MARKETING SITE FOR A FICTIONAL AI-AUTOMATION COMPANY CALLED **VOLTLINE**. THE NAMED AESTHETIC IS **"BONE & VOLT"** — A CLEAN, SWISS-INDUSTRIAL SYSTEM RENDERED ON A WARM OFF-WHITE (BONE) CANVAS, PUNCTUATED BY HARD GRAPHITE BLACK AND A SINGLE ELECTRIC LIME ACCENT. THE MOOD IS CONFIDENT, ENGINEERING-FORWARD, AND SLIGHTLY RETRO-FUTURIST: MONOSPACE LABELS, TIGHT SANS HEADLINES, ORBITING 3D PRIMITIVES, AND TINY "SPACE / STARFIELD" REVEALS ON HOVER. IT MUST FEEL LIKE A PRECISION INSTRUMENT, NOT GENERIC SAAS.

## COLOR PALETTE

- BONE BACKGROUND: `rgb(243, 243, 243)` (PRIMARY CANVAS)
- GRAPHITE / INK: `rgb(19, 19, 19)` (PRIMARY TEXT, DARK SURFACES)
- DEEP SPACE BLACK: `#0a0a0f` (HOVER OVERLAYS, STARFIELD BACKDROP)
- ELECTRIC LIME: `rgb(152, 254, 0)` (THE ONLY ACCENT — USE SPARINGLY AND DELIBERATELY)
- NEUTRAL BORDER: `rgb(211, 211, 211)`
- BUTTON GRAY: `rgb(229, 229, 229)`
- SECONDARY TEXT: `rgba(19, 19, 19, 0.7)`

## TYPOGRAPHY

- DISPLAY / HEADLINES: A TIGHT GEOMETRIC SANS (SATOSHI-LIKE; FALL BACK TO INTER / SYSTEM SANS), BOLD 700, NEGATIVE TRACKING UP TO -0.04EM. HERO HEADLINE NEAR 80PX WITH LEADING TIGHTER THAN THE FONT SIZE (~72PX LINE-HEIGHT).
- BODY / SUBHEAD: MEDIUM-WEIGHT SANS, 24PX, LINE-HEIGHT 36PX, SLIGHT NEGATIVE TRACKING.
- LABELS / EYEBROWS / META: A MONOSPACE FACE (ROBOTO MONO / JETBRAINS MONO STYLE), UPPERCASE, SMALL, OFTEN PREFIXED WITH A `/` SLASH.
- VENDOR FONTS LOCALLY; DO NOT HOTLINK GOOGLE FONTS AT RUNTIME.

## BORDER RADIUS & SHADOW SYSTEM

- RADII: SHARP CORNERS DOMINATE — 4PX (SM) FOR BUTTONS/CARDS, 10–14PX FOR LARGER PANELS, FULL PILLS ONLY FOR BADGES.
- SOFT LAYERED BADGE SHADOW FOR FLOATING PILLS.

## LAYOUT & SECTION BREAKDOWN

CONSTRAIN CONTENT TO A MAX WIDTH OF ~1240PX, CENTERED, WITH GENEROUS HORIZONTAL PADDING.

1. **NAVBAR (FIXED/ABSOLUTE, ~72PX TALL):** LEFT WORDMARK "VOLTLINE" IN BOLD TIGHT SANS. CENTER MONOSPACE UPPERCASE NAV LINKS (OUR IMPACT / SOLUTIONS / THE MISSION / INSIGHTS / JOIN US). RIGHT: A "START BUILDING" BUTTON WITH A THIN BORDER THAT, ON HOVER, FILLS WITH A RANDOMIZED LIME PIXEL-GRID ANIMATION OVER A DEEP-SPACE BACKDROP AND SWAPS TEXT TO WHITE/INK.

2. **HERO:** LARGE LEFT-ALIGNED HEADLINE "AUTOMATE EXCELLENCE WITH CUSTOM AI." BELOW IT, A TWO-COLUMN BOTTOM ROW: ON THE LEFT, A LIVE 3D COMPOSITION OF ORBITING CUBES; ON THE RIGHT, A SUPPORTING PARAGRAPH, TWO CTA BUTTONS, A HAIRLINE DIVIDER WITH A MONO LABEL "/ POWERING INNOVATION FOR 300+ TEAMS", AND A FADE-MASKED MARQUEE OF PARTNER WORDMARKS.

3. **3D HERO COMPOSITION:** PURE-CSS 3D (PRESERVE-3D, PERSPECTIVE ~2000PX). A LARGE CENTRAL GRAPHITE CUBE WITH A GLOWING LIME CORE ORB INSIDE; A SMALL SOLID-LIME SATELLITE CUBE ORBITING ON ONE PLANE; A WHITE "DATA NODE" CUBE ON A TILTED ORBIT WITH A TINY SCANNING LINE AND MONO "SYNC_ACTIVE" READOUT. THE WHOLE RIG SLOWLY ROTATES ON Y (~25S LOOP) AT A FIXED -20° X TILT.

4. **STATS STRIP:** A ROW OF 3–4 BIG MONO/SANS METRICS (E.G. 99.98% UPTIME, 4.2M TASKS/DAY, 38MS LATENCY, 300+ TEAMS) WITH MONO CAPTIONS, SEPARATED BY HAIRLINES.

5. **SOLUTIONS / FEATURE GRID:** A 3-CARD GRID ON BONE WITH THIN BORDERS AND SHARP CORNERS; EACH CARD HAS A MONO INDEX (01 / 02 / 03), A SHORT BOLD TITLE, BODY COPY, AND A LIME ACCENT DETAIL THAT ACTIVATES ON HOVER (E.G. A CORNER TICK OR A SPACE/STARFIELD REVEAL).

6. **DARK CTA / "THE MISSION" BAND:** A FULL-WIDTH DEEP-SPACE BLACK PANEL WITH A SUBTLE STARFIELD, A LIME EYEBROW, A LARGE WHITE HEADLINE, AND A LIME-ACCENTED CTA BUTTON THAT MIRRORS THE HERO PIXEL/STAR INTERACTION.

7. **FOOTER:** BONE BACKGROUND, MONO COLUMNS OF LINKS, WORDMARK, FINE PRINT, AND A SUBTLE ANIMATED LIME CARET OR STATUS DOT ("SYSTEMS NOMINAL").

## HERO COMPOSITION DETAILS

- HEADLINE LEFT-WEIGHTED, OVERLAPPING SLIGHTLY WITH THE 3D RIG VERTICAL RHYTHM (NEGATIVE MARGIN ALLOWED).
- PRIMARY CTA: GRAPHITE PILL-RECT WITH A LIME SQUARE ICON CHIP (ARROW), HOVER SWAPS TO DEEP-SPACE BLACK WITH TWINKLING STARS.
- SECONDARY CTA: OUTLINED, HOVER ALSO REVEALS STARFIELD AND INVERTS TEXT TO WHITE.

## MOTION / ANIMATION / INTERACTION SPEC

- CONTINUOUS: GLOBAL CUBE-RIG Y-ROTATION (25S LINEAR LOOP, -20° X TILT); SATELLITE ORBIT (~15S); DATA-NODE TILTED ORBIT (~20S); PULSING LIME CORE; SCANNING LINE INSIDE DATA NODE; PARTNER MARQUEE (~30S LINEAR, FADE-MASKED EDGES).
- HOVER: PIXEL-GRID FILL ON "START BUILDING" (RANDOMIZED CELL REVEAL, ~25MS STAGGER IN, ~15MS OUT, BORDER GOES LIME); STARFIELD/TWINKLE REVEALS ON CTA BUTTONS; ARROW-CHIP SLIDE WIPE.
- SCROLL: INTERSECTION-OBSERVER REVEAL (OPACITY + 20PX TRANSLATE-Y, 0.8S EASE-OUT) ON SECTION BLOCKS; FEATURE CARDS STAGGER IN; OPTIONAL COUNT-UP ON THE STATS STRIP.
- RESPECT `PREFERS-REDUCED-MOTION`: DISABLE ORBITS, MARQUEE, AND TWINKLES.

## RESPONSIVE BEHAVIOR

- DESKTOP (≥1024PX): TWO-COLUMN HERO, FULL NAV, LARGE TYPE.
- TABLET: STACK HERO COLUMNS, SHRINK HEADLINE, KEEP 3D RIG SCALED DOWN, FEATURE GRID TO 2 COLUMNS.
- MOBILE (<640PX): SINGLE COLUMN, HAMBURGER OR HIDDEN CENTER NAV, HEADLINE ~44–52PX, STACKED CTAS FULL-WIDTH, 3D RIG REDUCED OR SIMPLIFIED, STATS AND FEATURES STACK VERTICALLY.

## DELIVERY CONSTRAINTS

- FULLY SELF-CONTAINED AND RUNNABLE OFFLINE; VENDOR ALL FONTS AND ASSETS LOCALLY WITH RELATIVE PATHS.
- NO COPYING ANY REFERENCE MARKUP VERBATIM — REBUILD THE DESIGN LANGUAGE INDEPENDENTLY WITH CLEAN, ORIGINAL CODE.
- HIGH POLISH: PIXEL-CRISP HAIRLINES, INTENTIONAL SPACING RHYTHM, NO GENERIC-AI-SLOP AESTHETICS.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/voltline-automation-h60).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
