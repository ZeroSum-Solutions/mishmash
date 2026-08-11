---
name: dashboard-ui
description: |
  Premium liquid-glassmorphism conference dashboard for a fictional video-meeting
  product. A four-column, two-row room grid — glass "create room" tile, solid and
  translucent room cards, a hand-built weekly-activity bar chart, and a
  horizontally-scrolling screen-share strip — sits over a fixed fullscreen video
  backdrop that swaps between a starry night loop and a sunlit grass-hill loop as
  the light/dark toggle is thrown. A floating bottom participant bar with animated
  voice-wave indicators, a components launcher, and video/mic toggle controls are
  pinned to the viewport. Built as one self-contained page: inline SVG icons, no
  chart library, real ARIA switch/radiogroup semantics on the toggle and view
  switcher, and a `prefers-reduced-motion` fallback throughout.
tags:
  - "dashboard"
  - "motionsites"
  - "glassmorphism"
  - "video-conferencing"
  - "dark-mode"
  - "data-viz"
triggers:
  - "conference dashboard"
  - "dashboard ui"
  - "glassmorphism dashboard"
  - "video call dashboard"
  - "rooms dashboard"
  - "meeting dashboard"
  - "liquid glass ui"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=dashboard"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "dashboard"
  scenario: "operations"
  example_prompt: "Build a liquid-glassmorphism conference dashboard like this one, in this template's own visual system, but for my real product. Follow the build spec exactly — palette, card grid, chart, and motion are part of the identity. Ask only for the missing essentials first: product name, room/meeting names, and participant imagery to swap in."
---

# Dashboard UI — Conference Dashboard

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single-screen "Rooms" view for a fictional video-conferencing product. The
whole page sits on a fixed, fullscreen looping background video — a starry
night hillside in dark mode, a sunlit grass hillside in light mode — with no
overlay tint, so every glass and solid surface reads its translucency against
real footage. A five-slot toolbar (profile, dark/light toggle + settings,
a dismissible meeting alert, a Dashboard/Rooms view switcher, search) sits
above a 4×2 room-card grid, three page-indicator dots, and a fixed bottom bar
of active participants. A components launcher and video/mic controls float in
the bottom corners.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real product name, room/meeting
   names, participant photos, and the two background video loops. Keep swapped
   images at the same crop and aspect ratio as the originals.
3. **Preserve the design system.** The glass/solid card vocabulary, the
   `--glass-bg` / `--accent-blue` / `--card-radius` tokens, the type scale, and
   the motion set in the build spec below are the identity — do not substitute
   fonts, recolor the palette, or strip the noise-texture overlay on glass cards.
4. **Extend by duplicating a card**, never by importing a layout from another
   template. A ninth room follows the same `.card` + variant classes as the
   existing eight.
5. **Keep motion and controls accessible.** The dark/light toggle is a real
   `role="switch"`, the view switcher is a roving-tabindex `role="radiogroup"`,
   and every animation stays behind `prefers-reduced-motion`, as the build spec
   requires.

## Build spec

### Palette & tokens (`:root`)

- `--glass-bg: rgba(255, 255, 255, 0.55)` / dark `rgba(0, 0, 0, 0.45)`
- `--glass-border: rgba(255, 255, 255, 0.6)` / dark `rgba(255, 255, 255, 0.08)`
- `--glass-blur: 8px`
- `--text-main: #1a1a1a` / dark `#ffffff`
- `--text-muted: #6b7280` / dark `#b0b0b0`
- `--accent: #000000` / dark `#ffffff`
- `--card-radius: 40px`
- `--transition: all 0.4s cubic-bezier(0.22, 1, 0.36, 1)`
- `--accent-blue: #3b82f6` (the mode-switch track, chart bars, "Screen Share"
  label — the one genuinely chromatic accent MishMash's recolor pass targets)
- `--accent-red: #ff4545` (muted mic/camera state)
- `--accent-orange: #e05e36` ("Alice" screen-share tag)
- `--card-solid-bg` / `--card-glass-empty-bg` — extra tokens (not in the
  original prompt's `:root` list) that carry the light/dark pairs the prompt
  gives prose-only ("solid card: `#fff` / dark `rgba(26,26,26,0.98)`"; "glass
  card: `rgba(0,0,0,0.18)` light / `rgba(255,255,255,0.08)` dark") so every
  card surface stays theme-reactive through one custom property instead of a
  duplicated selector per card.

Body: Inter (300–700), `height: 100vh`, `padding: 32px 40px`, flex column,
`overflow: hidden`, black fallback background under the video layer.

### Layout

- **Background:** two fixed, fullscreen `<video>` loops (autoplay, muted,
  loop, `playsinline`, `object-fit: cover`, `z-index: -1`), swapped by a
  `body.dark-mode` class; both carry a poster frame and pause when
  `prefers-reduced-motion` is set.
- **Toolbar** (`grid-template-columns: auto auto 1fr auto auto`): circular
  profile avatar → dark/light toggle + Settings pill → centered dismissible
  meeting alert (host avatar, "Meeting is about to start", a `-5:23` time
  pill, and a close button with an SVG progress ring) → Dashboard/Rooms view
  switcher (Rooms active by default) → circular search button.
- **Room grid** (`grid-template-columns: repeat(4, 1fr)`, 2 rows, 24px gap,
  1400px max-width): empty glass "Create a room" tile; five room cards mixing
  solid and glass surfaces, each with a header icon, title, subtitle, and a
  footer pairing an overlapping-avatar stack with a count badge; a "Weekly
  Insights" card carrying a 60-bar chart (24 blue + 36 grey, exact heights
  ported from the prompt) with an avatar-marker row and a play button; a
  "Screen Share" card with two pill chips and a drag-and-touch-scrollable
  4-thumbnail strip, one thumbnail carrying a floating "Alice" tag.
- **Page indicators:** three dots below the grid, first active.
- **Fixed overlays:** a centered glass participant bar (four avatars, two
  with animated voice-wave badges, a "+17" chip); a bottom-left "components"
  launcher (2×2 avatar grid); bottom-right video/mic toggle buttons that swap
  icon and go red when off.

### Motion inventory

- Card hover: `translateY(-3px) scale(1.01)` on the shared 0.4s
  cubic-bezier(0.22, 1, 0.36, 1) transition.
- Mode-switch handle: `translateX(-36px)` into dark mode on
  `cubic-bezier(0.4, 0, 0.2, 1)`; the small sun/moon glyph slides the
  complementary `translateX(42px)` on the same curve.
- Voice-wave bars: 3 staggered bars, `4px → 10px → 4px` height,
  `1s ease-in-out infinite`, 0 / 0.2s / 0.4s delays.
- Floating control hover: `scale(1.08)`.
- Every rule above collapses to `0.01ms` / one iteration and card/control
  hover transforms are neutralized under `@media (prefers-reduced-motion:
  reduce)`; the background videos are paused rather than autoplaying.

### Accessibility affordances (additive — do not change the rendered look)

- Dark/light toggle is a real `<button role="switch" aria-checked>` with a
  label that flips between "Switch to dark/light mode".
- View switcher is `role="radiogroup"` / `role="radio"` with roving
  `tabindex` and Left/Right arrow-key selection.
- Meeting-alert close, search, settings, video/mic toggles, the components
  launcher, and every card's "more options" icon are real `<button>`s with
  `aria-label`s; video/mic toggles also carry `aria-pressed`.
- The screen-share strip is a focusable (`tabindex="0"`), `aria-label`led
  scroll region reachable without the mouse-drag enhancement.
- All room-count avatar stacks and background media use `alt=""` /
  `aria-hidden="true"` as decorative; every content-bearing `<img>` (screen
  previews) carries a real `alt`.
- Toolbar sits in a `<nav>` landmark; cards are `<article>` with a real
  `<h3>` heading.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="dashboard-ui" type="text/html" title="Dashboard UI — Conference Dashboard">
<!doctype html>
<html>...</html>
</artifact>
```

