---
name: lantern-broth-midnight-ramen-h8
description: |
  A full, multi-section marketing landing page for Lantern Broth, a late-night Japanese ramen bar. The page uses the "Warm Modular Bento" design language — a cozy, nostalgic, earthy system built entirely from rounded rectangular tiles packed edge-to-edge into a CSS Grid bento-box layout, evoking a tray of neatly arranged dishes. Tile fills alternate between beige, terracotta, mustard, and teal, giving the grid the look of a colorful bento tray. The hero features a two-column bento with a poster headline tile alongside colored action tiles and a tall steaming-bowl photo card. Sections continue through a "made with tradition" feature row, an earthy teal statement band, a top-picks product row, a promo split, a testimonial panel with chevron controls, a WhatsApp rewards CTA, a prep/rewards triptych, and a dark cocoa footer. Motion is vanilla JS: IntersectionObserver tile reveals with stagger, hover de-tilt on hero photos, testimonial rotation, product card lifts, and a drifting steam/glow over the hero bowl — respecting `prefers-reduced-motion`. Typography pairs Oswald (condensed all-caps display) with DM Sans (body), both self-hosted as WOFF2.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "lantern broth"
  - "lantern"
  - "broth"
  - "midnight"
  - "ramen"
  - "bar"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/lantern-broth-midnight-ramen-h8"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Lantern Broth — Midnight Ramen Bar Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Lantern Broth — Midnight Ramen Bar Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A full, multi-section marketing landing page for Lantern Broth, a late-night Japanese ramen bar. The page uses the "Warm Modular Bento" design language — a cozy, nostalgic, earthy system built entirely from rounded rectangular tiles packed edge-to-edge into a CSS Grid bento-box layout, evoking a tray of neatly arranged dishes. Tile fills alternate between beige, terracotta, mustard, and teal, giving the grid the look of a colorful bento tray. The hero features a two-column bento with a poster headline tile alongside colored action tiles and a tall steaming-bowl photo card. Sections continue through a "made with tradition" feature row, an earthy teal statement band, a top-picks product row, a promo split, a testimonial panel with chevron controls, a WhatsApp rewards CTA, a prep/rewards triptych, and a dark cocoa footer. Motion is vanilla JS: IntersectionObserver tile reveals with stagger, hover de-tilt on hero photos, testimonial rotation, product card lifts, and a drifting steam/glow over the hero bowl — respecting `prefers-reduced-motion`. Typography pairs Oswald (condensed all-caps display) with DM Sans (body), both self-hosted as WOFF2.

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
<artifact identifier="lantern-broth-midnight-ramen-h8" type="text/html" title="Lantern Broth — Midnight Ramen Bar Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# LANTERN BROTH — MIDNIGHT RAMEN LANDING PAGE

## AESTHETIC IDENTITY

BUILD A FULL, MULTI-SECTION MARKETING LANDING PAGE FOR A LATE-NIGHT JAPANESE
RAMEN BAR CALLED **"LANTERN BROTH"**. THE NAMED DESIGN LANGUAGE IS
**"WARM MODULAR BENTO"** — A COZY, NOSTALGIC, EARTHY SYSTEM BUILT ENTIRELY FROM
ROUNDED RECTANGULAR "TILES" PACKED EDGE-TO-EDGE INTO A BENTO-BOX GRID, AS IF THE
WHOLE PAGE WERE A TRAY OF NEATLY ARRANGED DISHES. THE MOOD IS UNHURRIED,
HANDMADE, AND APPETIZING: SLOW MIDNIGHT MOMENTS, STEAM RISING OFF A BOWL,
PAPER-LANTERN GLOW. NOTHING SHOULD READ AS GENERIC SAAS — EVERY SURFACE IS A
SOFT, CREAM-COLORED CARD WITH A GENEROUS 14–16PX CORNER RADIUS AND A WHISPER-SOFT
SHADOW.

## COLOR PALETTE (EXACT)

- TERRACOTTA / RUST (PRIMARY): `#C8553D`
- MUSTARD GOLD (SECONDARY): `#F2D06B`
- MUTED TEAL (ACCENT): `#A8D0C8`
- DEEP TEAL (ACCENT DARK): `#2A6F66`
- CREAM (PAGE BACKGROUND): `#FDF8E8`
- BEIGE CARD SURFACE: `#F9F1DC`
- NEAR-WHITE SURFACE: `#FDFDF7`
- INK TEXT (PRIMARY): `#222222`
- MUTED TEXT (SECONDARY): `#666666`
- DARK COCOA (FOOTER): `#4A3B32`

TILE FILLS ALTERNATE BETWEEN BEIGE, TERRACOTTA, MUSTARD, AND TEAL SO THE GRID
READS LIKE A COLORFUL BENTO TRAY. TERRACOTTA AND DEEP-TEAL TILES USE WHITE TEXT;
BEIGE AND MUSTARD TILES USE INK TEXT.

## TYPOGRAPHY

- DISPLAY / HEADINGS: **OSWALD** (CONDENSED GROTESQUE), WEIGHTS 400/500/700, SET
  IN ALL-CAPS WITH TIGHT LEADING (0.9–0.95) FOR PUNCHY, POSTER-LIKE HEADLINES.
- BODY / UI: **DM SANS**, WEIGHTS 400/500/700, FOR PARAGRAPHS, CAPTIONS, AND
  PRICES. SMALL UPPERCASE LABELS USE OSWALD WITH WIDE LETTER-SPACING.
- VENDOR BOTH FONTS LOCALLY (WOFF2) — NO GOOGLE FONTS CDN AT RUNTIME.

## LAYOUT & SECTION BREAKDOWN

CENTERED CONTENT COLUMN, MAX-WIDTH ~1200PX, ~16PX GUTTERS BETWEEN TILES.
SECTIONS, TOP TO BOTTOM:

1. **STICKY HEADER** — WHITE BAR, SUBTLE SHADOW. LEFT NAV (HOME, MENU), CENTERED
   WORDMARK "LANTERN BROTH" WITH A BOWL/LANTERN ICON, RIGHT NAV (LOCATIONS,
   CONTACT) PLUS SEARCH + BAG ICONS. COLLAPSES GRACEFULLY ON MOBILE.

2. **HERO BENTO** — A TWO-COLUMN BENTO. LEFT: A LARGE BEIGE TILE WITH A
   POSTER HEADLINE ("THE ULTIMATE UMAMI RUSH YOU NEED AT 12:00 AM"), A SHORT
   DESCRIPTION, AND TWO BUTTONS (FILLED "ORDER NOW", OUTLINE "OUR STORY"); BELOW
   IT, TWO SMALLER COLORED ACTION TILES (MUSTARD "RAMEN KITS", TERRACOTTA
   "RESERVE A TABLE") EACH WITH A CIRCULAR ARROW BADGE AND A TILTED FOOD PHOTO
   THAT STRAIGHTENS ON HOVER. RIGHT: A TALL FULL-HEIGHT HERO PHOTO TILE OF A
   STEAMING BOWL.

3. **"MADE WITH TRADITION" PILL HEADER** + A THREE-PART BENTO ROW: LEFT 2×2 GRID
   OF FEATURE TILES (HAKATA STYLE, 24H SIMMERED BROTH, FRESH GREENS, NO MSG) EACH
   WITH AN ICON; CENTER A LARGE PHOTO TILE OF A CHEF; RIGHT A STACK OF THREE
   MENU-HIGHLIGHT ROWS (THUMBNAIL + NAME + ONE-LINER).

4. **EARTHY STATEMENT BAND** — A WIDE MUTED-TEAL TILE WITH A CENTERED MISSION
   SENTENCE ABOUT WARM, NOSTALGIC, SLOW MOMENTS, PUNCTUATED BY SMALL INLINE
   ICONS.

5. **"TOP PICKS JUST FOR YOU" PRODUCTS** — TERRACOTTA TAB HEADER, THEN THREE
   PRODUCT CARDS (SPECIAL TONKOTSU KIT, VOLCANO MISO, CREAMY VEGAN SHIO) WITH A
   CORNER BADGE (BEST SELLER / SPICY / VEGAN), A PRODUCT PHOTO, PRICE, AND A
   "BUY NOW" BUTTON.

6. **PROMO SPLIT** — A TERRACOTTA TILE ("LANTERN BROTH IS HERE", OPEN TILL 3 AM,
   ROUNDED "SHOP NOW" BUTTON, DECORATIVE OVERLAPPING MUSTARD CIRCLES) BESIDE A
   PHOTO TILE.

7. **TESTIMONIALS** — A BEIGE PANEL WITH A TAB HEADER, LEFT/RIGHT CIRCULAR
   CHEVRON CONTROLS, AND THREE CENTERED REVIEW COLUMNS (AVATAR, NAME, QUOTE,
   FIVE GOLD STARS).

8. **WHATSAPP REWARDS CTA** — A TERRACOTTA TILE WITH TWO LARGE MUSTARD CIRCLES
   BLEEDING OFF THE LEFT AND RIGHT EDGES, A HEADLINE, AND A PILL BUTTON
   ("JOIN MIDNIGHT COMMUNITY").

9. **PREP / REWARDS TRIPTYCH** — THREE TILES: A TEAL "HOW TO PREPARE YOUR PERFECT
   BOWL?" LIST TILE, A CENTER PHOTO TILE, AND A DEEP-TEAL "JOIN OUR REWARDS
   PROGRAM" TILE WITH A RING-CIRCLE DECORATION AND A BUTTON.

10. **FOOTER** — DARK COCOA TILE WITH A ROUNDED TOP, A LARGE "GET IN TOUCH"
    HEADING, ADDRESS + SOCIAL ICONS ON THE LEFT, A CENTERED BOWL MASCOT, AND TWO
    LINK COLUMNS ON THE RIGHT.

## MOTION / ANIMATION / INTERACTION SPEC

- SCROLL-REVEAL: TILES FADE UP (OPACITY 0→1, TRANSLATEY 20PX→0) VIA AN
  INTERSECTIONOBSERVER AS THEY ENTER THE VIEWPORT, WITH A GENTLE STAGGER ACROSS
  EACH SECTION (~0.8S EASE-OUT).
- HERO ACTION TILES: THE TILTED FOOD PHOTO ROTATES BACK TO 0° AND SCALES SLIGHTLY
  ON HOVER; THE CIRCULAR ARROW BADGE NUDGES.
- BUTTONS: FILLED↔OUTLINE INVERT ON HOVER; PILL BUTTONS SCALE UP ~1.05.
- TESTIMONIAL CHEVRONS: ROTATE THE THREE REVIEWS THROUGH A SMALL SET ON CLICK
  (NO LIBRARY — VANILLA JS).
- PRODUCT CARDS: SUBTLE LIFT + SHADOW DEEPEN ON HOVER.
- STEAM ACCENT: A SOFT, SLOWLY DRIFTING STEAM/GLOW EFFECT OVER THE HERO BOWL
  PHOTO FOR LIFE.
- RESPECT `prefers-reduced-motion`.

## RESPONSIVE BEHAVIOR

- DESKTOP (≥1024PX): FULL MULTI-COLUMN BENTO GRIDS AS DESCRIBED.
- TABLET (≥640PX): GRIDS COLLAPSE TO TWO COLUMNS; THE TALL HERO PHOTO MAY HIDE OR
  STACK.
- MOBILE (<640PX): EVERY TILE STACKS TO A SINGLE COLUMN, HEADER NAV COLLAPSES,
  HEADLINES SCALE DOWN FLUIDLY. TOUCH TARGETS STAY COMFORTABLE.

## TECHNICAL NOTES

- SELF-CONTAINED, RUNNABLE OFFLINE. VENDOR ALL ASSETS LOCALLY: FONTS (WOFF2),
  ALL FOOD/PORTRAIT IMAGERY, AND ANY ICONS. PREFER INLINE SVG ICONS OVER AN ICON
  FONT CDN. REFERENCE EVERYTHING WITH RELATIVE LOCAL PATHS.
- CLEAN, SEMANTIC HTML; THE BENTO GRID DRIVEN BY CSS GRID; NO HEAVY FRAMEWORK
  REQUIRED.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/lantern-broth-midnight-ramen-h8).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
