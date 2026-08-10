---
name: lexington-williamsburg
description: |
  Williamsburg is a static reproduction of the current Lexington Themes commerce and editorial design. It includes all 71 discoverable routes as plain HTML, CSS, and JavaScript with no build step.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "williamsburg commerce template"
  - "williamsburg"
  - "commerce"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/williamsburg"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Williamsburg Commerce Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Williamsburg Commerce Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Williamsburg is a static reproduction of the current Lexington Themes commerce and editorial design. It includes all 71 discoverable routes as plain HTML, CSS, and JavaScript with no build step.

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
<artifact identifier="lexington-williamsburg" type="text/html" title="Williamsburg Commerce Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

WILLIAMSBURG IS A PREMIUM E-COMMERCE TEMPLATE FROM LEXINGTON THEMES, AVAILABLE AT HTTPS://WILLIAMSBURG-ASTRO.PAGES.DEV/. IT IS BUILT WITH ASTRO AND TAILWIND CSS AND PROVIDES A COMPLETE STOREFRONT EXPERIENCE WITH A CLEAN, MODERN AESTHETIC SUITABLE FOR LIFESTYLE, FASHION, AND BOUTIQUE BRANDS.

## PAGES

THE TEMPLATE INCLUDES THE FOLLOWING 16 PAGES:

1. **HOME** (`/`) — HERO SECTION WITH FEATURED PRODUCTS, PROMOTIONAL BANNERS, TESTIMONIALS, AND NEWSLETTER SIGNUP
2. **STORE HOME** (`/STORE`) — STORE LANDING PAGE WITH FEATURED COLLECTIONS AND PROMOTIONAL IMAGERY
3. **ALL PRODUCTS** (`/STORE/PRODUCTS`) — PRODUCT GRID WITH FILTERS, SORTING, AND PAGINATION
4. **PRODUCT DETAIL** (`/STORE/PRODUCTS/[ID]`) — SINGLE PRODUCT PAGE WITH IMAGE GALLERY, VARIANT SELECTION, ADD-TO-CART, AND RELATED PRODUCTS
5. **BLOG** (`/BLOG`) — BLOG INDEX WITH ARTICLE CARDS, CATEGORIES, AND PAGINATION
6. **BLOG POST** (`/BLOG/[SLUG]`) — SINGLE ARTICLE PAGE WITH RICH CONTENT, AUTHOR INFO, AND RELATED POSTS
7. **CONTACT** (`/CONTACT`) — CONTACT FORM WITH BUSINESS INFO AND MAP EMBED
8. **PRICING** (`/PRICING`) — PRICING TIERS WITH FEATURE COMPARISON TABLE
9. **HELP CENTER** (`/HELPCENTER`) — FAQ SECTIONS AND SUPPORT CATEGORIES
10. **MEMBERSHIP** (`/MEMBERSHIP`) — MEMBERSHIP PLANS AND BENEFITS PAGE
11. **AFFILIATES** (`/AFFILIATES`) — AFFILIATE PROGRAM INFO AND SIGNUP CTA
12. **SIGN IN** (`/SIGN-IN`) — AUTHENTICATION PAGE WITH EMAIL AND PASSWORD FORM
13. **SIGN UP** (`/SIGN-UP`) — REGISTRATION PAGE WITH FULL SIGNUP FORM
14. **ABOUT** (`/ABOUT`) — BRAND STORY, TEAM SECTION, AND VALUES
15. **STORE TAGS** (`/STORE/TAGS`) — TAG/CATEGORY BROWSING PAGE FOR PRODUCT DISCOVERY
16. **CHECKOUT** (`/CHECKOUT`) — MULTI-STEP CHECKOUT WITH ORDER SUMMARY, SHIPPING, AND PAYMENT FIELDS

## DESIGN SYSTEM

### TYPOGRAPHY
- **PRIMARY FONT:** INTER (VARIABLE, LOADED FROM RSMS.ME/INTER) — USED FOR BODY TEXT, UI ELEMENTS, NAVIGATION, AND LABELS
- **DISPLAY FONT:** INSTRUMENT SERIF (LOADED FROM GOOGLE FONTS) — USED FOR HEADINGS, HERO TEXT, AND EDITORIAL MOMENTS

### COLOR PALETTE
- **NEUTRAL BASE:** WHITE (`#FFFFFF`) BACKGROUNDS WITH ZINC/GRAY SCALE FOR TEXT AND BORDERS
- **ACCENT:** DARK NEAR-BLACK (`#18181B` / ZINC-900) FOR PRIMARY TEXT AND BUTTONS
- **MUTED:** LIGHT GRAYS (`ZINC-100`, `ZINC-200`) FOR CARDS, DIVIDERS, AND SECONDARY BACKGROUNDS
- **DESTRUCTIVE/HIGHLIGHT:** SUBTLE USE OF WARM TONES FOR SALE BADGES AND ALERTS

### FRAMEWORK
- BUILT WITH TAILWIND CSS UTILITY CLASSES — ALL SPACING, TYPOGRAPHY SCALE, AND RESPONSIVE BREAKPOINTS ARE TAILWIND-BASED
- RESPONSIVE AT MOBILE (< 768PX), TABLET (768PX), AND DESKTOP (1024PX+) BREAKPOINTS

## INTERACTIVE FEATURES

- **CART DRAWER** — SLIDE-IN SIDEBAR CART ACCESSIBLE FROM THE NAVBAR CART ICON; SHOWS LINE ITEMS, QUANTITIES, AND SUBTOTAL WITHOUT LEAVING THE PAGE
- **SEARCH MODAL** — FULL-SCREEN SEARCH OVERLAY TRIGGERED BY THE MAGNIFYING-GLASS ICON IN THE HEADER; SUPPORTS KEYWORD INPUT AND DISPLAYS RESULTS INLINE
- **MEGA MENU / NAV TABS** — MULTI-COLUMN DROPDOWN NAVIGATION WITH TABBED CONTENT FOR STORE CATEGORIES, COLLECTIONS, AND FEATURED LINKS
- **HAMBURGER MENU** — MOBILE NAVIGATION DRAWER THAT SLIDES IN FROM THE LEFT/RIGHT, CONTAINING THE FULL NAV TREE AND CTA BUTTONS
- **KEEN SLIDER** — TOUCH-FRIENDLY CAROUSEL COMPONENT (KEEN-SLIDER LIBRARY) USED FOR PRODUCT IMAGE GALLERIES, HOMEPAGE HERO SLIDERS, AND TESTIMONIAL CAROUSELS
- **ACCORDION / FAQ** — COLLAPSIBLE SECTIONS FOR HELP CENTER AND PRODUCT DETAIL FAQs
- **VARIANT SELECTOR** — COLOR AND SIZE SWATCHES ON PRODUCT DETAIL PAGE THAT UPDATE IMAGERY AND PRICING
- **QUANTITY STEPPER** — INCREMENT/DECREMENT CONTROL FOR CART AND PRODUCT DETAIL QUANTITY INPUT

## REFERENCE

LIVE DEMO: HTTPS://WILLIAMSBURG-ASTRO.PAGES.DEV/

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/williamsburg).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
