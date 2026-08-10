---
name: lexington-streamer
description: |
  Streamer is a static reproduction of the current Lexington Themes music and media design. It includes all 103 discoverable routes as plain HTML, CSS, and JavaScript with no build step.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "streamer music and media template"
  - "streamer"
  - "music"
  - "media"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/streamer"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "site-theme"
  scenario: "marketing"
  example_prompt: "Build Streamer Music and Media Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Streamer Music and Media Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Streamer is a static reproduction of the current Lexington Themes music and media design. It includes all 103 discoverable routes as plain HTML, CSS, and JavaScript with no build step.

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
<artifact identifier="lexington-streamer" type="text/html" title="Streamer Music and Media Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE STREAMER TEMPLATE BY LEXINGTON THEMES — A MUSIC AND INDIE MEDIA PLATFORM FEATURING BLOG, PODCAST, JOBS, AND MORE.
> REFERENCE: `https://lexingtonthemes.com/viewports/streamer`

## SUMMARY

STREAMER IS A MUSIC AND INDIE MEDIA PLATFORM TEMPLATE BY LEXINGTON THEMES. IT FEATURES A DARK-HEADER STICKY NAVIGATION, A CREAM/LIGHT BODY, ORANGE ACCENT COLORS, AND CONTENT SECTIONS FOR BLOG POSTS, PODCAST EPISODES, JOBS, AUTHORS, PRICING PLANS, AND A DESIGN SYSTEM OVERVIEW. THE TEMPLATE USES INTER FONT, KEEN-SLIDER FOR CAROUSELS, AND FUSE.JS FOR CLIENT-SIDE SEARCH.

## STYLE

- FONT: INTER, SANS-SERIF (FROM RSMS.ME/INTER/INTER.CSS)
- COLOR PALETTE:
  - BASE-900: #0d0d0d (NEAR BLACK, USED FOR NAV BG, CARDS)
  - BASE-300: #f5f0e8 (CREAM/OFF-WHITE, BODY BG)
  - BASE-200: #e8e2d9
  - BASE-100: #d9d2c7
  - ACCENT-500: OKLCH(70.5% .213 47.604) (ORANGE/AMBER ACCENT)
  - TEXT-BASE-300: CREAM TEXT ON DARK BG
- TYPE SCALE: TAILWIND V4 BASED (XS=0.75REM, SM=0.875REM, BASE=1REM, LG=1.125REM, XL=1.25REM, 2XL=1.5REM, 3XL=1.875REM, 4XL=2.25REM, 5XL=3REM)
- BORDER RADIUS: NONE (SQUARE CORNERS THROUGHOUT)
- ANIMATIONS: DURATION-300 TRANSITIONS, HOVER:BLUR-XS ON NAV ITEMS, GROUP-OPEN:-ROTATE-45 ON MENU ICON

## LAYOUT & STRUCTURE

### PAGES

1. HOME (INDEX.HTML): HERO WITH TICKER BAR, FEATURED BLOG/PODCAST CARDS, KEEN-SLIDER CAROUSEL
2. BLOG (BLOG.HTML): BLOG LISTING WITH TAB CATEGORY FILTERING (ALL, MUSIC, EUROPE, INDUSTRY, VENUES, FINANCE, BUSINESS, WELLNESS, TECH, NEWS, SUSTAINABILITY)
3. PODCAST (PODCAST.HTML): PODCAST EPISODE LISTING WITH KEEN-SLIDER CAROUSEL
4. JOBS (JOBS.HTML): JOB LISTINGS PAGE
5. ABOUT (ABOUT.HTML): ABOUT PAGE WITH TEAM INFO
6. PRICING-ADVERTISE (PRICING-ADVERTISE.HTML): ADVERTISING PRICING TIERS
7. PRICING-MEMBERSHIP (PRICING-MEMBERSHIP.HTML): MEMBERSHIP PRICING TIERS
8. AUTHORS (AUTHORS.HTML): AUTHORS LISTING PAGE
9. BLOG-POST (BLOG-POST.HTML): INDIVIDUAL BLOG POST DETAIL PAGE
10. PODCAST-EPISODE (PODCAST-EPISODE.HTML): INDIVIDUAL PODCAST EPISODE PAGE
11. SYSTEM-OVERVIEW (SYSTEM-OVERVIEW.HTML): DESIGN SYSTEM OVERVIEW
12. SYSTEM-COLORS (SYSTEM-COLORS.HTML): COLOR PALETTE SYSTEM PAGE
13. SYSTEM-BUTTONS (SYSTEM-BUTTONS.HTML): BUTTON COMPONENT SYSTEM
14. SYSTEM-TYPOGRAPHY (SYSTEM-TYPOGRAPHY.HTML): TYPOGRAPHY SYSTEM

### SHARED CHROME

- NAVIGATION: STICKY TOP DARK BAR (BG-BASE-900), LOGO LEFT, SEARCH ICON + PLUS/CLOSE DROPDOWN MENU RIGHT
- DROPDOWN MENU: FULL-WIDTH PANEL WITH LARGE TYPOGRAPHY LINKS (BLUR HOVER EFFECT)
- SEARCH MODAL: FULL-SCREEN OVERLAY WITH FUSE.JS SEARCH, ORANGE INPUT BACKGROUND
- TICKER BAR: SCROLLING NEWS TICKER (HOME PAGE ONLY)
- FOOTER: DARK BG WITH LINKS AND SOCIAL ICONS

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/streamer).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
