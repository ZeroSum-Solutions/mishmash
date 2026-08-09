---
name: lexington-flaco
description: |
  Flaco is a pixel-faithful static implementation of the Flaco template by Lexington Themes. It is a minimal personal portfolio and blog site for a fictional software engineer named Jarvis. Built with HTML, CSS, and JavaScript, it includes six pages: Home, Blog, Projects, Store, Studio, and Stack. The design features a warm neutral palette with a lime-green accent, a light and dark theme toggle persisted to `localStorage`, a Fuse.js-powered fuzzy search modal, an animated brand logo marquee, and detailed hover interactions. Fonts are Geist, Instrument Serif italic, and Geist Mono.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "flaco: minimal personal portfolio and blog template"
  - "flaco"
  - "minimal"
  - "personal"
  - "portfolio"
  - "blog"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/flaco"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "site-theme"
  scenario: "marketing"
  example_prompt: "Build Flaco: Minimal Personal Portfolio and Blog Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Flaco: Minimal Personal Portfolio and Blog Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Flaco is a pixel-faithful static implementation of the Flaco template by Lexington Themes. It is a minimal personal portfolio and blog site for a fictional software engineer named Jarvis. Built with HTML, CSS, and JavaScript, it includes six pages: Home, Blog, Projects, Store, Studio, and Stack. The design features a warm neutral palette with a lime-green accent, a light and dark theme toggle persisted to `localStorage`, a Fuse.js-powered fuzzy search modal, an animated brand logo marquee, and detailed hover interactions. Fonts are Geist, Instrument Serif italic, and Geist Mono.

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
<artifact identifier="lexington-flaco" type="text/html" title="Flaco: Minimal Personal Portfolio and Blog Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE FLACO TEMPLATE BY LEXINGTON THEMES. CLONED AS A PLAIN HTML + CSS + VANILLA-JS PROJECT WITH ALL ASSETS VENDORED LOCALLY. NO BUILD STEP REQUIRED.
> REFERENCE: `https://lexingtonthemes.com/viewports/flaco`

## SUMMARY

FLACO IS A MINIMAL, ELEGANT PERSONAL PORTFOLIO/BLOG TEMPLATE FOR SOFTWARE ENGINEERS AND DEVELOPERS. THE TEMPLATE IS BUILT WITH ASTRO AND TAILWIND CSS V4 (UTILITY-FIRST). IT FEATURES A CLEAN TYPOGRAPHIC IDENTITY, A SOFT WARM NEUTRAL PALETTE WITH A LIME-GREEN ACCENT, AND FULL LIGHT/DARK MODE SUPPORT DRIVEN BY A THEME TOGGLE AND `PREFERS-COLOR-SCHEME`. THE SITE PRESENTS "JARVIS" — A FICTIONAL SOFTWARE ENGINEER — WITH PAGES FOR HOME, BLOG, PROJECTS, STORE, STUDIO, STACK, AND A SYSTEM DESIGN OVERVIEW. NAVIGATION IS VIA A HAMBURGER MENU OVERLAY WITH STAGGERED ENTRANCE ANIMATIONS. A FUZZY SEARCH MODAL (FUSE.JS) IS ACCESSIBLE FROM A FIXED SEARCH BUTTON.

## STYLE

### PALETTE

| TOKEN | LIGHT VALUE | DARK VALUE |
|---|---|---|
| BASE-50 | oklch(98.5% 0 0) | same |
| BASE-100 | oklch(96.7% .001 286.375) | same |
| BASE-200 | oklch(92% .004 286.32) | same |
| BASE-400 | oklch(70.5% .015 286.067) | same |
| BASE-500 | oklch(55.2% .016 285.938) | same |
| BASE-600 | oklch(44.2% .017 285.786) | same |
| BASE-800 | oklch(27.4% .006 286.033) | same |
| BASE-900 | oklch(21% .006 285.885) | same |
| BASE-950 | oklch(14.1% .005 285.823) | same |
| ACCENT-50 | oklch(98.6% .031 120.757) | same |
| ACCENT-300 | oklch(89.7% .196 126.665) | same |
| ACCENT-400 | oklch(84.1% .238 128.85) | same |
| ACCENT-500 | oklch(76.8% .233 130.85) | same |
| ACCENT-600 | oklch(64.8% .2 131.684) | same |
| BODY BG (LIGHT) | var(--color-white) = #f6f6f4 | var(--color-base-950) |

### FONTS

- PRIMARY / UI: GEIST, SANS-SERIF (WEIGHTS 300–600)
- DISPLAY / HEADINGS: INSTRUMENT SERIF, SERIF (ITALIC VARIANT USED HEAVILY)
- MONO: GEIST MONO, MONOSPACE

### TYPE SCALE (TAILWIND V4 DEFAULTS)
- XS: 0.75REM | SM: 0.875REM | BASE: 1REM | LG: 1.125REM | XL: 1.25REM
- 2XL: 1.5REM | 3XL: 1.875REM | 4XL: 2.25REM | 5XL: 3REM | 6XL: 3.75REM

### RADII
- LG: 0.5REM | XL: 0.75REM | 2XL: 1REM | 3XL: 1.5REM | FULL: 9999PX

### ANIMATION & EASING
- DEFAULT TRANSITION: 0.15S CUBIC-BEZIER(0.4, 0, 0.2, 1)
- EASE-OUT: CUBIC-BEZIER(0, 0, 0.2, 1)
- EASE-IN-OUT: CUBIC-BEZIER(0.4, 0, 0.2, 1)
- MARQUEE: 12S LINEAR INFINITE (LOGO TICKER)
- DURATION-300: 0.3S | DURATION-500: 0.5S
- MENU ENTRANCE: STAGGERED PER-LINK OPACITY + TRANSLATEY(20PX → 0), 0.3S EASE-OUT, DELAY 0.1S * INDEX

### INTERACTIONS
- HOVER ON PROJECT CARDS: SHADOW-LIGHT / SHADOW-DARK ELEVATION, BUTTON SLIDES UP FROM BELOW (-MB-20 → MB-0)
- ARROW ICON IN PROJECT CARD: ROTATES -45DEG ON GROUP-HOVER
- NAV LINKS (IN MENU): UNDERLINE SWEEP VIA PSEUDO-ELEMENT SCALE-X 0→1
- THEME TOGGLE: FIXED BOTTOM-LEFT PILL BUTTON; TOGGLES .DARK ON <HTML>; PERSISTS TO LOCALSTORAGE
- SEARCH: FIXED BOTTOM-RIGHT BUTTON OPENS A MODAL WITH FUSE.JS FUZZY SEARCH
- STACK CARDS: SUBTLE ROTATION (6DEG / -12DEG) APPLIED; LOGO ROTATES -45DEG ON HOVER
- AVATAR IMAGE: SCALE-150 + ROTATE-6 ON HOVER (DURATION-300)
- NAV MENU TOGGLE: OPACITY + POINTER-EVENTS TRANSITION ON FULL-SCREEN OVERLAY; BACKDROP-BLUR-XL

## LAYOUT & STRUCTURE

### PAGES DISCOVERED & CLONED

1. **HOME (INDEX.HTML)** — HERO + MARQUEE LOGOS + PROJECTS GRID + BLOG FEATURED + STACK MARQUEE + FOOTER
2. **BLOG (BLOG/INDEX.HTML)** — PAGINATED BLOG POST LIST
3. **PROJECTS (PROJECTS/INDEX.HTML)** — GRID OF ALL PROJECTS
4. **STORE (STORE/INDEX.HTML)** — PRODUCTS/DIGITAL GOODS LISTING
5. **STUDIO (STUDIO/INDEX.HTML)** — SERVICES / HIRE ME PAGE
6. **STACK (STACK/INDEX.HTML)** — FULL TECH STACK LISTING

### SHARED CHROME

- **HEADER/NAV**: LOGO (ITALIC "JARVIS" IN INSTRUMENT SERIF), TWO INLINE NAV LINKS (OVERVIEW, BUY FLACO), HAMBURGER MENU BUTTON → FULL-SCREEN OVERLAY MENU
- **FOOTER**: CENTERED LOGO ICON + COPYRIGHT + SOCIAL ICONS (X, YOUTUBE, GITHUB)
- **FIXED BUTTONS**: THEME TOGGLE (BOTTOM-LEFT) + SEARCH (BOTTOM-RIGHT)
- **SEARCH MODAL**: FUSE.JS POWERED FUZZY SEARCH OVER BLOG POSTS

### HOME PAGE SECTIONS
1. HERO: "HIRE ME 2 SPOTS OPEN" LINK, H1 "HI, I'M JARVIS" WITH AVATAR, TAGLINE, CTA
2. BRAND MARQUEE: SCROLLING LOGOS ROW WITH FADE MASKS
3. PROJECTS: ITALIC HEADING + "SEE THEM ALL" LINK + 2-COL GRID OF PROJECT CARDS
4. BLOG: ITALIC HEADING + "READ ALL MY BLOG POSTS" LINK + FEATURED ARTICLE CARD (LEFT: META + TITLE + DESC + CTA; RIGHT: IMAGE)
5. STACK PREVIEW: ITALIC HEADING + "CHECK OUT MY WHOLE STACK" LINK + HORIZONTAL SCROLLING CARDS WITH ROTATIONS

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/flaco).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
