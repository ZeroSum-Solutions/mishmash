---
name: lexington-vanta
description: |
  Vanta is a static reproduction of the current Lexington Themes learning platform design. It includes all 64 discoverable routes as plain HTML, CSS, and JavaScript with no build step.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "vanta learning platform template"
  - "vanta"
  - "learning"
  - "platform"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/vanta"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Vanta Learning Platform Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Vanta Learning Platform Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Vanta is a static reproduction of the current Lexington Themes learning platform design. It includes all 64 discoverable routes as plain HTML, CSS, and JavaScript with no build step.

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
<artifact identifier="lexington-vanta" type="text/html" title="Vanta Learning Platform Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> THIS IS A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF AN EXISTING UI TEMPLATE, REBUILT AS PLAIN HTML + CSS + VANILLA JS FOR STUDY AND LEARNING. REFERENCE: `https://lexingtonthemes.com/viewports/vanta`

## SUMMARY

VANTA IS A CLEAN, MINIMAL COURSE/LEARNING PLATFORM TEMPLATE BUILT WITH ASTRO AND TAILWIND CSS. IT FEATURES A LIGHT DEFAULT THEME WITH A DARK MODE TOGGLE, TWO TYPEFACES (GEIST SANS AND NEWSREADER SERIF), AND A LIME-GREEN ACCENT COLOR. THE TEMPLATE INCLUDES FOUR MAIN PAGES: HOME (COURSE LANDING PAGE), PRICING, SIGN-IN, AND SYSTEM OVERVIEW. IT ALSO INCLUDES A TESTIMONIALS SLIDER (KEEN SLIDER), A SEARCH MODAL (FUSE.JS), AND A MOBILE-RESPONSIVE NAV WITH SLIDE-DOWN MENU.

## STYLE

- **PALETTE:**
  - `--color-primary`: `oklch(16.84% 0 0)` — NEAR-BLACK (MAIN TEXT)
  - `--color-secondary`: `oklch(100% 0 0)` — WHITE (BACKGROUND)
  - `--color-accent`: `oklch(81.34% .218 130.43)` — LIME GREEN (BUTTONS, HIGHLIGHTS)
  - DARK THEME: `[data-theme="dark"]` — INVERTS PRIMARY/SECONDARY (BLACK BG, WHITE TEXT)
- **FONTS:**
  - SANS: `Geist, sans-serif` (BODY TEXT, UI ELEMENTS)
  - SERIF: `Newsreader, serif` (DESCRIPTIVE PARAGRAPHS)
  - MONO: `Geist Mono, monospace` (CODE ELEMENTS)
- **TYPE SCALE:** `text-xs` (0.75rem), `text-sm` (0.875rem), `text-base` (1rem)
- **RADII:** `rounded-xl` (0.75rem) FOR CARDS, `rounded-full` FOR BUTTONS/DOTS
- **SPACING:** TAILWIND 4 SPACING SCALE (0.25rem UNIT)
- **ANIMATIONS:** `duration-300 ease-in-out` ON NAV/HOVER, SLIDER (KEEN-SLIDER)
- **BORDERS:** DOTTED DIVIDERS `border-dotted border-primary/10`

## LAYOUT & STRUCTURE

### HOME (index.html)
- FIXED TOP NAV: LOGO LEFT (vanta®), NAV LINKS + THEME DOTS RIGHT, HAMBURGER MOBILE
- SCROLL-TRIGGERED BACKDROP BLUR ON NAV
- HERO SECTION: LARGE HEADING + SERIF SUBTEXT, DOTTED BORDER BOTTOM
- FEATURES GRID (2-COL MD): 4 FEATURE ITEMS WITH TITLE/DESCRIPTION
- TARGET AUDIENCE SECTION: WHO THIS COURSE IS FOR (5 ITEMS)
- OUTCOMES SECTION: WHAT YOU'LL WALK AWAY WITH (5 ITEMS)
- COURSES PREVIEW: LINK + 2 COURSE CARDS (HOVER BG TRANSITION)
- TESTIMONIALS SLIDER (KEEN SLIDER): 8 CUSTOMER CARDS WITH AVATARS, PREV/NEXT BUTTONS
- FOOTER: LARGE "VANTA" SVG TEXT WITH MASK FADE

### PRICING (pricing.html)
- SAME FIXED NAV + FOOTER
- HERO: PRICING HEADLINE + SERIF SUBTEXT
- MONTHLY/ANNUAL TOGGLE (ANIMATED SLIDER)
- 2-COL PRICING CARDS: INDIVIDUALS ($19/MO OR $15/ANNUAL), TEAMS ($499/MO OR $459/ANNUAL)
- EACH CARD: PLAN NAME, PRICE (DYNAMIC), FEATURE LIST (DOTTED BORDER)
- CTA BUTTON: "START LEARNING" (ACCENT)

### SIGN-IN (sign-in.html)
- SAME NAV
- FORM: EMAIL + PASSWORD INPUTS, REMEMBER ME CHECKBOX
- BUTTONS: "SIGN IN WITH EMAIL" + GOOGLE SIGN-IN ICON BUTTON
- SIGNUP LINK BELOW

### SYSTEM OVERVIEW (system/overview.html)
- SAME NAV
- OVERVIEW HEADING + TWO SECTIONS: "STATIC" AND "CONTENT COLLECTION"
- GRID OF LINKED CATEGORIES WITH SUB-LINKS

### SHARED CHROME
- FIXED SEARCH BUTTON (BOTTOM RIGHT, ACCENT COLOR)
- SEARCH MODAL (FUSE.JS FUZZY SEARCH OVER CONTENT)
- THEME TOGGLE (WHITE/BLACK DOTS) WITH LOCALSTORAGE PERSISTENCE
- MOBILE NAV: SLIDE DOWN OVERLAY, CLOSE BUTTON

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/vanta).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
