---
name: yoga-coach-landing
description: |
  Full-viewport, two-screen landing page for a fictional private yoga coach, Jessica.
  No page scroll: a black hero video screen (poster image, click-to-play background
  video, mouse parallax, slide-away headline) hands off on video end to a light-blue
  gradient "class collection" screen with three overlapping, hover-previewable video
  cards. Set in Anton (Google Fonts), all-caps, high-contrast black/white with a soft
  sky-blue accent reserved for the second screen and focus rings.
tags:
  - "landing-page"
  - "motionsites"
  - "wellness"
  - "yoga"
  - "video-hero"
  - "interactive"
triggers:
  - "yoga coach"
  - "yoga"
  - "wellness landing page"
  - "video hero"
  - "full screen landing page"
  - "no scroll landing page"
  - "class collection"
  - "private sessions"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=yoga-coach"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build a full-viewport, two-screen yoga coach landing page for a real studio: a video hero that plays on click and hands off to a class-collection screen with hover-preview video cards. Follow this template's build spec exactly — palette, type, section order, and motion are part of the identity. Ask only for the missing essentials first: coach name, real class videos or photos, and booking link."
---

# Jessica — Yoga Coach

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A viewport-locked, no-scroll landing page for a fictional private yoga coach. It has
exactly two states, not two sections a user scrolls past: a full-bleed hero video
screen, and a "class collection" screen that slides up over it once the hero video
finishes playing.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the real coach's name, slogan, class copy, and
   video/photo assets — match the existing poster/video crop and aspect ratios when
   swapping media so the layout doesn't reflow.
3. **Preserve the design system.** The all-caps Anton type, the black/white hero,
   the sky-blue collection gradient, and the spring-based motion in the build spec
   below are the identity — do not substitute fonts, recolor the palette, or strip the
   parallax/slide/hover motion.
4. **Extend by duplicating sections**, never by importing a layout from another
   template. This template intentionally ships only its two states; add a third state
   in this template's own vocabulary if one is needed.
5. **Keep motion accessible.** Every animation degrades to an instant, dignified state
   under `prefers-reduced-motion`, as the build spec requires.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="yoga-coach-landing" type="text/html" title="Jessica — Yoga Coach">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

The page YOU are looking at in `example.html`, described from the finished build.

### Palette

- `--ink: #060606` / `--paper: #ffffff` — literal neutral scaffolding (hero is pure
  black/white, no tint).
- `--accent-soft: #d5effd`, `--accent-mid: #aedcf9`, `--accent: #8cd0f7` — the three
  sky-blue stops of the collection screen's gradient, declared as real parseable hex
  on `:root` so MishMash's recolor pass can retint them; `--accent` also doubles as the
  `:focus-visible` outline color everywhere in the page.
- The collection background gradient is the page's one genuinely chromatic surface:
  `linear-gradient(to bottom, var(--accent-soft), var(--accent-mid), var(--accent))`.

### Type

Google Font **Anton** (`family=Anton`), used for every line of copy, always uppercase.
Sizes step through explicit breakpoints (375 / 640 / 768 / 1024 / 1280px) rather than
fluid `clamp()`, matching the original's discrete responsive scale:

- Slogan: 20px → 24px → 30px → 35.2px, `line-height: 0.95`, `letter-spacing: 0.025em`.
- Hero titles ("Hey, I Am Jessica" / "Yoga Coach"): 48px → 72px → 96px → 160px →
  176px, `line-height: 1`, `letter-spacing: -0.025em`.
- Collection giant background text ("Collection #451"): viewport-relative, `13.5vw`
  → `16.9vw`, white-to-transparent gradient clipped to the text.

### Sections

1. **Hero (`#hero`)** — full-viewport `<section>`. A poster `<img>` sits under a
   `<video>` (muted, `playsinline`, local MP4) that fades in on load. A slogan
   (top-left), a two-part title ("Hey, I Am Jessica" bottom-left as the page `<h1>`,
   "Yoga Coach" bottom-right as a matching `<p>`), and a circular "Let's Start"
   `<button>` sit in a `pointer-events: none` overlay whose children opt back in.
2. **Collection (`#collection`)** — a second full-viewport `<section>`, off-screen
   below the fold until the hero video ends, with a "Back to Start" `<button>`, an
   `<h2>` (visually hidden) plus a decorative giant "Collection #451" line, and a
   three-card deck of overlapping, rotated video `<button>`s (left/right cards tucked
   behind the center one with negative margins and z-index).

### Motion inventory

- **Parallax:** raw `mousemove` on the hero maps cursor position to a ±20px
  translate on the background video via inline `style.transform` — no CSS transition,
  matching the source's "inline style, no transition" spec.
- **Headline/button reveal:** CSS `transition` with the source's exact cubic-bezier
  curves — `cubic-bezier(0.16, 1, 0.3, 1)` for the slogan/title slide-out on play,
  `cubic-bezier(0.34, 1.56, 0.64, 1)` (bouncy overshoot) for the start button's exit.
- **Collection slide-up/down:** a hand-rolled damped-spring integrator (displacement,
  velocity, `stiffness: 220`, `damping: 32`, `mass: 1`) drives the panel's
  `translateY` every animation frame — a real port of the spring math, not a
  cubic-bezier stand-in, since CSS has no native spring easing.
- **Card hover/focus/touch:** a second spring (`stiffness: 200`, `damping: 20`) drives
  one shared 0→1 progress value per card; x, y, rotation, and scale are linearly
  interpolated from that same progress, which is mathematically equivalent to
  springing each property independently since all four share identical spring
  constants and start at rest.
- **`prefers-reduced-motion`:** the parallax listener never attaches, every spring
  jumps straight to its end value with no animation frames, and CSS transition
  durations collapse to near-zero — the end state is identical, only the motion is
  removed.

### Accessibility

- Hero and collection buttons are real `<button>` elements — natively focusable and
  keyboard-activatable, with visible `:focus-visible` rings in `--accent`.
- Card previews trigger on mouse hover, keyboard focus/blur, and `touchstart` (which
  toggles and stops any other active card), so the hover-only reveal has both a focus
  and a touch path per the accessibility rules for hover reveals.
- `Escape` closes the collection screen and returns focus to "Let's Start"; finishing
  the hero video moves focus to "Back to Start" — both additive, neither changes the
  default rendered appearance.
- All decorative elements (`hero-tint`, giant background text, ring overlays,
  glow) are `aria-hidden`; the page has exactly one `<h1>`.

### Fidelity notes

- The prompt's `preview_url` (a screenshot of the real rendered site) showed the
  center collection card at its rest scale matching the outer two cards, not visibly
  1.05× larger — the source code's static `scale-105` utility class on that card would
  in practice be overridden by Motion's own inline `transform`, so the built page
  follows the screenshot's actual rendered behavior rather than the ambiguous prose.
- `hls.js` and the Mux `.m3u8` streams in the prompt are replaced with locally
  vendored, pre-transcoded MP4s per `SPEC.md`'s CDN-library and remote-asset rules —
  same footage, same crop, just served from `assets/` with no streaming library.
- React/TypeScript/Vite/Tailwind v4/Motion are translated to semantic HTML + inline
  vanilla CSS/JS with equivalent visuals and motion, per the fidelity contract.

## Source & license

Generated output under a MotionSites unlimited subscription; upstream prompt text is
not included in this repository.
