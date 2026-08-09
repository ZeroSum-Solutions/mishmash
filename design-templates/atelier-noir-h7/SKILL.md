---
name: atelier-noir-h7
description: |
  A quiet, editorial, haute-couture multi-section landing page for a fictional Parisian fashion house named Maison Éclisse, built in the "Atelier Noir" aesthetic — a restrained lookbook on warm bone paper (`#F4F1EA`) where ink type, generous negative space, and hard-edged architecture replace gradients and drop shadows. It reads like a printed campaign monograph that happens to scroll: section numbers, corner index markers, running uppercase metadata in the margins, a slowly rotating circular text badge in the hero, alternating collection diptychs, a staggered product grid, a journal, and a soot-dark footer.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "atelier noir"
  - "atelier"
  - "noir"
  - "luxury"
  - "fashion"
  - "house"
  - "landing"
  - "maison"
  - "clisse"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/atelier-noir-h7"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Atelier Noir — Luxury Fashion House Landing Page for Maison Éclisse as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Atelier Noir — Luxury Fashion House Landing Page for Maison Éclisse

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A quiet, editorial, haute-couture multi-section landing page for a fictional Parisian fashion house named Maison Éclisse, built in the "Atelier Noir" aesthetic — a restrained lookbook on warm bone paper (`#F4F1EA`) where ink type, generous negative space, and hard-edged architecture replace gradients and drop shadows. It reads like a printed campaign monograph that happens to scroll: section numbers, corner index markers, running uppercase metadata in the margins, a slowly rotating circular text badge in the hero, alternating collection diptychs, a staggered product grid, a journal, and a soot-dark footer.

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
<artifact identifier="atelier-noir-h7" type="text/html" title="Atelier Noir — Luxury Fashion House Landing Page for Maison Éclisse">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# ATELIER NOIR — LUXURY FASHION HOUSE LANDING PAGE

BUILD A FULL, MULTI-SECTION LANDING PAGE FOR A FICTIONAL PARISIAN FASHION HOUSE NAMED **MAISON ÉCLISSE**. THE NAMED AESTHETIC IDENTITY IS **"ATELIER NOIR"** — A QUIET, EDITORIAL, HAUTE-COUTURE LOOKBOOK BUILT ON RESTRAINT, NEGATIVE SPACE, AND THE INTERPLAY OF INK ON BONE. THE MOOD IS HUSHED, EXPENSIVE, AND CONFIDENT — LESS A STOREFRONT, MORE A PRINTED CAMPAIGN BOOK THAT HAPPENS TO SCROLL.

## DESIGN LANGUAGE & MOOD

- A STUDY IN REDUCTION: GENEROUS WHITESPACE, FULL-BLEED IMAGERY, AND TYPOGRAPHY AS THE PRIMARY ORNAMENT. NO GRADIENTS, NO DROP SHADOWS EXCEPT THE FAINTEST TEXT SHADOW OVER PHOTOGRAPHY. NO ROUNDED CORNERS — EVERYTHING IS HARD-EDGED AND ARCHITECTURAL.
- THE PAGE READS LIKE A FASHION MONOGRAPH: SECTION NUMBERS, INDEX MARKERS IN CORNERS, RUNNING UPPERCASE METADATA (CITY, YEAR, COLLECTION) IN THE MARGINS.
- A SINGLE WARM-NEUTRAL CANVAS (BONE), TRUE INK FOR TYPE, AND A MUTED SEPIA/TAUPE FOR SECONDARY TEXT. ONE WHISPER OF WARMTH ONLY.

## EXACT COLOR PALETTE

- BONE / PAPER BACKGROUND: `#F4F1EA`
- SURFACE (SLIGHTLY DEEPER PANEL): `#EBE6DB`
- INK (PRIMARY TEXT, NEAR-BLACK): `#16130F`
- SOOT (FOOTER / DARK SECTIONS): `#100E0B`
- SEPIA (SECONDARY TEXT, MUTED): `#7A7060`
- LINE / HAIRLINE BORDERS: `#CFC7B6`
- ACCENT (RARE, A BURNT TERRACOTTA USED ONLY FOR THE TINY ACTIVE DOT / INDEX HIGHLIGHT): `#A6492B`
- TEXT ON DARK: `#EDE7DA`

## TYPOGRAPHY

- DISPLAY / HEADINGS: A HIGH-CONTRAST SERIF — **CORMORANT GARAMOND** (WEIGHTS 300, 400, 500, 600) WITH SOME HEADINGS IN ITALIC FOR EMPHASIS WORDS. LARGE SIZES, WIDE LETTER-SPACING ON DISPLAY CAPS, TIGHT LEADING.
- UI / BODY / LABELS: A NEUTRAL GROTESQUE — **JETBRAINS MONO** IS NOT USED; INSTEAD USE **ARCHIVO** OR A CLEAN SANS (300/400/500) FOR BODY, AND ALL SMALL LABELS ARE UPPERCASE WITH `0.25EM`–`0.3EM` TRACKING AT 10–12PX.
- THE CONTRAST BETWEEN THE ELEGANT SERIF AND THE TECHNICAL UPPERCASE SANS LABELS IS THE SIGNATURE TYPOGRAPHIC TENSION.

## FULL LAYOUT & SECTION BREAKDOWN

1. **FIXED HEADER** — TRANSPARENT OVER THE HERO, BONE WITH A HAIRLINE BORDER ONCE SCROLLED. LEFT: A HAMBURGER (TWO SHORT RULES) + "MENU" LABEL. CENTER: WORDMARK "MAISON ÉCLISSE" IN SPACED SERIF CAPS. RIGHT: "SEARCH" AND "CART (0)" LABELS. ON SCROLL THE HEADER GAINS A SOLID BONE BACKGROUND AND HAIRLINE.

2. **HERO** — FULL VIEWPORT. FULL-BLEED EDITORIAL PORTRAIT PHOTOGRAPH WITH A SUBTLE DARK SCRIM. CENTERED: A TINY UPPERCASE KICKER ("FALL–WINTER MMXXV"), A MASSIVE SERIF TITLE ("ÉCLISSE" OR A ONE-WORD COLLECTION NAME, E.G. "PÉNOMBRE"), AND A THIN-BORDERED "VIEW THE LOOKBOOK" GHOST BUTTON THAT INVERTS ON HOVER. BOTTOM-LEFT CORNER: "PARIS · EST. MMXIV" METADATA. BOTTOM-RIGHT CORNER: A SLOWLY ROTATING CIRCULAR TEXT BADGE ("NEW SEASON · 2025 ·") WITH A SMALL CENTER GLYPH AND A FAINT GLASS DISC.

3. **MANIFESTO / INTRO** — CENTERED ON BONE. A LARGE SERIF PULL-QUOTE WITH ONE ITALIC WORD ("FORM IS THE *SILENCE* BETWEEN GESTURES.") AND A SMALL "SCROLL TO EXPLORE" LABEL BENEATH.

4. **COLLECTION (ALTERNATING DIPTYCHS)** — TWO FULL-WIDTH ROWS, EACH A 50/50 SPLIT OF A TALL IMAGE AND A TEXT PANEL ON SURFACE COLOR. ROW 1 IMAGE-LEFT, ROW 2 IMAGE-RIGHT (ORDER FLIPS). EACH PANEL: A NUMBERED LABEL ("01 — THE COAT"), A SERIF TITLE, A SHORT BODY PARAGRAPH, AND AN UNDERLINED "DISCOVER" LINK. IMAGES SCALE GENTLY ON HOVER WITHIN AN OVERFLOW-HIDDEN FRAME.

5. **SELECTED PIECES (STAGGERED PRODUCT GRID)** — A HEADER ROW ("SELECTED PIECES" + "VIEW ALL"). A RESPONSIVE GRID (1 / 2 / 3 COLUMNS) OF PRODUCT CARDS, EACH A 3:4 IMAGE THAT SCALES ON HOVER, WITH AN UPPERCASE NAME AND PRICE ON A BASELINE-ALIGNED ROW. EVEN COLUMNS ON DESKTOP ARE OFFSET DOWNWARD (STAGGERED) FOR EDITORIAL RHYTHM. A CENTERED "SHOP ALL" GHOST BUTTON BELOW.

6. **FULL-BLEED EDITORIAL STATEMENT** — A 70–80VH IMAGE BANNER WITH A CENTERED LIGHT SERIF STATEMENT IN CAPS ("FORM FOLLOWS FEELING").

7. **THE JOURNAL** — TWO STAGGERED ARTICLE CARDS (4:3 IMAGES) ON SURFACE, EACH WITH A CATEGORY LABEL, SERIF HEADLINE THAT TURNS ITALIC ON HOVER, A SHORT DEK, AND A "READ STORY" UNDERLINE.

8. **NEWSLETTER ("JOIN THE ATELIER")** — CENTERED, NARROW. SERIF HEADING, A SHORT LINE OF SEPIA COPY, AND A BORDER-BOTTOM-ONLY EMAIL INPUT WITH AN UPPERCASE "SUBSCRIBE" BUTTON.

9. **FOOTER** — SOOT-DARK. LARGE WORDMARK + ABOUT PARAGRAPH ON THE LEFT (SPANNING TWO COLUMNS), NAVIGATION AND SOCIAL COLUMNS ON THE RIGHT, A HAIRLINE DIVIDER, AND A BOTTOM ROW WITH COPYRIGHT AND "PRIVACY & TERMS".

## MOTION / ANIMATION / INTERACTION SPEC

- **SCROLL REVEAL**: SECTIONS AND CARDS FADE UP (OPACITY 0 → 1, TRANSLATEY 28PX → 0) VIA INTERSECTIONOBSERVER WITH A SOFT CUBIC-BEZIER `(0.16, 1, 0.3, 1)` OVER ~0.8S, STAGGERED PER ITEM.
- **HEADER**: BACKGROUND + HAIRLINE FADE IN AFTER ~40PX OF SCROLL.
- **HERO BADGE**: CONTINUOUS 14S LINEAR ROTATION OF THE CIRCULAR TEXT; CENTER GLYPH STATIC; BADGE SCALES UP SLIGHTLY ON HOVER.
- **IMAGE HOVER**: 1.2S EASE TRANSFORM SCALE TO 1.06 WITHIN CLIPPED FRAMES.
- **MENU OVERLAY**: A FULL-SCREEN BONE PANEL SLIDES IN FROM THE LEFT WITH LARGE SERIF LINKS THAT GO ITALIC ON HOVER; CLOSE WITH AN X THAT ROTATES 90°.
- **SEARCH OVERLAY**: A FULL-SCREEN PANEL FADING/RISING IN WITH A LARGE CENTERED UNDERLINE INPUT AND "TRENDING" CHIPS.
- **CUSTOM CURSOR (OPTIONAL, DESKTOP)**: A SMALL RING THAT GROWS OVER INTERACTIVE ELEMENTS — KEEP IT SUBTLE OR OMIT IF IT HARMS CLARITY.
- ALL MOTION RESPECTS `PREFERS-REDUCED-MOTION`.

## RESPONSIVE BEHAVIOR

- DESKTOP (≥1024PX): DIPTYCHS ARE TRUE 50/50; PRODUCT GRID IS 3 COLUMNS WITH STAGGERED EVEN COLUMNS; CORNER METADATA AND ROTATING BADGE VISIBLE.
- TABLET (≥768PX): DIPTYCHS REMAIN SPLIT; GRID 2 COLUMNS; SOME EXTRA PRODUCTS HIDDEN.
- MOBILE (<768PX): EVERYTHING STACKS SINGLE-COLUMN; IMAGE THEN TEXT; HEADER SIMPLIFIES; HERO TITLE SCALES DOWN; CORNER METADATA HIDES; HAMBURGER OPENS THE FULL-SCREEN MENU.

## TECHNICAL NOTES

- SINGLE SELF-CONTAINED STATIC SITE (`INDEX.HTML` + `STYLES.CSS` + `MAIN.JS`). NO BUILD STEP REQUIRED; VANILLA HTML/CSS/JS.
- ALL ASSETS VENDORED LOCALLY: FONTS SELF-HOSTED OR LOADED VIA GOOGLE FONTS, AND ALL EDITORIAL PHOTOGRAPHY DOWNLOADED INTO A LOCAL `ASSETS/` FOLDER AND REFERENCED BY RELATIVE PATH. THE PROJECT MUST RUN FULLY OFFLINE.
- ACCESSIBLE: SEMANTIC LANDMARKS, ALT TEXT, FOCUS-VISIBLE STATES, KEYBOARD-OPERABLE OVERLAYS.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/atelier-noir-h7).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
