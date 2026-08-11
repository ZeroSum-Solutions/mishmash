---
name: art-landing
description: |
  Two-section scroll landing for **S.P.D**, a fictional daily-operations
  automation platform. Section one is a full-bleed black hero: a muted,
  looping period-painting video plays edge to edge behind a top-left
  wordmark and tagline, a top-right pill CTA, and a large right-aligned
  serif headline low in the frame. A cloud-plume image straddles the seam
  into section two, a saturated red panel holding a centered monogram, an
  uppercase mission line, a large script signature, two closing lines of
  copy, and a second looping video with a soft fade into the red. Motion is
  a staggered load-in fade on the hero, an IntersectionObserver reveal on
  the red section's content, and a scroll-linked parallax on the cloud
  plume — all degrading to a static, fully-visible layout under reduced
  motion.
tags:
  - "landing-page"
  - "motionsites"
  - "video-hero"
  - "scroll-page"
  - "dark-mode"
  - "parallax"
triggers:
  - "art landing"
  - "spd"
  - "s.p.d"
  - "automation landing page"
  - "video hero landing"
  - "red section landing"
  - "cloud transition"
  - "daily routine automation"
  - "business automation saas"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=art-landing"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build S.P.D — Daily Automation Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage to swap in."
---

# S.P.D — Daily Automation Landing Page

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A two-section scroll landing for S.P.D, a fictional platform that automates
the recurring busywork of running a business. Section one is a full-viewport
black hero with an edge-to-edge looping video, a wordmark and tagline
top-left, a pill call-to-action top-right, and a large right-aligned serif
headline anchored to the bottom of the frame. A cloud-plume image bridges
the seam into section two: a saturated red panel that centers a monogram, a
mission statement, a large cursive signature ("S.P.D"), two closing lines of
copy, and a second looping video that fades into the red above it.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, wordmark,
   tagline, headline lines, and body copy. Swap the two vendored clips and
   the cloud-plume image for footage/imagery of matching orientation and
   mood — keep the hero clip muted/looped and full-bleed, and keep the
   showcase clip's aspect intact so the fade-to-red transition still reads.
3. **Preserve the design system.** The black-hero-to-red-showcase structure,
   the Italiana display headline, the Manrope body type, the Marck Script
   signature, and the single red chromatic accent are the identity — do not
   swap in a different accent hue, a heavier body weight, or a different
   section order without being asked.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. This template ships exactly two sections by design; if
   the user wants more below the fold, design them from scratch in this
   template's own vocabulary (black/white/red neutrals plus the three type
   families already in play).
5. **Keep motion accessible.** The hero load-in fade, the red section's
   scroll reveal, and the cloud parallax must all stay behind
   `prefers-reduced-motion`, exactly as the build spec below requires.

## Build spec

### Palette tokens

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--ink` | `#000000` | Hero background |
| `--paper` | `#ffffff` | All text and line-art on both sections |
| `--mist` | `#cccccc` | Reserved neutral for secondary text |
| `--accent` | `#ff0000` | The one chromatic token — showcase section background, fade-gradient start |
| `--accent-fade` | `rgba(255, 0, 0, 0)` | Transparent fade-gradient stop, keyed to `--accent` |

The showcase section's top fade (`.fade-top`) is the one `gradient()`
declaration on a brand surface, and it runs `var(--accent)` into
`var(--accent-fade)` so a client recolor of the red also recolors the fade.
The hero's bottom scrim is a literal black-to-transparent gradient — neutral
scaffolding, left literal by design.

### Typography

Three Google Fonts, matching the source brief directly (no substitution
needed — all three ship on Google Fonts):

- **Manrope** (400/600) — body copy, tagline, description paragraphs.
- **Italiana** — the hero `<h1>` and the CTA label, uppercase with wide
  letter-spacing.
- **Marck Script** — the "S.P.D" signature in the showcase section.

Headline size is `clamp(2.25rem, 1.05rem + 6.5vw, 6rem)`, weight 400,
line-height 1.1 on mobile tightening to 0.92 at the desktop breakpoint. The
signature scales `clamp(3.5rem, 2.6rem + 8vw, 7.5rem)` so it never overflows
a narrow viewport.

### Layout

**Section one — hero** (`<section class="hero">`, full-bleed black,
`min-height: 100vh`):

1. **Background video** — full-bleed `<video>` (`position: absolute; inset:
   0; object-fit: cover`), with a poster-image fallback for the
   reduced-motion path and a soft bottom scrim for text legibility.
2. **Wordmark column** (top-left, `top/left: 24/20px` mobile → `64/64px`
   desktop) — a 48–64px geometric mark plus a two-line tagline that swaps
   text between mobile and desktop via CSS display toggles, and — desktop
   only — a two-paragraph description pushed `400px` below the mark.
3. **CTA** (top-right, mirrored offsets) — a pill button, 1px white border,
   Italiana label "Get started," background fades from `10%`-black
   (mobile) / transparent (desktop) to `10%`-white with a `48px` backdrop
   blur on hover.
4. **Heading block** (bottom-right, `bottom/right: 32/20px` mobile →
   `64/64px` desktop, right-aligned on desktop) — on mobile, the same
   two-paragraph copy repositioned above the `<h1>`; the `<h1>` itself
   swaps between a four-line desktop break and a three-line mobile break of
   the same headline.

**Section two — showcase** (`<section class="showcase">`, `min-height:
100vh`, background `var(--accent)`):

1. **Cloud plume** — a wide transparent-background image pinned to the top
   of the section and translated up by half its own height, so it visually
   straddles the seam with the hero above; parallaxes further on scroll.
2. **Content column** (centered, `max-width: 900px`) — an 80px monogram, an
   uppercase mission paragraph (`max-width: 400px`), the "S.P.D" script
   signature, and two closing paragraphs of copy.
3. **Video block** — a second looping video (`object-fit: contain`, full
   width) with a `100px` red-to-transparent fade layered over its top edge.

### Motion inventory

- **Hero load-in**: the wordmark column, CTA, and heading block each
  animate `opacity 0 → 1` with `translateY(24px) → 0` over 800ms, staggered
  0.1s–0.3s apart, easing `cubic-bezier(0.23, 1, 0.32, 1)`.
- **CTA hover**: `background` and `backdrop-filter` transition over 300ms;
  never scales from 0.
- **Cloud parallax**: an `rAF`-batched scroll listener maps scroll
  `0px → 300px` to `translateY 0 → -100px` (viewports ≥768px) or
  `0 → -24px` (narrower), layered on top of the plume's fixed `-50%` seam
  offset via a CSS custom property.
- **Showcase reveal**: an `IntersectionObserver` fades up the monogram,
  mission line, signature, and closing copy (threshold 0.15) the first time
  each scrolls into view — the same 24px/700ms/ease-out treatment as the
  hero.
- **Ambient loops**: both videos autoplay, loop, and stay muted via HTML
  attributes; a small inline script calls `.play()` defensively and is the
  only script beyond the reveal/parallax logic.
- **`prefers-reduced-motion: reduce`**: both `<video>` elements hide in
  favor of their poster-frame `<img>` fallbacks, every fade/reveal renders
  fully visible with no transform, the CTA's hover transition is removed,
  and the cloud plume freezes at its resting `-50%` offset — a fully static
  page.

### Assets

- `assets/hero-bg.mp4` — the hero's background clip, downloaded and
  re-encoded to a muted, 720p, ~6s H.264 loop (~1.7MB); its own source is a
  looping period-painting/pool-float vignette with playful AI-style
  detection-box overlays baked in — no edits needed, no real-world
  trademarks present.
- `assets/hero-poster.jpg` — poster frame for the hero video and its
  reduced-motion fallback.
- `assets/showcase-bg.mp4` — the showcase section's clip, same re-encode
  treatment (~0.8MB). One frame of the source footage carried a visible
  Apple logo on a prop laptop; that region is pixelated for the clip's full
  duration using the same blocky-redaction look the footage already uses
  elsewhere, so the fix reads as part of the piece rather than a patch.
- `assets/showcase-poster.jpg` — poster frame for the showcase video and
  its reduced-motion fallback.
- `assets/cloud-overlay.png` — the transparent-background cloud plume,
  downloaded from its genuinely-Cloudinary source and downscaled to 1800px
  wide (~1.1MB) to stay well under the image budget.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="art-landing" type="text/html" title="S.P.D — Daily Automation Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```
