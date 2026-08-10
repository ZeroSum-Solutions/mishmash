---
name: lexington-zeroindex
description: |
  Zeroindex is a static reproduction of the current Lexington Themes documentation and SaaS design. It includes all 109 discoverable routes as plain HTML, CSS, and JavaScript with no build step.
tags:
  - "site-theme"
  - "lexingtonthemes"
  - "claude-directory"
triggers:
  - "zeroindex documentation template"
  - "zeroindex"
  - "documentation"
  - "site-theme"
od:
  mode: prototype
  platform: desktop
  upstream: "https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/zeroindex"
  upstream_license: MIT
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "docs"
  scenario: "marketing"
  example_prompt: "Build Zeroindex Documentation Template as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in."
---

# Zeroindex Documentation Template

> Multi-page site theme vendored from the MIT-licensed `pulkitxm/claude-directory` gallery.

Zeroindex is a static reproduction of the current Lexington Themes documentation and SaaS design. It includes all 109 discoverable routes as plain HTML, CSS, and JavaScript with no build step.

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
<artifact identifier="lexington-zeroindex" type="text/html" title="Zeroindex Documentation Template">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The upstream prompt that produced this design, verbatim.

> SELF-CONTAINED, PIXEL-FAITHFUL REPRODUCTION OF THE ZEROINDEX TEMPLATE FROM LEXINGTON THEMES. REFERENCE: `https://lexingtonthemes.com/viewports/zeroindex`

## SUMMARY

ZEROINDEX IS A DOCUMENTATION SITE TEMPLATE BUILT WITH ASTRO JS AND TAILWIND CSS V4. IT FEATURES A TWO-PANEL LAYOUT WITH A FIXED LEFT SIDEBAR (288PX WIDE) AND A SCROLLABLE MAIN CONTENT AREA. THE TEMPLATE INCLUDES A MARKETING LANDING PAGE, FULL DOCUMENTATION SECTION WITH ACCORDION SIDEBAR NAVIGATION, BLOG, SIGN-IN, INTEGRATIONS, CHANGELOG, AND LICENSING PAGES.

## STYLE

- **FONTS**: GEIST (SANS, 100–900) + GEIST MONO (MONOSPACE, 100–900) FROM GOOGLE FONTS
- **PALETTE**:
  - BASE SCALE (NEUTRAL GRAY): BASE-50 `OKLCH(98.5% 0 0)` THROUGH BASE-950 `OKLCH(14.5% 0 0)`
  - ACCENT (SKY BLUE): ACCENT-500 `OKLCH(68.5% .169 237.323)`, ACCENT-600 `OKLCH(58.8% .158 241.966)`
  - SEMANTIC: ORANGE (WARNING), EMERALD (SUCCESS), CYAN (INFO), ROSE (ERROR)
  - LIGHT BG: WHITE / BASE-100; DARK BG: BASE-900 `OKLCH(20.5% 0 0)`
- **RADII**: MD=.375REM, LG=.5REM, XL=.75REM, 2XL=1REM
- **TRANSITIONS**: DEFAULT 150MS CUBIC-BEZIER(.4,0,.2,1); SIDEBAR ACCORDION 500MS EASE-IN-OUT
- **THEME**: SYSTEM/LIGHT/DARK THREE-WAY TOGGLE, STORED IN LOCALSTORAGE, `.DARK` CLASS ON HTML

## LAYOUT & STRUCTURE

### PAGES DISCOVERED AND CLONED:

1. **INDEX.HTML** — MARKETING LANDING PAGE (NOT DOCS LAYOUT): MAIN NAV HEADER (BUY ZEROINDEX, OVERVIEW, BLOG, SIGN-IN LINKS + THEME TOGGLE), HERO SECTION (H1 "ASTRO JS DOCUMENTATION", SUBTEXT, GET STARTED + ASTRO FEATURES BUTTONS), GETTING STARTED SECTION (4-COLUMN GRID: QUICK START, API REFERENCE, GUIDES, SUPPORT), RESOURCES SECTION (3-COL GRID WITH SUPPORT/COMMUNITY/TUTORIALS/INTEGRATIONS CARDS)
2. **DOCS/GETTING-STARTED/INTRODUCTION.HTML** — DOCS LAYOUT (SIDEBAR + HEADER + CONTENT): INTRODUCTION DOC PAGE
3. **DOCS/GETTING-STARTED/QUICK-START.HTML** — QUICK START GUIDE DOC PAGE
4. **DOCS/COMPONENTS/ALERTS.HTML** — ALERTS COMPONENT DOC PAGE WITH LIVE EXAMPLES
5. **DOCS/COMPONENTS/BUTTONS.HTML** — BUTTONS COMPONENT DOC PAGE WITH LIVE EXAMPLES
6. **DOCS/COMPONENTS/TABS.HTML** — TABS COMPONENT DOC PAGE
7. **DOCS/COMPONENTS/TYPOGRAPHY.HTML** — TYPOGRAPHY DOC PAGE
8. **DOCS/COMPONENTS/WRAPPERS.HTML** — WRAPPERS DOC PAGE
9. **DOCS/COMPONENTS/BADGES.HTML** — BADGES DOC PAGE
10. **DOCS/COMPONENTS/ACCORDION.HTML** — ACCORDION DOC PAGE
11. **DOCS/NAVIGATION/SIDEBAR.HTML** — SIDEBAR NAVIGATION DOC PAGE
12. **DOCS/NAVIGATION/SIDEBAR-LINKS.HTML** — SIDEBAR LINKS DOC PAGE
13. **DOCS/SHIKI/SHIKI-EXAMPLES.HTML** — SHIKI ANNOTATION EXAMPLES DOC PAGE
14. **DOCS/SHIKI/CODE-HIGHLIGHTER.HTML** — CODE HIGHLIGHTER DOC PAGE
15. **DOCS/HELP/FAQ.HTML** — FAQ DOC PAGE
16. **INTEGRATIONS.HTML** — INTEGRATIONS LISTING PAGE (DOCS LAYOUT)
17. **CHANGELOG.HTML** — CHANGELOG PAGE (DOCS LAYOUT)
18. **INFOPAGES/LICENSING.HTML** — LICENSING INFO PAGE (DOCS LAYOUT)
19. **BLOG/INDEX.HTML** — BLOG LISTING PAGE (MARKETING LAYOUT)
20. **SIGN-IN.HTML** — SIGN-IN PAGE (MINIMAL LAYOUT)
21. **SYSTEM/OVERVIEW.HTML** — SYSTEM DESIGN OVERVIEW PAGE (DOCS LAYOUT)

## Source & license

Vendored from MIT-licensed
[`pulkitxm/claude-directory`](https://github.com/pulkitxm/claude-directory/tree/main/templates/premium/lexingtonthemes/zeroindex).
The upstream MIT licence text ships in this template at [`LICENSE`](./LICENSE) and
must be redistributed alongside any copy of `example.html` or `assets/`.

Webfonts and full-resolution imagery are **not** vendored: local `@font-face`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
