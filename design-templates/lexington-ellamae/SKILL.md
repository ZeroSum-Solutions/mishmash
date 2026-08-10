---
name: lexington-ellamae
description: |
  Ella Mae® is a 15-page operations workspace template with thick structural borders, pill-shaped controls, an animated logo marquee, native FAQ disclosures, responsive navigation, and a large footer wordmark. It is built with HTML, CSS, and JavaScript and requires no build step.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "ella mae®: saas operations workspace website template"
  - "ella"
  - "mae"
  - "saas"
  - "operations"
  - "workspace"
  - "website"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/ellamae"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "site-theme"
  scenario: "marketing"
  example_prompt: "Build Ella Mae®: SaaS Operations Workspace Website Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Ella Mae®: SaaS Operations Workspace Website Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Ella Mae® is a 15-page operations workspace template with thick structural borders, pill-shaped controls, an animated logo marquee, native FAQ disclosures, responsive navigation, and a large footer wordmark. It is built with HTML, CSS, and JavaScript and requires no build step.

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
<artifact identifier="lexington-ellamae" type="text/html" title="Ella Mae®: SaaS Operations Workspace Website Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE ELLA MAE® TEMPLATE — EVERY PAGE, THE FULL LOOK & FEEL, HOVER STATES, AND SCROLL/ENTRANCE ANIMATIONS — AS PLAIN HTML/CSS/JS WITH NO BUILD STEP REQUIRED.
>
> REFERENCE: `https://lexingtonthemes.com/viewports/ellamae`

## SUMMARY

ELLA MAE® IS A SAAS OPERATIONS WORKSPACE TEMPLATE BUILT FOR TEAMS THAT NEED TO MANAGE REQUESTS, APPROVALS, AND WORKFLOWS FROM ONE CALM DASHBOARD. THE DESIGN IS BOLD, STRUCTURED, AND HIGHLY GEOMETRIC — FEATURING THICK 8PX BORDERS, PILL-SHAPED BUTTONS, AND A STARK TWO-COLOR PALETTE ANCHORED BY DEEP NAVY AND WARM ORANGE/TERRACOTTA. THE TEMPLATE IS BUILT WITH TAILWIND CSS V4 AND USES THE INTERVARIABLE FONT. THE LIVE DEMO IS HOSTED AT `https://ellamae-astro.pages.dev/`.

## STYLE

### PALETTE

- **ACCENT (DARK NAVY/BLUE):**
  - `accent-50`: oklch(96.6% 0.008 253.85)
  - `accent-100`: oklch(93.8% 0.015 260.75)
  - `accent-200`: oklch(87.9% 0.031 258.95)
  - `accent-300`: oklch(81.4% 0.048 257.27)
  - `accent-400`: oklch(71.5% 0.078 253.68)
  - `accent-500`: oklch(62% 0.074 252.87)
  - `accent-600`: oklch(52.6% 0.062 252.19)
  - `accent-700`: oklch(43.2% 0.051 253.07)
  - `accent-800`: oklch(32.8% 0.040 253.2)
  - `accent-900`: oklch(23.1% 0.027 253.42) — **PRIMARY DARK (NEAR BLACK-BLUE)**
  - `accent-950`: oklch(18.8% 0.022 251.91)
- **SECONDARY (WARM ORANGE/TERRACOTTA):**
  - `secondary-500`: oklch(64.2% 0.156 40.9) — **PRIMARY ORANGE**
  - `secondary-900`: oklch(23.9% 0.058 41.41)
  - FULL SCALE: 50–950
- **BASE (NEUTRAL GRAYS):**
  - `base-400`–`base-900` — NEUTRAL TEXT/DIVIDER COLORS
- **WHITE**: oklch(99.1% 0.012 91.5)

### FONTS

- **PRIMARY**: `InterVariable, sans-serif` — LOADED FROM `https://rsms.me/inter/inter.css`
- **WEIGHTS**: 400 (NORMAL), 500 (MEDIUM), 600 (SEMIBOLD)

### TYPE SCALE (RESPONSIVE)

- XS: 0.75rem
- SM: 0.875rem
- BASE: 1rem
- LG: 1.125rem → XL (1.25rem)
- HEADINGS: TEXT-2XL (1.5rem) THROUGH TEXT-6XL (3.75rem) — RESPONSIVE WITH SM/MD/LG BREAKPOINTS
- TRACKING: `-0.025em` (TIGHT) ON ALL HEADINGS

### SPACING & LAYOUT

- CONTAINER: `max-w-7xl` (80rem) WITH `border-x-8 border-accent-900` — THICK VERTICAL BORDERS ON ALL SECTIONS
- GRID DIVIDERS: `divide-y-8 divide-accent-900`, `divide-x-8` — 8PX THICK BORDERS AS STRUCTURAL DIVIDERS
- PADDING: `px-8`, `py-24`, `py-32`, `py-64` — GENEROUS VERTICAL RHYTHM
- SECTION BORDERS: `border-t-8 border-accent-900` — EVERY SECTION HAS THICK TOP BORDER

### ANIMATION & INTERACTION

- **MARQUEE**: `@keyframes marquee` — 12s LINEAR INFINITE SCROLL FOR BRAND LOGOS
- **HOVER CARDS**: `hover:shadow-none hover:translate-y-1` WITH `duration-300` TRANSITION
- **BUTTONS**: `transition-all duration-500` — BACKGROUND, TEXT, AND SHADOW CHANGE ON HOVER
- **FAQ ACCORDION**: CSS `<details>/<summary>` WITH `group-open:-rotate-45 duration-300` ICON ROTATION
- **MOBILE MENU**: OPACITY/TRANSLATE TOGGLE WITH `duration-300`
- **BUTTON FOCUS**: `focus:translate-y-1` — PRESS-DOWN EFFECT
- EASING: `cubic-bezier(0.4, 0, 0.2, 1)` (ease-in-out), `cubic-bezier(0, 0, 0.2, 1)` (ease-out)

### COMPONENT TOKENS

- **BUTTONS**: ROUNDED-FULL, BORDER-2, SHADOW OFFSET IN ACCENT-900
  - SIZES: XXS (H-8), XS (H-9), SM (H-10), MD (H-14)
  - VARIANTS: DEFAULT (WHITE BG), ACCENT (ACCENT-200 BG), SECONDARY
- **CARDS**: ROUNDED-XL, SHADOW + OUTLINE, HOVER LIFT
- **SECTION STRUCTURE**: THICK 8PX BORDERS CREATING GRID/NEWSPAPER AESTHETIC

## LAYOUT & STRUCTURE

### PAGES DISCOVERED (15 TOTAL)

1. **HOME** (`index.html`) — HERO + MARQUEE LOGOS + FEATURES (2-COL GRID) + FEATURES DARK + FEATURES MINI GRID + FEATURES BENTO + FEATURES NUMBERED LIST + TESTIMONIAL + PRICING (3 TIERS) + CTA + FAQ (ACCORDION) + FOOTER
2. **SYSTEM OVERVIEW** (`system/overview/index.html`) — GRID OF ALL TEMPLATE PAGES/LINKS
3. **CHANGELOG** (`changelog/index.html`) — STICKY LEFT PANEL + CHANGELOG ARTICLE CARDS
4. **CUSTOMERS** (`customers/index.html`) — HERO + CUSTOMER CASE STUDY CARDS GRID
5. **HELP CENTER** (`helpcenter/index.html`) — HERO + HELP CATEGORY CARDS + ARTICLE LIST
6. **INTEGRATIONS** (`integrations/index.html`) — STICKY LEFT PANEL WITH CATEGORY NAV + INTEGRATION CARDS GROUPED BY CATEGORY
7. **BLOG** (`blog/index.html`) — HERO WITH SEARCH + BLOG ARTICLE CARDS GRID
8. **SYSTEM BUTTONS** (`system/buttons/index.html`) — BUTTON SHOWCASE (ALL VARIANTS, SIZES, STATES)
9. **SYSTEM COLORS** (`system/colors/index.html`) — COLOR SWATCH SHOWCASE
10. **SYSTEM TYPOGRAPHY** (`system/typography/index.html`) — TYPE SCALE SHOWCASE
11. **SYSTEM LINKS** (`system/links/index.html`) — LINK VARIANT SHOWCASE
12. **CONTACT / 404** (`contact/index.html`) — 404 PAGE (DARK BG, CENTERED)
13. **404** (`404.html`) — 404 PAGE (DARK BG, CENTERED)
14. **LOGIN** (`forms/login/index.html`) — CENTERED LOGIN FORM
15. **SIGN UP** (`forms/signup/index.html`) — CENTERED SIGN UP FORM

### SHARED CHROME

- **NAVIGATION**: FIXED TOP BAR, THICK BORDER, ORANGE/SECONDARY-500 BACKGROUND, LOGO LEFT, NAV LINKS CENTER/RIGHT, "BUY ELLAMAE" CTA BUTTON, HAMBURGER MENU FOR MOBILE
- **FOOTER**: DARK ACCENT-900 BG, NEWSLETTER SUBSCRIBE FORM, SOCIAL LINKS, NAV LINKS, LARGE "ELLAMAE" SVG WORDMARK AT BOTTOM

### HOME PAGE SECTIONS

1. HERO — LARGE CENTERED HEADING, SUBTEXT, GET STARTED CTA, DECORATIVE BLOB SVGS
2. MARQUEE LOGOS — INFINITE SCROLL BRAND LOGOS ON DARK BG
3. FEATURES SPLIT (2-COL) — FEATURE DESCRIPTION + BLOB IMAGE, 2 ROWS
4. FEATURES DARK — DARK BG, H2 + COLLAB IMAGE + 3-COL FEATURE CARDS
5. FEATURES MINI BENTO — 2-COL, 2-ROW MINI FEATURE CARDS (TEAMWIDE VISIBILITY, GUARDRAILS)
6. FEATURES OVERVIEW — DARK BG, 3-COL, 12 FEATURE ITEMS WITH NUMBERED BADGES
7. TESTIMONIAL — ROUND AVATAR IMAGE, LARGE QUOTE, ATTRIBUTION
8. PRICING — 3 TIERS: TEAM ($29), GROWTH ($69), ENTERPRISE ($99)
9. CTA — BLOB ICON, HEADING, SUBTEXT, GET STARTED BUTTON
10. FAQ — LEFT PANEL (STICKY), RIGHT PANEL (ACCORDIONS VIA `<DETAILS>`)
11. FOOTER — NEWSLETTER + SOCIAL + NAV + SVG WORDMARK

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/ellamae).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
