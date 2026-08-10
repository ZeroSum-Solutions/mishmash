---
name: aegis-console-h39
description: |
  A multi-section marketing landing page for **Aegis**, a fictional enterprise cybersecurity platform, built in a "Precision Grid" design language — a bright, engineering-forward SaaS aesthetic on a white/bone canvas with a single electric-lime accent (`#DCF986`). The centerpiece is a live security console product mockup with an animated SVG line chart that draws itself via `stroke-dashoffset`, pulsing status dots, and count-up metrics. Display type uses Clash Grotesk over Satoshi body text. Motion includes staggered fade-and-rise on load, IntersectionObserver scroll reveals, and a floating "real-time monitoring" pill — all respecting `prefers-reduced-motion`.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "aegis console"
  - "aegis"
  - "console"
  - "precision-grid"
  - "cybersecurity"
  - "saas"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/aegis-console-h39"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Aegis Console — Precision-Grid Cybersecurity SaaS Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Aegis Console — Precision-Grid Cybersecurity SaaS Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A multi-section marketing landing page for **Aegis**, a fictional enterprise cybersecurity platform, built in a "Precision Grid" design language — a bright, engineering-forward SaaS aesthetic on a white/bone canvas with a single electric-lime accent (`#DCF986`). The centerpiece is a live security console product mockup with an animated SVG line chart that draws itself via `stroke-dashoffset`, pulsing status dots, and count-up metrics. Display type uses Clash Grotesk over Satoshi body text. Motion includes staggered fade-and-rise on load, IntersectionObserver scroll reveals, and a floating "real-time monitoring" pill — all respecting `prefers-reduced-motion`.

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
<artifact identifier="aegis-console-h39" type="text/html" title="Aegis Console — Precision-Grid Cybersecurity SaaS Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# AEGIS CONSOLE — PRECISION-GRID CYBERSECURITY SAAS LANDING PAGE

## NAMED AESTHETIC IDENTITY

BUILD A FULL, MULTI-SECTION, FULLY RESPONSIVE MARKETING LANDING PAGE FOR A FICTIONAL ENTERPRISE CYBERSECURITY PLATFORM NAMED **AEGIS**. THE NAMED DESIGN LANGUAGE IS **"PRECISION GRID"** — A BRIGHT, CONFIDENT, ENGINEERING-FORWARD SAAS AESTHETIC THAT FEELS LIKE A WELL-LIT CONTROL ROOM RENDERED ON CLEAN PAPER. THE MOOD IS CALM, AUTHORITATIVE, AND EXPENSIVE: INK-BLACK TYPE ON A WHITE/BONE CANVAS, ONE DECISIVE ELECTRIC-LIME ACCENT, HAIRLINE GRID RULES THAT FADE INTO THE BACKGROUND, AND A LIVE "SECURITY CONSOLE" PRODUCT MOCKUP AS THE HERO CENTERPIECE. NOTHING IS DARK-MODE OR NEON-CYBERPUNK; THE TRUST COMES FROM RESTRAINT, PRECISION SPACING, AND ONE LOUD ACCENT USED SPARINGLY.

## COLOR PALETTE (EXACT)

- INK / PRIMARY TEXT & SURFACES: `RGB(29, 29, 29)` — NEAR-BLACK CHARCOAL.
- ACCENT LIME: `RGB(220, 249, 134)` (`#DCF986`) — THE SINGLE BRAND ACCENT; USED ON ICON-CHIPS, BARS, PILL TAGS, AND ONE GRAPH STROKE ONLY.
- SECONDARY WARM ACCENT (USE RARELY, FOR ONE ALERT STATE): `#FF8C42`.
- BACKGROUND: PURE WHITE `RGB(255, 255, 255)`.
- SURFACE / BONE: `RGB(248, 247, 247)` AND CARD BONE `RGB(250, 250, 250)`.
- SECONDARY TEXT / GRAY: `RGB(70, 70, 70)`.
- LIVE/STATUS GREEN: `#22C55E` FOR "ONLINE" PULSE DOTS.
- HAIRLINES: `RGBA(0,0,0,0.06)` TO `RGBA(0,0,0,0.1)`.

## TYPOGRAPHY

- DISPLAY / HEADINGS: **CLASH GROTESK** (WEIGHT 500), TIGHT TRACKING `-1PX`, LINE-HEIGHT `1.1`. HERO H1 SCALES `48PX` MOBILE → `64PX` DESKTOP, MAX-WIDTH ~`884PX`.
- BODY / UI: **SATOSHI** (WEIGHTS 400, 500), LINE-HEIGHT `1.7` FOR PARAGRAPHS, MAX-WIDTH ~`618PX`.
- LOAD BOTH FROM FONTSHARE; VENDOR LOCALLY WHERE POSSIBLE. SMALL EYEBROW/LABEL TEXT IS UPPERCASE, BOLD, WITH WIDE LETTER-SPACING.

## LAYOUT & SECTION BREAKDOWN (TOP TO BOTTOM)

1. **HEADER / NAV** — TRANSPARENT, CENTERED, MAX-WIDTH `1140PX`. LEFT: A SQUARE INK LOGO CHIP CONTAINING A SHIELD GLYPH + WORDMARK "AEGIS". CENTER (DESKTOP ONLY): NAV LINKS "PLATFORM" (WITH A HOVER MEGA-DROPDOWN LISTING CLOUD SECURITY / THREAT RESPONSE / CONSULTING, EACH WITH TITLE + SUBLABEL), "FEATURES", "PRICING", "DOCS". RIGHT: A PILL "GET STARTED" CTA — INK BACKGROUND, WHITE TEXT, ARROW GLYPH. MOBILE: HAMBURGER OPENING A SLIDE-DOWN SHEET.
2. **HERO** — MIN-HEIGHT 100VH, CENTERED CONTENT. A FADING SQUARE GRID BACKGROUND (`80PX` CELLS, HAIRLINE LINES) MASKED WITH A RADIAL GRADIENT SO IT DISSOLVES TO WHITE AT THE EDGES. CENTERED: H1 "SHIELD EVERY DIGITAL ASSET WITH IRONCLAD PRECISION", A SUPPORTING PARAGRAPH, AND TWO PILL BUTTONS (DARK PRIMARY WITH A LIME CIRCULAR ARROW-CHIP THAT SLIDES ON HOVER; WHITE OUTLINE SECONDARY). BELOW: THE **SECURITY CONSOLE MOCKUP** — A WHITE ROUNDED CARD WITH SOFT SHADOW AND HAIRLINE BORDER CONTAINING: A CONSOLE HEADER ("SYSTEM HEALTH: OPTIMAL" + LIME STATUS CHIP), A LEFT STAT COLUMN ("THREATS PREVENTED 12,842" ON AN INK CARD WITH A LIME PROGRESS BAR; "ACTIVE SCANS 94% +2.4%"), A LARGE CHART PANEL ("ATTACK SURFACE ANALYSIS") WITH AN ANIMATED LIME SVG LINE GRAPH OVER A FAINT SECOND LINE AND GRID GUIDES, AND A BOTTOM STATUS BAR OF FOUR NODES WITH PULSING DOTS (EUROPE-WEST, US-EAST, AI DEFENSE, 99.9% UPTIME). FLOATING DECOR: BLURRED LIME + INK GLOWS BEHIND THE CARD, AND A FLOATING "REAL-TIME MONITORING ON" PILL THAT GENTLY BOBS.
3. **LOGO TRUST STRIP** — "TRUSTED BY SECURITY TEAMS AT" EYEBROW OVER A ROW OF 5–6 MUTED MONOCHROME COMPANY WORDMARKS (FICTIONAL), HAIRLINE-DIVIDED.
4. **FEATURES GRID** — A SECTION EYEBROW + HEADLINE, THEN A 3-COLUMN (→1 ON MOBILE) GRID OF FEATURE CARDS, EACH WITH A LIME ICON CHIP, TITLE, AND SHORT COPY; CARDS LIFT ON HOVER. INCLUDE AT LEAST: REAL-TIME THREAT DETECTION, AUTOMATED RESPONSE, ZERO-TRUST ACCESS, COMPLIANCE REPORTING, ENDPOINT TELEMETRY, AI ANOMALY SCORING.
5. **METRICS BAND** — A FULL-WIDTH INK PANEL WITH 3–4 BIG LIME/WHITE STAT FIGURES (E.G. "99.99% UPTIME", "1.2B EVENTS/DAY", "<40MS RESPONSE", "0 BREACHES") THAT COUNT UP WHEN SCROLLED INTO VIEW.
6. **HOW-IT-WORKS / PRODUCT DETAIL** — A TWO-COLUMN ALTERNATING SECTION PAIRING COPY WITH A SECONDARY MOCKUP CARD (E.G. AN ALERT FEED / TIMELINE), CONNECTED BY A HAIRLINE-NUMBERED 01–03 STEP LIST.
7. **PRICING** — THREE PLAN CARDS (STARTER / TEAM / ENTERPRISE), THE MIDDLE ONE HIGHLIGHTED WITH AN INK FILL OR A LIME BORDER + "MOST POPULAR" PILL; FEATURE CHECK LISTS AND CTAS.
8. **CTA BAND** — A CENTERED CLOSING CALL TO ACTION ON BONE OR INK WITH THE PRIMARY PILL.
9. **FOOTER** — MULTI-COLUMN LINK GROUPS, WORDMARK, FINE PRINT, AND A LIME STATUS LINE.

## MOTION / ANIMATION / INTERACTION SPEC

- ON-LOAD: HERO HEADLINE, PARAGRAPH, BUTTONS, AND THE CONSOLE CARD FADE-AND-RISE IN STAGGERED SEQUENCE (`OPACITY 0→1`, `TRANSLATEY 30PX→0`, CUBIC-BEZIER EASE, ~`1.2S`, DELAYS `0.1/0.2/0.3/0.4S`).
- SCROLL REVEALS: SECTIONS USE AN INTERSECTIONOBSERVER TO ADD A "VISIBLE" CLASS, TRIGGERING THE SAME RISE-IN.
- THE CHART'S LIME LINE ANIMATES ITS STROKE-DASHOFFSET TO "DRAW ITSELF" WHEN THE HERO LOADS; STATUS DOTS PULSE CONTINUOUSLY.
- METRICS COUNT UP FROM 0 TO TARGET WITH AN EASE WHEN THE METRICS BAND ENTERS THE VIEWPORT.
- BUTTON HOVER: THE CIRCULAR ARROW-CHIP TRANSLATES RIGHT ~`6PX`; CARDS LIFT `-8PX` WITH A SOFTER-TO-DEEPER SHADOW; THE FLOATING MONITORING PILL LOOPS A GENTLE `±10PX` FLOAT.
- ALL MOTION RESPECTS `PREFERS-REDUCED-MOTION`.

## RESPONSIVE BEHAVIOR

- DESKTOP-FIRST GRID AT `1140–1200PX` MAX CONTENT WIDTH, COLLAPSING TO SINGLE COLUMN ON MOBILE.
- NAV LINKS HIDE BELOW `MD`, REPLACED BY A HAMBURGER SHEET.
- THE CONSOLE MOCKUP GRID STACKS (STAT COLUMN ABOVE CHART) ON SMALL SCREENS; THE SIDE FLOATING PILL HIDES BELOW `LG`.
- TYPOGRAPHY, PADDING, AND CARD SHADOWS SCALE DOWN GRACEFULLY; NO HORIZONTAL OVERFLOW.

## DELIVERABLE

A SINGLE SELF-CONTAINED, STATIC, FULLY RESPONSIVE SITE (HTML + CSS + VANILLA JS), WITH ALL FONTS AND ASSETS VENDORED LOCALLY, NO BUILD STEP REQUIRED, RUNNABLE OFFLINE. DISTINCTIVE, POLISHED, NON-GENERIC UI THAT MEETS A HIGH CRAFT BAR.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/aegis-console-h39).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
