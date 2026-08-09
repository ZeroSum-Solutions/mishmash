---
name: lexington-hirewise
description: |
  Hirewise is an 11-page job board website template based on the original Astro and Tailwind design by Lexington Themes. It covers job listings with category filters, detailed job and company pages, a candidate directory, pricing, a blog, and authentication forms. Visual highlights include a light and dark mode toggle persisted in `localStorage`, fuzzy search powered by Fuse.js, a large navigation panel with colorful category tiles, and a responsive card-based layout using Geist and a custom OKLCH color scale.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "hirewise: job board website template"
  - "hirewise"
  - "job"
  - "board"
  - "website"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/hirewise"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "site-theme"
  scenario: "marketing"
  example_prompt: "Build Hirewise: Job Board Website Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Hirewise: Job Board Website Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Hirewise is an 11-page job board website template based on the original Astro and Tailwind design by Lexington Themes. It covers job listings with category filters, detailed job and company pages, a candidate directory, pricing, a blog, and authentication forms. Visual highlights include a light and dark mode toggle persisted in `localStorage`, fuzzy search powered by Fuse.js, a large navigation panel with colorful category tiles, and a responsive card-based layout using Geist and a custom OKLCH color scale.

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
<artifact identifier="lexington-hirewise" type="text/html" title="Hirewise: Job Board Website Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> PIXEL-FAITHFUL REPRODUCTION OF THE HIREWISE JOB BOARD TEMPLATE BY LEXINGTON THEMES, RECREATED AS PLAIN HTML/CSS/JS WITH NO BUILD STEP.

REFERENCE: `https://lexingtonthemes.com/viewports/hirewise`

## SUMMARY

HIREWISE IS A PREMIUM JOB BOARD TEMPLATE BUILT WITH ASTRO AND TAILWIND CSS. THIS CLONE REPRODUCES ALL 11 PAGES AS PLAIN HTML/CSS/JS, INCLUDING: HOME (WITH HERO, FEATURED JOBS, JOBS BY CATEGORY, COMPANIES, CANDIDATES, AND NEWSLETTER SECTIONS), SIGN IN, SIGN UP, BLOG LISTING, COMPANIES DIRECTORY, CANDIDATES DIRECTORY, PRICING, JOBS LISTING, JOB DETAIL, COMPANY DETAIL, AND SUBMIT JOB FORM.

## STYLE

- FONT: GEIST, SANS-SERIF (LOADED FROM GOOGLE FONTS CDN)
- COLOR PALETTE: CUSTOM TOKENS — BLUE (#1DA8FF), ORANGE (#FA5925), GREEN (#00C172), YELLOW (#FFB112), AND A NEUTRAL BASE SCALE (BASE-50 THROUGH BASE-950) USING OKLCH
- DARK MODE: TOGGLED VIA .DARK CLASS ON HTML ELEMENT, PERSISTED IN LOCALSTORAGE WITH NO-FLASH BOOT SCRIPT
- BUTTONS: THREE VARIANTS — PRIMARY (BLUE), SECONDARY (GRAY), DARK (BASE-800); ALL WITH INSET SHADOW HIGHLIGHT AND RING BORDER
- CARDS: OUTLINED (1PX SOLID BASE-200), WHITE BACKGROUND, ROUNDED-XL, SOFT DROP SHADOW

## LAYOUT & STRUCTURE

- NAVIGATION: FULL-WIDTH LOGO + ICON BUTTONS (SEARCH, THEME TOGGLE) + TEXT BUTTONS (SIGN IN, SIGN UP) + MENU TOGGLE. MEGA-NAV SLIDES OPEN BELOW WITH QUICK LINKS (LEFT COL) AND 4 COLORFUL CATEGORY TILES (JOBS=ORANGE, COMPANIES=BLUE, CANDIDATES=YELLOW, NEWS=GREEN) IN A 2-COL GRID.
- HOME HERO: 2-COLUMN GRID — LEFT: HEADLINE + CTA + STATS GRID (2X2); RIGHT: TESTIMONIAL CARDS IN COLORED ROUNDED RECTANGLES WITH CIRCULAR AVATAR PLACEHOLDERS.
- FEATURED JOBS: 3-COL CARD GRID, EACH WITH COMPANY LOGO (COLORED DIV WITH INITIAL), JOB TITLE, TAGS, SALARY, APPLY BUTTON.
- JOBS BY CATEGORY: TABBED CATEGORY FILTER ON LEFT + JOB LIST ON RIGHT (4-COL LAYOUT).
- COMPANIES SECTION: GRID OF COMPANY CARDS WITH LOGO, NAME, JOB COUNT, DESCRIPTION.
- CANDIDATES SECTION: GRID OF CANDIDATE CARDS WITH AVATAR (COLORED CIRCLE WITH INITIALS), NAME, LOCATION, LEVEL, ROLE.
- NEWSLETTER CTA: DARK BACKGROUND SECTION WITH EMAIL INPUT + SUBSCRIBE BUTTON.
- FOOTER: 5-COL GRID WITH LOGO/TAGLINE/SOCIAL LINKS + 4 LINK COLUMNS + COPYRIGHT + THEME TOGGLE.
- ALL PAGES SHARE NAVIGATION AND FOOTER; INTERACTIVE ELEMENTS: SEARCH MODAL (FUSE.JS), CHAT BUBBLE (BOTTOM-RIGHT), THEME TOGGLE, MENU TOGGLE.

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/hirewise).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
