---
name: kairos-academy-h0
description: |
  A fully self-contained, responsive marketing landing page for Kairos Academy, a premium competitive-exam coaching institute for civil-service, banking, and railway aspirants. The page uses the "Warm Editorial Ember" aesthetic — a confident, bookish, high-contrast editorial language built on a cream paper stock, one decisive ember-orange accent, ink-black type, and crisp hairline rules punctuated by a small solid dot, evoking a well-printed study annual. The hero uses a signature split-tone layout where an ember upper band gives way to a cream lower band, with overlapping exam cards and floating pill tags above a ghosted "KAIROS" watermark. Sections continue through a count-up stats strip, stacked program rows, a subjects grid, a 4-step Kairos Method grid, auto-rotating testimonials, a single-open FAQ, a CTA bar, and an ink footer. Motion is vanilla JS: per-word hero reveal, IntersectionObserver reveals, floating tags, count-up stats, slide-up double-text nav hovers, and testimonial cross-fade — all respecting `prefers-reduced-motion`.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "kairos academy"
  - "kairos"
  - "academy"
  - "competitive"
  - "exam"
  - "coaching"
  - "landing"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/kairos-academy-h0"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Kairos Academy — Competitive Exam Coaching Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Kairos Academy — Competitive Exam Coaching Landing Page

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A fully self-contained, responsive marketing landing page for Kairos Academy, a premium competitive-exam coaching institute for civil-service, banking, and railway aspirants. The page uses the "Warm Editorial Ember" aesthetic — a confident, bookish, high-contrast editorial language built on a cream paper stock, one decisive ember-orange accent, ink-black type, and crisp hairline rules punctuated by a small solid dot, evoking a well-printed study annual. The hero uses a signature split-tone layout where an ember upper band gives way to a cream lower band, with overlapping exam cards and floating pill tags above a ghosted "KAIROS" watermark. Sections continue through a count-up stats strip, stacked program rows, a subjects grid, a 4-step Kairos Method grid, auto-rotating testimonials, a single-open FAQ, a CTA bar, and an ink footer. Motion is vanilla JS: per-word hero reveal, IntersectionObserver reveals, floating tags, count-up stats, slide-up double-text nav hovers, and testimonial cross-fade — all respecting `prefers-reduced-motion`.

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
<artifact identifier="kairos-academy-h0" type="text/html" title="Kairos Academy — Competitive Exam Coaching Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# KAIROS ACADEMY — "SHARPEN THE DECISIVE HOUR"

BUILD A FULLY SELF-CONTAINED, RESPONSIVE MARKETING LANDING PAGE FOR **KAIROS ACADEMY**, A PREMIUM COMPETITIVE-EXAM COACHING INSTITUTE FOR CIVIL-SERVICE, BANKING, AND RAILWAY ASPIRANTS. THE NAMED AESTHETIC IDENTITY IS **"WARM EDITORIAL EMBER"** — A CONFIDENT, BOOKISH, HIGH-CONTRAST EDITORIAL LANGUAGE THAT FEELS LIKE A WELL-PRINTED STUDY ANNUAL: CREAM PAPER STOCK, ONE DECISIVE EMBER-ORANGE ACCENT, INK-BLACK TYPE, AND CRISP HAIRLINE RULES WITH PUNCTUATING DOTS.

## DESIGN LANGUAGE & MOOD

- WARM, PRINT-INSPIRED, EDITORIAL. CALM CONFIDENCE, NOT HYPE. GENEROUS WHITESPACE, STRONG TYPOGRAPHIC HIERARCHY, A SINGLE SATURATED ACCENT USED SPARINGLY FOR EMPHASIS.
- SPLIT-TONE HERO: A SOLID EMBER-ORANGE UPPER BAND THAT GIVES WAY TO A CREAM LOWER BAND, WITH CARDS AND FLOATING PILL TAGS OVERLAPPING THE SEAM.
- RECURRING MOTIF: A THIN INK HAIRLINE RULE UNDER EVERY SECTION TITLE, TERMINATED BY A SMALL SOLID DOT ON ITS RIGHT END.
- SOFT, LOW-SPREAD CARD SHADOWS; 10PX CARD RADIUS; FULLY-ROUNDED (PILL) BUTTONS AND TAGS. NOTHING GLOSSY OR NEON — EVERYTHING MATTE AND PAPER-LIKE.

## EXACT COLOR PALETTE

- EMBER PRIMARY: `#E8552B` (PRIMARY ACCENT, HERO BAND, ACTIVE STATES)
- EMBER DEEP: `#C8401C` (HOVER / PRESSED ACCENT)
- BONE BACKGROUND: `#FBF8F1` (PAGE BACKGROUND, WARM CREAM)
- LINEN SURFACE: `#F0EADB` (SECONDARY SURFACE, TAG FILLS, MUTED SECTIONS)
- INK: `#16130F` (PRIMARY TEXT, DARK FOOTER)
- GRAPHITE: `#3A352E` (SECONDARY TEXT)
- MUTED: `#9A9286` (TERTIARY / META TEXT)
- PAPER WHITE: `#FFFFFF` (CARD SURFACES)
- HAIRLINE: `RGBA(22,19,15,0.10)` (BORDERS / RULES)

## TYPOGRAPHY

- USE A SINGLE TIGHT GROTESQUE FOR EVERYTHING: **INTER TIGHT** (WEIGHTS 400, 500, 600, 700, 800). VENDOR THE FONT FILES LOCALLY (WOFF2) — DO NOT HOTLINK GOOGLE FONTS.
- DISPLAY HEADINGS: 700–800 WEIGHT, TIGHT NEGATIVE LETTER-SPACING (≈ -0.03EM), LINE-HEIGHT ~1.05–1.1. HERO HEADLINE CLAMPS FROM ~40PX MOBILE TO ~88PX DESKTOP.
- SECTION TITLES: 500 WEIGHT, 30–52PX. CARD TITLES: 700, UPPERCASE OPTIONAL FOR SUBJECT/STEP CARDS. BODY: 400–500, 16–18PX, GRAPHITE. EYEBROWS/META: UPPERCASE, WIDE TRACKING (≈0.2EM), 11–13PX.

## LAYOUT & SECTION BREAKDOWN (TOP TO BOTTOM)

1. **STICKY HEADER** — TRANSPARENT OVER THE HERO, GAINS A SUBTLE SHADOW ON SCROLL. LEFT: WORDMARK "KAIROS" (BOLD, TIGHT). CENTER (DESKTOP ONLY): A WHITE PILL NAV WITH NUMBERED LINKS (01 PROGRAMS · 02 SUBJECTS · 03 METHOD · 04 FAQ), EACH WITH A SLIDE-UP DOUBLE-TEXT HOVER WHERE THE LABEL SLIDES UP TO REVEAL AN EMBER-COLORED DUPLICATE. RIGHT: A SOLID INK "ENQUIRE NOW" PILL BUTTON (HOVERS TO EMBER). MOBILE: HAMBURGER TOGGLING A FULL-WIDTH SHEET.
2. **HERO** — EMBER UPPER BAND (~120–150PX TOP PADDING) WITH A CENTERED WORD-BY-WORD REVEALED HEADLINE IN WHITE ("SHARPEN THE / DECISIVE HOUR.") AND ONE INK PILL CTA ("EXPLORE PROGRAMS"). BELOW THE SEAM, ON A CREAM BAND: A TWO-UP OVERLAPPING ROW PULLED UP OVER THE SEAM — A WHITE COPY CARD (TOP EMBER ACCENT BORDER, HEADING, PARAGRAPH ABOUT 600+ MOCK TESTS AND MENTORSHIP, AND A "START YOUR JOURNEY" BUTTON) BESIDE A TALL PHOTO CARD (PORTRAIT OF A STUDENT). UNDER THE CARDS: A FIELD OF FLOATING PILL TAGS NAMING EXAMS (UPSC, SSC CGL, IBPS PO, RRB NTPC, SBI CLERK, CDS, CAPF, MTS) — ABSOLUTELY POSITIONED AND GENTLY FLOATING ON DESKTOP, A 2-COLUMN GRID ON MOBILE, WITH A GIANT GHOSTED "KAIROS" WATERMARK BEHIND THEM.
3. **STATS STRIP** — A SLIM ROW OF FOUR COUNT-UP METRICS (E.G. 18K+ ASPIRANTS, 600+ MOCK TESTS, 94% SELECTION RATE, 40+ MENTORS) THAT ANIMATE FROM ZERO WHEN SCROLLED INTO VIEW, SEPARATED BY HAIRLINE DIVIDERS.
4. **PROGRAMS** ("FOCUSED EXAM STREAMS") — SECTION HEADER WITH TITLE + RULE-AND-DOT ON THE LEFT AND A SUPPORTING PARAGRAPH ON THE RIGHT. THEN THREE STACKED FULL-WIDTH PROGRAM ROWS (CIVIL SERVICES / BANKING & FINANCE / RAILWAY RECRUITMENT), EACH A LEFT PHOTO (ZOOMS ON HOVER) + RIGHT CONTENT (TITLE, RULE-DOT, A ROW OF UPPERCASE TAG PILLS, A PARAGRAPH, AND AN "ENROLL NOW" PILL). ROW BACKGROUND SOFTENS TO WHITE ON HOVER.
5. **SUBJECTS** ("CORE DISCIPLINES") — ON A WHITE BAND, A 4-UP CARD GRID (QUANTITATIVE APTITUDE, REASONING ABILITY, ENGLISH LANGUAGE, GENERAL AWARENESS). EACH CARD: AN INLINE SVG ICON IN A ROUNDED LINEN TILE THAT FLIPS TO EMBER ON HOVER, A TITLE WITH RULE-DOT, AND A BULLETED LIST WITH SMALL EMBER DOTS. A FAINT EMBER QUARTER-CIRCLE BLEEDS FROM THE TOP-RIGHT CORNER.
6. **METHOD** ("THE KAIROS METHOD") — A 4-STEP FRAMEWORK GRID (PHASE ONE CONCEPT CLARITY · PHASE TWO DELIBERATE PRACTICE · PHASE THREE MOCK SIMULATION · FINAL PHASE PERFORMANCE ANALYSIS). EACH STEP CARD FLIPS ITS WHOLE BACKGROUND TO EMBER ON HOVER WITH TEXT INVERTING TO WHITE; STAGGERED REVEAL DELAYS.
7. **TESTIMONIALS** ("SELECTION STORIES") — ON A WHITE BAND, A TWO-COLUMN LAYOUT: A TALL PHOTO WITH A BOTTOM INK GRADIENT AND OVERLAID QUOTE/LABEL ON ONE SIDE, AND TWO STACKED QUOTE CARDS ON THE OTHER THAT AUTO-ROTATE THROUGH A POOL OF TESTIMONIALS WITH A CROSS-FADE EVERY ~6S (QUOTE, AVATAR, NAME, EMBER ROLE LABEL).
8. **FAQ** — A TWO-COLUMN ACCORDION OF COMMON ADMISSION/BATCH/MATERIAL QUESTIONS; OPENING ONE CLOSES THE OTHERS; THE CHEVRON ROTATES AND THE ACTIVE ITEM GAINS AN EMBER BORDER.
9. **FINAL CTA BAR** — A LINEN PANEL WITH A BOLD HEADLINE, A SUPPORTING LINE ABOUT NEW BATCHES, AND TWO BUTTONS ("SEE PROGRAMS" EMBER WITH AN ARROW + "CALL ENQUIRIES" INK), BUTTONS LIFT ON HOVER.
10. **FOOTER** — INK-BLACK, FOUR COLUMNS (BRAND + ADDRESS/CONTACT, EXAMS COVERED, RESOURCES, NEWSLETTER WITH AN INLINE EMBER "JOIN" SUBMIT), A HAIRLINE-DIVIDED BOTTOM ROW WITH COPYRIGHT AND A TAGLINE.

## MOTION / ANIMATION / INTERACTION SPEC

- HERO HEADLINE: PER-WORD STAGGERED FADE-AND-RISE ON LOAD (~60MS APART).
- SCROLL REVEALS: AN INTERSECTION OBSERVER FADES/SLIDES ELEMENTS IN (UP, LEFT, OR RIGHT VARIANTS) AT ~10% VISIBILITY, ONCE EACH.
- FLOATING HERO TAGS: SLOW INFINITE VERTICAL "FLOAT" KEYFRAMES (TWO TIMING VARIANTS, 4S AND 6S).
- STATS: COUNT-UP FROM ZERO TO TARGET WHEN THE STRIP ENTERS VIEW.
- NAV LINKS: SLIDE-UP DOUBLE-TEXT HOVER. BUTTONS: COLOR/LIFT TRANSITIONS. PROGRAM PHOTOS: SCALE-105 ZOOM ON HOVER. SUBJECT ICON TILE & METHOD CARDS: COLOR-INVERT ON HOVER.
- TESTIMONIALS: TIMED CROSS-FADE ROTATION. FAQ: HEIGHT/CHEVRON TOGGLE WITH SINGLE-OPEN BEHAVIOR.
- RESPECT `PREFERS-REDUCED-MOTION` BY DISABLING NON-ESSENTIAL ANIMATION.

## RESPONSIVE BEHAVIOR

- DESKTOP (≥1024PX): MAX CONTENT WIDTH ~1360PX, MULTI-COLUMN GRIDS, ABSOLUTELY-FLOATING HERO TAGS, CENTER PILL NAV VISIBLE.
- TABLET (≥768PX): TWO-COLUMN GRIDS, PROGRAM ROWS REMAIN SIDE-BY-SIDE.
- MOBILE (<768PX): SINGLE-COLUMN STACKS, HERO TAGS BECOME A 2-COLUMN GRID, PILL NAV COLLAPSES INTO A HAMBURGER SHEET, REDUCED SECTION SPACING, NO HORIZONTAL OVERFLOW.

## TECH & DELIVERY CONSTRAINTS

- BUILD AS A STANDALONE STATIC SITE (HTML + CSS + VANILLA JS) — NO BUILD STEP REQUIRED, RUNNABLE BY OPENING/ SERVING THE FOLDER.
- HAND-AUTHOR THE CSS (NO TAILWIND CDN AT RUNTIME). VENDOR ALL ASSETS LOCALLY: FONT WOFF2 FILES AND ALL PHOTOGRAPHY DOWNLOADED INTO AN `ASSETS/` FOLDER AND REFERENCED BY RELATIVE PATHS. THE PROJECT MUST RUN FULLY OFFLINE.
- SEMANTIC, ACCESSIBLE MARKUP; KEYBOARD-OPERABLE NAV, FAQ, AND BUTTONS; ALT TEXT ON ALL IMAGERY.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/kairos-academy-h0).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
