---
name: luxury-editorial-ecommerce
description: |
  Three-scene editorial ecommerce landing for **STRETCH**, a fictional
  refillable-formula beauty and skincare label, built as a single
  self-contained HTML file with inline CSS and vanilla JS. A split-screen
  hero pairs a full-bleed sunlit portrait against an auto-advancing video
  slideshow; a cream horizontal product carousel with a wheel-hijacked
  scroll and a gold progress bar follows; a three-column black video grid
  closes the page. Runs on the system UI font stack (no webfonts loaded,
  matching the source design exactly) with a single gold accent token
  running through the wavy underline, the carousel progress bar, and hover
  states. IntersectionObserver scroll reveals, a crossfading hero
  slideshow, staggered card fade-ins, and a rotating announcement bar
  carry the motion.
tags:
  - "landing-page"
  - "motionsites"
  - "ecommerce"
  - "beauty"
  - "editorial"
  - "video-hero"
triggers:
  - "stretch"
  - "beauty"
  - "skincare"
  - "ecommerce"
  - "editorial"
  - "cosmetics"
  - "product carousel"
  - "video hero"
  - "landing page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=luxury-editorial-ecommerce-design"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build STRETCH — Ethical Beauty Editorial Ecommerce as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: the real brand name, real product copy and prices, and any imagery to swap in for the hero portrait, slideshow, product shots, and category videos."
---

# STRETCH — Ethical Beauty Editorial Ecommerce

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Three-scene ecommerce landing for **STRETCH**, a fictional refillable-formula
beauty label built around "ethical beauty, sustainable impact." A split hero
sits a warm editorial portrait against an auto-advancing three-slide video
panel; a cream best-sellers carousel shows seven products across a
horizontally-scrolling, wheel-hijacked strip with a gold progress bar; a
black three-column video grid closes the page with vertical category
lockups. Both the announcement bar and the hero slideshow carry small,
purposeful interaction (message rotation, dot navigation, a pause/play
toggle) rather than purely decorative motion.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace the brand and copy.** Swap the `STRETCH` wordmark, the hero
   headline/paragraph, the seven product names/categories/prices, and the
   three category labels for the user's real brand, products, and pricing.
3. **Preserve the design system.** The cream/ink/gold palette, the system
   font stack, the split-hero-into-carousel-into-video-grid section order,
   and the motion choreography below are the identity — do not swap in a
   different type system, drop the gold accent, or reorder the three
   scenes.
4. **Swap media like-for-like.** The hero background wants a portrait/near-
   square image; the hero slideshow and the three category tiles want
   short, muted, loopable video (or a static image — the markup degrades
   cleanly to a still frame); product shots want a 3:4 crop. Keep the
   `assets/` folder structure and update `src` attributes in place.
5. **Extend by duplicating a scene**, never by importing a section from
   another template. The three-scene structure mirrors the source prompt
   exactly; add further scenes (e.g. a testimonial band or a footer) in
   this template's own vocabulary if the user needs more content.
6. **Keep motion accessible.** Every animation stays behind
   `prefers-reduced-motion`, including pausing the ambient background
   video to its first frame, as the build spec below requires.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="luxury-editorial-ecommerce" type="text/html" title="STRETCH — Ethical Beauty Editorial Ecommerce">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished `example.html`.

### Palette

| Token | Value | Use |
| --- | --- | --- |
| `--cream` | `#F9F4F0` | Best-sellers section background, card fill |
| `--paper` | `#FFFFFF` | Nav background, base page background |
| `--ink` | `#1A1A1A` | Primary text, hero-left fallback, categories background |
| `--ink-soft` / `--ink-faint` | `rgba(26,26,26,.62)` / `.38` | Secondary copy, inactive tab |
| `--line` | `rgba(26,26,26,.14)` | Hairline borders (nav, cards, progress track) |
| `--gold` | `#C8A45C` | Chromatic brand accent — wavy underline, progress bar core |
| `--gold-light` / `--gold-deep` | `#E7CD98` / `#96733A` | Gradient stops on the progress bar; hover tint in the mobile menu |
| `--scrim-strong` / `--scrim-soft` | `rgba(12,9,6,.62)` / `.08` | Neutral hero-image legibility gradient (literal by design) |
| `--overlay-rest` / `--overlay-hover` | `rgba(0,0,0,.14)` / `.28` | Category video darken-on-hover |

The carousel's scroll-progress thumb is the one deliberately chromatic
gradient surface — `linear-gradient(90deg, var(--gold-deep), var(--gold),
var(--gold-light))` — so recoloring the gold tokens visibly recolors it.
The hero scrim and button hover-sheen are neutral black/white effects and
stay literal, per the neutral-scaffolding convention.

### Type

**System UI stack** (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
"Helvetica Neue", Arial, sans-serif`) throughout — the source prompt
specifies no custom font is loaded, so the system stack is not a
substitution, it's the faithful build. Headline sizes use `clamp()` for
fluid scaling (hero title `clamp(2.2rem,5vw,3.9rem)`; category vertical
labels `clamp(2.6rem,7vw,5.4rem)`).

### Sections

1. **Announcement bar.** Cream strip above the nav with a two-message
   rotator (auto-advances every 4.5s, pauses under reduced motion) flanked
   by chevron prev/next buttons.
2. **Nav.** `STRETCH` wordmark, a center link row (`shop` anchors to the
   carousel; `learn`/`journal`/`theme` are inert placeholders styled
   identically, since this single-page build has no destination for them),
   a currency indicator (French flag + "eur €"), account/search/bag icon
   buttons, and a hamburger that opens a fullscreen dark mobile menu below
   768px.
3. **Hero.** Split 50/50 at desktop width (stacks on mobile/tablet). Left
   half: full-bleed portrait (`assets/hero-bg.webp`) under a neutral
   bottom-to-top scrim, the two-line headline "ethical beauty, sustainable
   impact." with a three-stroke gold wavy underline SVG beneath "impact.",
   a paragraph, and an "about us" button. Right half: a three-slide video
   panel (`hero-slide-1/2/3.mp4`) that crossfades every 5s, with dot
   navigation and a pause/play toggle.
4. **Best sellers.** Cream section with a "best sellers"/"sets" tab pair
   (active tab gets a scale-in ink dot) above a seven-card horizontal
   carousel. Each card shows a category (+ optional subcategory) label, a
   3:4 product image, a name, and a price (two cards carry a struck-through
   former price). The carousel scrolls horizontally on vertical mouse-wheel
   input and drives a gold gradient progress bar beneath it.
5. **Categories.** Full-bleed black three-column grid (stacks to one column
   below 768px). Each tile is a looping category video
   (`category-face/tools/body.mp4`) under a darken-on-hover overlay, a
   large vertical (`writing-mode: vertical-lr`) label, and a "shop
   [category]" button anchored back to the carousel.

### Motion inventory

- **Announcement rotator** — two messages crossfade on a 4.5s interval;
  manual prev/next always available; auto-rotation stops under reduced
  motion.
- **Nav underline** — each center link's underline grows `width:0` to
  `100%` on hover/focus over 300ms.
- **Hamburger morph** — the two-bar icon rotates into an X; the fullscreen
  mobile menu fades in/out over 500ms and traps focus on open (Escape,
  overlay-adjacent buttons, and every link close it).
- **Hero reveal** — the headline/copy/button block fades up 32px over 1s,
  fired via a double `requestAnimationFrame` immediately after load (it's
  already in view, so it isn't scroll-triggered).
- **Hero slideshow** — videos crossfade over 700ms on a 5s auto-advance;
  dots and the pause/play toggle both drive and reflect the active slide;
  pausing also calls `.pause()` on the inactive videos.
- **Wavy gold underline** — three static SVG strokes at different
  weights/opacities under "impact." — a color accent, not an animation.
- **Best-sellers reveal** — the tab row fades up 24px over 800ms; each of
  the seven cards fades up 28px over 500ms with an 80ms stagger
  (200ms–680ms delays), all via `IntersectionObserver` (fires once, then
  unobserves).
- **Carousel wheel hijack + progress** — vertical wheel deltas scroll the
  carousel horizontally; a `scroll` listener drives a gold gradient thumb
  across a 280px track.
- **Product image hover** — scales to 105% over 500ms.
- **Categories reveal** — each tile fades up 48px over 1s via
  `IntersectionObserver`.
- **Category hover** — the background video scales to 105% over 700ms, the
  dark overlay deepens from `.14` to `.28` alpha over 500ms, and the
  vertical label nudges up 2px.
- **Buttons (`.btn-primary`)** — lift 2px with a shadow on hover, plus a
  neutral diagonal light-sweep via a `::before` pseudo-element.

All of the above is vanilla CSS keyframes/transitions plus plain
`IntersectionObserver`/`requestAnimationFrame`/`setInterval` JS — no GSAP,
no WebGL. Every transition/animation collapses to its resting state under
`@media (prefers-reduced-motion: reduce)`, the announcement and slideshow
timers are skipped entirely, and every `<video>` element is paused and
seeked to a static frame so the page never carries ambient motion for users
who've asked to avoid it.

### Asset note

All eleven media files referenced in the source prompt (five product/hero
images, six short video clips) downloaded successfully and are vendored
under `assets/`: the hero portrait and four product photos as `.webp`
(renamed from `.png` — the source URLs actually served WebP payloads), and
the six MP4 clips re-encoded with `ffmpeg` to 720p, muted, H.264,
`+faststart` (`scale=-2:720`), bringing the largest file down from 17.9MB to
1.3MB. Total vendored payload is 3.8MB across 11 files — well under the
per-template media budget. `template.json#remote_dependencies` is empty;
nothing in the page depends on a live network fetch. None of the fictional
product-bottle labels visible in the vendored photography (e.g. a
perfume-style bottle reading "NUSSA" in the category videos) are real
trademarks, so no de-branding was needed beyond keeping the prompt's own
fictional `STRETCH` brand name and copy.
