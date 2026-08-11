---
name: glassmorphic-feature-tabs
description: |
  Dark glassmorphic "Core Features" tabs section for the fictional product **UI Rocket**, built as a single self-contained HTML page. A four-way tab bar (Exclusive Tutorial, Courses, Templates, Animated Backgrounds) drives a cross-fading image stage layered with a scaled dashboard mockup, framed by mouse-tracked spotlight borders, with auto-rotation, arrow controls, and a crossfading caption. Full ARIA tablist/tab/tabpanel semantics with roving tabindex and arrow-key navigation.
tags:
  - "component"
  - "motionsites"
  - "tabs"
  - "glassmorphism"
  - "dark-mode"
  - "dashboard-mock"
triggers:
  - "ui rocket"
  - "feature tabs"
  - "glassmorphic tabs"
  - "core features section"
  - "tab section"
  - "dashboard mockup"
  - "spotlight border"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=glassmorphic-feature-tabs"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build a dark glassmorphic feature-tabs section like this one, in this template's own visual system, but for my real product. Follow the build spec exactly — palette, typography, tab/mockup composition, and motion are part of the identity. Ask only for the missing essentials first: product name, the four feature labels/captions, and preview imagery to swap in."
---

# Glassmorphic Feature Tabs — UI Rocket

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A dark "Core Features" tabs section for the fictional product **UI Rocket**. A
header pairs a pill badge and an editorial heading with a short supporting
paragraph. Below it, a four-way ARIA tablist (Exclusive Tutorial, Courses,
Templates, Animated Backgrounds) drives a single image stage: the active
tab's preview photo cross-fades under a glassmorphic dashboard mockup
(sidebar nav + header + content grid) that swaps its body content per tab.
Three glass panels — the tab bar, the stage, and an arrow/caption control
bar — each carry a mouse-tracked white spotlight that traces a 1px gradient
border around the cursor. Tabs auto-rotate every 5 seconds until the visitor
interacts, hovers, or focuses inside the section, and never auto-rotate under
`prefers-reduced-motion`.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real product name, header
   copy, the four tab labels/captions, and the preview imagery in `assets/`.
   Keep image dimensions close to the vendored 1280×724 stage photos.
3. **Preserve the design system.** The near-black scaffold, the
   purple→pink→orange accent gradient, the glassmorphic dashboard mockup, and
   the spotlight-border treatment on all three control shells are the
   identity — do not substitute a different accent palette or strip the
   mouse-tracked border effect.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. This page is intentionally tabs-only; if a second
   section is needed, design it from scratch in this template's own
   vocabulary (same tokens, same easing).
5. **Keep the tabs accessible.** `role="tablist"`/`"tab"`/`"tabpanel"`,
   `aria-selected`, roving `tabindex`, and Left/Right/Home/End arrow-key
   navigation are load-bearing — do not flatten them into plain `<div>`s or
   drop the keyboard handlers when extending this section.
6. **Keep motion accessible.** Scroll reveals collapse and auto-rotation
   never starts under `prefers-reduced-motion`, as the build spec requires.

## Build spec

### Palette

- `--bg` (`#000000`) — page background, literal neutral, protected from the
  recolor pass by design.
- `--fg`, `--fg-dim`, `--fg-dimmer`, `--fg-faint` — white text at 100%, 65%,
  50%, and 40% opacity.
- `--line`, `--line-soft`, `--surface`, `--surface-strong` — translucent
  white borders/fills used for every glass panel and card.
- `--accent-a` (`#9e67fa`, violet), `--accent-b` (`#fe6abb`, pink), and
  `--accent-c` (`#ff9c65`, amber) — the three genuinely chromatic root
  tokens, sampled from the mockup's own brand-icon gradient
  (`linear-gradient(135deg, rgb(158,103,250), rgb(254,106,187) 50%,
  rgb(255,156,101))`). Every gradient built from them reads its stops
  through `var()`.
- `--accent-blue` (`#3b82f6`) — the header icon box / "Invite" pill accent
  inside the dashboard mockup.

### Type

Google Fonts **Inter** (weights 300–700), matching the prompt exactly. Icons
use Google Fonts **Material Symbols Rounded** (variable, `opsz,wght,FILL,GRAD`
axis) as text-content ligatures (`grid_view`, `rocket_launch`, `arrow_back`,
…), also matching the prompt exactly — both were already Google-hosted, no
substitution needed. Header sizes are exact Tailwind-scale breakpoint steps,
not fluid `clamp()`: the heading is `1.875rem` below 640px and `2.25rem` at
`≥640px` (`line-height:1.05`, `letter-spacing:-0.02em`); the right-column
paragraph is `0.875rem` below 640px and `1rem` at `≥640px`. The dashboard
mockup's internal type/icon/padding sizes are expressed as CSS container
query units (`cqw`, scoped to the stage frame's `container-type:
inline-size`), each computed directly from the prompt's fixed 900×562-canvas
pixel values (`value_cqw = value_px / 900 × 100`), with pixel fallbacks for
browsers without container-query-unit support — so the whole mockup scales
as one unit with its container width while preserving the source's exact
internal proportions.

### Layout

One `<section class="features">` inside `<main>`, background `#08020e`
(`hsl(270 80% 3%)`, the prompt's `--background` token) with the prompt's own
`py-12 sm:py-16` vertical padding (`3rem` / `4rem` at `≥640px`); `<main>`
itself adds a small amount of extra breathing room above/below (flat
`#000000`, no invented decoration) so the section reads as placed on its own
page rather than stranded, per the batch's section-page rule:

1. **Header row** — pill ("Core Features") + two-line heading on the left,
   a short supporting paragraph on the right; stacks on mobile, splits
   `flex-row` at 768px.
2. **Tab pill bar** (desktop/tablet only, `≥640px`, matching the source
   design) — a glass pill shell with a mouse-tracked spotlight border,
   containing the `role="tablist"` of 4 tabs. Each tab hugs its own label
   width (`justify-items:start` on the grid) rather than stretching to an
   equal column, matching the reference screenshot. Hidden below 640px; the
   arrow/caption bar below remains the mobile equivalent.
3. **Image stage** — a glass shell (spotlight border, size 600/intensity
   0.5, `border-radius:1rem` — Tailwind's `2xl`) around a `16:10` frame.
   Four `<img>` cross-fade absolutely stacked (400ms opacity), one per tab,
   sourced from `assets/tab-*.webp`. Layered over them (`inset:4px`,
   `padding:3%`/`4%` at `≥640px`, matching `inset-1 p-[3%] sm:p-[4%]`), four
   `role="tabpanel"` mockups cross-fade (300ms opacity): each renders a
   glassmorphic "dashboard" card (sidebar nav + header + content) that
   mirrors the currently active tab. Per the reference screenshot: Courses
   and Templates each render a 2×2 grid of 4 cards (not the prompt prose's
   "2×3"/"3×2" reading — the rendered site shows exactly 4 items per tab in
   two columns); Animated Backgrounds keeps a 3×2 grid of 6 tiles, each
   overlaid with a small "Copy URL" pill instead of a play badge, matching
   the reference exactly; Exclusive Tutorial renders one full-width featured
   card (LIVE badge, overflow-menu dot, centered play glyph, duration badge,
   title + meta below) rather than the prose's "60% + 3 rows" split, which
   the reference screenshot does not show. The mockup's visual chrome is
   `aria-hidden`; each panel carries a `sr-only` summary sentence instead,
   since the caption bar already announces the same information live.
4. **Arrow / caption bar** — a third spotlight-bordered glass pill with
   previous/next icon buttons (`arrow_back`/`arrow_forward`, both size 16)
   flanking an `aria-live="polite"` caption that shows the short label on
   mobile and the full caption sentence at `≥640px`.

### Motion inventory

- **Scroll reveal (`FadeUp` translation)** — `.reveal` elements (pill,
  heading, paragraph) start `opacity:0; translateY(24px)`, animated to
  final state over 600ms (`cubic-bezier(0.22,1,0.36,1)`) via an
  `IntersectionObserver` (`threshold:0.3`, fires once), with per-element
  `--reveal-delay` staggering (0s / 0.1s / 0.2s).
- **Spotlight border** — each of the three glass shells listens for
  `pointermove`/`pointerleave` and writes `--spot-x`/`--spot-y` custom
  properties consumed by a `radial-gradient` + `mask-composite: exclude`
  overlay, tracing a soft white 1px border around the cursor.
- **Tab cross-fade** — the active stage image and dashboard mockup fade in
  (400ms / 300ms opacity) while the outgoing pair fades out.
- **Caption cross-fade** — on tab change, the caption text exits
  (opacity→0, `translateY(-6px)`), swaps text after 125ms, then enters from
  `translateY(6px)` back to rest — a vanilla-JS/CSS translation of the
  prompt's `AnimatePresence mode="wait"`, ~250ms total.
- **Auto-rotation** — advances one tab every 5000ms via `setInterval`.
  Stops permanently on the first click or keyboard activation, and pauses
  (without permanently stopping) while the pointer hovers or focus sits
  anywhere inside the section — satisfying the spec's carousel/slider rule
  that auto-advance must stop on focus and hover, in addition to the
  prompt's own "stop after first interaction" behavior.
- **Hover/press micro-interactions** — arrow buttons brighten on hover and
  scale to 0.94 on press, both on the shared UI easing
  `cubic-bezier(0.23,1,0.32,1)`.
- **`prefers-reduced-motion: reduce`** — scroll reveals render in their
  final state with no transition; the auto-rotation `setInterval` is never
  started at all (checked once at load via `matchMedia`); cross-fade and
  caption transitions collapse to near-instant. The mouse-tracked spotlight
  border is left active, since it is pointer-driven rather than autoplaying
  and carries no vestibular risk.

### Accessibility

- Real `role="tablist"` / `role="tab"` / `role="tabpanel"` wiring:
  `aria-selected` reflects the active tab, `aria-controls`/`aria-labelledby`
  pair each tab with its panel, and a roving `tabindex` keeps exactly one
  tab in the page tab order at a time.
- **Left/Right arrow keys** move focus and activate the adjacent tab
  (wrapping); **Home/End** jump to the first/last tab.
- Visible focus via a shared `:focus-visible` outline in the pink accent.
- The arrow/caption control bar duplicates tab-switching for pointer/touch
  users and via real `<button>`s with accessible names ("Previous feature"
  / "Next feature"); the caption region is `aria-live="polite"` so screen
  reader users hear the active feature announced on every change.
- The decorative dashboard mockups are `aria-hidden`; each tabpanel instead
  carries a concise `sr-only` sentence describing what the mockup shows, so
  assistive tech gets the content without a wall of decorative markup.

### Deviations from the prompt (with reason)

Checked against the `preview_url` screenshot (an animated WebP of the live
render) as ground truth, per the fidelity standard. Colors, radii, spacing,
breakpoints, and motion timings were corrected to the prompt's exact stated
values; the items below are the only remaining departures, each required by
`SPEC.md`'s authoring rules or by a genuine conflict between the prompt's
prose and its own rendered screenshot (screenshot wins):

- **`TabDashboardMock`'s fixed 900×562 canvas + `ResizeObserver` +
  `transform: scale()`** is translated to a fluid layout using CSS
  container query units (`cqw`) on `.stage-frame` (`container-type:
  inline-size`), with every internal measurement computed from the same
  900px-canvas pixel values the prompt specifies. Permitted under
  React/Tailwind→vanilla translation.
- **Courses and Templates render 4 cards in a 2×2 grid, not 6.** The
  prompt's prose says "2×3" / "3×2 grid of cards," but the reference
  screenshot clearly shows exactly 4 cards in 2 columns for both tabs.
  Screenshot taken as ground truth over the ambiguous prose per the fidelity
  standard.
- **Exclusive Tutorial renders one full-width featured card, not a
  "60% + 3 stacked rows" split.** The reference screenshot shows a single
  large video-style card (LIVE badge, overflow menu, centered play glyph,
  duration badge, title + meta below) filling the panel body, with no
  second column of rows visible. Screenshot taken as ground truth.
- **Six CloudFront background-loop MP4s** (`bg1.mp4`…`bg6.mp4`) were not
  vendored. The prompt itself specifies a fallback for exactly this case
  ("if a specific URL 404s, fall back to the matching higgs.ai poster image
  as a static tile"); the Animated Backgrounds tiles use that documented
  fallback — the four vendored nature-scene stage photos, two repeated for
  a full 3×2 grid of 6 — each overlaid with the reference's own "Copy URL"
  pill rather than a play badge.
- **The Exclusive Tutorial featured-card thumbnail** reuses the vendored
  `assets/tab-tutorial.webp` per the prompt's own instruction ("Tutorial
  thumbnails: reuse the four `images.higgs.ai` URLs from the tabs array");
  the reference screenshot's specific demo artwork for that card was not
  vendored as a separate asset and was out of scope to fetch fresh.
- **The remote pravatar.cc avatar** (`https://i.pravatar.cc/64?img=12`) is
  replaced with a CSS-only two-letter avatar badge (accent gradient +
  initials) to avoid a remote image dependency, per the no-hotlinking rule.
- **Course/template card copy** (titles, lesson counts, categories) is
  invented placeholder content in the section's own voice — the prompt
  explicitly says to "compose roughly" for these cards and gives no exact
  copy; the reference screenshot's own demo copy ("Zero to One," "Clone Any
  Website Using Claude Opus 4.6," …) is unrelated placeholder content from
  whatever account produced that capture, not part of the design spec.
- **Icon optical-size axis (`opsz`)** is fixed at a representative value
  per icon rather than matching each instance's exact rendered pixel size
  (the source sets `opsz` dynamically per `MIcon` instance). `FILL`/`GRAD`/
  `wght` match exactly; the `opsz` simplification is not visually
  distinguishable at these icon sizes.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="glassmorphic-feature-tabs" type="text/html" title="Glassmorphic Feature Tabs — UI Rocket">
<!doctype html>
<html>...</html>
</artifact>
```

## Source note

Derived from a MotionSites prompt for a product referred to throughout as
"UI Rocket" — not a real trademark, kept as-is. Vendored assets: four
1280×724 nature-scene stage photos (`tab-tutorial.webp`, `tab-courses.webp`,
`tab-templates.webp`, `tab-backgrounds.webp`), two dashboard-mock card
covers (`module-cover-1.png`, `module-cover-2.png`), and a play-icon SVG —
all confirmed against the prompt's own `preview_url` screenshot as the
correct imagery for each tab. Fonts (Inter, Material Symbols Rounded) were
already Google-hosted; no substitution needed.
