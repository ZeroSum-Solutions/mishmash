---
name: lexington-profoliox
description: |
  ProFolioX is a static reproduction of the current Lexington Themes portfolio template. It combines a fixed desktop sidebar, responsive mobile navigation, Geist typography, light and dark themes, animated project cards, searchable content, and editorial portfolio layouts.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "profoliox portfolio template"
  - "profoliox"
  - "portfolio"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/profoliox"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "site-theme"
  scenario: "marketing"
  example_prompt: "Build ProFolioX Portfolio Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# ProFolioX Portfolio Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

ProFolioX is a static reproduction of the current Lexington Themes portfolio template. It combines a fixed desktop sidebar, responsive mobile navigation, Geist typography, light and dark themes, animated project cards, searchable content, and editorial portfolio layouts.

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
<artifact identifier="lexington-profoliox" type="text/html" title="ProFolioX Portfolio Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE PROFOLIOX TEMPLATE — A PORTFOLIO/FOLIO THEME WITH FIXED LEFT SIDEBAR, DARK/LIGHT MODE, AOS SCROLL ANIMATIONS, AND HOVER CARD EFFECTS.
>
> REFERENCE: `https://lexingtonthemes.com/viewports/profoliox`

## SUMMARY

PROFOLIOX IS A MINIMAL, DARK/LIGHT PORTFOLIO TEMPLATE BUILT FOR DESIGNERS AND DEVELOPERS. IT FEATURES A PERSISTENT LEFT SIDEBAR WITH STAGGERED-ENTRANCE NAVIGATION, A THEME TOGGLE WITH LOCALSTORAGE PERSISTENCE, AND AN IN-PAGE FUZZY SEARCH MODAL POWERED BY FUSE.JS. CONTENT PAGES USE AOS (ANIMATE ON SCROLL) FOR FADE-UP ENTRANCE ANIMATIONS AND HOVER CARD EFFECTS WHERE OVERLAY TEXT SLIDES UP FROM BELOW ON HOVER. THE DESIGN IS BASED ON GEIST FONT, AN OKLCH-BASED NEUTRAL PALETTE (`BASE-*`) AND AN OKLCH INDIGO/VIOLET ACCENT PALETTE (`ACCENT-*`), WITH NO DECORATIVE CHROME — CLEAN WHITESPACE AND THIN 1PX DIVIDERS DEFINE STRUCTURE.

## STYLE

- **FONTS:** GEIST (SANS), GEIST MONO (CODE/MONO)
- **PALETTE:**
  - BASE NEUTRALS (OKLCH): BASE-50 `oklch(98.5% 0 0)` → BASE-950 `oklch(14.5% 0 0)`
  - ACCENT (INDIGO/VIOLET OKLCH): ACCENT-300 `oklch(59.81% .221 277.36)`, ACCENT-400 `oklch(49.73% .283 269.85)`, ACCENT-500 `oklch(45.2% .313 264.05)`
  - LIGHT BG: `white` / DARK BG: `base-950`
- **TYPE SCALE:** TEXT-XS 0.75REM → TEXT-9XL 8REM; BODY TEXT-BASE 1REM / LINE-HEIGHT 1.5
- **RADII:** RADIUS-MD 0.375REM, RADIUS-LG 0.5REM, RADIUS-XL 0.75REM
- **ANIMATIONS:** AOS FADE-UP (DURATION 400MS DEFAULT, UP TO 3000MS); HOVER TRANSLATE-Y-12 → 0 (CARD TEXT REVEAL, 800MS EASE-IN-OUT); NAV LINK STAGGER (OPACITY+TRANSLATE-Y, 0.1S STEPS); FOOTER LINK HOVER TRANSLATE-X-1.5; THEME TOGGLE ARIA-CHECKED; SEARCH MODAL BACKDROP-BLUR

## LAYOUT & STRUCTURE

### SHARED CHROME
- **SIDEBAR (FIXED LEFT, 256PX, HIDDEN ON MOBILE):** LOGO SVG → NAV LINKS (BLOG, WORK, STORE, ABOUT, STUDIO, COURSE, SIGN IN, SIGN UP, CONTACT) → SYSTEM LINKS (OVERVIEW, LINKS, BUTTONS, COLORS, TYPOGRAPHY) → BUY LINK; FOOTER: THEME-TOGGLE BUTTON + SEARCH BUTTON
- **MOBILE HEADER (VISIBLE < LG):** HAMBURGER + LOGO; OVERLAY DRAWER MATCHING SIDEBAR
- **MAIN CONTENT AREA:** `lg:ml-64` OFFSET; `min-h-[640px] flex flex-col`; `<main class="grow">`
- **FOOTER (INSIDE MAIN AREA):** 3-COLUMN GRID (RESOURCES, CONNECT, NAVIGATION); COPYRIGHT LINE

### PAGES DISCOVERED & THEIR SECTIONS

1. **HOME (`index.html`)** — HERO (AVATAR IMAGE, TITLE, DESCRIPTION, CTA); FEATURED WORK (3-UP GRID WITH HOVER OVERLAY); PROCESS (3-STEP WITH GIANT BACKGROUND NUMBERS); LATEST BLOG POSTS (4-UP GRID); FEATURED STORE PRODUCTS (3-UP GRID)
2. **BLOG (`blog/index.html`)** — HEADING "REFLEXIONS"; 2-COLUMN GRID OF POSTS WITH HOVER OVERLAY + DATE/AUTHOR; SHOW-MORE PAGINATION; FOOTER
3. **BLOG POST (`blog/posts/[1-6].html`)** — HERO IMAGE; TITLE + DESCRIPTION; META (PUBLISHED DATE, AUTHOR, READ TIME, TAGS); PROSE CONTENT
4. **WORK (`work/index.html`)** — HEADING "ALL WORK"; 2-COLUMN GRID OF PROJECTS WITH HOVER OVERLAY + DESCRIPTION
5. **WORK DETAIL (`work/[1-6].html`)** — HERO IMAGE WITH EXTERNAL LINK BUTTON; TITLE + PROSE DESCRIPTION; PROJECT META (CLIENT, YEAR, CATEGORY, SERVICES)
6. **STORE (`store/index.html`)** — HEADING "DIGITAL PRODUCTS FOR YOUR BUSINESS"; 3-COLUMN PRODUCT GRID WITH ASPECT-8/10 IMAGES, PRICE, DESCRIPTION
7. **STORE ITEM (`store/[1-6].html`)** — PRODUCT TITLE + DESCRIPTION; BUY BUTTON; SPECIFICATIONS TABLE; IMAGE GALLERY
8. **ABOUT (`about.html`)** — INTRO PARAGRAPH + PORTRAIT IMAGE; AWARDS & HONORS LIST; CLIENTS GRID; SKILLS/TECH SECTION
9. **STUDIO (`studio.html`)** — HEADING + CTA; SERVICE CARDS (UI/UX, DEVELOPMENT, BRANDING) WITH PRICING + FEATURE LISTS; FAQ ACCORDION
10. **COURSE (`course.html`)** — HERO IMAGE; TITLE + DESCRIPTION; OVERVIEW + COURSE DETAILS SIDEBAR; MODULES LIST
11. **SIGN IN (`signin.html`)** — SIMPLE FORM (EMAIL, PASSWORD, SUBMIT)
12. **SIGN UP (`signup.html`)** — SIMPLE FORM (EMAIL, PASSWORD, CONFIRM PASSWORD, SUBMIT)
13. **CONTACT (`contact.html`)** — HEADING "GET IN TOUCH"; CONTACT FORM (NAME, LAST NAME, COMPANY, EMAIL, MESSAGE, SUBMIT)
14. **SYSTEM / OVERVIEW (`system/overview.html`)** — DESIGN SYSTEM OVERVIEW PAGE
15. **SYSTEM / LINKS (`system/links.html`)** — LINK VARIANTS
16. **SYSTEM / BUTTONS (`system/buttons.html`)** — BUTTON VARIANTS
17. **SYSTEM / COLORS (`system/colors.html`)** — COLOR PALETTE SWATCHES
18. **SYSTEM / TYPOGRAPHY (`system/typography.html`)** — TYPE SCALE SPECIMENS

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/profoliox).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
