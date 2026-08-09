---
name: voltic-showroom-h89
description: |
  A single-page, forced-light marketing landing page for **Voltic**, a fictional Indian chain of walk-in "experience centers" where people touch, feel, and demo flagship phones, laptops, audio, and cameras before they buy. The aesthetic identity is "Electric Stone" — a quiet, editorial, gallery-like warm-neutral canvas punctuated by a single high-voltage electric-lime accent (`rgb(182, 228, 2)`). The mood is calm, tactile, and retail-premium: near-black ink on warm stone, with lime used only as punctuation — terminal dots on headlines, eyebrow dots, the primary CTA, and check icons. Typography is a single vendored **Inter** family with tight-tracked display headlines and wide-tracked uppercase eyebrows.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "voltic showroom"
  - "voltic"
  - "showroom"
  - "premium"
  - "offline"
  - "electronics"
  - "experience"
  - "center"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/voltic-showroom-h89"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Voltic Showroom — Premium Offline Electronics Experience Center Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Voltic Showroom — Premium Offline Electronics Experience Center Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A single-page, forced-light marketing landing page for **Voltic**, a fictional Indian chain of walk-in "experience centers" where people touch, feel, and demo flagship phones, laptops, audio, and cameras before they buy. The aesthetic identity is "Electric Stone" — a quiet, editorial, gallery-like warm-neutral canvas punctuated by a single high-voltage electric-lime accent (`rgb(182, 228, 2)`). The mood is calm, tactile, and retail-premium: near-black ink on warm stone, with lime used only as punctuation — terminal dots on headlines, eyebrow dots, the primary CTA, and check icons. Typography is a single vendored **Inter** family with tight-tracked display headlines and wide-tracked uppercase eyebrows.

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
<artifact identifier="voltic-showroom-h89" type="text/html" title="Voltic Showroom — Premium Offline Electronics Experience Center Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# VOLTIC SHOWROOM — PREMIUM OFFLINE ELECTRONICS EXPERIENCE-CENTER LANDING PAGE

## OVERVIEW

BUILD A SINGLE-PAGE, FORCED-LIGHT MARKETING LANDING PAGE FOR A FICTIONAL PREMIUM OFFLINE ELECTRONICS RETAILER CALLED **VOLTIC**, AN INDIAN CHAIN OF WALK-IN "EXPERIENCE CENTERS" WHERE PEOPLE TOUCH, FEEL AND DEMO FLAGSHIP PHONES, LAPTOPS, AUDIO AND CAMERAS BEFORE THEY BUY. THE NAMED AESTHETIC IDENTITY IS **"ELECTRIC STONE"** — A QUIET, EDITORIAL, GALLERY-LIKE WARM-NEUTRAL CANVAS PUNCTUATED BY A SINGLE HIGH-VOLTAGE ELECTRIC-LIME ACCENT. THE MOOD IS CALM, CONFIDENT, TACTILE AND RETAIL-PREMIUM — NEVER A GENERIC SAAS GRADIENT PAGE.

## DESIGN LANGUAGE & MOOD

- WARM, PAPER-LIKE STONE BACKGROUNDS WITH GENEROUS NEGATIVE SPACE AND A GROUNDED, ARCHITECTURAL FEEL.
- ONE — AND ONLY ONE — SATURATED ACCENT: AN ACID ELECTRIC LIME, USED SPARINGLY AS PUNCTUATION (TERMINAL DOTS ON HEADLINES, ACCENT DOTS ON EYEBROWS, PRIMARY CTA FILL, CHECK ICONS, HOVER STATES). EVERYTHING ELSE IS NEAR-BLACK INK ON WARM STONE.
- LARGE PHOTOGRAPHIC HERO PANELS WITH ROUNDED CORNERS, INSET INSIDE A FULL-VIEWPORT CARD, LIKE A FRAMED GALLERY PLATE.
- A REFINED EDITORIAL FEEL: SMALL ALL-CAPS WIDE-TRACKED EYEBROWS WITH A LIME DOT, OVERSIZED TIGHT-TRACKED DISPLAY HEADLINES, RESTRAINED BODY COPY.

## EXACT COLOR PALETTE

- BRAND PRIMARY / INK: `RGB(33, 33, 29)` — NEAR-BLACK WARM CHARCOAL.
- BRAND ACCENT / ELECTRIC LIME: `RGB(182, 228, 2)`.
- NEUTRAL BACKGROUND / STONE: `RGB(243, 239, 235)`.
- NEUTRAL SURFACE / OFF-WHITE: `RGB(253, 252, 251)`.
- NEUTRAL MUTED / GREIGE: `RGB(194, 191, 188)`.
- TEXT PRIMARY: `RGB(33, 33, 29)`; TEXT SECONDARY: `RGB(70, 70, 67)`; TEXT MUTED: `RGB(144, 144, 142)`; TEXT-ON-DARK: `RGB(246, 245, 238)`.
- FORCE LIGHT MODE; IGNORE `PREFERS-COLOR-SCHEME: DARK`.

## TYPOGRAPHY

- SINGLE FAMILY: **INTER** (WEIGHTS 300, 400, 500, 600), VENDORED LOCALLY (SELF-HOSTED WOFF2, NO REMOTE FONT CDN).
- DISPLAY HEADLINES: WEIGHT 500, TIGHT LETTER-SPACING (~-0.02EM), LEADING NEAR 1. HERO HEADLINE RUNS AS THREE STACKED WORDS — `TOUCH.` `FEEL.` `CHOOSE.` — EACH TERMINAL PERIOD RENDERED IN ELECTRIC LIME.
- EYEBROWS: 10–11PX, UPPERCASE, ~2PX TRACKING, TEXT-SECONDARY, PRECEDED BY A SMALL LIME DOT.
- BODY: 400 WEIGHT, COMFORTABLE LEADING; PRICES IN A HEAVIER WEIGHT.

## LAYOUT & SECTION BREAKDOWN (TOP TO BOTTOM)

1. **FLOATING PILL NAVBAR** — FIXED, CENTERED, OFF-WHITE ROUNDED CAPSULE WITH SOFT SHADOW, MAX-WIDTH ~960PX. LEFT: WORDMARK "VOLTIC" (UPPERCASE, WIDE TRACKING). CENTER: NAV LINKS (HOME, EXPERIENCE, OFFERS, LOCATIONS) WITH A SOFT STONE PILL HIGHLIGHT ON HOVER. RIGHT: INK-FILLED "CONTACT US" CAPSULE WITH AN ARROW GLYPH. MOBILE: HAMBURGER OPENS A FULL-SCREEN SLIDE-IN OVERLAY MENU.
2. **HERO** — FULL-VIEWPORT-HEIGHT GREIGE CARD WITH ROUNDED CORNERS, SPLIT INTO TWO HALVES. LEFT HALF (TEXT): A LEAD PARAGRAPH ("INDIA'S MOST TRUSTED OFFLINE DESTINATION FOR PREMIUM ELECTRONICS…"), THE STACKED `TOUCH. / FEEL. / CHOOSE.` DISPLAY HEADLINE WITH LIME TERMINAL DOTS, AND A SOCIAL-PROOF ROW (OVERLAPPING CIRCULAR AVATARS + "1.2M+ HAPPY TECHIES VISITED OUR STORES"). RIGHT HALF (IMAGE): A FULL-BLEED PHOTO OF A MODERN ELECTRONICS STORE WITH A SUBTLE DARK OVERLAY, AND AN OVERLAID GLASS-FREE TEXT BLOCK WITH TWO BUTTONS — A LIME "LOCATE STORE" AND A STONE "WHATSAPP US". A DECORATIVE CURVED "SCROLL" GRAPHIC SITS AT THE BOTTOM CENTER SEAM.
3. **DEMO MARQUEE** — OFF-WHITE BAND. CENTERED EYEBROW ("IN-STORE NOW") + HEADLINE ("AVAILABLE FOR DEMO TODAY"). AN INFINITE HORIZONTAL AUTO-SCROLLING MARQUEE OF PRODUCT CARDS (PRODUCT IMAGE ON A LIGHT PLATE, NAME, RUPEE PRICE, AND A TINY UPPERCASE TAG LIKE "STUDIO GRADE AUDIO • DEMO READY"). MARQUEE PAUSES ON HOVER; CARD IMAGES SCALE SLIGHTLY ON HOVER.
4. **CURATED ZONES** — STONE BACKGROUND. EYEBROW ("EXPERIENCE CENTERS") + HEADLINE ("CURATED ZONES"). A RESPONSIVE GRID (1→2→4 COLUMNS) OF TALL 4:5 IMAGE TILES (THE PHONE HUB, COMPUTING DESK, AUDIO LOUNGE, CAMERA STUDIO). EACH TILE HAS A BOTTOM-UP DARK GRADIENT, A WHITE TITLE + SUBTITLE, AND A SLOW IMAGE ZOOM ON HOVER.
5. **THE VOLTIC ADVANTAGE (INTERACTIVE ACCORDION + IMAGE)** — A LARGE OFF-WHITE PANEL, TWO COLUMNS. LEFT: EYEBROW ("IN-STORE EXPERIENCE") + TWO-LINE HEADLINE ("THE VOLTIC ADVANTAGE. EXCLUSIVELY OFFLINE.") AND A FOUR-ITEM ACCORDION (INSTANT IN-STORE PURCHASE, EXPERT CONSULTATIONS, LIVE TESTING ZONES, SAME-DAY LOCAL DELIVERY). INACTIVE TITLES ARE DIMMED; THE ACTIVE ITEM EXPANDS ITS BODY COPY. RIGHT: A TALL IMAGE THAT CROSS-FADES TO MATCH THE ACTIVE ACCORDION ITEM.
6. **OFFLINE PERKS (PRICING-STYLE PRODUCT DEALS)** — CENTERED HEADER ("OFFLINE PERKS YOU CAN'T RESIST."). THREE CARDS IN A ROW: TWO STONE/OFF-WHITE CARDS AND A CENTER FEATURED CARD ON INK WITH A LIME "BESTSELLER" BADGE. EACH CARD: PRODUCT IMAGE PLATE, NAME, PRICE (WITH STRIKETHROUGH / EMI / SAVINGS), A SHORT NOTE, A LIME-CHECK FEATURE LIST, AND A FULL-WIDTH CAPSULE CTA ("CHECK STOCK" / "BOOK TRIAL").
7. **VISIT OR CONNECT (CTA BAND)** — A WIDE INK PANEL WITH ROUNDED TOP, HEADLINE "VISIT OR CONNECT.", SUPPORTING COPY, AND TWO BUTTONS: A LIME "WHATSAPP" (WITH WHATSAPP GLYPH) AND AN OFF-WHITE "CALL SUPPORT" (WITH PHONE GLYPH).
8. **FOOTER** — INK BACKGROUND, TEXT-ON-DARK. LEFT: LIME WORDMARK, A LARGE STATEMENT HEADLINE, STORE ADDRESS AND LIME CONTACT LINES. RIGHT: THREE LINK COLUMNS (EXPERIENCE / SUPPORT / CONNECT). BOTTOM: COPYRIGHT + "AUTHORIZED RETAILER" LINE IN MUTED UPPERCASE.

## HERO COMPOSITION

- ON DESKTOP THE HERO IS A SINGLE FRAMED CARD FILLING THE VIEWPORT WITH A LEFT TEXT HALF (GREIGE) AND RIGHT IMAGE HALF. ON MOBILE IT STACKS: TEXT (~55% HEIGHT) ABOVE IMAGE (~45% HEIGHT).
- THE LIME ACCENT APPEARS ONLY ON THE THREE TERMINAL PERIODS, THE EYEBROW DOTS, AND THE "LOCATE STORE" BUTTON — KEEPING THE COMPOSITION OVERWHELMINGLY NEUTRAL.

## MOTION / ANIMATION / INTERACTION SPEC

- **REVEAL-ON-SCROLL**: ELEMENTS WITH A REVEAL CLASS START AT OPACITY 0 / TRANSLATEY(20PX) AND ANIMATE TO VISIBLE VIA AN INTERSECTIONOBSERVER WITH A SOFT CUBIC-BEZIER(0.16, 1, 0.3, 1) EASE OVER ~0.8S, WITH STAGGERED TRANSITION-DELAYS.
- **CUSTOM CURSOR**: A SMALL LIME DOT FOLLOWS THE POINTER ON DESKTOP (HIDDEN ON TOUCH/SMALL SCREENS).
- **INFINITE MARQUEE**: CSS KEYFRAME TRANSLATE FROM 0 TO -50% OVER ~40S, DUPLICATED TRACK FOR SEAMLESS LOOP, PAUSED ON HOVER.
- **ACCORDION**: CLICK SWITCHES THE ACTIVE ITEM, ANIMATING MAX-HEIGHT OPEN/CLOSED AND CROSS-FADING THE PAIRED IMAGE.
- **HOVER**: NAV PILL HIGHLIGHT FADE, CARD IMAGE SCALE, ZONE TILE ZOOM, BUTTON OPACITY SHIFTS.
- **SMOOTH SCROLL** FOR IN-PAGE ANCHOR LINKS; **MOBILE MENU** SLIDES IN/OUT VIA TRANSFORM.

## RESPONSIVE BEHAVIOR

- DESKTOP: TWO-HALF HERO, 4-COLUMN ZONES, 3-COLUMN DEALS, TWO-COLUMN ADVANTAGE PANEL, FULL NAV LINKS.
- TABLET: 2-COLUMN ZONES, STACKED PANELS.
- MOBILE: STACKED HERO, SINGLE-COLUMN EVERYTHING, HAMBURGER OVERLAY MENU, CUSTOM CURSOR DISABLED, COMFORTABLE TAP TARGETS.

## TECH & ASSET REQUIREMENTS

- PLAIN STATIC BUILD (HTML + CSS + VANILLA JS). NO BUILD STEP REQUIRED; MUST RUN FROM A STATIC SERVER AND FULLY OFFLINE.
- VENDOR ALL ASSETS LOCALLY: SELF-HOST INTER WOFF2 FONTS AND DOWNLOAD ALL PHOTOGRAPHY / PRODUCT IMAGES / AVATARS INTO A LOCAL `ASSETS/` FOLDER, REFERENCED BY RELATIVE PATHS. RECREATE THE CURVED SCROLL GRAPHIC AND ALL ICONS AS INLINE SVG.
- CLEAN, SEMANTIC, ACCESSIBLE MARKUP; NO HORIZONTAL OVERFLOW; POLISHED, NON-TEMPLATED, GALLERY-GRADE EXECUTION.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/voltic-showroom-h89).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
