---
name: lexington-quartiere
description: |
  Quartiere is a static reproduction of the current Lexington Themes luxury real estate template. Its editorial layout combines Geist typography, sharp monochrome styling, property galleries, agent profiles, listing search, booking, and lead forms.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "quartiere real estate template"
  - "quartiere"
  - "real"
  - "estate"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/quartiere"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Quartiere Real Estate Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Quartiere Real Estate Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Quartiere is a static reproduction of the current Lexington Themes luxury real estate template. Its editorial layout combines Geist typography, sharp monochrome styling, property galleries, agent profiles, listing search, booking, and lead forms.

The upstream theme ships a full multi-page site. `example.html` is its home page; the remaining routes (about, blog, pricing, help centre, auth, and design-system pages) stay upstream — rebuild them from the build spec when a project needs them.

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
<artifact identifier="lexington-quartiere" type="text/html" title="Quartiere Real Estate Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE QUARTIERE REAL ESTATE TEMPLATE BY LEXINGTON THEMES, BUILT AS PLAIN HTML + CSS + VANILLA JS WITH NO BUILD STEP REQUIRED.

REFERENCE: `https://quartiere-astro.pages.dev/`

## SUMMARY

QUARTIERE IS A LUXURY REAL ESTATE TEMPLATE WITH A MINIMAL, EDITORIAL AESTHETIC. IT IS BUILT ON ASTRO BY LEXINGTON THEMES AND FEATURES A CLEAN BLACK-AND-WHITE PALETTE WITH NEUTRAL GRAYS, EDITORIAL TYPOGRAPHY USING THE GEIST TYPEFACE, AND TASTEFUL AOS (ANIMATE ON SCROLL) ENTRANCE EFFECTS. THE TEMPLATE COVERS THE FULL LIFECYCLE OF A LUXURY REAL ESTATE BUSINESS: LISTING PROPERTIES FOR SALE AND RENT, AGENT PROFILES, A PROPERTY DETAIL VIEW, A SELL-PROPERTY LANDING PAGE, AND A CONTACT FORM.

## STYLE

- **PALETTE:** ALL NEUTRAL — WHITE (#FFFFFF), NEAR-BLACK (OKLCH 20.5%), AND A FULL GRAY SCALE (BASE-50 THROUGH BASE-950 IN OKLCH). A BLUE ACCENT SCALE (OKLCH ACCENT-50–950) IS DEFINED BUT NOT PROMINENTLY USED IN THE UI. NO BRAND COLOR BEYOND NEUTRAL.
- **FONTS:** GEIST (SANS) + GEIST MONO — LOADED VIA GOOGLE FONTS. ALL BODY AND HEADING TEXT USES GEIST; TABULAR NUMERALS ARE ENABLED.
- **TYPE SCALE:** XS (0.75REM) THROUGH 8XL (6REM). HEADINGS USE FONT-WEIGHT 500, LETTER-SPACING −0.05EM. BODY COPY IS BASE-500 (MID-GRAY).
- **RADII:** NONE — ALL ELEMENTS ARE SHARP-CORNERED.
- **SHADOWS:** NONE.
- **BORDERS:** 1PX SOLID VAR(--COLOR-BASE-200) USED AS DIVIDERS THROUGHOUT.
- **ANIMATION EASINGS:** CUBIC-BEZIER(0.4, 0, 0.2, 1) FOR ALL TRANSITIONS. AOS ENTRANCE ANIMATIONS: FADE-UP, DURATION 400–2000MS, ONCE: TRUE. PROPERTY IMAGES SCALE TO 1.1 ON HOVER (TRANSITION-SLOW = 500MS).
- **LAYOUT RHYTHM:** CONTAINER MAX-WIDTH 80REM (1280PX), PADDING-INLINE 2REM (MD: 3REM). SECTIONS SEPARATED BY 3–6REM VERTICAL PADDING. GRID DIVIDERS USE BORDER-TOP 1PX BASE-200.

## LAYOUT & STRUCTURE

### PAGES DISCOVERED

1. **HOME (INDEX.HTML)** — HERO FULL-WIDTH IMAGE WITH BOTTOM-RIGHT CONTACT BOX; LARGE FADE-UP H1; "WHY CHOOSE US" 3-COLUMN FEATURE GRID; "AVAILABLE PROPERTIES FOR SALE" 3-UP CARD GRID WITH HOVER-FADE EFFECT; SELL CTA TWO-COLUMN (IMAGE + OUTLINED BOX); AGENTS TEASER 2-UP GRID; FOOTER WITH FULL QUARTIERE LETTERFORM SVG.
2. **FOR SALE (FOR-SALE.HTML)** — NO HERO IMAGE; TEXT-ONLY INTRO HEADER (3-COL GRID: H1 SPANNING 2 COLS + DESCRIPTION); FUSE.JS SEARCH TRIGGER; 5-CARD PROPERTY GRID WITH HOVER-FADE; SELL CTA TWO-COLUMN; FOOTER.
3. **FOR RENT (FOR-RENT.HTML)** — SAME STRUCTURE AS FOR-SALE BUT WITH RENTAL PROPERTIES AND "MONTHLY RENT" LABEL; SEARCH; FOOTER WITH CTA.
4. **PROPERTY DETAIL (PROPERTY-DETAIL.HTML)** — FULL-HEIGHT HERO IMAGE (75VH); TWO-COLUMN DETAIL GRID (MAIN 2/3 + SIDEBAR 1/3); PROPERTY SPECS (SQFT/BED/BATH); GALLERY 3-UP GRID; CONTACT AGENT FORM IN SIDEBAR; RELATED PROPERTIES; FOOTER.
5. **AGENTS (AGENTS.HTML)** — FULL-WIDTH HERO IMAGE; "WORLDWIDE AGENTS" H1 IN 3-COL GRID WITH FUSE.JS SEARCH IN COL 2–3; VERTICAL LIST OF AGENTS (PHOTO LEFT, INFO RIGHT: NAME, ROLE, PHONE, OFFICE, ADDRESS); SELL CTA; FOOTER.
6. **SELL PROPERTY (SELL-PROPERTY.HTML)** — HERO IMAGE + CONTACT BOX; LARGE H1; INTRO PARAGRAPH (FADE-UP, COL 2–3); "LIST YOUR HOME" SECTION WITH TWO FEATURE ROWS (EACH: TITLE/TEXT LEFT + IMAGE + INFO RIGHT); "BE WHERE THE WORLD IS LOOKING" TWO-COLUMN CTA (IMAGE LEFT + OUTLINED CONTENT BOX); FEATURES: PRIME EXPOSURE / GLOBAL CONNECTIONS / UNMATCHED MARKETING; CONTACT FORM (FIRST/LAST/TOTAL-COST/MESSAGE); FOOTER.
7. **CONTACT (CONTACT.HTML)** — SIMPLE "CONTACT US" HEADING; 3-COL GRID: IMAGE-WITH-DARK-OVERLAY LEFT + FULL FORM RIGHT (FIRST NAME, LAST NAME, EMAIL, PHONE, COUNTRY, STATE, CITY, DATE, CONCERN TYPE, OFFICE, DESCRIPTION + SUBMIT); FOOTER.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/quartiere).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
