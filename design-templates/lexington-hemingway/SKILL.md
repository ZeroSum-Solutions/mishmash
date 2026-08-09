---
name: lexington-hemingway
description: |
  Hemingway is a pixel-faithful implementation of the Hemingway premium Astro template by Lexington Themes. It is a clean editorial content and podcast website built with HTML, CSS, and JavaScript. The template combines Inter and STIX Two Text, uses a carefully tuned neutral palette, and includes nine pages: Home, About, Magazine, Blog Post, Podcast, Podcast Interview, Pricing, Design System Overview, and 404. Images, supporting assets, and the Tailwind utility stylesheet are vendored locally.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "hemingway: editorial magazine and podcast website template"
  - "hemingway"
  - "editorial"
  - "magazine"
  - "podcast"
  - "website"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/hemingway"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "site-theme"
  scenario: "marketing"
  example_prompt: "Build Hemingway: Editorial Magazine and Podcast Website Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Hemingway: Editorial Magazine and Podcast Website Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Hemingway is a pixel-faithful implementation of the Hemingway premium Astro template by Lexington Themes. It is a clean editorial content and podcast website built with HTML, CSS, and JavaScript. The template combines Inter and STIX Two Text, uses a carefully tuned neutral palette, and includes nine pages: Home, About, Magazine, Blog Post, Podcast, Podcast Interview, Pricing, Design System Overview, and 404. Images, supporting assets, and the Tailwind utility stylesheet are vendored locally.

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
<artifact identifier="lexington-hemingway" type="text/html" title="Hemingway: Editorial Magazine and Podcast Website Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE HEMINGWAY TEMPLATE BY LEXINGTON THEMES — A CONTENT/MAGAZINE/PODCAST WEBSITE WITH EDITORIAL AESTHETIC.
> REFERENCE: `https://lexingtonthemes.com/viewports/hemingway`

## SUMMARY

HEMINGWAY IS A PREMIUM ASTRO TEMPLATE BY LEXINGTON THEMES DESIGNED FOR CONTENT CREATORS, PODCASTERS, AND DESIGN ENGINEERS. IT FEATURES AN EDITORIAL MAGAZINE AESTHETIC WITH CLEAN TYPOGRAPHY, A LIGHT/DARK COLOR SYSTEM, AND PAGES FOR BLOG POSTS, PODCAST INTERVIEWS, AND SUBSCRIPTION PRICING.

## STYLE

- **PALETTE:**
  - BASE-50: `oklch(98.5% 0 0)` (NEAR WHITE — MAIN BACKGROUND)
  - BASE-100: `oklch(97% 0 0)`
  - BASE-200: `oklch(92.2% 0 0)`
  - BASE-300: `oklch(87% 0 0)`
  - BASE-400: `oklch(70.8% 0 0)` (MUTED TEXT)
  - BASE-500: `oklch(55.6% 0 0)`
  - BASE-600: `oklch(43.9% 0 0)` (SECONDARY TEXT)
  - BASE-700: `oklch(37.1% 0 0)`
  - BASE-800: `oklch(26.9% 0 0)`
  - BASE-900: `oklch(20.5% 0 0)` (PRIMARY TEXT / NEAR BLACK)
  - BASE-950: `oklch(14.5% 0 0)`
  - ACCENT-500: `oklch(82.72% .146 89.45)` (WARM AMBER/GOLD)
  - BLACK: `#000`
  - WHITE: `#fff`
- **FONTS:**
  - SANS: INTER (RSMS CDN)
  - SERIF: STIX TWO TEXT (GOOGLE FONTS — USED FOR HEADINGS, EDITORIAL TEXT, LARGE DISPLAY)
  - MONO: UI-MONOSPACE / MENLO
- **TYPE SCALE:**
  - XS: 0.75REM · SM: 0.875REM · BASE: 1REM · LG: 1.125REM · XL: 1.25REM
  - 2XL: 1.5REM · 3XL: 1.875REM · 4XL: 2.25REM · 5XL: 3REM · 6XL: 3.75REM · 7XL: 4.5REM · 8XL: 6REM
- **RADII:** MD: 0.375REM · LG: 0.5REM · FULL: 9999PX (BUTTONS USE ROUNDED-FULL)
- **ANIMATION:** DEFAULT 500MS EASE-IN-OUT TRANSITIONS ON BUTTONS/LINKS
- **SPACING:** 0.25REM BASE UNIT (TAILWIND STANDARD)

## LAYOUT & STRUCTURE

### PAGES DISCOVERED

1. **HOME (`index.html`)** — HERO SECTION WITH LARGE SERIF HEADLINE, POPULAR BLOG POSTS GRID (4-COL), INTERVIEWS SECTION, PODCAST SECTION WITH NEWSLETTER SIGNUP CTA AT BOTTOM
2. **ABOUT (`about.html`)** — 2-COL LAYOUT WITH EDITORIAL TEXT ON LEFT, GRAYSCALE IMAGE GRID ON RIGHT
3. **BLOG (`blog.html`)** — SERIF ITALIC HEADING, 2-COL ARTICLE GRID WITH SQUARE IMAGES, PAGINATION
4. **BLOG POST (`blog-post.html`)** — STICKY LARGE TITLE, IMAGE, AUTHOR BIO, SUBSCRIBER-ONLY CONTENT GATE, NEXT/PREV NAVIGATION
5. **OVERVIEW (`overview.html`)** — DESIGN SYSTEM PAGE LISTING ALL TEMPLATE PAGES AND COMPONENTS
6. **PODCAST (`podcast.html`)** — FULL-WIDTH PODCAST EPISODE LIST WITH DUAL IMAGES PER EPISODE
7. **PODCAST INTERVIEW (`podcast-interview.html`)** — HERO IMAGE, EPISODE TITLE, SUBSCRIBER GATE, AUDIO PLAYER (FOR SUBSCRIBERS)
8. **PRICING (`pricing.html`)** — 4-COL PRICING GRID WITH 4 TIERS: LISTENER ($8), ENGAGER ($20), EDITOR ($40), PUBLISHER ($100/YR), PLUS FAQ
9. **404 (`404.html`)** — CENTERED LARGE SERIF "404" WITH BACK HOME BUTTON

### SHARED CHROME

- **NAV:** 3-COL GRID — LOGO SVG (LEFT) · NAV LINKS (CENTER) · BUY BUTTON (RIGHT) — STICKY Z-10
- **FOOTER:** BLACK BACKGROUND WITH WHITE LOGO SVG, NEWSLETTER EMAIL FORM, 4-COL LINK GRID, LEGAL ROW

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/hemingway).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
