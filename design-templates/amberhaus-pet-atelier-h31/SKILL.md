---
name: amberhaus-pet-atelier-h31
description: |
  A multi-section marketing landing page for **Amberhaus**, a fictional high-end pet boutique and care atelier, built in a "Warm Amber Boutique" design language — a quiet, editorial look that reads like a printed lifestyle monograph about pampered pets rather than a generic pet-store site. Everything sits on crisp warm-white paper punctuated by a single saturated amber-gold accent (`#D97706`) and a butter-cream tint. Signature features include a custom amber paw-print cursor page-wide, a triptych hero with auto-crossfading image sliders and parallax center text, a 300vh horizontal-scroll sticky story track, vertical marquee testimonials with alternating up/down columns, and a spring-eased floating menu. Typography mixes Bricolage Grotesque display, Inter body, and Playfair Display italic flourish.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "amberhaus"
  - "luxury"
  - "pet"
  - "boutique"
  - "care"
  - "atelier"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/amberhaus-pet-atelier-h31"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Amberhaus — Luxury Pet Boutique & Care Atelier Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Amberhaus — Luxury Pet Boutique & Care Atelier Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A multi-section marketing landing page for **Amberhaus**, a fictional high-end pet boutique and care atelier, built in a "Warm Amber Boutique" design language — a quiet, editorial look that reads like a printed lifestyle monograph about pampered pets rather than a generic pet-store site. Everything sits on crisp warm-white paper punctuated by a single saturated amber-gold accent (`#D97706`) and a butter-cream tint. Signature features include a custom amber paw-print cursor page-wide, a triptych hero with auto-crossfading image sliders and parallax center text, a 300vh horizontal-scroll sticky story track, vertical marquee testimonials with alternating up/down columns, and a spring-eased floating menu. Typography mixes Bricolage Grotesque display, Inter body, and Playfair Display italic flourish.

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
<artifact identifier="amberhaus-pet-atelier-h31" type="text/html" title="Amberhaus — Luxury Pet Boutique & Care Atelier Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# AMBERHAUS — LUXURY PET ATELIER & BOUTIQUE LANDING PAGE

BUILD A FULL, MULTI-SECTION, FULLY RESPONSIVE MARKETING LANDING PAGE FOR A FICTIONAL HIGH-END PET BOUTIQUE AND CARE ATELIER NAMED **AMBERHAUS** — "EVERY COMPANION DESERVES THE GOLD STANDARD." THE NAMED AESTHETIC IDENTITY IS **"WARM AMBER BOUTIQUE"**: A QUIET, EXPENSIVE, EDITORIAL DESIGN LANGUAGE THAT FEELS LIKE A PRINTED LIFESTYLE MONOGRAPH ABOUT PAMPERED PETS — NOT A GENERIC PET-STORE SITE. EVERYTHING SITS ON CRISP WARM WHITE PAPER, PUNCTUATED BY A SINGLE SATURATED AMBER-GOLD ACCENT AND A SOFT BUTTER-CREAM TINT, WITH GENEROUS ROUNDED RADII, HAIRLINE BORDERS, AND CONFIDENT MIXED TYPOGRAPHY (A CHUNKY GROTESQUE DISPLAY, A NEUTRAL SANS BODY, AND AN OCCASIONAL ITALIC SERIF FOR FLOURISH).

## DESIGN LANGUAGE & MOOD

- WARM, BOUTIQUE, EDITORIAL, INTENTIONAL. CALM LUXURY, NEVER LOUD. GENEROUS WHITESPACE, STRONG TYPOGRAPHIC HIERARCHY, AND A SINGLE AMBER ACCENT USED DELIBERATELY FOR EMPHASIS.
- NO GENERIC-AI-SLOP: NO PURPLE GRADIENTS, NO GLASSMORPHISM, NO NEON. SOFT, LOW-CONTRAST SHADOWS ONLY.
- A PLAYFUL SIGNATURE TOUCH: A CUSTOM AMBER **PAW-PRINT CURSOR** APPLIED ACROSS THE WHOLE PAGE, AND A SUBTLE TILED TEXTURE OVERLAY (FAINT CUBES/GRAIN) AT ~5% OPACITY OVER LARGE SURFACES.
- ROUNDED RADII SCALE: PILLS AND BUTTONS FULLY ROUNDED; CARDS 24PX; LARGE FEATURE PANELS 32PX; HERO/FOOTER CANVAS 40–48PX. HAIRLINE BORDERS AT `rgba(amber, 0.1–0.2)`.

## COLOR PALETTE (EXACT)

- AMBER PRIMARY: `#D97706` (HEADINGS, ACCENTS, BUTTONS, CURSOR).
- BUTTER CREAM: `#FEF3C7` (TINTED PANELS, PILLS, HERO CENTER COLUMN).
- WARM WHITE BACKGROUND: `#FFFFFF`.
- INK PRIMARY TEXT: `#1F2937`.
- MUTED SECONDARY TEXT: `#4B5563`.
- NEAR-BLACK FOR DEEP CONTRAST WHERE NEEDED: `#141415`.

## TYPOGRAPHY

- DISPLAY: **"BRICOLAGE GROTESQUE"** (700/800) — CHUNKY, CONFIDENT, TIGHT TRACKING (-0.03 TO -0.04EM) FOR HEADINGS AND THE LOGO.
- BODY: **"INTER"** (400/500/700) — NEUTRAL, LEGIBLE.
- FLOURISH: **"PLAYFAIR DISPLAY"** ITALIC (400) — FOR SMALL EDITORIAL ITALIC LABELS ("TREAT THEM TO GOLD.", "READY FOR A SPA DAY?").
- LETTERSPACING: LOGO WIDE (0.15EM), UPPERCASE EYEBROWS WIDE (0.2EM).

## LAYOUT & SECTION BREAKDOWN (TOP TO BOTTOM)

1. **FLOATING HEADER (FIXED).** THREE ZONES OVER A POINTER-EVENTS-NONE BAR: LEFT — A CREAM PILL "MENU" BUTTON WITH A TWO-BAR ICON THAT MORPHS TO AN X AND A VERTICAL TEXT-SWAP ("MENU"→"EXPLORE"); CENTER — THE WORDMARK "AMBERHAUS." (SHORTENS TO "A.H." ON MOBILE); RIGHT — A CREAM PILL "BOOK A VISIT"→"LET'S TALK" TEXT-SWAP BUTTON. THE MENU OPENS A ROUNDED CREAM FLOATING PANEL ANCHORED BOTTOM-RIGHT WITH LARGE DISPLAY NAV LINKS (SERVICES, SHOP, OUR STORY, CONTACT) AND SOCIALS, ANIMATING IN WITH A SOFT SPRING EASE.
2. **TRIPTYCH HERO.** A FULL-WIDTH THREE-COLUMN COMPOSITION (~32% / 36% / 32%) ON A HAIRLINE TOP RULE: LEFT AND RIGHT COLUMNS ARE TALL (~689PX) AUTO-CROSSFADING IMAGE SLIDERS (3 IMAGES EACH, 5S INTERVAL, 1S OPACITY FADE); THE CENTER COLUMN IS A BUTTER-CREAM PANEL, CENTERED, HOLDING AN AMBER UPPERCASE EYEBROW, A CHUNKY DISPLAY HEADLINE, A MUTED SUBHEAD, AND A FULLY-ROUNDED AMBER CTA BUTTON THAT INVERTS TO WHITE-ON-AMBER-OUTLINE ON HOVER. THE CENTER TEXT GETS A GENTLE PARALLAX TRANSLATE AS THE PAGE SCROLLS. ON MOBILE THE COLUMNS STACK.
3. **SERVICES + BOUTIQUE GRID.** A CREAM PILL HEADER BAR ("AMBERHAUS EXCELLENCE" / "BOOK APPOINTMENT"). BELOW, A THREE-ZONE GRID (`320px 1fr 340px`): LEFT — FOUR SERVICE FEATURE CARDS (MASTER GROOMING, LUXURY BOARDING, PET WELLNESS, ELITE CONCIERGE) EACH WITH A LINE ICON, UPPERCASE DISPLAY TITLE, AND COPY, HOVERING TO A DEEPER CREAM; CENTER — A TALL FEATURE IMAGE PANEL WITH A BOTTOM AMBER GRADIENT, AN ITALIC SERIF LINE, AND A HUGE UPPERCASE DISPLAY HEADING, WITH A SLOW IMAGE ZOOM ON HOVER; RIGHT — FOUR HORIZONTAL "BOUTIQUE PRODUCT" CARDS (CIRCULAR PRODUCT THUMBNAIL, NAME, AMBER PRICE, "ADD TO CART +").
4. **HORIZONTAL-SCROLL STORY ("THE AMBERHAUS JOURNEY").** A 300VH SECTION WITH A STICKY FULL-VIEWPORT TRACK THAT TRANSLATES HORIZONTALLY AS THE USER SCROLLS VERTICALLY. FOUR CHAPTER STEPS: AN INTRO STEP (FOUNDER VISION, YEAR 2012), TWO ALTERNATING IMAGE+TEXT STEPS (2015 GROOMING METHODOLOGY; 2019 BOUTIQUE COLLECTION), AND A CREAM CONCLUSION CARD ("THE PRESENT") WITH A SOFT AMBER BLUR ORB AND A "JOIN THE CIRCLE" CTA. EACH STEP HAS AN AMBER "CHAPTER" EYEBROW, A DISPLAY HEADING, A YEAR NUMERAL, AND AN AMBER RULE.
5. **VERTICAL MARQUEE TESTIMONIALS.** ON A FAINT CREAM-TINT BACKGROUND: A CENTERED TITLE BLOCK WITH A 5-STAR PILL ("5.0 BOUTIQUE RATING") AND A DISPLAY HEADLINE ("VOICES FROM THE AMBERHAUS CIRCLE"). BELOW, A FOUR-COLUMN GRID OF INFINITELY VERTICALLY-SCROLLING CARDS (ALTERNATING COLUMNS SCROLL UP / DOWN AT ~45S LINEAR LOOP, PAUSE ON HOVER), MIXING WHITE REVIEW CARDS, CREAM EMPHASIS CARDS, IMAGE CARDS, AND AN AMBER "BRAND" CARD. A TOP/BOTTOM LINEAR-GRADIENT MASK FADES THE EDGES. COLUMNS COLLAPSE RESPONSIVELY (2 ON TABLET, 1 ON MOBILE).
6. **FOOTER CANVAS + FLOATING CONTACT CARD.** A LARGE AMBER ROUNDED CANVAS (40–48PX RADIUS) WITH A FAINT TEXTURE OVERLAY: WORDMARK + "SINCE MMXXII" TOP-LEFT, AND GIANT GHOSTED DISPLAY LETTERS SPELLING "PAWS." ALONG THE BOTTOM WITH A STAGGERED PER-LETTER JUMP ANIMATION; A LEGAL/COPY ROW. A CREAM "CONTACT" CARD OVERLAPS THE TOP-RIGHT OF THE CANVAS (NEGATIVE TOP MARGIN, BIG SOFT SHADOW) WITH TWO NAV LINK COLUMNS AND A "BOOK VISIT" CTA.
7. **PROJECT OVERLAY.** A FULL-SCREEN WHITE OVERLAY THAT SLIDES UP FROM THE BOTTOM (TRIGGERED BY "BOOK A VISIT") WITH TWO LARGE EDITORIAL CTA CARDS ("GROOMING & CARE — READY FOR A SPA DAY?" AND "LUXURY CONCIERGE — GOT A UNIQUE REQUEST?"), EACH WITH AN ITALIC SERIF LABEL, A CHUNKY DISPLAY HEADLINE, COPY, AND A ROUND ARROW BUTTON THAT ROTATES 45° ON HOVER. CLOSED VIA AN X OR ESCAPE.

## MOTION / ANIMATION / INTERACTION SPEC

- SCROLL-REVEAL: ELEMENTS TAGGED FOR ANIMATION FADE+RISE (OPACITY 0→1, TRANSLATEY 30PX→0, 0.8S EASE-OUT) VIA AN INTERSECTION OBSERVER (THRESHOLD ~0.1), UNOBSERVED AFTER FIRING.
- HERO SLIDERS: AUTO CROSSFADE EVERY 5S; CENTER TEXT PARALLAX TIED TO SCROLL OFFSET (~0.1 FACTOR).
- HORIZONTAL JOURNEY: SCROLL PROGRESS (0→1) OVER THE STICKY CONTAINER MAPS TO `translateX(-progress * (trackWidth - viewportWidth))`.
- TESTIMONIAL MARQUEE: CSS KEYFRAME LOOPS (UP / DOWN), PAUSED ON HOVER; DUPLICATED CONTENT FOR SEAMLESS LOOP.
- MENU: TWO-BAR HAMBURGER MORPHS TO X; PANEL SPRINGS IN WITH `cubic-bezier(0.23,1,0.32,1)`; CLICK-OUTSIDE AND ESCAPE CLOSE IT.
- FOOTER WORDMARK: PER-LETTER STAGGERED JUMP KEYFRAME (2.5S INFINITE).
- BUTTONS: ACTIVE SCALE 0.95, SOFT SHADOW LIFT ON HOVER; TEXT-SWAP BUTTONS SLIDE A SECOND LABEL UP ON HOVER. SMOOTH-SCROLL FOR ALL IN-PAGE ANCHORS (OFFSET FOR THE FIXED HEADER). A CUSTOM AMBER PAW CURSOR APPLIES PAGE-WIDE; A SLIM AMBER SCROLLBAR.

## RESPONSIVE BEHAVIOR

- HERO TRIPTYCH STACKS VERTICALLY ON MOBILE; CENTER PANEL REMAINS CENTERED.
- SERVICES GRID COLLAPSES: FEATURE CARDS TO A 2-COL GRID, THEN SINGLE COLUMN; CENTER IMAGE AND PRODUCT LIST STACK.
- JOURNEY STEPS WIDEN ON SMALL SCREENS (70–75VW) AND ALTERNATE IMAGE/TEXT STACK ON MOBILE.
- TESTIMONIAL COLUMNS REDUCE FROM 4 → 2 → 1.
- FOOTER CONTACT CARD WIDTH FLEXES; GIANT FOOTER TYPE USES `clamp()`.
- HEADER LABELS COLLAPSE TO ICONS ON MOBILE; WORDMARK SHORTENS.

## DELIVERABLE

A SELF-CONTAINED STATIC SITE (HTML + CSS + JS) WITH ALL ASSETS (FONTS, IMAGES, TEXTURE) VENDORED LOCALLY SO IT RUNS FULLY OFFLINE. POLISHED, DISTINCTIVE, NON-TEMPLATED EXECUTION WORTHY OF A LUXURY BRAND.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/amberhaus-pet-atelier-h31).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
