---
name: oyla-ecommerce
description: |
  Single-page luxury ecommerce landing for the fictional Berlin ring studio
  **OYLA**. Pure black-and-white composition with one crimson accent
  (`#A3111E`) reserved for the header and nav. A 500vh scroll-scrubbed hero
  video, a pinned horizontal product carousel that expands into a second
  scroll-scrubbed video, a sticky two-column brand-story/stats section with
  per-character "stomp" reveals, and a fixed-reveal footer with a working
  newsletter form.
tags:
  - "landing-page"
  - "motionsites"
  - "ecommerce"
  - "jewelry"
  - "luxury"
  - "scroll-video"
triggers:
  - "oyla"
  - "jewelry landing page"
  - "ring studio"
  - "luxury ecommerce"
  - "scroll scrubbed video"
  - "product carousel"
  - "handcrafted jewelry"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=oyla"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build OYLA — a luxury handcrafted-jewelry landing page — as a self-contained responsive page in this template's own visual system. Follow the build spec below exactly: black-and-white palette with the single crimson accent, the scroll-scrubbed hero video, the pinned product carousel, and the two-column brand-story section. Ask only for the missing essentials first: brand name, real product photography/video, and copy."
---

# OYLA — Handcrafted Rings Landing Page

Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, hero
   video/imagery, product photography, prices, and copy. Match existing
   video aspect ratio (16:9-ish, portrait-safe crop) and image crop when
   swapping assets.
3. **Preserve the design system.** Pure black/white with the single crimson
   accent, the type pairing (Instrument Serif for display, Inter Tight for
   everything else), and the section rhythm are the identity — do not
   substitute fonts, recolor the palette, or strip the scroll-scrub motion.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. A new stat card or product card should copy the
   existing markup pattern exactly.
5. **Keep motion accessible.** Every scroll-driven effect (video scrub,
   horizontal carousel, per-character reveals) has a reduced-motion
   fallback in the build spec below — preserve it when editing.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="oyla-ecommerce" type="text/html" title="OYLA — Handcrafted Rings Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The finished page, described from its own markup and CSS.

### Palette & type

- `--color-bg: #ffffff`, `--color-text: #000000`, `--color-divider: #000000`
  — strictly black and white for all body content.
- `--accent: #A3111E` — the single chromatic root token, deep crimson, used
  only for the header logo, the ABOUT link, the hamburger, and `[ BAG ]` (and
  reused as the `:focus-visible` outline color across the page).
- Display type: **Instrument Serif** (`--font-serif`), regular weight, used
  for the hero title, the "Made Without Compromise" heading, and every stat
  number/label.
- Body/UI type: **Inter Tight** (`--font-sans`), weights 300–700, used for
  nav, buttons, paragraph copy, and the footer.
- **Cormorant Garamond** is loaded (300–700 + italics) per the source spec
  but not visibly used anywhere in the built page — kept available for
  future extension, matching the prompt's own "loaded but not actively
  used" note.

### Section-by-section layout

1. **Fixed header** — logo (inline SVG wordmark: a ring-shaped "O" built
   from two concentric arcs plus an "YLA" text glyph in Instrument Serif,
   all filled with `var(--accent)`) at top-left; nav at top-right with
   ABOUT, a two-bar hamburger button, and a `[ BAG ]` button. `top/left/
   right: 32px`, all interactive elements dim to `opacity: 0.7` on hover/
   focus.
2. **Hero** — a `500vh` black section with a `position: sticky` 100vh
   viewport. A full-bleed muted video (`assets/hero-scrub.mp4`) is scrubbed
   frame-by-frame by scroll position (see Motion below). "MEASURED /
   PURITY" (Instrument Serif, `clamp(36px,6vw,72px)`) sits bottom-left over
   the video, with a DISCOVER capsule button beneath it that smooth-scrolls
   to the footer.
3. **Collection (horizontal product carousel)** — a `300vh` pin wrapper
   holding a sticky 100vh section. Six ring cards (Obsidian Coil $480, Void
   Arc $560, Onyx Hex $620, Shadow Sigil $740, Eclipse Band $820, Matte
   Skull $950 — the last two reuse the first two products' photography, as
   specified) sit in a flex row at `33.333vw` each. As the section is
   scrolled, the row translates horizontally (0–60% of the pin's scroll
   range), then a centered `.video-scaling-wrapper` expands from 0% to 100%
   width (60–100% of the range), revealing a second scroll-scrubbed video
   (`assets/reveal-scrub.mp4`) beneath it.
4. **Brand story / stats** — a 50/50 CSS grid. The left column is
   `position: sticky` with the "Made Without Compromise" heading, three
   brand-story paragraphs, and a VIEW COLLECTION button that scrolls back
   to the carousel; all four elements fade + slide up in a 0.15s stagger
   when the column enters view. The right column holds four stat cards
   (100% Handmade / 14-92g Per piece / Sterling & Silver / Lifetime
   Guarantee, the last with an "Est. OYLA Studio, 2019." subtext), each
   `min-height: 45vh`. Each card's heading is a duplicated `<h1>` pair — the
   first hidden by `:first-child { display: none }`, the second split into
   per-character spans that "stomp" in (translateY + opacity, staggered)
   the first time the card scrolls into view.
5. **Footer (fixed reveal)** — `position: fixed; bottom: 0`, three columns
   (Sign in/credits, Instagram/legal links, Newsletter). A transparent
   `.footer-spacer` div at the end of the document flow is sized in JS to
   match the footer's real height, so the fixed footer is uncovered only
   once the page's natural scroll runs out. The newsletter form is a real
   `<form>` with a labeled email input; submit is intercepted (no live
   `action`) and swaps the form for an inline "You're on the list. Welcome."
   success message.

### Motion inventory

- **Hero video scrub** — `requestAnimationFrame` loop reads scroll progress
  through the 500vh hero, lerps toward the target `currentTime` at a `0.08`
  factor, and only assigns `video.currentTime` when `!video.seeking` and the
  delta exceeds `0.01s` (the seeking-guard pattern from the source spec,
  ported verbatim to prevent decoder flooding).
- **Hero text exit** — past 80% scroll progress through the hero, each
  hero-title character fades, blurs (`blur(0–6px)`), and shifts up
  (`translateY(0 to -24px)`) with a per-character stagger and a cubic
  ease-out. The DISCOVER button fades/shifts with a `pow(progress, 4)`
  curve across the full hero scroll, matching the source's easing.
- **Collection horizontal scroll + video reveal** — same rAF/lerp/seeking-
  guard pattern drives both the card row's `translateX` (linear, phase 1)
  and the second video's scrub (phase 2), keyed off scroll progress through
  the 300vh pin wrapper.
- **Brand-story stagger** — `IntersectionObserver` (threshold 0.15, fires
  once) adds `.is-in-view` to the four left-column elements, each with a
  `0.15s` stagger via `transition-delay`; `0.8s` duration, opacity 0→1 +
  `translateY(20px)→0`, `cubic-bezier(0.25,0.46,0.45,0.94)` (power2.out).
- **Stat card "stomp"** — a per-card `IntersectionObserver` (fires once)
  splits the visible heading into character spans and the detail paragraph
  into word spans, then reveals them with a small stagger.
- **`@media (prefers-reduced-motion: reduce)`** — the hero and carousel
  collapse to natural document height (no scroll-jacking), both videos
  freeze on their first frame, the horizontal carousel becomes a plain
  `overflow-x: auto` strip, and every stagger/blur/translate effect resolves
  instantly to its final state.

### Translation notes (implementation → this template's rules)

- Source is a Vite + Express SPA with GSAP 3.12.5 + ScrollTrigger loaded
  from a CDN; this template collapses that into one self-contained
  `example.html` with vanilla `IntersectionObserver` + `requestAnimationFrame`
  doing the same scroll-linked work (SPEC.md's mandated CDN-library →
  vanilla translation). The visual result — what scrubs, when, and how far —
  is preserved; only the machinery changed.
- The source's GSAP `pin: true` + implicit spacer distance isn't given an
  exact pixel value; `300vh` was chosen for the pin wrapper (split 60/40
  between the horizontal-scroll and video-reveal phases) as a judgment call
  that reproduces the two-phase behavior the prompt describes.
- The server-side `GET /api/higgsfield-video` proxy (which refreshed the
  video URLs at runtime) has no equivalent in a static single-file page;
  both videos are vendored locally instead, from the exact CloudFront URLs
  the prompt specifies.
- The prompt's `alert('You're on the list. Welcome.')` on newsletter submit
  is replaced with an inline success message per SPEC-BATCH2 §4 (forms may
  not use blocking native dialogs and must show an inline success state).
- The `.stomp-wrapper`/`.stomp-stack` duplicate-heading DOM structure is
  reproduced exactly as specified (first `<h1>` hidden, second visible), but
  the prompt gives no formula for the "stomp" motion itself — a
  staggered per-character translateY+opacity reveal was used as the closest
  reading of a heading that "stomps" into place.

### Assets

- `assets/hero-scrub.mp4` — hero scroll-scrub video, transcoded to 720p
  muted H.264 from the prompt's CloudFront source.
- `assets/reveal-scrub.mp4` — second scroll-scrub video (collection reveal),
  same transcode treatment.
- `assets/product-obsidian-coil.webp`, `product-void-arc.webp`,
  `product-onyx-hex.webp`, `product-shadow-sigil.webp` — four vendored ring
  product photos (the sixth-card and fifth-card entries reuse the first two,
  exactly as the prompt specifies).

### De-branding check

OYLA is treated as a fictional brand per the manifest note. Verified by web
search: no jewelry brand or registered trademark exactly named "OYLA" was
found (only an unrelated product named "Oyla Earring" from a different
brand, Kivay Jewellery — a product name, not a competing house). The four
vendored ring product photos were inspected at full resolution for
engraved/printed marks; none carry any visible logo, hallmark, or brand
text. The two vendored videos (AI-generated Higgsfield fashion footage, not
footage of a real identifiable person) show only plain silver rings against
white/water backdrops — no visible trademarks.

