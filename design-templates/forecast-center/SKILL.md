---
name: forecast-center
description: |
  Liquid-glass weather dashboard for a fictional "Central Jakarta" storm
  forecast. A dark, edge-anchored 1357×871 desktop canvas: a frosted glass
  sidebar with a wave-mark logo and five nav icons, a header greeting with
  four tool buttons, a headline chip + masked-reveal "Strom / with Heavy
  Rain" hero over a full-bleed storm-lightning photo, a six-day temperature
  strip above a self-drawing SVG wave chart, and a translucent right rail of
  four location cards (one large "10°C" hero card plus three compact city
  rows). A ~2.6s choreographed entrance (slide, pop, mask-wipe, pen-draw,
  specular sheen) plays once on load, with a full single-column mobile
  reflow and a bottom icon dock below 860px.
tags:
  - "dashboard"
  - "motionsites"
  - "weather"
  - "glassmorphism"
  - "utility"
  - "data-viz"
triggers:
  - "weather dashboard"
  - "forecast dashboard"
  - "liquid glass weather"
  - "storm forecast ui"
  - "weather utility"
  - "jakarta weather"
  - "weather app ui"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=forecast-center"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "dashboard"
  scenario: "operations"
  example_prompt: "Build a liquid-glass weather dashboard like this one, in this template's own visual system, but for my real product. Follow the build spec exactly — the absolute 1357×871 grid, the glass sidebar/header/rail vocabulary, the self-drawing wave chart, and the entrance choreography are part of the identity. Ask only for the missing essentials first: product/brand name, the real location and forecast data, and a background photo to swap in."
---

# Forecast Center — Liquid-Glass Weather Dashboard

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single-screen weather dashboard for a fictional forecast product. The whole
page is a fixed, fullscreen storm-lightning photo behind a dark vignette,
with a frosted sidebar, header, hero, forecast strip, and a translucent
right rail of location cards all reading as liquid glass over the real
photo underneath — no opaque panels, no drop-shadow stacks, no purple
gradients.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real product name, the
   welcomed user's name, the real location, condition headline, forecast
   numbers, and a background storm/weather photo at the same crop and mood.
3. **Preserve the design system.** The `--u` viewport-scaling unit, the
   glass gradient recipes (sidebar / tool / chip / card), the type scale,
   and the entrance choreography in the build spec below are the identity —
   do not substitute fonts, recolor the palette, or strip the specular sheen.
4. **Extend by duplicating a rail card**, never by importing a layout from
   another template. A fifth location follows the same `.card.row` markup
   as the existing three.
5. **Keep motion and controls accessible.** Every animation stays behind
   `prefers-reduced-motion` (the chart ships fully drawn, the sheen is
   removed), the nav/tool buttons carry real `aria-label`s and visible
   `:focus-visible` rings, and the avatar has an inline-SVG fallback for a
   failed image load.

## Build spec

Described from the finished page in `example.html`.

### Scaling system

Every size and position is `calc(N * var(--u))`, where
`--u: min(100vw / 1357, 100dvh / 871)` — a single scalar that keeps the
whole 1357×871 desktop composition proportional at any window size. Layout
is absolute / edge-anchored (sidebar, header, hero, forecast strip, and
rail each pinned to two edges) so there is never a blank band as the
viewport resizes. Below 860px the page reflows to a static single column
with a fixed bottom icon dock (`--u` is recalculated against a 430px mobile
reference width); below 420px `--u` tracks `100vw / 430` directly.

### Palette & glass tokens

- Page fallback background: `#04121b`; ink: `#ffffff`.
- Full-bleed background photo (`assets/storm-background.jpg`) with a
  three-layer dark vignette (`::after` on `.stage`) so text stays legible
  over any part of the image.
- Sidebar / tool / chip / card surfaces are all translucent white gradients
  (`rgba(255,255,255,.09–.26)`) with `backdrop-filter: blur(...) saturate(115–118%)`
  — the "liquid glass" language — plus a one-shot specular sheen (`::after`,
  skewed gradient sweep) on cards and the chip.
- `--accent: #5eead4` is the one chromatic root token, and it is scoped
  **only** to the `:focus-visible` outline. The resting render is
  intentionally monochrome (white ink + glass over photo), so the accent
  never appears until a control is focused — the permitted "additive
  accessibility" deviation for a genuinely monochrome design.

### Typography

- Body: Inter 400/500/600/700. Headline: Inter Tight 500.
- `h1` (the "Strom / with Heavy Rain" headline): `calc(63*u)` / line-height
  `calc(78*u)` / letter-spacing `calc(.25*u)`, each line masked in an
  `overflow:hidden` wrapper for the reveal animation.
- The big rail temperature (`10°C`) runs at `calc(92*u)` with a tight
  `calc(-4.4*u)` letter-spacing; the "C" unit sits in an `<i>`.

### Layout, section by section

1. **Sidebar** — logo mark (inline SVG, clipped wavy-line "wordmark" in a
   rounded square), an active-page pip, five nav icons (Dashboard active,
   Reports, Explore regions, Calendar, Settings), and a sign-out control
   pinned to the bottom.
2. **Header** — "Welcome" / display-name stack on the left; add-location,
   search, notifications, and an avatar button (photo with an inline-SVG
   fallback on load error) on the right.
3. **Hero** — a glass chip ("Weather Forecast"), the masked two-line
   headline, and a fixed-width blurb paragraph with a clip-path wipe-in.
4. **Forecast strip** — a six-item temperature row (each paired with a
   weather icon), a hand-authored SVG wave chart that draws its stroke
   then wipes its fill left-to-right, and a day-of-week row with the
   active day bolded.
5. **Right rail** — one large "big" card (place name, giant temperature,
   a three-metric row: wind / precipitation / gust) followed by three
   compact row cards (country, city, condition, temperature + icon).

### Icon system

Nineteen inline `<symbol>` definitions (`i-grid`, `i-chart`, `i-globe`,
`i-cal`, `i-gear`, `i-out`, `i-plus`, `i-search`, `i-bell`, `i-pin`,
`i-wind`, `i-drop`, `i-gust`, `i-cloud`, `i-cloud2`, `i-hail`, `i-sun`,
`i-avatar`, `i-logo`) live once in a hidden sprite `<svg>` and are consumed
everywhere via `<use href="#i-...">` — no icon font, no external requests.

### Motion inventory

- **Entrance choreography** (plays once, ~50ms–2.55s, `animation-fill-mode: both`):
  sidebar slides in from the left; the logo pops in; nav items and the
  sign-out icon rise in with a staggered delay; the active-page pip grows
  vertically; the header greeting and tool buttons rise/pop in; the hero
  chip wipes open; the two headline lines mask-reveal upward; the blurb
  clip-wipes down; the four rail cards slide in from the right; the six
  temperatures rise in on a stagger; the chart strokes draw themselves
  (`stroke-dashoffset` 1→0) and the fill wipes left-to-right roughly 220ms
  behind the pen; the day labels rise in on a stagger; a specular sheen
  sweeps once across every glass card and the chip.
- **Micro-interactions:** nav links and the sign-out icon lift and go
  fully opaque on hover/focus; tool buttons brighten their glass on
  hover/focus; every focusable control gets a visible `:focus-visible`
  ring (the one chromatic accent in the page).
- **`prefers-reduced-motion: reduce`:** every animation/transition is
  collapsed to effectively instant, the sheen sweep is removed, and the
  chart renders fully drawn and filled instead of animating in.

### Responsive behavior

At ≤860px the fixed absolute layout gives way to a static, vertically
scrolling single column (header → hero → forecast → rail), the sidebar
becomes a fixed bottom icon dock (pip and logo hidden, entrance switches
to a plain rise-in), and the temperature/day rows wrap and shrink to stay
inside the viewport with no horizontal scroll. Verified with a headless
375px render.

## Asset & font notes

- **Background photo:** the original prompt's storm photo was an
  ~238KB base64 JPEG embedded directly in the source CSS, not a URL —
  it was not retrievable through this build's inputs. `assets/storm-background.jpg`
  is a substitute Unsplash photo (multiple lightning strikes over a dark
  field under cumulonimbus cloud, free Unsplash License, photographer
  Greg Johnson), color-graded with a hue/vignette pass to match the
  prompt's specified "cool teal-green / deep blue-black" mood and the
  reference screenshot's contrast profile.
- **Avatar photo:** vendored locally from the exact Unsplash URL the
  prompt specified (`assets/avatar.jpg`), rather than hot-linked, per this
  catalog's asset-vendoring rule.
- **Fonts:** Inter (400/500/600/700) and Inter Tight (500) via Google
  Fonts — an exact match for the prompt's specified families, no
  substitution needed.
- **Display name:** the prompt's reference render greets a named person
  next to a stock headshot. Per this batch's real-person rule, the
  displayed name was replaced with a fictional one ("Raka Mahendra"); the
  avatar photo is unidentified Unsplash stock photography, which is
  permitted as-is.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="forecast-center" type="text/html" title="Forecast Center — Liquid-Glass Weather Dashboard">
<!doctype html>
<html>...</html>
</artifact>
```

