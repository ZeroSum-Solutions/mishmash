---
name: noctis-aurum-h69
description: |
  A multi-section e-commerce landing page for Noctis Aurum, a fictional fine-jewelry maison (atelier de luxe, est. 1989), built on an "Obsidian & Champagne" aesthetic — a deep, nocturnal, old-money luxury language where champagne gold glints against ink-dark obsidian and cool pearl, with Cormorant Garamond serif headlines and generous negative space. Sections flow from an announcement banner and sticky blurred header through a split hero with a 3-image cross-fade slideshow and floating "current focus" card, a circular category rail, a gold marquee strip, an 8-product grid with quick-add simulation, a dark heritage feature, a men's 3-card strip, a bespoke atelier block, and footer — all self-contained and offline-runnable with `prefers-reduced-motion` support.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "noctis aurum"
  - "noctis"
  - "aurum"
  - "fine"
  - "jewelry"
  - "maison"
  - "e-commerce"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/noctis-aurum-h69"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Noctis Aurum — Fine Jewelry Maison E-Commerce Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Noctis Aurum — Fine Jewelry Maison E-Commerce Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A multi-section e-commerce landing page for Noctis Aurum, a fictional fine-jewelry maison (atelier de luxe, est. 1989), built on an "Obsidian & Champagne" aesthetic — a deep, nocturnal, old-money luxury language where champagne gold glints against ink-dark obsidian and cool pearl, with Cormorant Garamond serif headlines and generous negative space. Sections flow from an announcement banner and sticky blurred header through a split hero with a 3-image cross-fade slideshow and floating "current focus" card, a circular category rail, a gold marquee strip, an 8-product grid with quick-add simulation, a dark heritage feature, a men's 3-card strip, a bespoke atelier block, and footer — all self-contained and offline-runnable with `prefers-reduced-motion` support.

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
<artifact identifier="noctis-aurum-h69" type="text/html" title="Noctis Aurum — Fine Jewelry Maison E-Commerce Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# NOCTIS AURUM — FINE JEWELRY MAISON LANDING PAGE

## AESTHETIC IDENTITY

BUILD A FULL, MULTI-SECTION E-COMMERCE LANDING PAGE FOR A FICTIONAL FINE JEWELRY MAISON NAMED **NOCTIS AURUM** (ATELIER DE LUXE, EST. 1989). THE NAMED AESTHETIC IDENTITY IS **"OBSIDIAN & CHAMPAGNE"** — A DEEP, NOCTURNAL, OLD-MONEY LUXURY LANGUAGE WHERE POLISHED CHAMPAGNE GOLD GLINTS AGAINST INK-DARK OBSIDIAN AND COOL PEARL. THE MOOD IS HUSHED, EXPENSIVE, AND CEREMONIAL — LESS A STOREFRONT, MORE A MIDNIGHT PRIVATE VIEWING IN A JEWEL VAULT. THINK CARTIER MEETS A VOGUE EDITORIAL: SERIF HEADLINES THE SIZE OF DOORWAYS, GENEROUS NEGATIVE SPACE, AND METAL THAT CATCHES THE LIGHT.

## COLOR PALETTE

- **OBSIDIAN (PRIMARY DARK):** `#0B0E13` — NEAR-BLACK NAVY-BLACK, USED FOR THE HERO, BANNERS, MARQUEE, HERITAGE SECTION, AND FOOTER.
- **CHAMPAGNE GOLD (ACCENT):** `#C9A86A` — REFINED MUTED GOLD FOR LABELS, RULES, DIVIDERS, PRICES, AND HOVER STATES. SECONDARY GOLD HIGHLIGHT `#E3C892` FOR GRADIENT SHEEN.
- **PEARL (LIGHT SURFACE):** `#F4F1EA` — WARM OFF-WHITE FOR THE LIGHT SECTIONS (CATEGORIES, BESTSELLERS, BESPOKE).
- **MIST (NEUTRAL SURFACE):** `#FBFAF6` — SLIGHTLY LIGHTER CARD/PANEL BACKGROUND.
- **INK (TEXT ON LIGHT):** `#13161C`; **STONE (MUTED TEXT):** `#6B6E76`.
- **TEXT ON DARK:** PURE-ISH WHITE `#F4F1EA` AT 100% FOR HEADLINES, AND AT 60–70% OPACITY FOR BODY COPY.

## TYPOGRAPHY

- **DISPLAY / HEADLINES:** A HIGH-CONTRAST SERIF — **"Cormorant Garamond"** (WEIGHTS 400, 500, 600) — FOR THE WORDMARK, ALL `H1`/`H2`/`H3`, AND PRODUCT NAMES. LETTERS LARGE, AIRY, WITH TIGHT LINE-HEIGHT (~1.05) ON HERO.
- **BODY / UI:** A NEUTRAL GROTESQUE — **"Inter"** (WEIGHTS 300, 400, 500, 600) — FOR PARAGRAPHS, NAV, BUTTONS, LABELS.
- **MICRO-LABELS:** INTER, UPPERCASE, 10–12PX, LETTER-SPACING `0.3em`, IN CHAMPAGNE GOLD, OFTEN PRECEDED BY A SHORT 48PX GOLD RULE.
- VENDOR BOTH FONT FAMILIES LOCALLY (SELF-HOSTED WOFF2 + `@font-face`), NO REMOTE FONT CDN.

## LAYOUT & SECTION BREAKDOWN (TOP TO BOTTOM)

1. **ANNOUNCEMENT BANNER** — THIN OBSIDIAN STRIP, CENTERED CHAMPAGNE-TINTED 12PX TEXT: "PRIVATE WINTER VIEWING NOW OPEN AT OUR PLACE VENDÔME SALON".
2. **STICKY HEADER** — TRANSLUCENT OBSIDIAN WITH BACKDROP BLUR. CENTERED SERIF WORDMARK "NOCTIS AURUM" WITH A TINY GOLD "ATELIER DE LUXE" SUB-TAG. LEFT NAV (COLLECTIONS, MAISON, BESPOKE), RIGHT NAV (SALONS + A GOLD-OUTLINE "ENQUIRE" PILL BUTTON). HAMBURGER ON MOBILE OPENING A FULL-HEIGHT LEFT DRAWER WITH BLUR BACKDROP.
3. **HERO (SPLIT 50/50, ~88VH)** — LEFT: OBSIDIAN CONTENT COLUMN WITH GOLD EYEBROW RULE + "EST. 1989 · PARIS", A MASSIVE SERIF HEADLINE "Light, made / **eternal**" (THE SECOND WORD IN CHAMPAGNE GOLD, LIGHTER WEIGHT), A MUTED INTRO PARAGRAPH, A SINGLE GOLD CTA PILL ("DISCOVER THE MAISON"), AND A TWO-STAT ROW (e.g. "2,400+ HAND-SET STONES", "30+ MAÎTRES JOAILLIERS") ABOVE A THIN TOP-BORDER. RIGHT: A FULL-BLEED IMAGE COLUMN RUNNING A SLOW 3-IMAGE CROSS-FADE SLIDESHOW OF JEWELRY, WITH A FLOATING GLASS "CURRENT FOCUS" CARD (BLUR PANEL, GOLD LABEL, A 3-DOT PROGRESS PIP THAT ADVANCES WITH THE SLIDESHOW). SUBTLE GOLD VIGNETTE/GRADIENT OVERLAY.
4. **CATEGORY RAIL** — PEARL BACKGROUND. 5 CIRCULAR CATEGORY MEDALLIONS (RINGS, EARRINGS, NECKLACES, BRACELETS, BRIDAL) — IMAGES IN GOLD-RINGED CIRCLES THAT GROW A GOLD BORDER AND SCALE THE IMAGE ON HOVER, WITH A SERIF LABEL + "EXPLORE" SUB.
5. **GOLD MARQUEE STRIP** — OBSIDIAN BAND WITH AN INFINITE HORIZONTAL MARQUEE OF SERIF VALUE PROPS SEPARATED BY GOLD DIAMOND/DOT GLYPHS (HALLMARKED GOLD · ETHICALLY SOURCED DIAMONDS · BESPOKE ATELIER · LIFETIME CARE).
6. **MOST COVETED (PRODUCT GRID)** — PEARL BACKGROUND. SECTION HEADER WITH SERIF TITLE "The most coveted" + A GOLD-UNDERLINE "VIEW ALL" LINK. A RESPONSIVE GRID (2 COL MOBILE → 4 COL DESKTOP) OF 8 PRODUCT CARDS: 4:5 IMAGE THAT SCALES ON HOVER INSIDE A ROUNDED FRAME, A GOLD "+" QUICK-ADD CHIP THAT FADES IN ON HOVER, CENTERED SERIF NAME, MUTED METAL/STONE LINE, AND A CHAMPAGNE-GOLD PRICE.
7. **HERITAGE FEATURE (FULL-WIDTH DARK)** — OBSIDIAN, TWO-COLUMN: LEFT COPY ("THE HÉRITAGE COLLECTION", BIG SERIF "Maison / regalia", PARAGRAPH, TWO GOLD-LEFT-BORDER MICRO-FEATURES, A GOLD CTA); RIGHT A TALL 4:5 EDITORIAL IMAGE WITH SOFT SHADOW.
8. **NOCTIS HOMME (3-CARD STRIP)** — MIST BACKGROUND. CENTERED SERIF TITLE + GOLD UNDERLINE RULE, THEN 3 ELEVATED WHITE CARDS (SQUARE IMAGE, SERIF NAME, GOLD PRICE) FOR MEN'S PIECES.
9. **BESPOKE ATELIER** — PEARL BACKGROUND. TWO-COLUMN: A STAGGERED PAIR OF ATELIER/CRAFT IMAGES ON ONE SIDE, AND ON THE OTHER A GOLD EYEBROW, BIG SERIF "Your vision, / **our hands**", PARAGRAPH, A GOLD-LEFT-BORDER CONTACT BLOCK (FLAGSHIP SALON + PRIVATE CONCIERGE), AND A SOLID OBSIDIAN CTA ("BOOK A PRIVATE APPOINTMENT").
10. **FOOTER (DARK)** — OBSIDIAN, 4-COLUMN: BRAND BLURB + SOCIAL LINKS, SHOP LINKS, SERVICES LINKS, AND SALON ADDRESSES (PARIS FLAGSHIP + LONDON SALON). BOTTOM BAR WITH COPYRIGHT + LEGAL LINKS, ALL GOLD-ON-OBSIDIAN.

## HERO COMPOSITION DETAIL

THE HERO MUST FEEL LIKE A CAMPAIGN COVER: ASYMMETRIC, THE TYPE DOMINANT ON THE DARK LEFT, THE IMAGERY LUMINOUS ON THE RIGHT. THE GLASS "CURRENT FOCUS" CARD FLOATS BOTTOM-RIGHT OVER THE IMAGE, NAMING THE PIECE ON SCREEN AND ADVANCING ITS PROGRESS PIPS IN SYNC WITH THE CROSS-FADE. A FAINT GOLD GRAIN/NOISE OR RADIAL SHEEN OVER THE OBSIDIAN ADDS DEPTH.

## MOTION / ANIMATION / INTERACTION SPEC

- **HERO SLIDESHOW:** 3 IMAGES CROSS-FADE EVERY ~5S WITH A LONG (1.6–2S) OPACITY TRANSITION; THE FOCUS-CARD TITLE AND 3-DOT PIPS UPDATE IN LOCKSTEP.
- **SCROLL REVEALS:** ELEMENTS TAGGED FOR REVEAL START AT `opacity:0; translateY(24px)` AND ANIMATE TO REST VIA AN `IntersectionObserver` (THRESHOLD ~0.12), STAGGERED WHERE GROUPED. EASING `cubic-bezier(.22,1,.36,1)`, ~0.8S.
- **PRODUCT / CATEGORY HOVER:** IMAGE SCALES TO ~1.08 OVER 0.9–1S; CATEGORY MEDALLIONS GAIN A GOLD BORDER; PRODUCT QUICK-ADD "+" CHIP FADES/SLIDES IN.
- **QUICK-ADD SIMULATION:** CLICKING A PRODUCT "+" CHIP BRIEFLY SWAPS IT TO A GOLD CHECK AND BUMPS A HEADER CART/SAVED COUNT, THEN REVERTS — A LIGHTWEIGHT JS SIMULATION, NO BACKEND.
- **MARQUEE:** SEAMLESS CSS `translateX` LOOP (~30S), DUPLICATED TRACK FOR CONTINUITY, PAUSES ON HOVER.
- **HEADER:** GAINS A STRONGER SHADOW/OPACITY ONCE SCROLLED PAST THE HERO. MOBILE DRAWER SLIDES IN FROM LEFT WITH A FADING BLUR BACKDROP.
- RESPECT `prefers-reduced-motion`: DISABLE THE SLIDESHOW AUTO-ADVANCE AND REVEAL TRANSFORMS WHEN REQUESTED.

## RESPONSIVE BEHAVIOR

- **DESKTOP (≥1024PX):** SPLIT HERO, 4-COL PRODUCT GRID, 5 CATEGORY MEDALLIONS IN A ROW, FLOATING FOCUS CARD VISIBLE.
- **TABLET (640–1023PX):** HERO STACKS (COPY OVER IMAGE), 2-COL PRODUCTS, 3-COL CATEGORIES, FOCUS CARD HIDDEN, HOMME CARDS WRAP.
- **MOBILE (<640PX):** SINGLE COLUMN THROUGHOUT, HAMBURGER DRAWER NAV, 2-COL PRODUCTS, 2-COL CATEGORIES, COMFORTABLE TAP TARGETS, REDUCED HERO HEIGHT (~70VH) WITH IMAGE BELOW COPY.

## TECH & ASSET NOTES

- PLAIN, DEPENDENCY-LIGHT BUILD: SEMANTIC HTML, ONE HAND-WRITTEN CSS FILE (CUSTOM PROPERTIES FOR THE PALETTE, NO TAILWIND CDN), AND ONE VANILLA JS FILE FOR SLIDESHOW, REVEALS, MARQUEE PAUSE, DRAWER, AND QUICK-ADD.
- ALL ASSETS VENDORED LOCALLY: SELF-HOST FONTS AS WOFF2 WITH `@font-face`, AND DOWNLOAD ALL JEWELRY/ATELIER PHOTOGRAPHY INTO A LOCAL `assets/` FOLDER REFERENCED BY RELATIVE PATHS — NO HOTLINKED CDN IMAGES. THE PROJECT MUST RUN FULLY OFFLINE.
- POLISHED, NON-GENERIC, EDITORIAL LUXURY EXECUTION: PRECISE SPACING RHYTHM, CONFIDENT TYPE SCALE, AND METAL-ON-DARK CONTRAST THAT READS AS A REAL HIGH-JEWELRY HOUSE.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/noctis-aurum-h69).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
