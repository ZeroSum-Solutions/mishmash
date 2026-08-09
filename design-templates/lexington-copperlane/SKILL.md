---
name: lexington-copperlane
description: |
  Copperlane is a 22-page business template for an automotive service center. Its design combines Stack Sans Notch display type, Inter body copy, dark navigation, high-contrast imagery, and bright yellow accents. The template includes service and package details, customer stories, appointment and contact forms, responsive navigation, search, FAQ disclosures, and video backgrounds.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "copperlane: automotive services website template"
  - "copperlane"
  - "automotive"
  - "services"
  - "website"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/copperlane"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "site-theme"
  scenario: "marketing"
  example_prompt: "Build Copperlane: Automotive Services Website Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Copperlane: Automotive Services Website Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Copperlane is a 22-page business template for an automotive service center. Its design combines Stack Sans Notch display type, Inter body copy, dark navigation, high-contrast imagery, and bright yellow accents. The template includes service and package details, customer stories, appointment and contact forms, responsive navigation, search, FAQ disclosures, and video backgrounds.

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
<artifact identifier="lexington-copperlane" type="text/html" title="Copperlane: Automotive Services Website Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> THIS IS A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE COPPERLANE TEMPLATE BY LEXINGTON THEMES — AN AUTO DETAILING AND CAR SERVICES BUSINESS WEBSITE. EVERY PAGE, SECTION, HOVER STATE, AND SCROLL ANIMATION IS REPRODUCED AS PLAIN HTML/CSS/JS WITH VENDORED ASSETS. NO BUILD STEP REQUIRED.
>
> REFERENCE: `https://lexingtonthemes.com/viewports/copperlane`

## SUMMARY

COPPERLANE IS A PREMIUM ASTRO/TAILWIND CSS TEMPLATE FOR AUTO DETAILING AND CAR SERVICE BUSINESSES. IT FEATURES A DARK-THEMED STICKY NAVIGATION WITH A MEGA MENU, ACCENT YELLOW/GOLD COLORS, "STACK SANS NOTCH" DISPLAY FONT WITH "INTER" BODY FONT, AND A COMPREHENSIVE MULTI-PAGE SITE STRUCTURE COVERING SERVICES, PACKAGES, CUSTOMER STORIES, BLOG, TEAM, JOBS, AND MORE.

## STYLE

- **PALETTE:**
  - ACCENT (GOLDEN/YELLOW): OKLCH 98%–20.5% SCALE (accent-50 THROUGH accent-950)
    - PRIMARY CTA: accent-300 `oklch(89.2% .166 106.44)` / HOVER: accent-400 `oklch(85.7% .159 106.15)`
    - LINK HOVER: accent-600 `oklch(68.7% .128 106.72)`
  - BASE (COOL GREY/SLATE): OKLCH 98.5%–13% SCALE (base-50 THROUGH base-950)
    - NAV BG: base-900/60 (DARK, TRANSLUCENT)
    - BODY BG: WHITE / base-50
    - TEXT: base-900 (NEAR-BLACK), base-600 (MID GREY), base-500 (LIGHTER GREY)
  - BLACK: #000 / WHITE: #FFF
- **FONTS:**
  - DISPLAY: "STACK SANS NOTCH", SERIF — HEADINGS, LOGO, SECTION TITLES (UPPERCASE)
  - BODY: "INTER", SANS-SERIF — ALL BODY TEXT, LABELS, BUTTONS
- **TYPE SCALE:** XS (0.75REM) → 9XL (8REM), LINE-HEIGHT VARIES
- **RADII:** MD (0.375REM), LG (0.5REM), XL (0.75REM), 3XL (1.5REM)
- **ANIMATION EASINGS:** CUBIC-BEZIER(0.4, 0, 0.2, 1) — EASE-IN-OUT; DURATION 150MS–500MS
- **SHADOWS:** SHADOW-XL ON NAV, SHADOW-2XL ON MEGA MENU
- **BACKDROP:** BACKDROP-BLUR-XL ON STICKY NAV

## LAYOUT & STRUCTURE

### PAGES DISCOVERED AND CLONED

1. **HOME** (`index.html`) — HERO WITH DARK FULL-SCREEN BG + CAR IMAGE, SERVICE CARDS GRID, PACKAGES PREVIEW, CUSTOMER TESTIMONIAL, BLOG PREVIEW, CTA SECTION
2. **SERVICES** (`services.html`) — SERVICES LIST PAGE WITH CATEGORY FILTERS, SERVICE CARDS WITH IMAGES
3. **PACKAGES** (`packages.html`) — SERVICE PACKAGES GRID WITH PRICING AND DETAILS
4. **CUSTOMERS** (`customers.html`) — CUSTOMER SUCCESS STORIES GRID WITH PHOTOS
5. **ABOUT** (`about.html`) — COMPANY STORY, MISSION, VALUES SECTIONS
6. **FAQ** (`faq.html`) — ACCORDION-STYLE FAQ SECTIONS
7. **SYSTEM OVERVIEW** (`system/overview.html`) — DESIGN SYSTEM OVERVIEW PAGE
8. **SERVICE PACKAGES** (`service-packages.html`) — DETAILED SERVICE PACKAGES LISTING
9. **PRICING** (`pricing.html`) — TRANSPARENT PRICING TABLES
10. **HELP CENTER** (`help-center.html`) — SEARCHABLE HELP ARTICLES
11. **BLOG** (`blog.html`) — BLOG ARTICLE LISTING WITH IMAGES
12. **TEAM** (`team.html`) — TEAM MEMBER PROFILES GRID
13. **JOBS** (`jobs.html`) — OPEN POSITIONS LISTING
14. **BOOK APPOINTMENT** (`book-appointment.html`) — BOOKING FORM PAGE
15. **CONTACT** (`contact.html`) — CONTACT FORM WITH MAP/INFO
16. **SERVICE DETAIL: ENGINE DIAGNOSTICS** (`services/engine-diagnostics.html`) — INDIVIDUAL SERVICE DETAIL
17. **SERVICE DETAIL: FULL DETAILING** (`services/full-detailing.html`) — INDIVIDUAL SERVICE DETAIL
18. **PACKAGE DETAIL: PERFORMANCE TUNE-UP** (`packages/performance-tune-up.html`) — PACKAGE DETAIL PAGE
19. **PACKAGE DETAIL: WINTER SAFETY PACKAGE** (`packages/winter-safety-package.html`) — PACKAGE DETAIL PAGE
20. **CUSTOMER STORY: ANTHONY SMITH** (`customers/anthony-smith.html`) — INDIVIDUAL CUSTOMER STORY
21. **BLOG POST 1** (`blog/posts/1.html`) — INDIVIDUAL BLOG ARTICLE
22. **BLOG POST 2** (`blog/posts/2.html`) — INDIVIDUAL BLOG ARTICLE

### SHARED CHROME

- **HEADER/NAV:** FIXED, DARK (base-900/60 + BACKDROP BLUR), MAX-W-7XL CENTERED, LOGO (UPPERCASE STACK SANS NOTCH), DESKTOP NAV LINKS, "EXPLORE" MEGA MENU TRIGGER, "BUY COPPERLANE" CTA BUTTON (accent-300), MOBILE HAMBURGER BUTTON
- **MEGA MENU:** 3-COLUMN GRID (SERVICES, RESOURCES, COMPANY) + FEATURED CTA ROW, WHITE BG, ROUNDED-3XL, SHADOW-2XL
- **MOBILE MENU:** FULL-WIDTH DROPDOWN, DARK BG, STACKED LINKS
- **FOOTER:** LOGO, NAV LINKS GROUPED BY CATEGORY, SOCIAL ICONS (TWITTER, INSTAGRAM, LINKEDIN, FACEBOOK), COPYRIGHT

### KEY INTERACTIONS

- MEGA MENU: CLICK "EXPLORE" → SHOW/HIDE DROPDOWN (TOGGLE hidden CLASS)
- MOBILE MENU: CLICK HAMBURGER → SHOW/HIDE MOBILE NAV (TOGGLE hidden CLASS + SWAP OPEN/CLOSE ICON)
- FAQ ACCORDIONS: CLICK QUESTION → EXPAND/COLLAPSE ANSWER
- HELP CENTER: SEARCH INPUT (FUSEJS SEARCH)
- STICKY HEADER: ALWAYS VISIBLE (fixed + z-50)
- HOVER STATES: BUTTONS (accent-300 → accent-400), NAV LINKS (OPACITY CHANGE), SERVICE CARDS (SLIGHT LIFT), MEGA MENU LINKS (text-accent-600)

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/copperlane).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
