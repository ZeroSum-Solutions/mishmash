---
name: azimuth-realty-engine-h36
description: |
  A multi-section marketing landing page for **Azimuth**, a fictional real-estate marketing and growth agency, built in a "High-Altitude Precision" design language — a midnight mission-control deck crossed with a luxury architecture prospectus. A deep navy void (`#0E1726`), a single electric-cobalt accent (`#2F6BFF`), Bricolage Grotesque display type, Inter Tight body, JetBrains Mono labels, and Playfair Display italic accents create an engineered, premium feel. Features include a floating pill navbar with a wide mega-menu, a 38/62 split hero with a grayscale-to-color building image, an ecosystem bento grid, a horizontally scrollable portfolio of property cards, a cobalt "method" bento section, and a stacked-card final CTA with fanning scroll animation — ideal as a real estate, property, or luxury brand landing page.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "azimuth"
  - "real"
  - "estate"
  - "marketing"
  - "agency"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/azimuth-realty-engine-h36"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Azimuth — Real Estate Marketing Agency Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Azimuth — Real Estate Marketing Agency Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A multi-section marketing landing page for **Azimuth**, a fictional real-estate marketing and growth agency, built in a "High-Altitude Precision" design language — a midnight mission-control deck crossed with a luxury architecture prospectus. A deep navy void (`#0E1726`), a single electric-cobalt accent (`#2F6BFF`), Bricolage Grotesque display type, Inter Tight body, JetBrains Mono labels, and Playfair Display italic accents create an engineered, premium feel. Features include a floating pill navbar with a wide mega-menu, a 38/62 split hero with a grayscale-to-color building image, an ecosystem bento grid, a horizontally scrollable portfolio of property cards, a cobalt "method" bento section, and a stacked-card final CTA with fanning scroll animation — ideal as a real estate, property, or luxury brand landing page.

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
<artifact identifier="azimuth-realty-engine-h36" type="text/html" title="Azimuth — Real Estate Marketing Agency Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# AZIMUTH — A "HIGH-ALTITUDE PRECISION" REAL-ESTATE MARKETING-ENGINE LANDING PAGE

## NAMED AESTHETIC IDENTITY

BUILD A FULLY RESPONSIVE, MULTI-SECTION MARKETING LANDING PAGE FOR A FICTIONAL
REAL-ESTATE MARKETING & GROWTH AGENCY NAMED **AZIMUTH** IN A DESIGN LANGUAGE CALLED
**"HIGH-ALTITUDE PRECISION."** THE MOOD IS A MIDNIGHT MISSION-CONTROL DECK CROSSED
WITH A LUXURY ARCHITECTURE PROSPECTUS: A DEEP NAVY VOID, A SINGLE CHARGED ELECTRIC
COBALT ACCENT, OVERSIZED EDITORIAL DISPLAY TYPE, CRISP MONOSPACE TECHNICAL LABELS,
AND CALM, SURGICAL MICRO-INTERACTIONS. IT SHOULD FEEL ENGINEERED, EXPENSIVE, AND
CONFIDENT — LIKE A FLIGHT-INSTRUMENT PANEL THAT SELLS BILLION-DOLLAR PROPERTY
INVENTORY. AVOID GENERIC SAAS GRADIENTS, GLASS-SLOP, AND NEON GAMER-RGB. THE PAGE
SHOULD READ AS PRECISE AND PREMIUM, NEVER PLAYFUL.

## COLOR PALETTE (EXACT)

- BRAND PRIMARY (DEEP NAVY): `#0E1726`
- BRAND SECONDARY (SLATE PANEL): `#16223A`
- BRAND ACCENT (ELECTRIC COBALT): `#2F6BFF`
- ACCENT DEEP (HOVER COBALT): `#1E4FD8`
- NEUTRAL BACKGROUND (NEAR-WHITE PAPER): `#F7F8FB`
- NEUTRAL SURFACE (OFF-WHITE CARD): `#EEF1F6`
- TEXT PRIMARY (ON DARK, NEAR-WHITE): `#F5F7FB`
- TEXT SECONDARY (MUTED SLATE): `#64748B`
- BORDER HAIRLINE: `RGBA(245, 247, 251, 0.10)` ON DARK, `RGBA(14, 23, 38, 0.08)` ON LIGHT

## TYPOGRAPHY

- DISPLAY / HEADINGS: **BRICOLAGE GROTESQUE** (WEIGHTS 400/600/700) — TIGHT
  TRACKING, OVERSIZED HERO UP TO 76PX.
- BODY / UI: **INTER TIGHT** (400/600).
- TECHNICAL LABELS / EYEBROWS / BUTTONS: **JETBRAINS MONO** (400/500), UPPERCASE,
  WIDE LETTER-SPACING (0.2EM–0.8EM).
- EDITORIAL ITALIC ACCENT (PULL QUOTES, INDEX NUMERALS): **PLAYFAIR DISPLAY**
  ITALIC.
- VENDOR ALL FOUR FONT FAMILIES LOCALLY (WOFF2/TTF) — DO NOT HOTLINK GOOGLE FONTS.

## LAYOUT & SECTION BREAKDOWN

1. **FLOATING PILL NAVBAR** — FIXED TOP-RIGHT (CENTERED ON MOBILE), A WHITE
   ROUNDED-FULL PILL WITH BACKDROP BLUR AND SOFT SHADOW. CONTAINS: LOGO
   "AZIMUTH." (COBALT PERIOD), A "SOLUTIONS" TRIGGER THAT OPENS A WIDE **MEGA
   MENU** (LEFT COLUMN OF STRATEGIC DIVISIONS WITH ANIMATED ARROW LINKS, RIGHT A
   2-UP IMAGE GRID OF CASE STUDIES WITH GRADIENT OVERLAYS), TWO MORE TEXT LINKS,
   AN EXPANDABLE CLICK-TO-CALL CHIP THAT GROWS ON HOVER, AND A DARK "INQUIRE" CTA
   PILL WITH A CIRCULAR ARROW BUTTON. A FULL-SCREEN SLIDE-IN MOBILE MENU
   (NAVY OVERLAY, OVERSIZED LINKS).

2. **SPLIT HERO** — FULL-VIEWPORT, NEAR-WHITE OUTER BACKGROUND. A CENTERED
   MAX-1280 CARD SPLIT INTO A `38% / 62%` GRID: LEFT IS A NAVY MEDIA PANEL WITH A
   GRAYSCALE-TO-COLOR BUILDING IMAGE THAT REVEALS ON LOAD AND A SMALL VIDEO-PLAY
   GLYPH; RIGHT IS A NAVY CONTENT PANEL WITH A PILL EYEBROW ("GLOBAL PRESENCE •
   STRATEGY FIRST"), AN OVERSIZED BRICOLAGE HEADLINE WITH ONE COBALT-HIGHLIGHTED
   WORD ("AUTHORITY"), A SUPPORTING PARAGRAPH, A PRIMARY COBALT CTA + A GHOST
   MONO LINK WITH AN ANIMATED ARROW, AND A TWO-STAT TRUST ROW (`$2.4B+` INVENTORY
   SOLD, `0.8%` AVG COST/LEAD) ABOVE A HAIRLINE RULE. A SMALL VERTICAL/HORIZONTAL
   MONO BRAND TAG SITS IN THE TOP-LEFT OF THE HERO ON DESKTOP.

3. **SOLUTIONS / ECOSYSTEM GRID** — LIGHT SECTION. A HEADER WITH MONO EYEBROW
   ("ECOSYSTEM ARCHITECTURE") AND A LARGE TWO-LINE HEADING. BELOW, A BENTO GRID:
   ONE FULL-WIDTH "DATA ACQUISITION" HERO CARD (TITLE + PARAGRAPH + MONO FEATURE
   LIST + A LAYERED IMAGE STACK WITH A FLOATING OVERLAY THUMBNAIL), AND TWO
   HALF-WIDTH CARDS ("HYPER-REAL" VISUAL ENGINE, "PRECISION" CONVERSION OPS) EACH
   WITH AN EYEBROW, TITLE, PARAGRAPH, MONO LIST, AND A LAYERED IMAGE PAIR. CARDS
   LIFT, GAIN A COBALT HAIRLINE BORDER, AND THEIR IMAGES SCALE/COLORIZE ON HOVER.

4. **PORTFOLIO SHOWCASE** — NAVY SECTION. LEFT: AN INDEX EYEBROW (`02 — PORTFOLIO
   · INSIGHTS`), A THREE-LINE BRICOLAGE HEADING, A PARAGRAPH, AND A COBALT
   "REQUEST ACCESS" PILL WHOSE ARROW ROTATES ON HOVER. RIGHT: A HORIZONTALLY
   SCROLLABLE ROW OF TALL `480PX` PROPERTY CARDS (THE MERIDIAN SPIRE — NEW YORK,
   PALM CRESCENT — DUBAI, THE GLASS PENTHOUSE — LONDON), EACH GRAYSCALE WITH A
   NAVY SCRIM THAT LIGHTENS AND COLORIZES ON HOVER, A LOCATION MONO LABEL, A
   "CASE STUDY" CHIP, AND A GIANT PLAYFAIR-ITALIC INDEX NUMERAL. LEFT/RIGHT
   ROUND NAV BUTTONS SCROLL THE TRACK SMOOTHLY.

5. **THE METHOD — HIGH-IMPACT BENTO** — COBALT SECTION WITH A FAINT DARK GRID
   BACKGROUND. A 6-COLUMN FRAMER-STYLE BENTO OF WHITE / NAVY CARDS: AN
   AVATAR-STACK "THE ARCHITECTS" TEAM CARD, A "TACTICAL INTEL" CARD WITH AN
   ABSTRACT GLASS-NODE ICON, A LARGE WHITE-ON-COBALT PHILOSOPHY STATEMENT, A
   "FUTURE-PROOFING" FORECAST CARD, A `$2.4B` STAT CARD + GLOBE CARD STACK, A
   PLAYFAIR-ITALIC TESTIMONIAL QUOTE CARD, AND A NAVY "ENTER THE ECOSYSTEM"
   PORTAL CARD. CARDS HAVE A SOFT LIFT-AND-SHADOW HOVER.

6. **FINAL CTA — STACKED CARD** — LIGHT SECTION. AN OVERSIZED UPPERCASE
   BRICOLAGE HEADLINE ("TRANSCEND THE MARKET."), A FULL-BLEED HAIRLINE DIVIDER,
   THEN A STACKED-CARD COMPOSITION: A TOP WHITE CARD (LIGHTNING-BOLT BADGE, MONO
   EYEBROW, HEADING, A DARK "CONSULTATION" BUTTON, AND A GRAYSCALE-TO-COLOR
   PORTRAIT IMAGE) WITH 2–3 OFFSET COLORED LAYERS (SURFACE, SLATE, COBALT)
   PEEKING BEHIND IT THAT FAN OUT/ANIMATE INTO PLACE WHEN THE SECTION SCROLLS
   INTO VIEW.

7. **FOOTER** — NAVY. LOGO, A SHORT MISSION LINE, COLUMNS OF LINKS (SOLUTIONS,
   COMPANY, CONTACT), AND A MONO COPYRIGHT / LEGAL ROW.

## MOTION / ANIMATION / INTERACTION SPEC

- **SCROLL REVEALS:** USE AN INTERSECTIONOBSERVER. TWO REVEAL FLAVORS:
  (A) "TEXT REVEAL" — TRANSLATEY(60PX) + OPACITY 0 → SETTLE, EASE
  `CUBIC-BEZIER(0.16,1,0.3,1)`, ~1.4S, WITH PER-ELEMENT `TRANSITION-DELAY`
  STAGGERS (0/100/200/300MS). (B) "ON-SCROLL" — TRANSLATEY(40PX) + OPACITY 0,
  ~1.2S `CUBIC-BEZIER(0.22,1,0.36,1)`.
- **HERO IMAGE:** GRAYSCALE → COLOR ON HOVER (1200MS), PLUS A LOAD-IN REVEAL WITH
  A DELAY.
- **MEGA MENU:** FADE + TRANSLATEY-4 → 0 ON HOVER, CHEVRON ROTATES 180°, IMAGES
  SCALE 1.1 ON HOVER.
- **PORTFOLIO:** NATIVE SMOOTH HORIZONTAL SCROLL; PREV/NEXT BUTTONS CALL
  `scrollBy({left: ±420, behavior:'smooth'})`. CARD IMAGES SCALE 1.1 + COLORIZE
  ON HOVER.
- **STACKED CTA:** ON SECTION ENTER, THE BACKGROUND LAYERS ANIMATE FROM
  OPACITY 0 / STACKED TO STAGGERED OFFSETS (E.G. ROTATE/TRANSLATE) OVER ~0.8S
  `CUBIC-BEZIER(0.16,1,0.3,1)`.
- **BUTTONS / ARROWS:** TRANSLATE-X OR ROTATE ON HOVER; PILL CTAS INVERT
  COLOR (NAVY ↔ COBALT ↔ WHITE).
- **CUSTOM SCROLLBAR:** THIN, NAVY TRACK, COBALT THUMB.
- RESPECT `PREFERS-REDUCED-MOTION`.

## RESPONSIVE BEHAVIOR

- DESKTOP-FIRST POLISH, FULLY FLUID DOWN TO 360PX.
- HERO COLLAPSES THE 38/62 SPLIT TO A STACKED SINGLE COLUMN (MEDIA ON TOP, FIXED
  HEIGHT).
- MEGA MENU + DESKTOP NAV LINKS HIDE BELOW LG; HAMBURGER + FULL-SCREEN OVERLAY
  TAKE OVER.
- ECOSYSTEM + METHOD BENTOS COLLAPSE TO ONE COLUMN ON MOBILE.
- PORTFOLIO STAYS A HORIZONTAL SWIPE TRACK ON ALL SIZES.
- STACKED CTA STACKS TEXT ABOVE IMAGE ON MOBILE.

## TECH & DELIVERY

- SINGLE SELF-CONTAINED STATIC SITE (PLAIN HTML + ONE CSS FILE + ONE JS FILE), NO
  BUILD STEP REQUIRED. TAILWIND-STYLE UTILITY CLASSES MAY BE USED BUT MUST WORK
  OFFLINE (NO CDN AT RUNTIME) — PREFER HAND-WRITTEN CSS WITH CUSTOM PROPERTIES.
- VENDOR ALL IMAGES, FONTS, AND ICONS LOCALLY INTO `ASSETS/`. NO REMOTE
  HOTLINKS AT RUNTIME.
- CLEAN, ACCESSIBLE MARKUP (LANDMARKS, ALT TEXT, FOCUS STATES, ARIA ON THE
  MENU TOGGLE).

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/azimuth-realty-engine-h36).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
