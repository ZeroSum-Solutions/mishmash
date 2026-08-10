---
name: ink-vermilion-personal-brand-h23
description: |
  A single-page, fully responsive personal-brand landing page for a fictional independent marketing consultant (Marlowe Vane) built in an "Ink & Vermilion Editorial" design language: warm paper-white canvas, ink-black type, a single decisive vermilion-red accent, and hand-drawn SVG scribbles, underlines, stars, and arrows that give the page a personally-annotated editorial print feel. Eleven sections span a sticky nav, a two-column hero with an inline contact card and portrait paste-up, a seamless marquee strip, a three-column services row, a dark gallery strip, editorial copy rows with hand-drawn node-graph SVGs, a CTA band, a speaking section, a four-up journal grid, a newsletter CTA, and a footer. Vanilla JS drives IntersectionObserver scroll reveals, a CSS-keyframe marquee, a float animation, and grayscale-to-color hover transitions — all respecting `prefers-reduced-motion`.
tags:
  - "landing-page"
  - "landing-pages"
  - "claude-directory"
triggers:
  - "ink & vermilion"
  - "ink"
  - "vermilion"
  - "editorial"
  - "personal-brand"
  - "landing"
  - "marketing"
  - "consultant"
  - "landing-page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/ink-vermilion-personal-brand-h23"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Ink & Vermilion — Editorial Personal-Brand Landing Page for a Marketing Consultant as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Ink & Vermilion — Editorial Personal-Brand Landing Page for a Marketing Consultant

> Landing page vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A single-page, fully responsive personal-brand landing page for a fictional independent marketing consultant (Marlowe Vane) built in an "Ink & Vermilion Editorial" design language: warm paper-white canvas, ink-black type, a single decisive vermilion-red accent, and hand-drawn SVG scribbles, underlines, stars, and arrows that give the page a personally-annotated editorial print feel. Eleven sections span a sticky nav, a two-column hero with an inline contact card and portrait paste-up, a seamless marquee strip, a three-column services row, a dark gallery strip, editorial copy rows with hand-drawn node-graph SVGs, a CTA band, a speaking section, a four-up journal grid, a newsletter CTA, and a footer. Vanilla JS drives IntersectionObserver scroll reveals, a CSS-keyframe marquee, a float animation, and grayscale-to-color hover transitions — all respecting `prefers-reduced-motion`.

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
<artifact identifier="ink-vermilion-personal-brand-h23" type="text/html" title="Ink & Vermilion — Editorial Personal-Brand Landing Page for a Marketing Consultant">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# INK & VERMILION — PERSONAL-BRAND CONSULTANT LANDING PAGE

## AESTHETIC IDENTITY

BUILD A SINGLE-PAGE, FULLY RESPONSIVE MARKETING / PERSONAL-BRAND LANDING PAGE FOR A FICTIONAL INDEPENDENT MARKETING CONSULTANT NAMED **MARLOWE VANE**. THE NAMED DESIGN LANGUAGE IS **"INK & VERMILION EDITORIAL"** — A WARM, PAPER-STOCK EDITORIAL AESTHETIC THAT FEELS LIKE A BEAUTIFULLY ART-DIRECTED PRINT MAGAZINE SPREAD CROSSED WITH A FRIENDLY, HAND-ANNOTATED NOTEBOOK. THE MOOD IS CONFIDENT, HUMAN, WARM, AND EXPENSIVE WITHOUT BEING COLD. IT IS THE OPPOSITE OF GENERIC SAAS / AI-SLOP: NO PURPLE GRADIENTS, NO GLASSMORPHISM, NO NEON. EVERYTHING SITS ON A WARM PAPER-WHITE CANVAS, ANCHORED BY INK-BLACK TYPE, AND PUNCTUATED BY A SINGLE DECISIVE **VERMILLION RED** ACCENT, WITH OCCASIONAL HAND-DRAWN SCRIBBLES, UNDERLINES, STARS, AND ARROWS THAT MAKE THE PAGE FEEL PERSONALLY ANNOTATED.

## COLOR PALETTE (EXACT)

- WARM PAPER BACKGROUND: `#FDFCF8` (PRIMARY CANVAS, WARM OFF-WHITE)
- STONE SURFACE: `#F2EFE9` (CARDS / ALTERNATE SECTIONS)
- HAIRLINE BORDER: `#E7E5E4`
- INK / TEXT PRIMARY: `#1C1917`
- TEXT SECONDARY: `#57534E`
- VERMILLION PRIMARY (THE ONE ACCENT): `#DC2626`
- VERMILLION DEEP (HOVER / DARKER): `#991B1B`
- GOLD SPARK (RARE SECONDARY ACCENT, FOR STARS / BADGES): `#FBBF24`
- INK DARK PANEL: `#1A1715` / `#0F0E0D` (FOR THE DARK GALLERY STRIP)
- TEXT ON ACCENT: `#FFFFFF`

## TYPOGRAPHY

- DISPLAY / EMPHASIS SERIF: **PLAYFAIR DISPLAY** (WEIGHTS 400/500/600/700, PLUS ITALIC 400/600). USED ONLY FOR ITALICIZED EMPHASIS WORDS INSIDE HEADLINES (E.G. "*BUILD MEANINGFUL*", "*WITH ME*").
- WORKHORSE SANS: **INTER TIGHT** (WEIGHTS 300/400/600/700/800, PLUS ITALIC 400). USED FOR EVERYTHING ELSE: LOGO, NAV, HEADLINES (EXTRABOLD), BODY, LABELS, BUTTONS.
- HEADLINES ARE TIGHTLY TRACKED (`-0.02EM`), EXTRABOLD (800). SUBHEADS ARE LIGHT (300) WITH ITALIC PLAYFAIR EMPHASIS SPANS.
- LABELS / EYEBROWS / NAV / BUTTON TEXT: UPPERCASE, BOLD, WIDE LETTER-SPACING (`0.15EM`), SMALL (11–13PX).
- VENDOR BOTH FONT FAMILIES LOCALLY (WOFF2) — DO NOT HOTLINK GOOGLE FONTS AT RUNTIME.

## LAYOUT & SECTION BREAKDOWN (TOP TO BOTTOM)

1. **STICKY HEADER / NAV** — WARM-PAPER, SLIGHTLY TRANSLUCENT WITH BACKDROP BLUR, THIN BOTTOM HAIRLINE. LEFT: WORDMARK "MARLOWE**VANE**" (FIRST WORD EXTRABOLD, SECOND LIGHT, UPPERCASE, TIGHT TRACKING). CENTER/RIGHT (DESKTOP): TEXT LINKS — ABOUT, SERVICES, SPEAKING, JOURNAL — PLUS A "LET'S TALK" OUTLINED VERMILLION PILL/BUTTON THAT INVERTS TO SOLID VERMILLION ON HOVER. MOBILE: A HAMBURGER THAT OPENS A FULL-WIDTH PAPER DROPDOWN MENU.

2. **HERO (TWO-COLUMN)** — LEFT COLUMN: GIANT EXTRABOLD HEADLINE "HI, I'M MARLOWE." THEN A LIGHT SUBHEAD: "I HELP BRANDS *BUILD MEANINGFUL* RELATIONSHIPS AND *SCALE THEM* THROUGH DIGITAL CHANNELS." — THE ITALIC EMPHASIS WORDS USE PLAYFAIR ITALIC AND ARE DECORATED WITH HAND-DRAWN SVG ANNOTATIONS (A WAVY VERMILLION UNDERLINE BENEATH ONE PHRASE; A SMALL FOUR-POINT STAR FLOATING BY ANOTHER). BELOW THE COPY: A COMPACT INLINE CONTACT CARD ON STONE SURFACE — NAME + EMAIL INPUTS WITH UNDERLINE-ONLY BORDERS THAT TURN VERMILLION ON FOCUS, AND A FULL-WIDTH VERMILLION "GET IN TOUCH" BUTTON. A SMALL HAND-DRAWN SCRIBBLE ARROW POINTS AT THE BUTTON FROM THE BOTTOM-LEFT. RIGHT COLUMN: A PORTRAIT-STYLE IMAGE WITH AN OFFSET HAIRLINE-BORDER "FRAME BLOCK" BEHIND IT (TOP-RIGHT OFFSET) TO MIMIC AN EDITORIAL PASTE-UP. (USE A LOCALLY-VENDORED PORTRAIT IMAGE.)

3. **ROTATED VERMILLION MARQUEE STRIP** — A FULL-BLEED VERMILLION BAR ROTATED ~-1DEG, SLIGHTLY OVER-SCALED, WITH A TOP/BOTTOM DEEPER-RED BORDER AND A DROP SHADOW, CONTAINING AN INFINITE LEFT-SCROLLING MARQUEE OF UPPERCASE SERVICE KEYWORDS ("BRAND MESSAGING • CUSTOMER RESEARCH • CONVERSION COPYWRITING • PERSONAL BRAND • INFLUENCER STRATEGY •") IN WHITE, SEPARATED BY LIGHT-RED BULLETS. THE MARQUEE LOOPS SEAMLESSLY (DUPLICATED TRACK, `transform: translateX` ANIMATION, ~25S LINEAR INFINITE).

4. **"WORK WITH ME" SERVICES (3 COLUMNS)** — A SECTION HEADER WITH A SMALL GOLD FOUR-POINT STAR ICON, "WORK *WITH ME*" (PLAYFAIR ITALIC EMPHASIS), AND A SMALL ITALIC PULL-QUOTE FLOATED TO THE RIGHT ON DESKTOP. BELOW: THREE SERVICE CARDS, EACH WITH A VERMILLION OUTLINE ICON, A VERMILLION BOLD TITLE, A SHORT GREY PARAGRAPH, AND A "READ MORE →" MICRO-LINK. TITLES: "HANDS-ON EXECUTION", "TRAINING & WORKSHOPS", "CONSULTING & COACHING".

5. **DARK GALLERY STRIP** — A FULL-BLEED, NEAR-BLACK BAND HOLDING A FOUR-UP (2-UP ON MOBILE) ROW OF IMAGES WITH 1PX GAPS, EACH SLIGHTLY DIMMED (OPACITY ~0.8) AND BRIGHTENING TO FULL ON HOVER. (USE LOCALLY-VENDORED IMAGES.)

6. **"WORDS WORK" EDITORIAL ROW (2 COLUMNS)** — HEADER "I MAKE *WORDS WORK*" WITH A LARGE FAINT TILDE FLOURISH BEHIND IT. TWO COLUMNS, EACH PAIRING A SMALL HAND-DRAWN "NODE GRAPH" SVG (DOTS CONNECTED BY LINES, MIXING VERMILLION AND GOLD DOTS) WITH A VERMILLION UPPERCASE TITLE, A GREY PARAGRAPH, AND A "VIEW CASE STUDY" MICRO-LINK. TITLES: "CONTENT MARKETING", "MESSAGING & COPYWRITING".

7. **"MISSING PIECE" CTA BAND** — STONE-SURFACE BAND WITH A TOP HAIRLINE. LEFT: "AM I YOUR *MISSING PIECE?*". RIGHT: A SOLID VERMILLION "LET'S TALK" BUTTON WITH A SMALL HAND-DRAWN ARROW POINTING AT IT AND A ROTATED HANDWRITTEN-STYLE NOTE ("LET'S FIND OUT IF WE'RE A GOOD MATCH.") ABOVE IT (DESKTOP ONLY).

8. **"LEARN WITH ME" SPEAKING (2 COLUMNS)** — HEADER "LEARN *WITH ME*". LEFT: TWO COURSE/PROGRAM ENTRIES (EYEBROW + BOLD TITLE + GREY DESC + UNDERLINED MICRO-CTA), PLUS A SHORT ITALIC TESTIMONIAL WITH AN ATTRIBUTED SOURCE. RIGHT: A SPEAKING-EVENT IMAGE (GRAYSCALE → COLOR ON HOVER) WITH A SOFT GOLD CIRCLE BEHIND ONE CORNER AND A SMALL WHITE "EVENT BADGE" CARD WITH A VERMILLION LEFT BORDER OVERLAID AT THE BOTTOM-LEFT.

9. **"JOURNAL" BLOG GRID (4-UP)** — HEADER "I LOVE SHARING *TRIED AND TESTED* MARKETING ADVICE." + EYEBROW "READ THE LATEST ON THE JOURNAL". A 4-UP (2-UP ON MOBILE) GRID OF POST CARDS: 16:9 GRAYSCALE THUMB THAT COLORIZES AND SCALES SLIGHTLY ON HOVER, A VERMILLION UPPERCASE CATEGORY, AND A BOLD TITLE THAT TURNS VERMILLION ON HOVER. A CENTERED "SEE ALL ARTICLES" UNDERLINED LINK BELOW.

10. **NEWSLETTER CTA (2 COLUMNS)** — LEFT: BIG EXTRABOLD HEADLINE "I READ 180 ARTICLES PER WEEK, SO *YOU DON'T HAVE TO.*" (THE SECOND CLAUSE IN MUTED GREY), A GREY SUBLINE, AND AN INLINE EMAIL + "SUBSCRIBE" VERMILLION BUTTON. RIGHT: A SLIGHTLY ROTATED FLATLAY/NOTEBOOK IMAGE (STRAIGHTENS ON HOVER) WITH A ROUND ROTATED VERMILLION "JOIN 50K+ SUBS" BADGE OVERLAPPING THE TOP-LEFT CORNER.

11. **FOOTER** — THIN TOP HAIRLINE, COPYRIGHT LINE LEFT, AND A ROW OF MINIMAL SOCIAL ICONS (TWITTER/X, LINKEDIN, INSTAGRAM, YOUTUBE) THAT TURN VERMILLION ON HOVER.

## MOTION / ANIMATION / INTERACTION SPEC

- **SCROLL REVEAL:** EVERY MAJOR BLOCK STARTS AT `opacity:0; translateY(20px)` AND TRANSITIONS TO `opacity:1; translateY(0)` OVER ~0.6S EASE-OUT WHEN IT ENTERS THE VIEWPORT (INTERSECTIONOBSERVER, THRESHOLD ~0.1, UNOBSERVE AFTER FIRST REVEAL). STAGGER SIBLINGS SLIGHTLY.
- **MARQUEE:** SEAMLESS INFINITE HORIZONTAL SCROLL VIA DUPLICATED TRACK + CSS KEYFRAMES (`translateX(0)` → `translateX(-100%)`, ~25S LINEAR INFINITE). PAUSE ON HOVER OPTIONAL.
- **FLOAT:** A SUBTLE 6S EASE-IN-OUT VERTICAL FLOAT (±10–20PX) ON ONE DECORATIVE ELEMENT (E.G. THE HERO STAR OR GOLD CIRCLE).
- **HOVER MICRO-INTERACTIONS:** OUTLINE BUTTON → FILLED INVERT; IMAGES GRAYSCALE→COLOR; GALLERY DIM→FULL; BLOG THUMB SCALE(1.05)+COLORIZE; LINKS UNDERLINE/COLOR SHIFTS. ALL ~200–500MS.
- **FOCUS STATES:** INPUTS HAVE UNDERLINE-ONLY BORDERS THAT ANIMATE TO VERMILLION ON FOCUS.
- **SMOOTH SCROLL** FOR IN-PAGE ANCHOR NAV.
- RESPECT `prefers-reduced-motion`: DISABLE MARQUEE + FLOAT + REVEAL OFFSETS WHEN REQUESTED.

## RESPONSIVE BEHAVIOR

- MOBILE-FIRST. HERO, SERVICES, WORDS-WORK, SPEAKING, AND NEWSLETTER COLLAPSE FROM 2/3 COLUMNS TO A SINGLE STACKED COLUMN.
- DESKTOP-ONLY FLOURISHES (FLOATED PULL-QUOTE, ROTATED HANDWRITTEN NOTE, SOME HAND-DRAWN ARROWS, THE EVENT BADGE CARD) ARE HIDDEN ON SMALL SCREENS.
- NAV COLLAPSES TO A HAMBURGER + PAPER DROPDOWN ON MOBILE.
- BLOG + GALLERY GRIDS GO 4-UP → 2-UP. MAX CONTENT WIDTH ~1200–1280PX, GENEROUS HORIZONTAL PADDING.

## DELIVERABLE

A SELF-CONTAINED, OFFLINE-RUNNABLE STATIC SITE (HTML/CSS/JS) WITH ALL FONTS AND IMAGES VENDORED LOCALLY. NO RUNTIME CDN DEPENDENCIES. HAND-DRAWN DECORATIONS ARE INLINE SVG. THE RESULT SHOULD READ AS A POLISHED, PERSONALLY-ANNOTATED EDITORIAL PERSONAL-BRAND PAGE — DISTINCTIVE, WARM, AND NOT TEMPLATED.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/landing-pages/ink-vermilion-personal-brand-h23).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
