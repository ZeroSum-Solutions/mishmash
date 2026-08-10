---
name: lexington-aelen
description: |
  Aelen is a bold, modern SaaS/CRM marketing website template — a pixel-faithful plain HTML/CSS/JS reproduction of the original Astro + Tailwind CSS v4 design by Lexington Themes. The template represents a fictional "next generation CRM" product called ÆLEN, targeting sales teams and agencies. Its design is defined by a warm cream/off-white background, giant bold display typography (up to 12rem), section-level color blocking in burnt orange, muted cyan, warm yellow, and light gray, dashed-border dividers throughout, vertical marquee testimonials, a mega-menu navigation, and a distinctive stacked horizontal-bar footer motif. The clone ships 17 complete pages — no build step, no framework, fully self-contained with vendored assets.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "aelen"
  - "saas"
  - "crm"
  - "marketing"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/aelen"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "site-theme"
  scenario: "marketing"
  example_prompt: "Build Aelen — SaaS CRM Marketing Template Clone as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Aelen — SaaS CRM Marketing Template Clone

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Aelen is a bold, modern SaaS/CRM marketing website template — a pixel-faithful plain HTML/CSS/JS reproduction of the original Astro + Tailwind CSS v4 design by Lexington Themes. The template represents a fictional "next generation CRM" product called ÆLEN, targeting sales teams and agencies. Its design is defined by a warm cream/off-white background, giant bold display typography (up to 12rem), section-level color blocking in burnt orange, muted cyan, warm yellow, and light gray, dashed-border dividers throughout, vertical marquee testimonials, a mega-menu navigation, and a distinctive stacked horizontal-bar footer motif. The clone ships 17 complete pages — no build step, no framework, fully self-contained with vendored assets.

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
<artifact identifier="lexington-aelen" type="text/html" title="Aelen — SaaS CRM Marketing Template Clone">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> THIS IS A SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF AN EXISTING UI TEMPLATE, REBUILT AS PLAIN HTML + CSS + VANILLA JS FOR STUDY AND LEARNING. REFERENCE: `https://lexingtonthemes.com/viewports/aelen`

## SUMMARY

AELEN IS A BOLD, MODERN SaaS/CRM MARKETING TEMPLATE BY LEXINGTON THEMES, BUILT WITH ASTRO + TAILWIND CSS V4. IT REPRESENTS A FICTIONAL "NEXT GENERATION CRM" PRODUCT CALLED ÆLEN, TARGETING SALES TEAMS AND AGENCIES. THE DESIGN IS CHARACTERIZED BY A WARM CREAM/OFF-WHITE BACKGROUND, GIANT BOLD DISPLAY TYPOGRAPHY, SECTION-LEVEL COLOR BLOCKING (ORANGE, CYAN, GRAY, YELLOW), DASHED-BORDER DIVIDERS, AND A DISTINCTIVE STACKED-BAR FOOTER MOTIF. THE CLONE REPRODUCES ALL DISCOVERED PAGES AS PLAIN HTML/CSS/JS — NO BUILD STEP, SELF-CONTAINED, ASSETS VENDORED LOCALLY.

THE LIVE DEMO IS SERVED FROM `https://aelen-astro.pages.dev/`.

## STYLE

### PALETTE
- `--color-white`: `oklch(95% 0.0187 80.72)` — WARM CREAM/OFF-WHITE, BODY BACKGROUND
- `--color-black`: `oklch(29% 0 0)` — NEAR-BLACK, BODY TEXT AND HEADINGS
- `--color-orange`: `oklch(60% 0.1499 37.55)` — BURNT ORANGE, FEATURED SECTION BACKGROUNDS, BRAND ACCENT
- `--color-cyan`: `oklch(80% 0.0456 250.63)` — MUTED CYAN/STEEL BLUE, SECONDARY SECTION BACKGROUNDS
- `--color-yellow`: `oklch(75% 0.1081 64.85)` — WARM YELLOW/GOLD, INDUSTRIES SECTION BACKGROUND
- `--color-gray`: `oklch(83% 0.0018 325.59)` — WARM LIGHT GRAY, FEATURES SECTION BACKGROUND

### FONTS
- PRIMARY: `Geist, sans-serif` — ALL BODY TEXT, NAVIGATION, UI ELEMENTS
- MONO: `Geist Mono, monospace` — CODE BLOCKS AND MONOSPACED CONTENT
- ACCENT: `Instrument Serif, serif` — ITALIC DECORATIVE USE

### TYPE SCALE
- HERO H1: `text-6xl sm:text-7xl md:text-9xl lg:text-[12rem]` — TRACKING `tighter` (-0.05em), WEIGHT `bold` (700)
- SECTION HEADINGS: `text-4xl lg:text-[10rem]` — TRACKING `tight`, WEIGHT `bold`
- SUBHEADINGS: `text-2xl md:text-4xl lg:text-7xl` — WEIGHT `semibold` (600)
- BODY: `text-base` (1rem/1.5rem LINE HEIGHT), WEIGHT `400`
- SMALL/CAPS: `text-xs uppercase tracking-wide` — LABELS AND META

### LAYOUT TOKENS
- SPACING UNIT: `--spacing: 0.25rem` (4px)
- CONTAINER: FULL WIDTH WITH `px-4` (16px) GUTTERS, MAX `2xl:max-w-screen-xl` (80rem)
- SECTION PADDING: `py-24` (96px) OR `py-48` (192px) FOR HERO SECTIONS
- HEADER HEIGHT: 49px (SINGLE SLIM NAV ROW WITH DASHED BOTTOM BORDER)

### ANIMATION / INTERACTION
- MARQUEE ANIMATION: `@keyframes upMarqueeFast { 0%: translateY(0%); 100%: translateY(-50%) }` — 12s LINEAR INFINITE (TESTIMONIALS VERTICAL SCROLL)
- MEGA MENU: `.mega-link` STARTS `opacity:0; transform:translateY(6px)`, ON `.is-open` TRANSITIONS TO `opacity:1; transform:translateY(0)` WITH STAGGERED DELAYS (40ms, 70ms, 100ms, 130ms... PER ITEM)
- MOBILE MENU: NAV LINKS ANIMATE IN WITH `opacity 0.3s ease-out` AND `transform 0.3s ease-out` STAGGERED BY 0.1s PER LINK
- CHAT BUBBLE: TOGGLES `opacity-0 pointer-events-none` ON CLICK
- KEEN SLIDER: TESTIMONIALS CAROUSEL USING `keen-slider@6.8.6`
- TRANSITIONS: `duration-300`, `ease-in-out` (`cubic-bezier(0.4, 0, 0.2, 1)`)
- HOVER STATES: `hover:text-orange`, `hover:bg-black/80`, `hover:bg-black/90`, `hover:text-black/50`

### BORDER / RADIUS
- BORDERS: `border-dashed border-black/20` (20% OPACITY NEAR-BLACK DASHED) — PRIMARY DIVIDER STYLE
- RADIUS: `rounded` (4px) FOR BADGES; `rounded-full` FOR PILL BUTTONS
- OUTLINE: `outline outline-black/20` — CARD OUTLINES

### FOOTER MOTIF
STACKED HORIZONTAL BAR DIVIDERS OF INCREASING HEIGHT: `h-0.5` (2px), `h-1` (4px), `h-2` (8px), `h-3` (12px) — ALL `bg-black`. FOLLOWED BY A `bg-black p-8` SOCIAL BAND. LARGE SVG WORDMARK (1051×289 VIEWBOX) AT THE BOTTOM.

## LAYOUT & STRUCTURE

### PAGES DISCOVERED AND CLONED

1. **`index.html`** — HOME PAGE (`/`)
   - SLIM TOP NAV: LOGO SVG (ÆLEN WORDMARK), "OVERVIEW" LINK, "SIGN UP" CTA BUTTON, SEARCH ICON
   - HERO: GIANT "ÆLEN'S CRM" H1 AT 12REM, SUBTITLE "A NEXT GENERATION CRM", TWO THIN DIVIDER LINES
   - FEATURES TEASER: GRAY BACKGROUND SECTION "BLENDING AI AND SALES EXPERTISE" WITH ORANGE CARD
   - FEATURES GRID: GRAY BACKGROUND — "REDEFINING WHAT A CRM CAN DO. BUILT FOR THE AI ERA" — FEATURE CARDS
   - INDUSTRIES: YELLOW BACKGROUND — "INDUSTRIES WE SUPPORT" — 2-COLUMN GRID WITH INDUSTRY CARDS
   - PRODUCT CALLOUT: ORANGE BACKGROUND — "ÆLEN IS DESIGNED TO HELP YOU WORK FASTER" — FEATURE DETAIL LAYOUT
   - CTA BAND: BLACK BACKGROUND — "READY TO TURN MORE LEADS INTO SALES? / JOIN OVER 1,000 AGENCIES" — SIGN UP LINK
   - INTEGRATIONS: CYAN BACKGROUND — "CONNECT ÆLEN TO LINKEDIN, CHARGEBEE, STRIPE..." — 4-COL GRID
   - TESTIMONIALS: VERTICAL MARQUEE ANIMATION — CUSTOMER TESTIMONIAL CARDS WITH KEEN SLIDER
   - FOOTER: STACKED BLACK BARS + BIG SVG WORDMARK + NAV + SOCIAL ICONS
   - FLOATING CHAT BUBBLE WIDGET (BOTTOM RIGHT)

2. **`blog.html`** — BLOG LISTING PAGE (`/blog`)
   - HERO: GIANT "BLOG" H1 + "LATEST NEWS" LABEL + DASHED DIVIDERS
   - BLOG GRID: ORANGE BACKGROUND — 6 BLOG POST CARDS WITH AUTHOR, DATE, NUMBER
   - FOOTER

3. **`blog-post.html`** — BLOG POST DETAIL (`/blog/posts/1`)
   - HERO: POST TITLE AS GIANT H1 + AUTHOR/DATE META
   - ARTICLE BODY: PROSE CONTENT WITH IMAGES
   - FOOTER

4. **`changelog.html`** — CHANGELOG PAGE (`/changelog`)
   - HERO: "CHANGELOG." H1 + "STAY UPDATED." SUBTITLE
   - CHANGELOG ENTRIES: 3 ENTRIES WITH DATE, TITLE, SUMMARY, "READ FURTHER" LINKS, SIGN UP CTA
   - FOOTER

5. **`changelog-detail.html`** — CHANGELOG DETAIL (`/changelog/1`)
   - SINGLE CHANGELOG ENTRY DETAIL VIEW
   - FOOTER

6. **`pricing.html`** — PRICING PAGE (`/pricing`)
   - HERO: "SIMPLE PRICING. FOR EVERYONE." H1
   - PRICING CARDS: 3 TIERS (WHITE BACKGROUND SECTION)
   - FAQ: ACCORDION SECTION — "CAN I GET A REFUND IF ÆLEN'S NOT RIGHT FOR ME?"
   - FOOTER

7. **`integrations.html`** — INTEGRATIONS PAGE (`/integrations`)
   - HERO: "INTEGRATIONS" H1
   - INTEGRATIONS GRID: ORANGE BACKGROUND — 4-COL GRID OF 6 INTEGRATION CARDS (CHARGEBEE, STRIPE, LINKEDIN, ETC.) WITH "LEARN MORE" LINKS
   - FOOTER

8. **`integration-detail.html`** — INTEGRATION DETAIL (`/integrations/1`)
   - INDIVIDUAL INTEGRATION PAGE (CHARGEBEE)
   - FOOTER

9. **`about.html`** — ABOUT PAGE (`/about`)
   - HERO: "ABOUT US" H1
   - MISSION: CYAN BACKGROUND — "A TEAM OF FORMER SALES LEADS, OPS PROS, AND PRODUCT BUILDERS"
   - EXPERIENCE: ORANGE BACKGROUND — "WE GOT EXPERIENCE" + BODY TEXT
   - TEAM: "OUR TEAM" DISPLAY HEADING + 3-COL GRID OF 6 TEAM MEMBER CARDS WITH PHOTOS
   - FOOTER

10. **`contact.html`** — CONTACT PAGE (`/contact`)
    - HERO: "CONTACT US" H1
    - CONTACT FORM: CYAN BACKGROUND CARD — EMAIL + MESSAGE FIELDS + "SEND IT!" BUTTON
    - FOOTER

11. **`helpcenter.html`** — HELP CENTER (`/helpcenter`)
    - HERO: HELP CENTER H1
    - KNOWLEDGE BASE ARTICLE LISTINGS
    - FOOTER

12. **`sign-up.html`** — SIGN UP FORM (`/sign-up`)
    - FULL-PAGE SIGN UP FORM
    - FOOTER

13. **`sign-in.html`** — SIGN IN FORM (`/sign-in`)
    - FULL-PAGE SIGN IN FORM
    - FOOTER

14. **`system-overview.html`** — DESIGN SYSTEM OVERVIEW (`/system/overview`)
    - HERO: "OVERVIEW" H1
    - PAGE INDEX: ALL TEMPLATE PAGES LISTED, GROUPED BY CATEGORY
    - DESIGN SYSTEM SIDEBAR LINKS (COLORS, BUTTONS, TYPOGRAPHY)
    - FOOTER

15. **`system-colors.html`** — DESIGN SYSTEM COLORS (`/system/colors`)
    - COLOR PALETTE SWATCHES AND TOKENS
    - FOOTER

16. **`system-buttons.html`** — DESIGN SYSTEM BUTTONS (`/system/buttons`)
    - BUTTON COMPONENTS AND VARIANTS
    - FOOTER

17. **`system-typography.html`** — DESIGN SYSTEM TYPOGRAPHY (`/system/typography`)
    - TYPOGRAPHY SPECIMENS AND SCALE
    - FOOTER

### SHARED CHROME (ALL PAGES)

**HEADER:**
- SLIM SINGLE ROW (49PX), `bg-white`, DASHED BOTTOM BORDER `border-dashed border-black/20`
- LEFT: ÆLEN LOGO SVG (WORDMARK PATH)
- RIGHT: "OVERVIEW" TEXT LINK + "SIGN UP" BUTTON + SEARCH ICON
- MOBILE: HAMBURGER TOGGLE REVEALS FULL-SCREEN OVERLAY NAV WITH STAGGERED LINK ANIMATIONS

**FOOTER:**
- LARGE PADDING TOP (192PX)
- STACKED BAR MOTIF: `h-0.5`, `h-1`, `h-2`, `h-3` ALL `bg-black`
- BLACK BAND: SOCIAL ICONS (X, LINKEDIN, YOUTUBE, INSTAGRAM)
- NAV LINKS: OVERVIEW, ABOUT, CAREERS, CONTACT, BLOG, CHANGELOG, PRICING
- LARGE ÆLEN SVG WORDMARK (SAME AS HEADER, SCALED UP)
- COPYRIGHT: "© COPYRIGHT LEXINGTON THEMES 2026"

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/aelen).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
