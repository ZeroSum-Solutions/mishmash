---
name: monocrit-studio-h27
description: |
  A full-viewport, cursor-driven hero section for a fictional independent art-direction studio called Monocrit Studio, built in a quiet near-monochrome Swiss-brutalist aesthetic: huge Bricolage Grotesque display type centered in a field of warm off-white paper (`#F2F0EB`), framed by hairline rules and tight uppercase eyebrow labels, with a single signal-red accent (`#FF3B2F`). The floating image card replaces the native cursor and lerps toward it with slight inertia and velocity-based tilt; headline letters magnetically recoil away from the cursor and spring back; and accumulated pointer travel cycles a stack of six portfolio images with a crossfade. Header and footer use `mix-blend-difference` to stay legible over both paper and dark card. Runs fully offline — font and all six images vendored locally.
tags:
  - "hero-section"
  - "hero-sections"
  - "claude-directory"
triggers:
  - "monocrit studio"
  - "monocrit"
  - "studio"
  - "cursor-driven"
  - "interactive"
  - "portfolio"
  - "hero"
  - "hero-section"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/hero-sections/monocrit-studio-h27"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "hero-section"
  scenario: "marketing"
  example_prompt: "Build Monocrit Studio — Cursor-Driven Interactive Portfolio Hero as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Monocrit Studio — Cursor-Driven Interactive Portfolio Hero

> Hero section vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A full-viewport, cursor-driven hero section for a fictional independent art-direction studio called Monocrit Studio, built in a quiet near-monochrome Swiss-brutalist aesthetic: huge Bricolage Grotesque display type centered in a field of warm off-white paper (`#F2F0EB`), framed by hairline rules and tight uppercase eyebrow labels, with a single signal-red accent (`#FF3B2F`). The floating image card replaces the native cursor and lerps toward it with slight inertia and velocity-based tilt; headline letters magnetically recoil away from the cursor and spring back; and accumulated pointer travel cycles a stack of six portfolio images with a crossfade. Header and footer use `mix-blend-difference` to stay legible over both paper and dark card. Runs fully offline — font and all six images vendored locally.

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
<artifact identifier="monocrit-studio-h27" type="text/html" title="Monocrit Studio — Cursor-Driven Interactive Portfolio Hero">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

# MONOCRIT STUDIO — INTERACTIVE MONOCHROME PORTFOLIO HERO

## AESTHETIC IDENTITY

BUILD A SINGLE, FULL-VIEWPORT HERO SECTION FOR A FICTIONAL INDEPENDENT
ART-DIRECTION STUDIO CALLED **"MONOCRIT STUDIO"**. THE NAMED DESIGN LANGUAGE IS
**"MONOCRIT"** — A QUIET, EDITORIAL, NEAR-MONOCHROME SWISS-BRUTALIST AESTHETIC:
HUGE GROTESQUE DISPLAY TYPE CENTERED IN A VAST FIELD OF OFF-WHITE PAPER, FRAMED
BY THIN HAIRLINE RULES AND TIGHT UPPERCASE EYEBROW LABELS. THE MOOD IS
CONFIDENT, RESTRAINED, AND GALLERY-LIKE — NOTHING DECORATIVE, EVERYTHING
INTENTIONAL. THE WHOLE PAGE IS DRIVEN BY THE CURSOR: A FLOATING IMAGE CARD
TRAILS THE POINTER, THE HEADLINE LETTERS PHYSICALLY RECOIL AWAY FROM IT, AND THE
PORTFOLIO IMAGERY CYCLES AS THE HAND MOVES. IT MUST FEEL LIKE A LIVING POSTER.

## COLOR PALETTE (STRICT, NEAR-MONOCHROME)

- PAPER / BACKGROUND: `#F2F0EB` (WARM OFF-WHITE BONE)
- INK / FOREGROUND: `#0D0D0D` (NEAR-BLACK)
- HAIRLINE RULES: INK AT 10–15% OPACITY
- MUTED TEXT: INK AT 55–65% OPACITY
- ONE SINGLE ACCENT, USED SPARINGLY: `#FF3B2F` (SIGNAL RED) — ONLY ON THE
  STATUS DOT, ONE WORD OF THE HEADLINE, AND HOVER STATES.
- THE FLOATING CARD AND ITS DROP SHADOW ARE THE ONLY PLACES WITH COLOR PHOTOS;
  KEEP THEM SLIGHTLY DESATURATED SO THE PAGE STAYS MONOCHROME OVERALL.

## TYPOGRAPHY

- DISPLAY + UI FONT: **"Bricolage Grotesque"** (VARIABLE, WEIGHTS 200–800),
  SELF-HOSTED/VENDORED LOCALLY (NO REMOTE CDN). FALL BACK TO A SYSTEM
  GROTESQUE SANS.
- HEADLINE: `clamp(3.5rem, 11vw, 12rem)`, WEIGHT 700–800, UPPERCASE,
  `letter-spacing: -0.04em`, `line-height: 0.82`. CENTERED, WRAPS ACROSS TWO
  WORDS.
- EYEBROW / LABELS / META: 10–13PX, UPPERCASE, `letter-spacing: 0.28em–0.35em`,
  WEIGHT 500–600.
- BODY DESCRIPTION: 12–14PX UPPERCASE, RELAXED LINE-HEIGHT, MAX-WIDTH ~300PX.

## LAYOUT & STRUCTURE (SINGLE SCREEN, 100VH)

1. **FIXED HEADER** — TOP, FULL WIDTH, GENEROUS PADDING. LEFT: STUDIO MARK
   "MONOCRIT©". CENTER (DESKTOP): A LIVE CLOCK / LOCATION META. RIGHT: A
   STATUS PILL "AVAILABLE FOR FREELANCE" PRECEDED BY A PULSING SIGNAL-RED DOT.
   THE HEADER USES `mix-blend-difference` SO IT STAYS LEGIBLE OVER BOTH PAPER
   AND THE DARK FLOATING CARD.
2. **CENTERED HERO BLOCK**:
   - EYEBROW LABEL: "INDEPENDENT ART DIRECTION — EST. 2024".
   - GIANT HEADLINE: "VISUAL / NOISE" (TWO LINES; THE WORD "NOISE" RENDERED IN
     A THIN OUTLINE/STROKE STYLE OR THE SIGNAL-RED ACCENT FOR CONTRAST).
     EVERY LETTER IS AN INDIVIDUAL INLINE-BLOCK SPAN.
   - BELOW: A HAIRLINE-TOPPED ROW SPLIT INTO A SHORT DESCRIPTION PARAGRAPH ON
     THE LEFT AND TWO PILL BUTTONS ON THE RIGHT ("VIEW INDEX" OUTLINE, "GET IN
     TOUCH" SOLID INK), WITH INVERTING HOVER STATES.
3. **FLOATING IMAGE CARD** — A FIXED `~190×250PX` ROUNDED CARD THAT FOLLOWS THE
   CURSOR (TRANSLATED TO CENTER ON THE POINTER). IT HOLDS A STACK OF 6 VENDORED
   PORTFOLIO IMAGES; ONLY ONE IS VISIBLE AT A TIME. THE CARD CARRIES A SOFT
   DROP SHADOW AND A SMALL UPPERCASE CAPTION BAR AT ITS BOTTOM ("PROJECT 03 /
   2024" STYLE), PLUS A FRAME COUNTER.
4. **FIXED FOOTER** — BOTTOM, FULL WIDTH, ALSO `mix-blend-difference`. LEFT:
   "SELECTED WORKS — 06". RIGHT: "MOVE CURSOR TO EXPLORE ↗". A THIN ANIMATED
   PROGRESS/SCRUB LINE OR INDEX DOTS (ONE PER IMAGE) SIT ALONG THE BOTTOM EDGE,
   HIGHLIGHTING THE CURRENTLY-SHOWN IMAGE.
5. **AMBIENT DETAIL** — A FAINT PAPER GRAIN/NOISE TEXTURE OVERLAY AND A SUBTLE
   FIXED CORNER REGISTRATION MARKS / TICK GRID TO REINFORCE THE PRINT FEEL.

## MOTION / ANIMATION / INTERACTION SPEC

- **CUSTOM CURSOR**: HIDE THE NATIVE CURSOR INSIDE THE HERO (`cursor: none`).
  THE FLOATING CARD IS THE CURSOR. ON INTERACTIVE ELEMENTS (BUTTONS/LINKS) THE
  CARD FADES OUT AND A SMALL RING/LABEL CURSOR APPEARS INSTEAD.
- **SMOOTH FOLLOW**: THE CARD LERPS TOWARD THE POINTER EACH ANIMATION FRAME
  (REQUESTANIMATIONFRAME, EASE ~0.12–0.18) SO IT TRAILS WITH SLIGHT INERTIA,
  AND TILTS/SKEWS SLIGHTLY BASED ON POINTER VELOCITY.
- **MAGNETIC LETTERS**: ON `mousemove`, EACH HEADLINE LETTER WITHIN ~150PX OF
  THE POINTER IS PUSHED RADIALLY AWAY (DISPLACEMENT PROPORTIONAL TO PROXIMITY),
  EASING BACK TO REST WITH A SPRINGY CUBIC-BEZIER WHEN THE POINTER LEAVES.
- **IMAGE CYCLING**: ACCUMULATE POINTER TRAVEL DISTANCE; EVERY TIME IT EXCEEDS
  A THRESHOLD (~60–80PX) ADVANCE TO THE NEXT IMAGE IN THE STACK (CROSSFADE),
  UPDATE THE CAPTION/COUNTER, AND MOVE THE ACTIVE FOOTER INDEX DOT.
- **ENTRANCE**: ON LOAD, THE EYEBROW, HEADLINE LETTERS (STAGGERED RISE/CLIP),
  AND META ROW ANIMATE IN; THE STATUS DOT BEGINS A SLOW PULSE.
- **LIVE CLOCK**: THE HEADER META UPDATES EVERY SECOND.
- RESPECT `prefers-reduced-motion`: DISABLE LERP/MAGNETISM, SHOW A STATIC
  CENTERED CARD OR HIDE IT, KEEP CONTENT FULLY READABLE.

## RESPONSIVE BEHAVIOR

- DESKTOP (≥1024PX): FULL EXPERIENCE AS ABOVE.
- TABLET: HEADER CENTER META MAY HIDE; HEADLINE SCALES VIA CLAMP; CARD SIZE
  REDUCES.
- MOBILE (NO HOVER / COARSE POINTER): DISABLE THE CURSOR-FOLLOW CARD AND
  MAGNETISM; INSTEAD AUTO-CYCLE THE PORTFOLIO IMAGES ON A TIMER IN A STATIC
  CENTERED OR CORNER CARD, STACK THE META ROW VERTICALLY, AND RESTORE THE
  NATIVE TOUCH BEHAVIOR. EVERYTHING REMAINS FULLY LEGIBLE AND TAPPABLE.

## TECH NOTES

- PLAIN HTML + CSS + VANILLA JS (NO HEAVY FRAMEWORK REQUIRED). NO REMOTE CDNS:
  VENDOR THE FONT AND ALL 6 PORTFOLIO IMAGES LOCALLY INTO AN `assets/` FOLDER
  AND REFERENCE THEM WITH RELATIVE PATHS. THE PROJECT MUST RUN FULLY OFFLINE.
- AIM FOR DISTINCTIVE, POLISHED, GALLERY-GRADE UI — NO GENERIC TEMPLATE FEEL.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/hero-sections/monocrit-studio-h27).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
