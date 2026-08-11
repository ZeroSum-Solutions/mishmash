---
name: adaptive-learning-education
description: |
  Single-viewport EdTech hero for **LEARNIQ**, a fictional adaptive-learning
  platform. A full-bleed looping video of a glowing silver-and-gold DNA
  double helix fills the entire viewport behind a Swiss/Helvetica-editorial
  composition: a minimal top nav, a two-column hero (light headline left,
  body copy and a filled CTA right), and a frosted light-gray bottom info
  bar anchoring the fold. A hamburger opens a full-height slide-in menu with
  staggered link entrances. Black-on-white throughout, no color in the
  resting render — one self-contained page, no scroll below the fold.
tags:
  - "landing-page"
  - "motionsites"
  - "hero"
  - "video-background"
  - "education"
  - "edtech"
  - "monochrome"
triggers:
  - "learniq"
  - "adaptive learning"
  - "edtech hero"
  - "education landing page"
  - "dna helix hero"
  - "swiss editorial hero"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=adaptive-learning"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build LEARNIQ — an adaptive-learning EdTech hero — as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — the full-bleed DNA-helix video, the Swiss editorial type, the frosted bottom info bar, and the slide-in menu are part of the identity. Ask only for the missing essentials first: real brand name, hero copy, and background footage to swap in."
---

# LEARNIQ — Adaptive Learning Hero Landing

> Rebuilt from a licensed MotionSites prompt as a self-contained page.

Single-viewport EdTech hero for **LEARNIQ**, a fictional adaptive-learning
platform. A full-bleed background video (a slowly rotating DNA double helix
of glowing silver-and-gold particles on white) sits behind every layer of
UI. Content stacks in one column: a slim nav, a spacer that pushes the hero
copy to the lower half of the viewport, a two-column hero block, and a
frosted rounded-top info bar that anchors the bottom edge. A hamburger
button opens a full-height white panel that slides in from the left with
staggered link entrances. The page is intentionally one viewport tall —
no scroll, no sections below the fold, matching the source design's own
scope.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, hero
   headline, body copy, nav labels, and background footage (or a static
   fallback image sized and positioned the same way — full-bleed,
   `object-fit: cover`, centered).
3. **Preserve the design system.** The full-bleed video plane, the
   two-column hero split, the frosted bottom info bar, and the pill CTAs
   in the build spec below are the identity — do not add a color overlay
   to the video, introduce a second section, or restyle the CTAs off their
   pill treatment.
4. **Extend by duplicating patterns**, never by importing chrome from
   another template. If more sections are needed below the hero, design
   them fresh in this template's own vocabulary — the hero itself should
   stay exactly this spare.
5. **Keep motion accessible.** The slide-in menu's stagger, the CTA hover
   transitions, and the background video all collapse or pause under
   `prefers-reduced-motion` — preserve all three when extending the page.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="adaptive-learning-education" type="text/html" title="LEARNIQ — Adaptive Learning Hero Landing">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished page, not the source prompt.

### Palette & type

- **Palette:** monochrome black-on-white throughout — `#000000` text over a
  near-white `#fafafa` page, `neutral-400`–`neutral-800` grays for secondary
  text and the filled CTA, a translucent `rgba(240,240,240,.75)` frosted
  panel for the bottom bar. All color in the resting render comes from the
  video (warm gold highlights on silver strands), never from CSS.
- **Chromatic root token:** `--accent: #2f6fed`. The source design is
  explicitly monochrome ("no purple gradients, no cream paper theme"), so
  per the monochrome-design rule this token is scoped exclusively to the
  `:focus-visible` outline — it never touches a fill, gradient, or the
  resting UI, so the recolor knob still has a real chromatic token to grab
  without changing the specified look.
- **Type:** the source specifies a paid "Helvetica Neue ME" webfont (a
  non-Google CDN link). It is not on Google Fonts, so this build substitutes
  **Inter** (weights 200/300/400/500/700) — the closest Google-hosted
  grotesque match for the same Swiss/Helvetica editorial register, at the
  same weights the design calls for (extralight numerals, light headline,
  bold wordmark).

### Section-by-section layout

1. **Nav** — `LEARNIQ` wordmark left, paired with a hamburger + "Menu"
   label (label hidden below 640px); search and account icon buttons right.
2. **Spacer** — a flexed empty region that pushes the hero copy down to the
   lower half of the viewport, matching the source's vertical composition.
3. **Two-column hero** — left column: uppercase eyebrow
   ("Vision of LEARNIQ"), a four-line light headline with hard line breaks,
   and an outline pill CTA ("Start Your Journey"). Right column: a
   five-line body paragraph (soft line breaks that collapse to flowing text
   below 640px) and a filled dark pill CTA with a down-arrow icon
   ("Dive in deeper").
4. **Frosted bottom info bar** — a rounded-top translucent panel pinned to
   the bottom edge (`margin-top: auto`): a huge extralight "01" beside a
   date and a two-line subhead on the left, a longer descriptive paragraph
   on the right.
5. **Slide-in menu overlay** — a fixed full-screen layer: a semi-transparent
   blurred backdrop plus a white panel (full width on mobile, 380px from
   640px up) that slides in from the left, holding the wordmark, a close
   button, six links, and a contact footer.

### Motion inventory

- Menu panel: `translateX(-100%) → translateX(0)`, 500ms
  `cubic-bezier(0.22, 1, 0.36, 1)`.
- Menu backdrop: opacity `0 → 1`, 500ms `ease-in-out`, with a 4px backdrop
  blur.
- Menu links: fade + rise (`opacity 0 → 1`, `translateY(16px) → 0`), 500ms
  ease-out, staggered per-link delays of 75/150/225/300/375/450ms on open,
  reset to 0ms on close; the contact footer follows the same fade/rise on a
  500ms delay.
- CTA hovers: outline CTA inverts to filled black/white; filled CTA darkens
  to pure black — both 300ms color transitions, exact constants from the
  source prompt.
- Icon buttons and the wordmark-adjacent hamburger: opacity to 0.7 on
  hover, 200ms.
- `prefers-reduced-motion: reduce` pauses the background video (it rests on
  a poster frame via `background-image` instead of looping), collapses
  every menu/CTA transition to near-zero, and disables smooth scrolling.

### Accessibility affordances

- The hamburger is a real `<button>` with `aria-haspopup`, `aria-expanded`,
  and `aria-controls` pointing at the menu overlay.
- The menu overlay is `role="dialog"` `aria-modal="true"` with an
  `aria-label`; visibility is driven by an `.is-open` class rather than the
  `hidden` attribute colliding with the panel's own `transform` rule.
- `Escape` closes the menu and returns focus to the hamburger. Clicking the
  backdrop or any menu link also closes it.
- Opening the menu moves focus to its close button; a `keydown` handler
  traps `Tab`/`Shift+Tab` inside the panel's focusable set (close button,
  six links, footer email) while it is open, released on close.
- Body scroll is locked (`overflow: hidden` via a `.menu-lock` class) while
  the menu is open and restored on close.
- Every interactive element carries a visible `:focus-visible` ring (the
  chromatic `--accent` token) that does not alter the resting appearance.
- The background `<video>` is `aria-hidden="true"` and decorative-only; all
  page content sits in a separate `z-10` layer above it.

### De-branding note

No real trademarks were found. The prompt's brand ("LEARNIQ"), copy,
email (`hello@learniq.co`), and the DNA-helix stock/generative footage are
already fictional/generic — nothing required renaming. The `od_category`
manifest note for this slug carries no additional de-brand duty beyond the
standing rule, and the vendored video and extracted poster frame were
inspected for any embedded real-world marks; none were found (the footage
is an abstract particle-rendered DNA strand on a white background, no
logos, text, or identifiable imagery).

### Assets

- `assets/hero-dna-video.mp4` — vendored from the prompt's exact specified
  CloudFront source URL, transcoded to 720p/muted/H.264 with faststart
  (1.2MB, down from a 9.35MB 1080p source).
- `assets/hero-dna-poster.jpg` — a frame extracted from the same video,
  used as the `<video poster>` and shown via `background-image` at rest
  under `prefers-reduced-motion`.

### Fonts

- Inter (weights 200/300/400/500/700) via Google Fonts, substituted for the
  source prompt's non-Google "Helvetica Neue ME" webfont — see the Palette
  & type note above.

