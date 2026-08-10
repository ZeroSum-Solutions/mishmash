---
name: lexington-alfred
description: |
  Alfred is a pixel-faithful static clone of the Alfred premium Astro template by Lexington Themes, reproduced as plain HTML, CSS, and vanilla JavaScript with no build step required. It is a ten-page light-mode SaaS landing site for a fictional business productivity platform, covering a hero section with a dashboard screenshot and scrolling logo marquee, a blue collaboration section, a rose calendar feature section, a six-cell bento grid showcasing product tools, a four-tab feature showcase with a glass background image, a CTA section, a two-plan pricing page with FAQ accordion, an about page with CEO photo and quote overlay, a customers page with six colored brand cards, a changelog, a twenty-integration grid with fuzzy search modal, a help center, a ten-post blog grid, and sign-in and book-a-demo forms. The design uses Inter Variable for all text, an oklch white-and-gray palette with soft accent colors (blue, rose, green, teal, purple, yellow), square corners throughout, and a CSS marquee animation for scrolling logo strips. Nav dropdowns, flyout sub-menus, and the mobile hamburger are wired in vanilla JS; shared nav and footer are injected via a shared.js component pattern requiring no build step.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "alfred"
  - "saas"
  - "productivity"
  - "platform"
  - "landing"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/alfred"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Alfred — SaaS Productivity Platform Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Alfred — SaaS Productivity Platform Landing Page

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Alfred is a pixel-faithful static clone of the Alfred premium Astro template by Lexington Themes, reproduced as plain HTML, CSS, and vanilla JavaScript with no build step required. It is a ten-page light-mode SaaS landing site for a fictional business productivity platform, covering a hero section with a dashboard screenshot and scrolling logo marquee, a blue collaboration section, a rose calendar feature section, a six-cell bento grid showcasing product tools, a four-tab feature showcase with a glass background image, a CTA section, a two-plan pricing page with FAQ accordion, an about page with CEO photo and quote overlay, a customers page with six colored brand cards, a changelog, a twenty-integration grid with fuzzy search modal, a help center, a ten-post blog grid, and sign-in and book-a-demo forms. The design uses Inter Variable for all text, an oklch white-and-gray palette with soft accent colors (blue, rose, green, teal, purple, yellow), square corners throughout, and a CSS marquee animation for scrolling logo strips. Nav dropdowns, flyout sub-menus, and the mobile hamburger are wired in vanilla JS; shared nav and footer are injected via a shared.js component pattern requiring no build step.

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
<artifact identifier="lexington-alfred" type="text/html" title="Alfred — SaaS Productivity Platform Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE ALFRED TEMPLATE FROM LEXINGTON THEMES. THIS IS A SAAS LANDING PAGE TEMPLATE BUILT WITH ASTRO AND TAILWIND CSS, CLONED AS PLAIN HTML + CSS + VANILLA JS.
> REFERENCE: `https://lexingtonthemes.com/viewports/alfred`

## SUMMARY

ALFRED IS A SAAS BUSINESS PLATFORM LANDING PAGE TEMPLATE BY LEXINGTON THEMES (MICHAEL ANDREUZZA). THE ACTUAL TEMPLATE IS HOSTED AT `HTTPS://ALFRED-ASTRO.PAGES.DEV`. IT IS A MULTI-PAGE SITE FEATURING A MARKETING/LANDING HOME PAGE, PRICING, ABOUT, CUSTOMERS, CHANGELOG, INTEGRATIONS, HELP CENTER, BLOG, SIGN-IN FORM, AND BOOK-DEMO FORM PAGES. THE DESIGN IS CLEAN, WHITE-DOMINANT, WITH COLORFUL ACCENT SECTIONS (BLUE, ROSE, GREEN, TEAL, PURPLE, YELLOW). THE NAV IS FIXED AND FLOATS WITH A WHITE OUTLINED BOX. INTERACTIVE ELEMENTS INCLUDE DROPDOWN NAVIGATION MENUS WITH FLYOUT SUBMENUS, TAB-SWITCHER FEATURE SECTIONS, AND MARQUEE LOGO ANIMATIONS.

## STYLE

### PALETTE

- BACKGROUND: `#FFFFFF` (WHITE)
- BASE-50: `OKLCH(98.5% 0 0)` (NEAR WHITE)
- BASE-100: `OKLCH(96.7% .001 286.375)`
- BASE-200: `OKLCH(92% .004 286.32)` (BORDERS / DIVIDERS)
- BASE-500: `OKLCH(44.6% .03 256.802)` (SECONDARY TEXT)
- BASE-600: `OKLCH(44.6% .03 256.802)` (MUTED TEXT)
- BASE-700: `OKLCH(38% .02 260)` (HOVER DARK BG)
- BASE-800: `OKLCH(22% .006 264)` (HEADINGS)
- BASE-900: `OKLCH(16% .004 265)` (DARK TEXT)
- BASE-950: `OKLCH(10% .002 268)` (NEAR BLACK)
- BLACK: `#000000`
- WHITE: `#FFFFFF`

ACCENT COLORS:
- BLUE-50: `OKLCH(96.49% .012 255.51)` / BLUE-800: `OKLCH(33.87% .085 254.36)` / BLUE-900: `OKLCH(22.79% .05 253.67)`
- ROSE-50: `OKLCH(95.73% .011 348.43)` / ROSE-800: `OKLCH(30.36% .064 350.27)` / ROSE-900: `OKLCH(20.49% .036 347.91)`
- GREEN-50: `OKLCH(95.7% .007 145.52)` / GREEN-800: `OKLCH(37.13% .034 144.85)` / GREEN-900: `OKLCH(26.5% .021 144.96)`
- TEAL-50: `OKLCH(97.12% .003 219.53)` / TEAL-100: `OKLCH(95.01% .008 207.14)` / TEAL-950: `OKLCH(33.46% .024 212.93)`
- PURPLE-50: `OKLCH(96.71% .014 304.14)` / PURPLE-400: `OKLCH(73.74% .118 298.82)` / PURPLE-900: `OKLCH(25.23% .11 292.04)`
- YELLOW-50: `OKLCH(97.14% .012 101.48)` / YELLOW-900: `OKLCH(24.58% .031 100)`
- RED-600: `OKLCH(57.7% .245 27.325)` (ERROR/DECLINE)
- GREEN-700: `OKLCH(46.07% .044 144.82)` (SUCCESS/GROWTH)

### FONTS

- PRIMARY: `INTERVARIABLE, SANS-SERIF` (VARIABLE WEIGHT 100-900)
- MONOSPACE: `UI-MONOSPACE, SFMONO-REGULAR, MENLO, MONACO, CONSOLAS, "LIBERATION MONO", "COURIER NEW", MONOSPACE`
- LOGO USES `FONT-MONO` CLASS (UPPERCASE, BOLD)

### TYPE SCALE

- H1: 3XL → 5XL (30PX → 48PX) — `FONT-MEDIUM`, `TRACKING-TIGHT`, `TEXT-BALANCE`
- H2: XL → 3XL (20PX → 30PX) — `FONT-MEDIUM`, `TRACKING-TIGHT`
- H3: XL → 2XL — `FONT-MEDIUM`
- BODY LG: 18PX / 20PX
- BODY BASE: 16PX
- BODY SM: 14PX
- BODY XS: 12PX

### RADII

- DEFAULT: `0PX` (SQUARE CORNERS FOR MOST ELEMENTS — INTENTIONAL DESIGN)
- `ROUNDED-MD`: 6PX
- `ROUNDED-LG`: 8PX
- `ROUNDED-XL`: 12PX
- `ROUNDED-FULL`: 9999PX (TAGS/BADGES)

### ANIMATION / EASINGS

- TRANSITION DURATION: `300MS`
- EASING: `EASE-IN-OUT` / `EASE-OUT`
- MARQUEE ANIMATION: CONTINUOUS HORIZONTAL SCROLL (`@KEYFRAMES MARQUEE`)
- DROPDOWN MENUS: OPACITY + VISIBILITY TOGGLE (0 → 1, INVISIBLE → VISIBLE)
- TAB CONTENT: FADE WITH `OPACITY-50` → `OPACITY-100` + INTERSECTION OBSERVER REVEAL

## LAYOUT & STRUCTURE

### PAGE 1: HOME (`INDEX.HTML`)

SECTIONS:
1. **HEADER/NAV**: FIXED, FULL-WIDTH, WHITE, OUTLINED. ALFRED LOGO (BLACK BG, WHITE SVG), DROPDOWN MENUS ("OVERVIEW", "COMPANY"), "NEWS" LINK, "LOG IN" BUTTON, "BUY ALFRED" CTA (BLACK).
2. **HERO**: LARGE H1 ("THE LAST BUSINESS PLATFORM YOU'LL EVER NEED"), MARQUEE LOGO STRIP, FULL-WIDTH DASHBOARD SCREENSHOT.
3. **COLLABORATION SECTION (BLUE BG)**: TEAM DASHBOARD IMAGE, 3-COLUMN FEATURE GRID.
4. **CALENDAR SECTION (ROSE BG)**: CALENDAR DASHBOARD IMAGE.
5. **TOOLS BENTO GRID**: 6-COLUMN GRID WITH ANALYTICS (TEAL), TEAMWORK (PURPLE), FILES (BLUE), SHORTCUTS (ROSE KEYBOARD VISUAL), INTEGRATIONS (YELLOW LOGO GRID).
6. **FEATURES TAB SECTION (GREEN BG)**: 4 TABBED FEATURES — INTEGRATIONS PREVIEW, CALENDAR PREVIEW, ANALYTICS CHART, KANBAN BOARD PREVIEW.
7. **CTA SECTION**: GLASS BACKGROUND IMAGE, HEADLINE, MARQUEE, "BOOK A DEMO" BUTTON.
8. **FOOTER**: 4-COLUMN NAV LINKS, NEWSLETTER SIGNUP FORM.

### PAGE 2: PRICING (`PRICING.HTML`)

SECTIONS:
1. SHARED HEADER/NAV
2. HERO: "PICK A PLAN, FREELOADERS WELCOME"
3. PRICING CARDS (2-COLUMN): TEAM ($49/M) AND ENTERPRISE (CUSTOM) — EACH WITH FEATURE LIST AND CTA BUTTON
4. FAQ SECTION (ACCORDION OR STATIC)
5. SHARED FOOTER

### PAGE 3: ABOUT (`ABOUT.HTML`)

SECTIONS:
1. SHARED HEADER/NAV
2. ABOUT HERO + COMPANY INFO
3. TEAM / VALUES SECTION
4. SHARED FOOTER

### PAGE 4: CUSTOMERS (`CUSTOMERS.HTML`)

SECTIONS:
1. SHARED HEADER/NAV
2. CUSTOMER STORIES / TESTIMONIALS
3. SHARED FOOTER

### PAGE 5: CHANGELOG (`CHANGELOG.HTML`)

SECTIONS:
1. SHARED HEADER/NAV
2. VERSION HISTORY ENTRIES
3. SHARED FOOTER

### PAGE 6: INTEGRATIONS (`INTEGRATIONS.HTML`)

SECTIONS:
1. SHARED HEADER/NAV
2. INTEGRATION CARDS GRID (BRAND LOGOS)
3. SHARED FOOTER

### PAGE 7: HELP CENTER (`HELPCENTER.HTML`)

SECTIONS:
1. SHARED HEADER/NAV
2. FAQ / HELP CATEGORIES
3. SHARED FOOTER

### PAGE 8: BLOG (`BLOG.HTML`)

SECTIONS:
1. SHARED HEADER/NAV
2. BLOG POST LIST / CARDS
3. SHARED FOOTER

### PAGE 9: SIGN IN (`SIGNIN.HTML`)

SECTIONS:
1. SHARED HEADER/NAV
2. SIGN-IN FORM (EMAIL + PASSWORD)
3. SHARED FOOTER

### PAGE 10: BOOK DEMO (`BOOKDEMO.HTML`)

SECTIONS:
1. SHARED HEADER/NAV
2. BOOK A DEMO FORM
3. SHARED FOOTER

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/alfred).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
