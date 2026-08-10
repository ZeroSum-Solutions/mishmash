---
name: riso-rebel-fest-h20
description: |
  A multi-section landing page for "Riso Rebel Fest", a fictional unconventional design conference. The "Floating-Pill Neo-Brutalism" aesthetic uses a warm off-white canvas with a matted-frame outer padding, content grouped into bold oversized rounded cards in saturated risograph color blocks, a chunky display serif paired with a clean grotesque, and floating pill chrome (nav, chips, buttons) sitting on the page like stickers. Sections include a sticky three-pill floating header, a type-as-hero headline ("DESIGN / FUTURE / CHAOS"), a bento feature-card grid with animated geometric motifs, a four-up speaker lineup, an agenda card, a three-tier tickets section, a dashed-border newsletter card, and footer — all built with vanilla HTML, CSS, and JS.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "riso rebel fest"
  - "riso"
  - "rebel"
  - "fest"
  - "design"
  - "conference"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/riso-rebel-fest-h20"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Riso Rebel Fest — Design Conference Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Riso Rebel Fest — Design Conference Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A multi-section landing page for "Riso Rebel Fest", a fictional unconventional design conference. The "Floating-Pill Neo-Brutalism" aesthetic uses a warm off-white canvas with a matted-frame outer padding, content grouped into bold oversized rounded cards in saturated risograph color blocks, a chunky display serif paired with a clean grotesque, and floating pill chrome (nav, chips, buttons) sitting on the page like stickers. Sections include a sticky three-pill floating header, a type-as-hero headline ("DESIGN / FUTURE / CHAOS"), a bento feature-card grid with animated geometric motifs, a four-up speaker lineup, an agenda card, a three-tier tickets section, a dashed-border newsletter card, and footer — all built with vanilla HTML, CSS, and JS.

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
<artifact identifier="riso-rebel-fest-h20" type="text/html" title="Riso Rebel Fest — Design Conference Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# RISO REBEL FEST — A NEO-BRUTALIST CONFERENCE LANDING PAGE

## AESTHETIC IDENTITY

BUILD A FULL, MULTI-SECTION LANDING PAGE FOR A FICTIONAL UNCONVENTIONAL DESIGN CONFERENCE CALLED **"RISO REBEL FEST"** (TAGLINE: "THE UNCONVENTIONAL CONFERENCE FOR DIGITAL REBELS & MAKERS"). THE NAMED AESTHETIC IS **"FLOATING-PILL NEO-BRUTALISM"**: A WARM OFF-WHITE CANVAS WITH A FULL-BLEED OUTER PADDING (LIKE A MATTED FRAME), CONTENT GROUPED INTO BOLD, OVERSIZED ROUNDED CARDS IN SATURATED RISOGRAPH-INSPIRED COLOR BLOCKS, A CHUNKY DISPLAY SERIF FOR HEADLINES PAIRED WITH A CLEAN GROTESQUE FOR BODY, AND FLOATING "PILL" CHROME (NAV, CHIPS, BUTTONS) THAT SITS ON TOP OF THE PAGE LIKE STICKERS. THE MOOD IS PLAYFUL, LOUD, CONFIDENT, ZINE-LIKE, AND ENERGETIC — NOT CORPORATE.

## COLOR PALETTE (EXACT)

- NEUTRAL BACKGROUND (PAGE CANVAS): `#F2F2F0`
- SURFACE / CARD WHITE: `#FFFFFF`
- INK / BRAND PRIMARY (TEXT + BLACK CARDS): `#0A0A0A`
- TEXT SECONDARY: `#4B5563`
- TEXT MUTED: `#9CA3AF`
- RISO GREEN: `#00C65E`
- RISO PURPLE / INDIGO: `#5C5FEF`
- RISO ORANGE (PRIMARY ACCENT): `#FF5C00`
- BORDERS: SUBTLE `rgba(0,0,0,0.08)` HAIRLINES ON LIGHT CARDS, `rgba(255,255,255,0.4)` ON COLOR CARDS.

THE ORANGE IS THE SIGNATURE ACCENT — USE IT FOR THE EYEBROW LABELS, ONE HERO WORD, KEY HOVER STATES, AND ONE TICKET TIER.

## TYPOGRAPHY

- DISPLAY / HEADLINES: A HEAVY, ROUNDED-INKED DISPLAY SERIF WITH A RETRO POSTER FEEL (E.G. "SHRIKHAND" OR A SIMILAR CHUNKY DISPLAY FACE). USE IT UPPERCASE FOR ALL BIG HEADLINES, WITH TIGHT LEADING (≈0.85) AND SLIGHT NEGATIVE TRACKING ON THE HERO.
- BODY / UI: A CLEAN GEOMETRIC-HUMANIST GROTESQUE (E.G. "DM SANS"), WEIGHTS 400 / 500 / 700. USE 700 FOR BUTTONS AND EYEBROWS, 400–500 FOR PARAGRAPHS.
- EYEBROW LABELS: SMALL, BOLD, UPPERCASE, WIDE LETTER-SPACING (≈0.2EM), OFTEN IN ORANGE.
- VENDOR BOTH FONTS LOCALLY (SELF-HOSTED WOFF2); DO NOT HOTLINK GOOGLE FONTS.

## LAYOUT & SECTION BREAKDOWN

THE WHOLE PAGE LIVES INSIDE A GENEROUS OUTER PADDING (≈1REM MOBILE, 2REM DESKTOP) SO THE OFF-WHITE CANVAS FRAMES EVERYTHING.

1. **FLOATING HEADER (STICKY).** THREE SEPARATE FLOATING WHITE PILLS THAT SIT NEAR THE TOP AND STAY STICKY: (A) A LOGO PILL — A SMALL TILTED BLACK ROUNDED SQUARE MONOGRAM ("RR") PLUS THE WORDMARK "RISO REBEL" WITH A TINY UPPERCASE "FEST 2025" SUBLINE; (B) A CENTER NAV PILL WITH LINKS (ABOUT, SPEAKERS, SCHEDULE, TICKETS) SEPARATED BY TINY DOT DIVIDERS; (C) A RIGHT PILL WITH A CITY/DATE CHIP ("BERLIN · NOV 21–23") AND A BLACK "GET TICKETS" BUTTON. ON MOBILE, COLLAPSE THE NAV INTO A HAMBURGER THAT TOGGLES A FLOATING DROPDOWN PILL.

2. **HERO.** A HUGE UPPERCASE THREE-WORD HEADLINE — **"DESIGN / FUTURE / CHAOS"** — STACKED ON MOBILE, INLINE ON DESKTOP, WITH ONE WORD ("CHAOS") IN ORANGE. TO THE RIGHT, A SHORT RIGHT-ALIGNED SUPPORTING PARAGRAPH ("THE UNCONVENTIONAL CONFERENCE FOR DIGITAL REBELS & MAKERS") WITH AN ORANGE BOLD KICKER ("SOLD OUT 3 YEARS RUNNING."). NO HERO IMAGE — TYPE IS THE HERO.

3. **FEATURE CARD GRID ("ABOUT").** A BENTO-STYLE GRID OF FOUR OVERSIZED ROUNDED CARDS (BORDER-RADIUS ≈32PX), EACH A SOLID RISO COLOR BLOCK WITH A SUBTLE ANIMATED GEOMETRIC MOTIF IN THE BACKGROUND: (A) GREEN "HANDS-ON WORKSHOPS" CARD WITH A GRID-OF-DOTS MOTIF; (B) PURPLE "INSANE NETWORKING" CARD WITH CONCENTRIC SPINNING ELLIPSES; (C) ORANGE "CAREER FAIR" CARD WITH OVERLAPPING CIRCLES; (D) BLACK "EARLY BIRD ENDS SOON" CARD WITH A TILTED WHITE "GRAB TICKET" BUTTON IN THE CORNER. THE TWO TALL CARDS SPAN FULL HEIGHT; THE ORANGE + BLACK CARDS STACK IN THE THIRD COLUMN. EACH HAS A WHITE PILL CTA AND SCALES SLIGHTLY ON HOVER.

4. **SPEAKERS ("THE LINEUP").** AN EYEBROW ("WHO'S COMING") + GIANT HEADLINE ("THE LINEUP") AND A "VIEW ALL 50+ SPEAKERS" UNDERLINE LINK. BELOW, A FOUR-UP GRID OF SPEAKER CARDS: A TALL 4:5 PORTRAIT (GRAYSCALE BY DEFAULT, COLOR + SLIGHT ZOOM ON HOVER, WITH A ROLE LABEL SLIDING UP FROM A BOTTOM GRADIENT), THE SPEAKER'S NAME IN THE DISPLAY SERIF, AND THEIR COMPANY. THE FOURTH CARD IS A "CALL FOR PAPERS / YOU?" ORANGE CARD INVITING APPLICATIONS.

5. **SCHEDULE ("AGENDA").** A WHITE ROUNDED CARD WITH A SOFT GREEN CORNER GLOW. LEFT COLUMN: HEADLINE "AGENDA", A SHORT BLURB, AND A "DOWNLOAD FULL PDF" BUTTON. RIGHT COLUMN: THREE DAY ROWS (DAY 01 / 02 / 03), EACH WITH A COLORED DAY LABEL (GREEN, PURPLE, ORANGE), A DATE CHIP, AND A SESSION DESCRIPTION, SEPARATED BY HAIRLINES.

6. **TICKETS ("GET A TICKET").** A CENTERED HEADLINE + SUBLINE, THEN THREE PRICING CARDS: STUDENT ($199, WHITE), PROFESSIONAL ($499, BLACK, RAISED & SHADOWED, "POPULAR" CORNER RIBBON IN GREEN), AND VIP ($999, WHITE WITH PURPLE ACCENTS). EACH HAS A TIER LABEL, A BIG SERIF PRICE, A BULLETED FEATURE LIST WITH COLORED DOTS, AND A FULL-WIDTH PILL "SELECT" BUTTON WITH AN INVERTING HOVER.

7. **NEWSLETTER.** A WHITE CARD WITH A DASHED BLACK BORDER (ZINE/CUT-OUT FEEL), A HEADLINE ("DON'T MISS THE UPDATES"), A SUBLINE, AND AN INLINE EMAIL INPUT + BLACK SUBSCRIBE BUTTON (HOVER TO ORANGE). SOFT MULTIPLY-BLEND COLORED BLOBS IN TWO CORNERS FOR DECORATION.

8. **FOOTER.** WORDMARK + DESCRIPTION, A LINKS COLUMN, AND A SOCIALS ROW OF SMALL ROUND PILL ICONS; A THIN TOP HAIRLINE AND A COPYRIGHT LINE.

## MOTION / ANIMATION / INTERACTION SPEC

- **SCROLL REVEAL:** EACH MAJOR BLOCK FADES IN + RISES (OPACITY 0→1, TRANSLATEY 20PX→0, ≈0.6S EASE-OUT) VIA AN INTERSECTIONOBSERVER, UNOBSERVING AFTER REVEAL. STAGGER SIBLINGS SLIGHTLY.
- **CARD MOTIFS:** GREEN CARD DOTS GENTLY PULSE; PURPLE CARD ELLIPSES SPIN AT DIFFERENT SPEEDS/DIRECTIONS (10S / 15S REVERSE / 20S, LINEAR INFINITE); ORANGE CARD CIRCLES DRIFT.
- **HOVER:** COLOR CARDS SCALE TO ≈1.01; SPEAKER PORTRAITS ZOOM TO 1.1 AND GO FROM GRAYSCALE TO COLOR WITH A ROLE LABEL REVEAL; BUTTONS INVERT FG/BG; NAV LINKS DARKEN.
- **STICKY HEADER:** STAYS PINNED; PILLS CAST SOFT SHADOWS. OPTIONAL: SUBTLE SHADOW INTENSIFIES AFTER SCROLLING PAST THE HERO.
- **HERO ACCENT:** THE ORANGE WORD CAN HAVE A SUBTLE UNDERLINE-WIPE OR COLOR-SHIFT ON LOAD.
- RESPECT `prefers-reduced-motion`: DISABLE SPINS/PULSES AND SHOW CONTENT IMMEDIATELY.

## RESPONSIVE BEHAVIOR

- **MOBILE (<768PX):** SINGLE COLUMN; HEADLINES SET IN VIEWPORT UNITS (≈10VW) AND STACK WORD-PER-LINE; HEADER PILLS STACK AND THE NAV COLLAPSES TO A HAMBURGER DROPDOWN; CARD GRIDS BECOME ONE COLUMN; TICKETS STACK WITH THE PRO CARD NO LONGER RAISED.
- **TABLET (768–1024PX):** TWO-COLUMN CARD AND SPEAKER GRIDS.
- **DESKTOP (>1024PX):** THREE-COLUMN BENTO FEATURE GRID, FOUR-UP SPEAKERS, INLINE HERO HEADLINE, RIGHT-ALIGNED HERO PARAGRAPH, RAISED PRO TICKET.

## TECH / QUALITY NOTES

- PURE HTML + CSS + VANILLA JS (NO BUILD STEP REQUIRED); OR A SIMPLE STATIC SETUP. NO HEAVY FRAMEWORKS.
- VENDOR ALL ASSETS LOCALLY: FONTS (WOFF2) AND SPEAKER PORTRAIT IMAGES. NO REMOTE CDN/HOTLINKS.
- CUSTOM ROUNDED SCROLLBAR, ACCESSIBLE FOCUS STATES, SEMANTIC LANDMARKS (HEADER / MAIN / SECTION / FOOTER), AND ALT TEXT ON IMAGES.
- DISTINCTIVE, POLISHED, NON-GENERIC: THE PAGE SHOULD FEEL LIKE A PRINTED RISOGRAPH ZINE BROUGHT TO THE WEB.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/riso-rebel-fest-h20).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
