---
name: lumen-vector-h92
description: |
  A fully responsive, multi-section creative-agency landing page for Lumen Vector, built in the "Electric Brutalism" design language. The mood is loud, confident, and playful — a deep midnight-indigo hero that explodes into a bright-white body drenched in candy-pastel panels, with oversized condensed poster typography (Anton), electric-lime accents, floating glossy pill particles, and crisp micro-interactions. Sections span an absolute header over the dark hero with a glass-pill desktop nav, a full-viewport hero with mixed-color headline words and floating tag pills, a trust marquee, a six-card pastel services grid, a studio/about block, a stacked selected-work gallery, a scroll-linked parallax testimonial row, a blue-panel pricing section, a two-column FAQ accordion, a methodology deck where three cards fan out on scroll into view, and a dark footer. Motion is vanilla JS: IntersectionObserver reveals, floating-pill loops, the marquee, scroll-mapped testimonial parallax, the methodology fan, a scroll-triggered header backdrop, and hover wipe-fills — respecting `prefers-reduced-motion`. Typography pairs Anton (condensed poster display) with Geist (body), both vendored locally.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "lumen vector"
  - "lumen"
  - "vector"
  - "electric"
  - "brutalism"
  - "creative"
  - "agency"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/lumen-vector-h92"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Lumen Vector — Electric Brutalism Creative Agency Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Lumen Vector — Electric Brutalism Creative Agency Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A fully responsive, multi-section creative-agency landing page for Lumen Vector, built in the "Electric Brutalism" design language. The mood is loud, confident, and playful — a deep midnight-indigo hero that explodes into a bright-white body drenched in candy-pastel panels, with oversized condensed poster typography (Anton), electric-lime accents, floating glossy pill particles, and crisp micro-interactions. Sections span an absolute header over the dark hero with a glass-pill desktop nav, a full-viewport hero with mixed-color headline words and floating tag pills, a trust marquee, a six-card pastel services grid, a studio/about block, a stacked selected-work gallery, a scroll-linked parallax testimonial row, a blue-panel pricing section, a two-column FAQ accordion, a methodology deck where three cards fan out on scroll into view, and a dark footer. Motion is vanilla JS: IntersectionObserver reveals, floating-pill loops, the marquee, scroll-mapped testimonial parallax, the methodology fan, a scroll-triggered header backdrop, and hover wipe-fills — respecting `prefers-reduced-motion`. Typography pairs Anton (condensed poster display) with Geist (body), both vendored locally.

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
<artifact identifier="lumen-vector-h92" type="text/html" title="Lumen Vector — Electric Brutalism Creative Agency Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# LUMEN VECTOR — AN "ELECTRIC BRUTALISM" CREATIVE-AGENCY LANDING PAGE

## AESTHETIC IDENTITY

BUILD A FULLY RESPONSIVE, MULTI-SECTION CREATIVE-AGENCY LANDING PAGE NAMED **LUMEN VECTOR** IN A DESIGN LANGUAGE CALLED **"ELECTRIC BRUTALISM."** THE MOOD IS LOUD, CONFIDENT, AND PLAYFUL — A DEEP MIDNIGHT-INDIGO HERO THAT EXPLODES INTO A BRIGHT-WHITE BODY DRENCHED IN CANDY-PASTEL PANELS. THINK OVERSIZED CONDENSED POSTER TYPOGRAPHY, ELECTRIC-LIME ACCENTS, FLOATING GLOSSY "PILL" PARTICLES, AND CRISP MICRO-INTERACTIONS. IT SHOULD FEEL LIKE A DIGITAL GROWTH STUDIO'S MANIFESTO — KINETIC, OPTIMISTIC, AND PREMIUM — NEVER CORPORATE OR GENERIC-AI-SLOP.

## COLOR PALETTE (EXACT)

- BRAND DARK (HERO + FOOTER BACKGROUND): `#070515`
- BRAND LIME (PRIMARY ACCENT / CTA): `#C6FF7C`
- BRAND ORANGE (EYEBROWS / HOVER HIGHLIGHT): `#FF5F2E`
- BRAND BLUE (PASTEL PANEL / HEADLINE WORD): `#B4DBFF`
- BRAND YELLOW (PASTEL PANEL / HEADLINE WORD): `#FDF070`
- BRAND PINK (PASTEL PANEL): `#F6C2F4`
- BRAND PURPLE (PASTEL PANEL): `#C7CAFF`
- CARD CREAM (PASTEL PANEL): `#FDFAE7`
- OFFWHITE SECTION BG: `#F8F8F8`
- TEXT MAIN (NEAR-BLACK INK): `#070515`
- TEXT MUTED: `#6D6C6C`
- WHITE: `#FFFFFF`

## TYPOGRAPHY

- DISPLAY / HEADINGS: A HEAVY CONDENSED POSTER SANS — **ANTON** (SINGLE WEIGHT), ALWAYS UPPERCASE, WITH NEGATIVE LETTER-SPACING (`-0.02EM` TO `-0.04EM`) AND TIGHT LINE-HEIGHT (1.0–1.1). USE FOR THE HERO HEADLINE, SECTION TITLES, CARD TITLES, STATS, AND THE WORDMARK.
- BODY / UI: A CLEAN GEOMETRIC GROTESQUE — **GEIST** (WEIGHTS 400/500/600) FOR PARAGRAPHS, NAV LINKS, BUTTONS, EYEBROWS, AND CARD COPY.
- VENDOR ALL FONTS LOCALLY (WOFF2) VIA `@font-face` WITH RELATIVE PATHS — NO REMOTE FONT CDNS AT RUNTIME.

## LAYOUT & SECTION BREAKDOWN

CONTENT IS CENTERED IN A `MAX-WIDTH: 1360PX` COLUMN WITH ~20PX GUTTERS. PANELS USE ROUNDED CORNERS (12–24PX), BUTTONS ARE FULL PILLS.

1. **HEADER (ABSOLUTE OVER HERO)** — TRANSPARENT BAR OVER THE DARK HERO. LEFT: ANTON WORDMARK `LUMEN VECTOR` IN WHITE. CENTER (DESKTOP): A GLASS PILL (`WHITE/5` BG, BACKDROP BLUR, HAIRLINE BORDER) WITH LINKS — HOME (ACTIVE, LIME), WORK, STUDIO, PROCESS. RIGHT: A LIME PILL CTA "START A PROJECT" THAT SCALES UP ON HOVER. ON SCROLL PAST 50PX THE HEADER GAINS A DARK TRANSLUCENT BACKDROP + BLUR. MOBILE: HAMBURGER TOGGLES A FULLSCREEN DARK OVERLAY MENU WITH GIANT ANTON LINKS THAT SLIDES IN FROM THE RIGHT.

2. **HERO (FULL VIEWPORT, DARK)** — CENTERED COMPOSITION ON `#070515`. ORDER: ORANGE EYEBROW "#1 DIGITAL GROWTH PARTNER"; A GIANT ANTON HEADLINE WRAPPING TO ~3 LINES WITH MIXED COLORED WORDS ("ELEVATING" WHITE, "BRANDS TO" BLUE, "UNPRECEDENTED" WHITE, A WHITE 4-POINT STAR GLYPH, "HEIGHTS" YELLOW); A MUTED-WHITE SUBPARAGRAPH; AND A "GLASS-RINGED" CTA — A LIME PILL "START A PROJECT →" SET INSIDE A DARK CAPSULE WRAPPED IN A SUBTLE WHITE GRADIENT RING. AROUND THE HEADLINE FLOAT THREE GLOSSY ROUNDED "TAG PILLS" (PURPLE "INNOVATION", ORANGE "IMPACT DRIVEN", YELLOW "STRATEGY"), EACH WITH A SOFT COLORED GLOW SHADOW AND A GENTLE INFINITE FLOAT/ROTATE ANIMATION (HIDDEN ON MOBILE). FAINT RADIAL GLOWS AND A SUBTLE GRID/DOT TEXTURE SIT BEHIND.

3. **TRUST MARQUEE (WHITE)** — "TRUSTED BY AMBITIOUS TEAMS WORLDWIDE" LABEL ABOVE A SEAMLESS INFINITE HORIZONTAL MARQUEE OF ~6 ANTON LOGO-WORDS (DUPLICATED FOR SEAMLESS LOOP), MASKED WITH LEFT/RIGHT WHITE FADE GRADIENTS.

4. **SERVICES (WHITE)** — SPLIT HEADER: LEFT = ORANGE EYEBROW "CORE CAPABILITIES" + ANTON TITLE "COMPLETE TOOLKIT FOR DIGITAL SCALE"; RIGHT = SUPPORTING PARAGRAPH. BELOW: A 1/2/3-COLUMN GRID OF SIX TALL PASTEL CARDS (CREAM, PINK, YELLOW, BLUE, PURPLE, LIME) EACH WITH A SMALL ICON BADGE, AN ANTON CARD TITLE THAT TURNS ORANGE ON HOVER, AND BODY COPY. CARDS LIFT (`-TRANSLATE-Y`) ON HOVER. TITLES: GROWTH MARKETING, BRAND IDENTITY, UI/UX DESIGN, WEB DEVELOPMENT, CONTENT STRATEGY, RETENTION & CRM.

5. **STUDIO / ABOUT (OFFWHITE)** — LEFT COLUMN: A SMALL ANTON `LUMEN VECTOR™` MARK PINNED TOP, AND A LARGE STAT `50+ GLOBAL PARTNERS` PINNED BOTTOM. RIGHT COLUMN: A LARGE ANTON STATEMENT WITH AN INLINE TRIANGLE GLYPH AND AN ORANGE PHRASE ("SUSTAINABLE GROWTH"), TWO BODY PARAGRAPHS SIDE-BY-SIDE, AND A LIME PILL "DISCOVER OUR METHOD →" WHOSE BACKGROUND WIPES TO BLUE FROM THE BOTTOM ON HOVER.

6. **SELECTED WORK (WHITE)** — CENTERED EYEBROW + ANTON TITLE "WORK THAT DEFINES CATEGORIES", THEN A VERTICAL STACK OF THREE FULL-WIDTH IMAGE CARDS (TALL, ROUNDED) WITH A DARK SCRIM AND CENTERED WHITE TEXT (CATEGORY LABEL, ANTON PROJECT NAME, ONE-LINE RESULT). IMAGE ZOOMS SLIGHTLY ON HOVER. PROJECTS: AURA COMMERCE, NEXUS FINANCIAL, VITALITY APP.

7. **TESTIMONIALS (WHITE)** — CENTERED EYEBROW + ANTON TITLE + INTRO. BELOW, A HORIZONTAL ROW OF FOUR CARDS (OFFWHITE, ROUNDED) WITH AVATAR, NAME (ANTON), ROLE, AND QUOTE — ALTERNATING CARDS OFFSET DOWNWARD. THE TRACK DRIFTS HORIZONTALLY AS A SCROLL-LINKED PARALLAX, WITH LEFT/RIGHT WHITE FADE OVERLAYS.

8. **PRICING (BLUE PANEL)** — CENTERED EYEBROW "ENGAGEMENT MODELS" + ANTON TITLE "CLEAR VALUE, NO SURPRISES" + INTRO, ON A FULL BRAND-BLUE BACKGROUND. TWO TIERS INSIDE A SINGLE OFFWHITE CONTAINER: FOUNDATION ($2,500/MO) AND ACCELERATOR ($6,800/MO, ELEVATED WHITE CARD WITH AN ORANGE "POPULAR" BADGE). EACH HAS AN ICON CHIP, NAME, PRICE, CHECKLIST, AND PILL CTA (ACCELERATOR'S CTA IS LIME).

9. **FAQ (WHITE)** — TWO COLUMNS: LEFT = STICKY EYEBROW + ANTON "COMMON QUESTIONS"; RIGHT = ACCORDION OF FOUR OFFWHITE ITEMS WITH A CIRCULAR PLUS/MINUS TOGGLE THAT ROTATES; OPENING ONE CLOSES THE OTHERS AND TURNS THE OPEN ITEM WHITE WITH A SHADOW.

10. **METHODOLOGY DECK (WHITE)** — CENTERED EYEBROW "OUR METHODOLOGY" + ANTON "THE DELIVERY OF EXCELLENCE". BELOW, THREE STACKED PASTEL CARDS (PURPLE 01 DATA-INFORMED, BLUE 02 BOLD CREATIVE, PINK 03 AGILE EXECUTION) THAT START COLLAPSED AND, ON SCROLL INTO VIEW, FAN OUT INTO A SPREAD (LEFT CARD ROTATES/TRANSLATES LEFT, RIGHT CARD RIGHT, CENTER CARD LIFTS AND SCALES) VIA A SMOOTH CUBIC-BEZIER TRANSITION.

11. **FOOTER (DARK)** — A LARGE ANTON CTA "READY TO SCALE YOUR BUSINESS?" WITH TWO FLOATING GLOSSY TAG PILLS ("GROWTH" YELLOW, "SCALE" PURPLE), A NEWSLETTER EMAIL INPUT WITH A ROUND ARROW SUBMIT BUTTON, A MULTI-COLUMN LINK GRID (COMPANY, SERVICES, RESOURCES, SOCIALS) WITH THE WORDMARK, AND A HAIRLINE-DIVIDED COPYRIGHT LINE.

## MOTION / ANIMATION / INTERACTION SPEC

- **SCROLL REVEAL:** EVERY MAJOR BLOCK FADES + SLIDES UP (`OPACITY 0→1`, `TRANSLATEY 30PX→0`) VIA `INTERSECTIONOBSERVER`, EASING `CUBIC-BEZIER(0.16, 1, 0.3, 1)` OVER ~0.8S, REVEALED ONCE.
- **FLOATING PILLS:** HERO + FOOTER TAG PILLS LOOP A GENTLE `TRANSLATEY` + SLIGHT `ROTATE` FLOAT (4.5–6S, EASE-IN-OUT, INFINITE).
- **MARQUEE:** LINEAR INFINITE `TRANSLATEX(0→-50%)` OVER ~30S; PAUSE ON HOVER OPTIONAL.
- **TESTIMONIAL PARALLAX:** TRACK `TRANSLATEX` MAPPED TO THE SECTION'S SCROLL PROGRESS THROUGH THE VIEWPORT.
- **METHODOLOGY FAN:** CARDS TRANSITION FROM STACKED/SCALED-DOWN TO A FANNED SPREAD WHEN THE DECK ENTERS VIEW (0.9S CUBIC-BEZIER), WITH STRONGER SPREAD ON DESKTOP.
- **HOVER:** CTA PILLS SCALE OR WIPE-FILL; SERVICE/WORK CARDS LIFT/ZOOM; CARD TITLES SHIFT TO ORANGE.
- **HEADER:** GAINS DARK TRANSLUCENT BLUR BACKDROP AFTER 50PX OF SCROLL.

## RESPONSIVE BEHAVIOR

- HERO HEADLINE SCALES FLUIDLY FROM ~32PX (MOBILE) TO ~82PX (DESKTOP); FLOATING PILLS HIDDEN BELOW `MD`.
- DESKTOP NAV PILL + INLINE CTA COLLAPSE INTO A HAMBURGER → FULLSCREEN SLIDE-IN MENU BELOW `LG`.
- SERVICES GRID: 1 COL (MOBILE) → 2 (MD) → 3 (XL). PRICING + ABOUT STACK VERTICALLY ON MOBILE.
- ALL SECTIONS USE GENEROUS VERTICAL RHYTHM (~120PX) THAT COMPRESSES ON SMALL SCREENS; NO HORIZONTAL OVERFLOW.

## TECH / DELIVERY

- SINGLE SELF-CONTAINED STATIC BUILD: `INDEX.HTML` + `STYLES.CSS` + `SCRIPT.JS` + LOCAL `ASSETS/` (FONTS, IMAGES). NO BUILD STEP REQUIRED; RUNS OFFLINE.
- VANILLA HTML/CSS/JS — NO RUNTIME CDN DEPENDENCIES. VENDOR FONTS AND ALL IMAGERY LOCALLY.
- SEMANTIC, ACCESSIBLE MARKUP; KEYBOARD-OPERABLE NAV, ACCORDION, AND FORM; `PREFERS-REDUCED-MOTION` RESPECTED.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/lumen-vector-h92).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
