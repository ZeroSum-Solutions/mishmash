---
name: media-card-carousel
description: |
  A horizontally-scrolling rail of five autoplaying video story cards for a fictional aerospace propulsion company, EngineTech. Cards sit at reduced opacity until hovered or focused, snap into place with scroll-snap, and the whole rail is a fully accessible carousel: real previous/next buttons, arrow-key navigation, and an auto-advance timer that pauses on hover, focus, and `prefers-reduced-motion`. Light, near-monochrome palette with a single accent color reserved for keyboard focus rings.
tags:
  - "motionsites"
  - "component"
  - "slider"
  - "carousel"
  - "video-rail"
  - "aerospace"
triggers:
  - "media card carousel"
  - "video stories"
  - "story card rail"
  - "video carousel"
  - "scroll-snap rail"
  - "prev next carousel"
  - "aerospace section"
  - "propulsion"
  - "enginetech"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=media-card-carousel"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Rebuild this Video Stories carousel for a real company: swap the header copy, the five card tags/titles/meta lines, and the vendored video/poster assets for the new brand, while keeping the scroll-snap rail, dimmed-idle card treatment, and the accessible prev/next + auto-advance behavior exactly as built."
---

# Media Card Carousel — EngineTech Video Stories

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A horizontally-scrolling rail of five autoplaying video story cards for a fictional aerospace propulsion company, EngineTech. Cards sit at reduced opacity until hovered or focused, snap into place with scroll-snap, and the whole rail is a fully accessible carousel: real previous/next buttons, arrow-key navigation, and an auto-advance timer that pauses on hover, focus, and `prefers-reduced-motion`.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content.** Swap the header headline/subhead, and for
   each of the five `<article class="story-card">` entries swap the category
   tag, title, and meta line. Swap the vendored media in `assets/` for the
   new brand's footage (or point the `src`/`href` at new files) — keep the
   same box model (`aspect-ratio: 16 / 9`, `object-fit: cover`) so cards stay
   aligned.
3. **Preserve the design system.** The palette tokens, type scale, spacing
   rhythm, and motion timings in the build spec below are the identity — do
   not substitute fonts, recolor the palette, or strip the dimmed-idle card
   treatment.
4. **Extend by duplicating cards.** Add or remove `<article class="story-card">`
   blocks inside `#story-rail`; the inline script queries `.story-card` at
   load time, so the carousel, keyboard navigation, and auto-advance all pick
   up the new count automatically — nothing else needs updating.
5. **Keep the carousel accessible.** The real `<button>` prev/next controls,
   the focusable `#story-rail` region, and the auto-advance pause-on-hover /
   pause-on-focus / pause-on-reduced-motion logic must stay wired exactly as
   built — these are non-optional per the section's own accessibility
   contract.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="media-card-carousel" type="text/html" title="Media Card Carousel — EngineTech Video Stories">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished page.

### Palette tokens (`:root`)

The design is genuinely monochrome — light background, near-black text, a
handful of neutral greys — so per the recolor contract, the one chromatic
token (`--accent`) is scoped exclusively to the `:focus-visible` outline and
never appears in the resting render.

- `--bg: #f7f8f8` — page/section background
- `--ink: #111111` — primary text, category tags, active footer bar
- `--ink-soft: #252b2b` — card headlines
- `--muted: #697272` — header subhead
- `--muted-2: #858d8d` — card meta lines
- `--muted-3: #7a8282` — footer counter text
- `--divider: #cfd4d4` — idle footer bars, control button borders
- `--video-bg: #dfe5e6` — media placeholder background
- `--accent: #2f6fed` — `:focus-visible` outline only

### Typography

Font stack `"Geist", "Inter", ui-sans-serif, system-ui, -apple-system,
BlinkMacSystemFont, "Segoe UI", sans-serif`. Geist isn't on Google Fonts, so
Inter (the stack's own next fallback) is loaded from the Google Fonts CDN as
the concrete face — the stack is kept literal so a future local Geist file
would still take precedence. Headline uses `clamp(38px, 4.4vw, 76px)` at
weight 300; card titles use `clamp(18px, 1.22vw, 24px)` at weight 520;
category tags are 15px at weight 760.

### Layout, section by section

1. **Header** — centered column, `min(100% - 96px, 900px)` wide: an `<h2>`
   headline and a muted `<p>` subhead.
2. **Controls row** — a right-aligned pair of round prev/next buttons,
   additive chrome (not part of the original visual spec) required for the
   carousel's accessibility contract; styled to match the section's neutral
   palette so it reads as native to the design.
3. **Rail** — a CSS grid rail (`grid-auto-flow: column`,
   `grid-auto-columns: minmax(520px, 34vw)`) with `scroll-snap-type: x
   mandatory`, holding five `<article class="story-card">` cards. Each card
   pairs a 16:9 media element with a category tag, title, and meta line.
   Idle cards sit at `opacity: 0.54` with a `translateY(10px)` offset;
   hover or focus brings them to full opacity with no offset.
4. **Footer progress indicator** — a static, `aria-hidden` decorative bar
   (two idle segments + one active segment, matching the source capture's
   own baked state) plus a "05 / 05" counter. Purely cosmetic, not wired to
   scroll position — the reference capture shows the same static state
   across its full animation, so this is baked identically.

### Motion inventory

- **Idle → hover/focus:** `opacity` and `transform` transition, 260ms ease,
  on each `.story-card`.
- **Auto-advance:** every 4000ms the rail smooth-scrolls one card via
  `scrollIntoView`, looping past the last card back to the first. Stops
  while the rail or controls are hovered, while any part of the rail has
  focus, and entirely under `prefers-reduced-motion` (falls back to no
  autoplay, instant/non-smooth scroll on manual navigation).
- **Manufacturing Floor card poster drift:** a slow 22s alternating
  `scale`/`translate` keyframe on the vendored replacement graphic (see
  Assets below), disabled under `prefers-reduced-motion`.
- **Responsive fallback:** at ≤860px, cards render at full opacity with no
  offset (touch users get the content directly, matching the source's own
  mobile behavior).

### Assets and de-branding

Three video clips are referenced by the prompt (two of the five cards reuse
earlier clips). All three were downloaded, and each was checked frame-by-frame
before vendoring, per this batch's real-media caution:

- **Integration Review** clip — clean; vendored as downloaded (transcoded to
  720p muted MP4).
- **Hot-Fire Campaign** clip — a small logo-and-wordmark decal on the
  rocket's nose cone tracked across the clip closely enough to real launch
  -provider livery conventions to be a plausible trademark risk (the
  accompanying text was AI-generated and illegible, but the swoosh-shaped
  mark itself was the concern). The region is blurred out for the full clip
  duration (crop + boxblur + overlay, sized generously to cover the mark's
  drift as the rocket lifts off); it now reads as a lens-flare/glare patch
  against the sunlit sky, consistent with the shot.
- **Manufacturing Floor** clip — showed a real, identifiable spacecraft
  (readable "STARLINER" markings and a U.S. flag decal) in every sampled
  frame across its full ten seconds, with the markings large enough that
  blurring would have obscured most of the frame. Per `SPEC.md`'s
  styled-poster/CSS fallback for an infeasible asset, this card instead
  ships a vendored abstract precision-inspection SVG graphic
  (`assets/story-manufacturing-floor-poster.svg`) with a slow drift
  animation in place of the video — thematically consistent with the card's
  own "sub-micron inspection" copy.

No other real names, logos, or trademarks appear in the shipped copy;
"EngineTech" is the prompt's own fictional brand name and was kept as-is.
