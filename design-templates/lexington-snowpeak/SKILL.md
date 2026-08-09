---
name: lexington-snowpeak
description: |
  Snowpeak is a static reproduction of the current Lexington Themes publication design. It includes all 107 discoverable routes as plain HTML, CSS, and JavaScript with no build step.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "snowpeak news and media template"
  - "snowpeak"
  - "news"
  - "media"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/snowpeak"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "site-theme"
  scenario: "marketing"
  example_prompt: "Build Snowpeak News and Media Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Snowpeak News and Media Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Snowpeak is a static reproduction of the current Lexington Themes publication design. It includes all 107 discoverable routes as plain HTML, CSS, and JavaScript with no build step.

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
<artifact identifier="lexington-snowpeak" type="text/html" title="Snowpeak News and Media Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE SNOWPEAK TEMPLATE BY LEXINGTON THEMES — A MODERN NEWS AND MEDIA PUBLICATION WEBSITE BUILT AS PLAIN HTML, CSS, AND VANILLA JAVASCRIPT WITH NO BUILD STEP REQUIRED. REFERENCE: `https://lexingtonthemes.com/viewports/snowpeak`

## SUMMARY

SNOWPEAK IS A NEWS AND MEDIA PUBLICATION TEMPLATE FEATURING A DISTINCTIVE FLOATING GLASSMORPHISM NAVIGATION PILL, A LARGE FULL-WIDTH LOGO HERO BLOCK, AN ANIMATED TICKER MARQUEE OF ARTICLE HEADLINES, CATEGORY-FILTERED ARTICLE GRIDS WITH TABBED NAVIGATION, A PODCAST LISTING PAGE WITH INTERACTIVE AUDIO PLAYERS, AUTH FORMS (SIGN IN / SIGN UP), A TAG/CATEGORY FILTER PAGE, AND A FULL BLOG POST DETAIL PAGE WITH SIDEBAR.

## DESIGN TOKENS

- MAIN BACKGROUND: `OKLCH(68.6% 0 0)` — MEDIUM GRAY (BASE-500)
- CARD BACKGROUNDS: `OKLCH(94% 0 0)` (NEAR-WHITE) AND `OKLCH(23.9% 0 0)` (NEAR-BLACK)
- ACCENT: `OKLCH(51.96% 0.262 286.62)` — PURPLE/VIOLET
- ORANGE: `OKLCH(77.19% 0.152 69.58)`
- PINK: `OKLCH(68.34% 0.284 330.57)`
- BODY FONT: INTERVARIABLE, SANS-SERIF (FROM RSMS.ME/INTER/INTER.CSS)
- DISPLAY FONT: "STACK SANS NOTCH", SANS-SERIF (FROM GOOGLE FONTS)
- SELECTION: BG-ORANGE-500, TEXT-BASE-900

## PAGES

1. `INDEX.HTML` — HOME PAGE WITH HERO LOGO, TICKER, FEATURED GRID, TABBED ARTICLE SECTIONS, AND FOOTER
2. `BLOG.HTML` — BLOG LISTING WITH SAME HERO, TICKER, FEATURED GRID, AND ALL POSTS GRID
3. `BLOG/POST.HTML` — ARTICLE DETAIL PAGE FOR POST #20 "ESPORTS ARE ALREADY HERE" WITH FULL PROSE AND SIDEBAR
4. `BLOG/TAG.HTML` — TAG-FILTERED VIEW FOR THE "TECH" CATEGORY
5. `PODCAST.HTML` — PODCAST LISTING WITH 10 EPISODES AND INTERACTIVE AUDIO PLAYER CONTROLS
6. `SIGN-IN.HTML` — SIGN IN FORM IN A DARK ROUNDED CARD
7. `SIGN-UP.HTML` — SIGN UP FORM WITH NAME FIELD AND ORANGE SUBMIT BUTTON

## KEY FEATURES

- FIXED FLOATING NAV PILL WITH GLASSMORPHISM BACKDROP-FILTER BLUR
- PLUS (+) TOGGLE OPENS DROPDOWN MENU WITH COLOR-CODED LINKS
- SEARCH BUTTON OPENS A FULL-SCREEN MODAL WITH LIVE FILTERING
- ANIMATED MARQUEE TICKER (90S LOOP, PAUSES ON HOVER) WITH ARTICLE HEADLINE PILLS
- LARGE SVG WORDMARK LOGO BLOCK (SHOWN ON HOME, BLOG LISTING, AND PODCAST; HIDDEN ON POST/AUTH PAGES)
- ARTICLE CARDS: CATEGORY TAG, DATE, UPPERCASE DISPLAY-FONT TITLE, AUTHOR, ARROW BUTTON (ROUNDED-XL → PILL ON HOVER)
- TABBED ARTICLE SECTIONS: TOP STORIES | BUSINESS | FINANCE | TECH | HEALTH | SPORTS
- PODCAST PLAYER WITH SIMULATED PLAY/PAUSE AND SEEK CONTROLS
- FOOTER WITH 4-COLUMN GRID: SUBSCRIBE BOX, NAVIGATION, CATEGORIES, SOCIAL LINKS
- FULLY RESPONSIVE USING CSS GRID AND FLEXBOX

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/snowpeak).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
