---
name: lexington-flabbergasted
description: |
  Flabbergasted is a pixel-faithful static clone of the Flabbergasted premium Astro template by Lexington Themes, reproduced as plain HTML, CSS, and vanilla JavaScript with no build step required. It is a single-page dark-mode SaaS landing page for a fictional AI voice platform, covering a hero with an AI chat widget, a scrolling logo marquee, a four-column feature grid, a voice-cloning demo section with Web Audio API pitch shift, a two-column CTA split, a six-card brainwaves feature grid, an integration showcase with hover colorize effect, a five-tier pricing table with monthly/annual toggle, a full feature-comparison table, a testimonials carousel powered by Keen Slider, and a structured footer. The design uses Inter Variable for body text, InterDisplay for headings, Geist Mono for labels, a near-black oklch color palette, named mesh gradients (meshLightBlue, meshRainbow, meshPurple, meshYellow, meshMagenta, meshGreen), and repeating vertical/horizontal stripe pattern backgrounds. Built for SaaS products, AI platforms, and dev tools looking for a sharp, content-dense dark landing page.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "flabbergasted: dark saas voice platform landing page"
  - "flabbergasted"
  - "dark"
  - "saas"
  - "voice"
  - "platform"
  - "landing"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/flabbergasted"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Flabbergasted: Dark SaaS Voice Platform Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Flabbergasted: Dark SaaS Voice Platform Landing Page

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Flabbergasted is a pixel-faithful static clone of the Flabbergasted premium Astro template by Lexington Themes, reproduced as plain HTML, CSS, and vanilla JavaScript with no build step required. It is a single-page dark-mode SaaS landing page for a fictional AI voice platform, covering a hero with an AI chat widget, a scrolling logo marquee, a four-column feature grid, a voice-cloning demo section with Web Audio API pitch shift, a two-column CTA split, a six-card brainwaves feature grid, an integration showcase with hover colorize effect, a five-tier pricing table with monthly/annual toggle, a full feature-comparison table, a testimonials carousel powered by Keen Slider, and a structured footer. The design uses Inter Variable for body text, InterDisplay for headings, Geist Mono for labels, a near-black oklch color palette, named mesh gradients (meshLightBlue, meshRainbow, meshPurple, meshYellow, meshMagenta, meshGreen), and repeating vertical/horizontal stripe pattern backgrounds. Built for SaaS products, AI platforms, and dev tools looking for a sharp, content-dense dark landing page.

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
<artifact identifier="lexington-flabbergasted" type="text/html" title="Flabbergasted: Dark SaaS Voice Platform Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE FLABBERGASTED TEMPLATE BY LEXINGTON THEMES — A DARK-THEMED SAAS LANDING PAGE BUILT FOR AN AI VOICE PLATFORM, FEATURING MESH GRADIENT BACKGROUNDS, SCROLLING LOGO MARQUEE, FEATURE GRIDS, VOICE CLONING DEMO, PRICING TABLE WITH MONTHLY/ANNUAL TOGGLE, FEATURE COMPARISON TABLE, CUSTOMER TESTIMONIAL SLIDER, AND A FULL FOOTER. REBUILT AS PLAIN HTML + CSS + VANILLA JS WITH NO BUILD STEP REQUIRED. REFERENCE: `https://lexingtonthemes.com/viewports/flabbergasted`

## DESIGN OVERVIEW

- **THEME:** PURE DARK — NEAR-BLACK BACKGROUND (`#0A0A0A` / `oklch(0.145 0 0)`), DARK CARDS (`oklch(0.205 0 0)`), AND SUBTLE BORDERS (`oklch(0.269 0 0)`)
- **FONTS:** INTER VARIABLE FOR BODY TEXT; INTER DISPLAY FOR HEADINGS (USED VIA `font-display` CLASS); GEIST MONO FOR MONOSPACE LABELS
- **ACCENT COLORS:** PURPLE/VIOLET ACCENT SCALE (`--color-accent-*`), PLUS NAMED MESH GRADIENTS: `meshLightBlue`, `meshRainbow`, `meshPurple`, `meshYellow`, `meshMagenta`, `meshGreen`
- **PATTERN BACKGROUNDS:** REPEATING VERTICAL AND HORIZONTAL STRIPE PATTERNS USING CSS `repeating-linear-gradient` IN DARK, ACCENT, AND LIGHT VARIANTS
- **LAYOUT:** MAX-WIDTH `72rem` (6XL) CONTENT CONTAINER WITH `xl:border-x` SIDE BORDERS; FULL-WIDTH DARK NAV FIXED AT TOP

## SECTIONS (HOME PAGE — `index.html`)

1. **NAV** — FIXED TOP BAR, LOGO + WORDMARK LEFT, NAV LINKS (OVERVIEW, BLOG, BUY), CTA BUTTON RIGHT; MOBILE HAMBURGER MENU SLIDES IN AS FULLSCREEN OVERLAY
2. **HERO** — CENTERED HEADLINE (`h1`), SUBTEXT, TWO CTA BUTTONS (`GET STARTED` IN MESH LIGHT BLUE, `READ THE DOCS` IN DARK), FLOATING TEXT AREA WITH SUGGESTION BUTTONS BELOW AND A SOFT WHITE BLUR GLOW BEHIND IT
3. **LOGO MARQUEE** — INFINITE SCROLLING BANNER OF 12 BRAND LOGOS (INVERTED TO WHITE), VERTICAL STRIPE PATTERN BACKGROUND
4. **FEATURES (4-COL)** — SECTION HEADING + BODY, 4 EQUAL COLUMNS EACH WITH A COLORED PATTERN SWATCH ON TOP AND TEXT BELOW (`base-900` BG)
5. **VOICE CLONING** — LEFT-ALIGNED HEADING, THREE VOICE MODES (NORMAL, CHIPMUNK, DEEP) EACH WITH A PLAY BUTTON THAT USES WEB AUDIO API PITCH SHIFT
6. **TWO-COLUMN CTA** — 2-COLUMN GRID WITH COLORFUL PATTERN BACKGROUNDS (ACCENT VERTICAL STRIPES, MESH MAGENTA), HEADINGS AND BODY COPY
7. **BRAINWAVES FEATURES (6-COL)** — SECTION HEADING + CTA, THEN 6 FEATURE CARDS IN A 3-COL GRID, EACH WITH A COLORED SWATCH ON THE BOTTOM
8. **INTEGRATIONS** — 2-COL GRID: LEFT WITH HEADING + "SEE ALL INTEGRATIONS" BUTTON, RIGHT WITH 3x2 GRID OF INTEGRATION LOGOS (GRAYSCALE ON HOVER → COLOR)
9. **PRICING** — MONTHLY/ANNUAL TOGGLE, 5-COLUMN PRICING CARDS (PLAY $0, SOLO $19, PRO $49, STUDIO $99, BLACKBOX CUSTOM), FULL FEATURE COMPARISON TABLE BELOW
10. **CUSTOMERS SLIDER** — TESTIMONIAL CARDS USING KEEN SLIDER; EACH CARD HAS A FULL-BLEED PORTRAIT IMAGE WITH COLORED MESH OVERLAY AND QUOTE IN FROSTED-GLASS BOTTOM HALF
11. **FOOTER** — 3-COL GRID (LOGO + TAGLINE, NAVIGATION LINKS, SOCIAL + MORE THEMES), DECORATIVE STRIPE PATTERN AT BOTTOM

## INTERACTIVE BEHAVIORS

- MOBILE MENU: HAMBURGER TOGGLES FULLSCREEN OVERLAY NAV WITH FADE + SLIDE TRANSITION
- LOGO MARQUEE: CSS `@keyframes marquee` INFINITE SCROLL ANIMATION
- VOICE PLAYER: WEB AUDIO API WITH PITCH SHIFT VIA `playbackRate = 2^(semitones/12)` (NO ACTUAL AUDIO FILE NEEDED — GRACEFULLY FAILS)
- PRICING TOGGLE: MONTHLY/ANNUAL SWITCH WITH SLIDING PILL INDICATOR; UPDATES ALL `.pricing-amount` SPANS VIA `data-monthly` / `data-annual` ATTRIBUTES
- TESTIMONIAL SLIDER: KEEN SLIDER CDN WITH PREV/NEXT BUTTONS
- CROSS-INDICATOR CORNERS: SMALL WHITE CROSSHAIR DECORATIONS AT SECTION BOUNDARIES (ABSOLUTELY POSITIONED `size-5` DIVS WITH TWO PERPENDICULAR 0.1PX LINES)

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/flabbergasted).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
