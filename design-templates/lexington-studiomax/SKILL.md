---
name: lexington-studiomax
description: |
  Studiomax is a static reproduction of the current Lexington Themes agency design. It includes all 44 valid discoverable routes as plain HTML, CSS, and JavaScript with no build step.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "studiomax agency template"
  - "studiomax"
  - "agency"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/studiomax"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "site-theme"
  scenario: "marketing"
  example_prompt: "Build Studiomax Agency Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Studiomax Agency Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Studiomax is a static reproduction of the current Lexington Themes agency design. It includes all 44 valid discoverable routes as plain HTML, CSS, and JavaScript with no build step.

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
<artifact identifier="lexington-studiomax" type="text/html" title="Studiomax Agency Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE STUDIOMAX TEMPLATE BY LEXINGTON THEMES. BUILT AS PLAIN HTML, CSS, AND VANILLA JAVASCRIPT WITH NO BUILD STEP REQUIRED. ALL ASSETS ARE VENDORED LOCALLY.

REFERENCE: `https://lexingtonthemes.com/viewports/studiomax`

## SUMMARY

STUDIOMAX IS A DARK-THEMED DESIGN AGENCY PORTFOLIO TEMPLATE. IT FEATURES A DISTINCTIVE MONOCHROMATIC BLACK DESIGN WITH FINE BORDER LINES, GEOMETRIC BACKGROUND PATTERNS (DIAGONAL STRIPES AND DIAMONDS), AND A CLEAN TYPOGRAPHIC HIERARCHY USING INTER (SANS-SERIF) AND JETBRAINS MONO (MONOSPACE) FONTS. THE TEMPLATE PRESENTS A FULL-FEATURED AGENCY WEBSITE WITH PORTFOLIO, SERVICES, TEAM, BLOG, AND CONTACT SECTIONS.

## STYLE

### PALETTE
- BACKGROUND (OUTER): `#000000` (PURE BLACK)
- BACKGROUND (CONTENT WRAPPER): `OKLCH(0.145 0 0)` (~#1A1A1A) — BASE-950
- BORDER COLOR: `OKLCH(0.205 0 0)` (~#282828) — BASE-900
- TEXT PRIMARY: `#FFFFFF` (WHITE)
- TEXT SECONDARY: `OKLCH(0.6 0.011 264)` — BASE-400 (MUTED GRAY-BLUE)
- TEXT MUTED: `OKLCH(0.512 0.011 264)` — BASE-500
- ACCENT: `OKLCH(0.5 0.175 264)` — ACCENT-600 (BLUE-PURPLE)
- ACCENT DARK: `OKLCH(0.45 0.175 264)` — ACCENT-700

### FONTS
- SANS: INTERVARIABLE (FROM RSMS.ME/INTER), SANS-SERIF
- MONO: JETBRAINS MONO (FROM FONTSHARE), MONOSPACE

### TYPE SCALE
- HERO H1: 2XL / 3XL / 4XL / 12REM (RESPONSIVE) — MONO, THIN (100), UPPERCASE, TRACKING-TIGHTER
- SECTION HEADINGS (LARGE): TEXT-4XL / 7XL / 9XL / 12REM — MONO, THIN
- BODY: 16PX / 1.5 LINE-HEIGHT
- SMALL/LABELS: 14PX — BASE-400/500

### RADII
- CARDS AND CONTAINERS: 12PX (ROUNDED-XL)
- BUTTONS: 8PX (ROUNDED-LG)

### ANIMATION EASINGS
- TRANSITIONS: 200–300MS EASE-IN-OUT
- MOBILE MENU: 200MS EASE-OUT WITH SCALE + OPACITY

### BACKGROUND PATTERNS
- `.BG-STRIPES`: DIAGONAL STRIPE PATTERN ON OUTER WRAPPER
- `.BG-DIAMONDS`: DIAMOND/RHOMBUS REPEATING PATTERN FOR HERO SECTIONS

## LAYOUT & STRUCTURE

### PAGES DISCOVERED AND CLONED

1. **HOME (INDEX.HTML)**
   - NAV: LOGO + DESKTOP NAV LINKS (OVERVIEW, WORK, SERVICES, PRICING, BLOG, TEAM, BUY STUDIOMAX) + SIGN IN / SIGN UP BUTTONS + MOBILE HAMBURGER
   - HERO: FULL-VIEWPORT, DIAMOND PATTERN, CENTERED MONO UPPERCASE HEADLINE
   - SELECTED WORK: 2-COLUMN GRID WITH PROJECT THUMBNAILS
   - SERVICES (ID="SERVICES"): LISTED SERVICE CARDS (APP, BRANDING, CMS, COMMERCE, MAINTENANCE, SEO, WEB)
   - PRICING (ID="PRICING"): PRICING PLAN CARDS
   - BLOG PREVIEW: 3-COLUMN GRID OF RECENT POSTS
   - CTA: "BOOK AN INTRO CALL" SECTION WITH DIAMOND BACKGROUND
   - FOOTER: NAVIGATION LINKS + SOCIAL ICONS (X, INSTAGRAM, GITHUB, DRIBBBLE) + DESIGN SYSTEM LINKS

2. **WORK (WORK.HTML)**
   - LARGE MONOSPACE "WORK" HERO
   - 2-COLUMN PORTFOLIO GRID (6 PROJECTS)
   - FOOTER

3. **BLOG (BLOG.HTML)**
   - LARGE MONOSPACE "JOURNAL" HERO
   - TAG FILTER PILLS
   - 3-COLUMN ARTICLE GRID (6 POSTS)
   - NEWSLETTER CTA + FOOTER

4. **TEAM (TEAM.HTML)**
   - LARGE MONOSPACE "TEAM" HERO
   - 2-COLUMN TEAM MEMBER GRID (4 MEMBERS)
   - HIRING CTA WITH DIAMOND BACKGROUND
   - FOOTER

5. **CONTACT (CONTACT.HTML)**
   - CONTACT FORM (NAME, COMPANY, EMAIL, MESSAGE)
   - OFFICES GRID (STOCKHOLM, GOTHENBURG, MALMÖ, UPPSALA)
   - EMAIL CONTACTS SECTION
   - FOOTER

6. **SIGN-IN (SIGN-IN.HTML)**
   - AUTH PAGE: EMAIL + PASSWORD + REMEMBER ME + FORGOT PASSWORD
   - GOOGLE SIGN-IN + SUBMIT BUTTONS

7. **SIGN-UP (SIGN-UP.HTML)**
   - AUTH PAGE: EMAIL + TERMS CHECKBOX
   - GOOGLE SIGN-UP + SUBMIT BUTTONS

8. **WORK-DETAIL (WORK-DETAIL.HTML)**
   - INDIVIDUAL PROJECT PAGE (EARTHWISE)
   - STICKY SIDEBAR: TITLE, METADATA, TEAM CREDITS
   - 4 STACKED PROJECT IMAGES
   - RELATED WORK SECTION

9. **BLOG-POST (BLOG-POST.HTML)**
   - INDIVIDUAL ARTICLE ("SUSTAINABLE WEB DESIGN")
   - PROSE CONTENT AREA
   - NEWSLETTER CTA
   - RELATED ARTICLES (4)

10. **SERVICE-DETAIL (SERVICE-DETAIL.HTML)**
    - INDIVIDUAL SERVICE PAGE (WEB DEVELOPMENT)
    - 4-FEATURE GRID
    - PROSE CONTENT + TESTIMONIAL
    - PROJECT CTA + FOOTER

11. **SYSTEM-OVERVIEW (SYSTEM-OVERVIEW.HTML)**
    - DESIGN SYSTEM / COMPONENT LIBRARY PAGE
    - PAGE LINKS (STATIC, CONTENT COLLECTIONS)
    - COLOR SWATCHES, BUTTON VARIANTS, TYPOGRAPHY SCALE

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/studiomax).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
