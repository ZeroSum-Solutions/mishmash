---
name: cobalt-repairworks-h78
description: |
  A single-page, forced-light landing page for **Repairworks**, a fictional neighborhood electronics repair studio, built in a "Workbench Editorial" aesthetic — a warm paper-cream canvas (`RGB(242, 241, 237)`), a single confident cobalt-blue accent (`RGB(22, 103, 217)`), generous whitespace, and a calm, reliable, trade-confident mood. The signature structural device is a 3.5px solid cobalt square glyph used consistently as the logo mark, eyebrow bullet, and metadata tick. Type pairs Host Grotesk (tight neo-grotesque, huge hero) with IBM Plex Mono for uppercase labels and spec ticks. Sections include a sticky blurred header, a hero with a "what we fix" device-card grid, a trusted-brands marquee, a two-up services grid with mono spec ticks and pricing, a six-block benefits grid, an about split, alternating testimonial cards, a two-column FAQ, and a final CTA panel.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "cobalt repairworks"
  - "cobalt"
  - "repairworks"
  - "electronics"
  - "repair"
  - "studio"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/cobalt-repairworks-h78"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Cobalt Repairworks — Electronics Repair Studio Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Cobalt Repairworks — Electronics Repair Studio Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A single-page, forced-light landing page for **Repairworks**, a fictional neighborhood electronics repair studio, built in a "Workbench Editorial" aesthetic — a warm paper-cream canvas (`RGB(242, 241, 237)`), a single confident cobalt-blue accent (`RGB(22, 103, 217)`), generous whitespace, and a calm, reliable, trade-confident mood. The signature structural device is a 3.5px solid cobalt square glyph used consistently as the logo mark, eyebrow bullet, and metadata tick. Type pairs Host Grotesk (tight neo-grotesque, huge hero) with IBM Plex Mono for uppercase labels and spec ticks. Sections include a sticky blurred header, a hero with a "what we fix" device-card grid, a trusted-brands marquee, a two-up services grid with mono spec ticks and pricing, a six-block benefits grid, an about split, alternating testimonial cards, a two-column FAQ, and a final CTA panel.

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
<artifact identifier="cobalt-repairworks-h78" type="text/html" title="Cobalt Repairworks — Electronics Repair Studio Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# COBALT REPAIRWORKS — PRECISION ELECTRONICS REPAIR LANDING PAGE

## OVERVIEW

BUILD A SINGLE-PAGE, FORCED-LIGHT MARKETING LANDING PAGE FOR A FICTIONAL NEIGHBORHOOD ELECTRONICS REPAIR STUDIO CALLED **REPAIRWORKS**, A WALK-IN BENCH THAT FIXES PHONES, TABLETS, LAPTOPS AND CONSOLES. THE NAMED AESTHETIC IS **"WORKBENCH EDITORIAL"**: A WARM PAPER-CREAM CANVAS, A SINGLE CONFIDENT COBALT-BLUE ACCENT, A LARGE TIGHT GROTESQUE DISPLAY TYPEFACE PAIRED WITH A SMALL UPPERCASE MONOSPACE FOR LABELS, GENEROUS WHITESPACE, AND HARD-EDGED SMALL SQUARE GLYPHS USED AS BULLET / LOGO MARKS. THE MOOD IS CALM, RELIABLE, PRECISE AND TRADE-CONFIDENT — A TIDY REPAIR BENCH UNDER GOOD LIGHT, NOT A FLASHY TECH STARTUP. EVERY SECTION SHOULD READ LIKE A WELL-SET TRADE BROCHURE: HONEST, LEGIBLE, QUIETLY PREMIUM.

## DESIGN LANGUAGE & MOOD

- WARM, OPTIMISTIC, GROUNDED. PLENTY OF AIR. NOTHING DECORATIVE FOR ITS OWN SAKE.
- THE SIGNATURE STRUCTURAL DEVICE IS THE **3.5PX SOLID COBALT SQUARE GLYPH** (A TINY FILLED SQUARE, BORDER-RADIUS ~4PX) USED CONSISTENTLY AS THE LOGO MARK, EYEBROW BULLET, AND METADATA TICK. INK-BLACK SQUARES MARK SPEC ROWS.
- ROUNDED-BUT-RESTRAINED CORNERS: 4PX (SHARP), 8PX (CARDS / IMAGES), AND FULLY-PILL (BUTTONS, 100PX).
- A SUBTLE PAPER GRAIN AND A FAINT WARM VIGNETTE MAY SIT OVER THE CANVAS. CARDS ARE PURE WHITE LIFTED ON A SOFT, LOW-CONTRAST SHADOW.

## COLOR PALETTE (EXACT)

- BRAND / COBALT PRIMARY: `RGB(22, 103, 217)` — THE ONLY SATURATED COLOR; USED FOR ACCENT GLYPHS, PRIMARY BUTTONS, EYEBROW LABELS, LINKS.
- CANVAS / PAPER BACKGROUND: `RGB(242, 241, 237)` — WARM OFF-WHITE CREAM.
- INK / TEXT PRIMARY: `RGB(20, 20, 20)` — NEAR-BLACK.
- TEXT SECONDARY: `RGBA(20, 20, 20, 0.6)`.
- SURFACE WHITE (CARDS): `RGB(255, 255, 255)`.
- HAIRLINE BORDER: `RGBA(139, 139, 136, 0.18)`.
- FAINT TINT FILL (BANDS / MARQUEE BG): `RGBA(20, 20, 20, 0.02)`.

## TYPOGRAPHY

- DISPLAY / BODY: **HOST GROTESK** (WEIGHTS 300, 400, 500, 600, 700) — A TIGHT NEO-GROTESQUE. HEADINGS USE 600 WITH NEGATIVE TRACKING (-0.03EM) AND LEADING ~1.08.
- LABELS / METADATA: **IBM PLEX MONO** (400, 500) — SMALL, UPPERCASE, SLIGHTLY TIGHT TRACKING, USED FOR EYEBROWS, SPEC TICKS, FOOTER COLUMN HEADS, AND COPYRIGHT.
- HERO H1 IS HUGE: ~6XL ON MOBILE SCALING TO ~8XL ON DESKTOP. SECTION H2S ARE 5–6XL. BODY IS 16–20PX.
- SELF-HOST BOTH FONT FAMILIES LOCALLY (NO REMOTE FONT CDN); STORE WOFF2 IN `assets/fonts` AND DEFINE `@font-face`.

## LAYOUT & SECTION BREAKDOWN (TOP TO BOTTOM)

1. **STICKY HEADER** — TRANSLUCENT BLURRED CREAM BAR (`backdrop-filter: blur(10px)`), HAIRLINE BOTTOM BORDER, 70PX TALL, MAX-WIDTH ~1600PX. LEFT: COBALT SQUARE GLYPH + WORDMARK "REPAIRWORKS" (SEMIBOLD, TIGHT). CENTER (DESKTOP ONLY): NAV LINKS — SERVICES, DEVICES, ABOUT, JOURNAL. RIGHT: A PHONE NUMBER WITH A SMALL PHONE ICON (HIDDEN ON SMALL SCREENS) + A PILL PRIMARY "BOOK A REPAIR" BUTTON.

2. **HERO** — TOP-PADDED (~160PX). LEFT-ALIGNED TEXT BLOCK INSIDE A ~1312PX CONTAINER: AN EYEBROW (COBALT GLYPH + MONO "BASED IN PORTLAND · WALK-INS WELCOME"), A MASSIVE H1 ("FIXED RIGHT. / FIXED FAST."-STYLE, MAX-WIDTH ~720PX), A SECONDARY PARAGRAPH (~560PX), AND TWO BUTTONS (PRIMARY "BOOK A REPAIR", SECONDARY OUTLINE "GET A QUOTE"). BELOW, AFTER A LARGE GAP, A **"WHAT WE FIX"** SUB-BLOCK: A ROW WITH A SMALL HEADING + A TEXT-LINK "VIEW ALL →", THEN A 3-COLUMN GRID OF TALL (3/4 ASPECT) IMAGE CARDS (SMARTPHONES, TABLETS, LAPTOPS) THAT SUBTLY ZOOM (SCALE 1.05) ON HOVER, EACH WITH A TITLE + ONE-LINE DESCRIPTION UNDER IT.

3. **TRUSTED BRANDS MARQUEE** — CENTERED "TRUSTED ACROSS EVERY MAJOR BRAND" LABEL, THEN A FULL-WIDTH HORIZONTAL AUTO-SCROLLING MARQUEE (CSS KEYFRAMES, ~30S LINEAR INFINITE, DUPLICATED TRACK FOR SEAMLESS LOOP) OF BRAND WORDMARKS RENDERED AS LARGE BOLD ITALIC UPPERCASE TEXT AT LOW OPACITY (~0.2) ON A FAINT TINT BAND WITH HAIRLINE TOP/BOTTOM BORDERS. BELOW: A SHORT CENTERED PARAGRAPH + AN "ABOUT THE BENCH →" TEXT-LINK.

4. **SERVICES GRID** — CENTERED 5–6XL H2 ("EXPERT SOLUTIONS FOR EVERY DEVICE"). A 2-COLUMN GRID OF FOUR WHITE SERVICE CARDS (SCREEN & DISPLAY, BATTERY REPLACEMENT, CHARGING & POWER, SOFTWARE & DIAGNOSTICS). EACH CARD: A COBALT SQUARE ICON, TITLE, DESCRIPTION, A ROW OF MONO SPEC TICKS (INK SQUARE + "READY IN 1–2 HOURS", "30-DAY WARRANTY"), AND A FOOTER ROW WITH AN OUTLINE "LEARN MORE" BUTTON ON THE LEFT AND A "FROM $XX" PRICE ON THE RIGHT. A CENTERED PRIMARY "VIEW ALL SERVICES" PILL BELOW THE GRID.

5. **BENEFITS / WHY US** — CENTERED H2 ("WHAT MAKES REPAIRWORKS DIFFERENT"). A 3-COLUMN, 2-ROW GRID OF SIX CENTERED BENEFIT BLOCKS, EACH: COBALT SQUARE ICON, A SMALL COBALT MONO CATEGORY WORD (EXPERTISE / EXPRESS / RELIABLE / TRUSTWORTHY / MULTI-BRAND / PROTECTED), A TITLE, AND A SHORT PARAGRAPH.

6. **IDENTITY / ABOUT SPLIT** — ON A FAINT TINT BAND. TWO COLUMNS: LEFT = EYEBROW ("OUR BENCH"), A 4–5XL STATEMENT HEADLINE, TWO PARAGRAPHS OF BODY, AND PRIMARY+SECONDARY BUTTONS. RIGHT = A SQUARE/4:5 PHOTO OF A TECHNICIAN AT WORK, ROUNDED 8PX.

7. **TESTIMONIALS** — A ROW WITH A 4–6XL H2 ("WHAT CUSTOMERS SAY") AND A RIGHT-ALIGNED OUTLINE BUTTON (DESKTOP). A 4-COLUMN GRID ALTERNATING TALL IMAGE CARDS AND WHITE QUOTE CARDS (A QUOTE GLYPH, A SHORT BOLD HEADLINE, THE TESTIMONIAL BODY, AND A FOOTER WITH A CIRCULAR AVATAR + NAME).

8. **FAQ** — NARROW (~866PX) CENTERED COLUMN. CENTERED H2 ("ANSWERS TO YOUR QUESTIONS"), THEN A 2-COLUMN GRID OF FOUR Q/A BLOCKS, EACH A QUESTION (MEDIUM WEIGHT) + ANSWER, DIVIDED BY HAIRLINE BOTTOM BORDERS.

9. **FINAL CTA** — A WHITE ROUNDED PANEL WITH 8PX PADDING WRAPPING AN INNER PADDED HEADER (EYEBROW "TAKE ACTION", A 4–6XL HEADLINE "GET YOUR DEVICE FIXED TODAY", A RIGHT-SIDE PARAGRAPH + PRIMARY BUTTON) ABOVE A WIDE (~21:9) FULL-BLEED IMAGE INSIDE THE PANEL.

10. **FOOTER** — FAINT TINT BAND, HAIRLINE TOP BORDER, CENTERED COMPOSITION: WORDMARK + GLYPH, A SHORT TAGLINE, A 3-COLUMN LINK GRID (MENU / COMPANY / FOLLOW) WITH MONO UPPERCASE COLUMN HEADS, AND A BOTTOM ROW WITH A MONO COPYRIGHT, A PRIVACY LINK, A DOT SEPARATOR, AND A "BACK TO TOP" LINK.

## MOTION / ANIMATION / INTERACTION SPEC

- **SCROLL REVEAL**: EVERY MAJOR BLOCK STARTS AT `opacity:0; translateY(30px)` AND EASES TO VISIBLE VIA AN `IntersectionObserver` (THRESHOLD ~0.1, ROOT-MARGIN BOTTOM -50PX), TRANSITION `0.8S cubic-bezier(0.16,1,0.3,1)`, EACH ELEMENT UNOBSERVED AFTER FIRING. STAGGER CARDS IN A GRID BY A SMALL PER-CHILD DELAY.
- **BRAND MARQUEE**: CONTINUOUS LEFTWARD `translateX(0 → -50%)` LOOP, PAUSE ON HOVER.
- **IMAGE CARD HOVER**: INNER IMAGE SCALES TO 1.05 OVER ~700MS; CARD CURSOR POINTER.
- **BUTTONS**: PRIMARY FILLS COBALT, FADES OPACITY ON HOVER; SECONDARY IS OUTLINE THAT INVERTS TO SOLID COBALT ON HOVER; TERTIARY TEXT-LINKS SLIDE THEIR ARROW 4PX RIGHT ON HOVER.
- **HEADER**: SUBTLE SHADOW / OPACITY SHIFT ONCE THE PAGE IS SCROLLED PAST THE HERO.
- RESPECT `prefers-reduced-motion`: DISABLE REVEAL TRANSFORMS AND THE MARQUEE ANIMATION.

## RESPONSIVE BEHAVIOR

- DESKTOP ≥1024PX: FULL MULTI-COLUMN GRIDS (3-UP DEVICE CARDS, 2-UP SERVICES, 3-UP BENEFITS, 4-UP TESTIMONIALS, 2-UP FAQ), CENTER NAV VISIBLE, 64PX CONTAINER PADDING.
- TABLET: COLLAPSE TO 2 COLUMNS WHERE SENSIBLE; REDUCE HERO TYPE SCALE.
- MOBILE <768PX: SINGLE COLUMN THROUGHOUT, HIDE CENTER NAV + PHONE NUMBER (KEEP THE PILL CTA), HERO H1 ~6XL, REDUCE SECTION PADDING, MARQUEE STILL SCROLLS.

## TECHNICAL NOTES

- PLAIN SELF-CONTAINED STATIC SITE (SINGLE `index.html` + LOCAL CSS/JS + LOCAL `assets/`). NO BUILD STEP REQUIRED; MUST RUN OFFLINE FROM `file://` OR A STATIC SERVER.
- VENDOR ALL IMAGES, FONTS, AND ICONS LOCALLY UNDER `assets/`. USE RELATIVE PATHS ONLY — NO HOTLINKED CDNS.
- SEMANTIC, ACCESSIBLE MARKUP: PROPER LANDMARKS, ALT TEXT, FOCUS-VISIBLE STATES, SUFFICIENT CONTRAST.
- THE AESTHETIC IDENTITY IS NAMED **"WORKBENCH EDITORIAL"** AND MUST READ AS DISTINCT, POLISHED, AND DELIBERATELY NON-GENERIC.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/cobalt-repairworks-h78).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
