---
name: lexington-author
description: |
  A pixel-faithful clone of the Lexington Themes "Author" premium Astro template, rebuilt as a self-contained, zero-build-step plain HTML/CSS/JavaScript project. Author is a dark, publication-style blog template for architecture writing, featuring a fixed navigation bar with a search modal, full-bleed hero imagery, a horizontal Keen Slider carousel for featured posts, a subscriber-only article grid, an individual authors section with profile pages, membership tiers, sign-in and sign-up forms, and a comprehensive design-system reference. All assets are vendored locally; no server or build tool is required.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "author , dark editorial blog & publication website template clone"
  - "author"
  - "dark"
  - "editorial"
  - "blog"
  - "publication"
  - "website"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/author"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Author , Dark Editorial Blog & Publication Website Template Clone as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Author , Dark Editorial Blog & Publication Website Template Clone

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

A pixel-faithful clone of the Lexington Themes "Author" premium Astro template, rebuilt as a self-contained, zero-build-step plain HTML/CSS/JavaScript project. Author is a dark, publication-style blog template for architecture writing, featuring a fixed navigation bar with a search modal, full-bleed hero imagery, a horizontal Keen Slider carousel for featured posts, a subscriber-only article grid, an individual authors section with profile pages, membership tiers, sign-in and sign-up forms, and a comprehensive design-system reference. All assets are vendored locally; no server or build tool is required.

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
<artifact identifier="lexington-author" type="text/html" title="Author , Dark Editorial Blog & Publication Website Template Clone">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE LEXINGTON THEMES "AUTHOR" TEMPLATE , EVERY PAGE, THE FULL LOOK & FEEL, HOVER STATES, AND ANIMATIONS , AS A PLAIN HTML/CSS/VANILLA-JS CLONE WITH NO BUILD STEP.
> REFERENCE: `https://lexingtonthemes.com/viewports/author`

## SUMMARY

"AUTHOR" IS A DARK, EDITORIAL BLOG & PUBLICATION TEMPLATE BY LEXINGTON THEMES. IT IS BUILT FOR ARCHITECTURE-FOCUSED WRITING AND FEATURES A PUBLICATION-STYLE LAYOUT WITH A FIXED TOP NAV, FULL-BLEED HERO IMAGERY, A HORIZONTAL KEEN-SLIDER CAROUSEL FOR FEATURED POSTS, A SUBSCRIBER-ONLY GRID, AN AUTHORS LISTING WITH INDIVIDUAL PROFILES, A PRICING/MEMBERSHIP PAGE, SIGN-IN/SIGN-UP FORMS, AND A MULTI-COLUMN FOOTER WITH CREDITS. THE DESIGN IS CONSISTENTLY DARK (BLACK BG, WHITE TEXT) WITH A SUBTLE PURPLE ACCENT USED ON CARD HOVER STATES. ALL IMAGERY IS ARCHITECTURAL PHOTOGRAPHY. THE TEMPLATE INCLUDES A FULL SYSTEM/DESIGN-SYSTEM SECTION (OVERVIEW, COLORS, BUTTONS, TYPOGRAPHY).

## STYLE

### PALETTE
- **BACKGROUND**: `#000000` (PURE BLACK)
- **BASE-950**: `#121212`
- **BASE-900**: `#262626`
- **BASE-700**: `#474747`
- **BASE-500**: `#858585`
- **BASE-400**: `#b5b5b5`
- **BASE-300**: `#d1d1d1`
- **BASE-200**: `#e8e8e8`
- **WHITE**: `#ffffff`
- **ACCENT-700** (HOVER OVERLAY): `oklch(45.9% .21 323.57)` ≈ `#8b0b98` (DEEP PURPLE)

### TYPOGRAPHY
- **FONT**: INTER (FROM `https://rsms.me/inter/inter.css`), VARIABLE FONT
- **WEIGHTS**: LIGHT (300), REGULAR (400), MEDIUM (500)
- **HERO H1**: `text-lg sm:text-xl md:text-2xl font-light`
- **SECTION HEADINGS**: `text-4xl md:text-5xl lg:text-6xl italic font-thin tracking-tighter`
- **BODY TEXT**: `text-base font-light`
- **CARD META**: `text-xs uppercase text-base-400`
- **MOBILE MENU LINKS**: `text-4xl md:text-5xl lg:text-6xl font-thin uppercase`

### SPACING / LAYOUT
- MAX WIDTH: `max-w-screen 2xl:max-w-400` (FULL SCREEN, MAX 100REM AT 2XL)
- HORIZONTAL PADDING: `px-8 lg:px-8`
- SECTION PADDING: `py-32` (TOP SECTIONS), `pt-32 pb-12`

### RADII / BORDERS
- BUTTONS: SQUARE (NO RADIUS)
- INPUTS: ONLY BOTTOM BORDER (NO RADIUS)
- DIVIDERS: `h-0.5` HORIZONTAL LINES (LAYERED: FULL-WIDTH BASE-900, 1/3 BASE-500, 1/5 BASE-300)

### ANIMATIONS / TRANSITIONS
- CARD HOVER: `group-hover:bg-accent-700/90 group-hover:mix-blend-multiply` (COLOR OVERLAY FADE ON BLOG CARDS)
- NAV LINKS: `duration-300 hover:text-base-400`
- BUTTONS: `transition-all duration-300 ease-in-out`
- MOBILE MENU: OPACITY + POINTER-EVENTS TOGGLE, STAGGERED LINK ENTRANCE (`translateY(20px) → 0`, 0.1s DELAY PER ITEM)
- SEARCH MODAL: SHOW/HIDE WITH `hidden` CLASS

## LAYOUT & STRUCTURE

### PAGES DISCOVERED (20 TOTAL)

1. **HOME** (`index.html`) , FIXED NAV + SEARCH MODAL; HERO SECTION (FULL-BLEED BG IMAGE, H1 + LARGE TAGLINE PARAGRAPH WITH INDENT); FEATURED HORIZONTAL KEEN-SLIDER (6 POST CARDS WITH HOVER COLOR-OVERLAY); SUBSCRIBERS-ONLY 2-COL GRID (2 POSTS); "GET IN" NEWSLETTER SIGNUP SECTION (FULL-BLEED BG IMAGE + FORM); MULTI-COLUMN FOOTER WITH LOGO-TEXT, CATEGORIES, FOOTER IMAGE, NAVIGATION LINKS, CREDITS, AWARDS

2. **BLOG INDEX** (`blog/index.html`) , HEADER; SECTION HEADING "BLOG"; 3-COL RESPONSIVE GRID OF ALL 6 POSTS (IMG + DATE + TITLE + AUTHOR AVATAR); FOOTER

3. **BLOG POST 1** (`blog/posts/1.html`) , HERO WITH BG IMAGE (GRADIENT OVERLAY); TITLE + DATE; LARGE LEAD DESCRIPTION PARAGRAPH; TAGS + AUTHOR AVATAR + SHARE BUTTONS; ARTICLE PROSE; RELATED POSTS GRID (4-COL); FOOTER

4. **BLOG POST 2** (`blog/posts/2.html`) , SAME STRUCTURE AS POST 1

5. **BLOG POST 3** (`blog/posts/3.html`) , SAME STRUCTURE AS POST 1

6. **BLOG POST 4** (`blog/posts/4.html`) , SAME STRUCTURE AS POST 1

7. **BLOG POST 5** (`blog/posts/5.html`) , SAME STRUCTURE AS POST 1

8. **BLOG POST 6** (`blog/posts/6.html`) , SAME STRUCTURE AS POST 1

9. **AUTHORS** (`authors/index.html`) , HEADER; "AUTHORS" SECTION HEADING; GRID OF 5 AUTHOR CARDS (PORTRAIT + NAME + BIO + ROLE + SOCIAL LINKS); FOOTER

10. **AUTHOR: DAVID LEE** (`authors/david-lee.html`) , HERO WITH BG IMAGE; AUTHOR NAME + ROLE + BIO (2 PARAGRAPHS); PORTRAIT ON RIGHT; SOCIAL LINKS; "MORE FROM" SECTION (4-COL GRID OF THEIR POSTS); FOOTER

11. **AUTHOR: EMMA CARTER** (`authors/emma-carter.html`) , SAME STRUCTURE

12. **AUTHOR: ISAAC TURNER** (`authors/isaac-turner.html`) , SAME STRUCTURE (HAS 4 POST IMAGES)

13. **AUTHOR: JORDAN WELLS** (`authors/jordan-wells.html`) , SAME STRUCTURE

14. **AUTHOR: JULIET RAMOS** (`authors/juliet-ramos.html`) , SAME STRUCTURE

15. **PRICING** (`pricing.html`) , HEADER; SECTION HEADING "MEMBERSHIP"; HERO TEXT "JOIN US AND ENJOY FULL ACCESS"; 3-COL PRICING TIERS (FREE / PRO / TEAM); FEATURE COMPARISON TABLE; FAQ ACCORDION; FOOTER

16. **SIGN IN** (`signin.html`) , CENTERED FORM: EMAIL + PASSWORD INPUTS; "SIGN IN" BUTTON; LINK TO SIGN UP; FOOTER

17. **SIGN UP** (`signup.html`) , CENTERED FORM: NAME + EMAIL + PASSWORD; "SIGN UP" BUTTON; LINK TO SIGN IN; FOOTER

18. **SYSTEM OVERVIEW** (`system/overview.html`) , DESIGN SYSTEM INTRO; LINKS TO OTHER SYSTEM PAGES; FOOTER

19. **SYSTEM COLORS** (`system/colors.html`) , COLOR SWATCHES FOR ALL BASE + ACCENT COLORS; FOOTER

20. **SYSTEM BUTTONS** (`system/buttons.html`) , ALL BUTTON VARIANTS (PRIMARY, SECONDARY, GHOST, SIZES); FOOTER

21. **SYSTEM TYPOGRAPHY** (`system/typography.html`) , TYPE SCALE SPECIMENS (H1–H6, BODY, SMALL); FOOTER

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/author).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
