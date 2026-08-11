---
name: apex-program-accordion
description: |
  A single-open curriculum accordion on a near-black canvas: a centered pill
  badge and heading sit above a dark card holding four course modules. Each
  module row shows an uppercase eyebrow and subtitle with a circular chevron
  that rotates on toggle; opening one module closes any other. The card
  carries a 1px border that glows with a soft white radial gradient tracking
  the cursor anywhere on the page. Module rows and the header fade up on
  scroll, staggered per module.
tags:
  - "component"
  - "motionsites"
  - "accordion"
  - "curriculum"
  - "faq"
triggers:
  - "accordion"
  - "curriculum"
  - "course modules"
  - "collapsible list"
  - "faq accordion"
  - "single open accordion"
  - "spotlight border"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=apex-program-accordion"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build the Apex Program curriculum accordion as a self-contained section in this template's own visual system. Follow the build spec below exactly — palette, typography, motion, and the single-open accordion behavior are part of the identity. Ask only for the missing essentials first: real module titles, real lesson copy, and any real course branding to swap in."
---

# Apex Program — Course Curriculum Accordion

Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A four-module course curriculum accordion on a pure-black page. The card
opens with its first module expanded; clicking any module header closes
whatever else is open and expands that one, with the header's circular
chevron button rotating 180° in step. The whole card sits inside a 1px
border ring whose glow follows the pointer anywhere on the page. The pill
badge, the heading, and each module row fade up into place as they scroll
into view.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace the module titles and lesson copy** with the user's real
   curriculum, keeping the eyebrow/subtitle/lesson-list structure per module.
3. **Preserve the design system.** The near-black palette, the 16px-radius
   card, the spotlight border, and the fade-up/accordion motion are the
   identity — do not substitute fonts, recolor the palette, or strip the
   spotlight effect.
4. **Extend by duplicating a module block** (the `<details class="module-accordion">`
   markup), never by importing an accordion pattern from another template.
5. **Keep motion accessible.** Fade-up and the accordion's height/opacity
   transition both honor `prefers-reduced-motion`, as the build spec below
   requires.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="apex-program-accordion" type="text/html" title="Apex Program — Course Curriculum Accordion">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

### Palette

Genuinely monochrome design — no chromatic accent in the resting render.

- Page background: `#000000`
- Card background: `#161616`
- Foreground text: near-white (`#f5f6f7`), used at full, 85%, 80%, 70%, and
  50% opacity for the type hierarchy
- Borders / fills: white at 4%, 6%, 10%, 15%, and 20% opacity
- `--accent` (`#4e9eff`) is scoped exclusively to the `:focus-visible`
  outline, per the recolor-compatible token requirement — it never appears
  in the resting visual.

### Typography

Inter (Google Fonts, weights 300–700). Heading is `1.875rem` below the
640px breakpoint and `2.25rem` at and above it (a hard breakpoint jump, not
a fluid scale) with `-0.02em` tracking and `1.05` line-height. Module
eyebrows are `11px` uppercase with `0.2em` tracking. Module subtitles are
`1.125rem` under 640px, `1.25rem` at and above it. Lesson rows are `14px`.

### Layout

- Slim top nav (`Apex Program` wordmark) and generous vertical breathing
  room are page chrome around the section — the section itself is the
  deliverable, per the section-as-page rule.
- Section container: max-width `1080px`, horizontal padding `1rem`/`1.5rem`
  under/over 640px.
- Centered header: pill badge, then heading, `48px` margin below.
- Card: `16px` border radius, `1px` border at 10% white, `#161616`
  background, horizontal padding `1.5rem`/`2rem` under/over 640px.
- Four module rows, each divided by a `1px` 10%-white top-ish border (via
  `border-bottom` on all but the last row).

### Motion inventory

- **Fade-up scroll reveal** — `IntersectionObserver` (threshold 0.3, fires
  once), animating `opacity 0→1` and `translateY(24px→0)` over `0.6s` with
  `cubic-bezier(0.22, 1, 0.36, 1)`. The badge fires at 0s delay, the heading
  at 0.1s, and each module row staggered by `0.15s × index`.
- **Accordion open/close** — clicking a module header's `<summary>` measures
  the panel's natural height and animates `height` and `opacity` over `300ms
  ease-in-out`; only one module stays open at a time (opening one collapses
  any other with the same animation). Native `<details name="curriculum-modules">`
  grouping is the no-JS fallback.
- **Chevron rotation** — the 36px circular chevron button rotates 180° over
  `300ms`, synchronized with the header click rather than the collapse
  animation's end, matching the original's simultaneous rotate + collapse.
- **Spotlight border** — a global `mousemove` listener writes `--spot-x` /
  `--spot-y` custom properties (relative to the card wrapper) driving a
  `520px` radial gradient at 50% white opacity, masked to a 1px ring around
  the card.
- All motion is wrapped in `@media (prefers-reduced-motion: reduce)`:
  fade-up skips the translate and animates near-instantly, and the accordion
  still opens/closes correctly but without the height/opacity transition.

### Accessibility

- Each module uses native `<details>`/`<summary>` (per this batch's second
  accordion pattern), giving screen readers built-in expanded/collapsed
  state without hand-rolled `aria-expanded`. All four share
  `name="curriculum-modules"` so a no-JS browser still enforces single-open
  behavior natively; JS drives the animated version and keeps the `open`
  attribute in sync with the visible state at all times.
- All decorative icons (`expand_more`, `check`) are `aria-hidden="true"`;
  the accessible name for each control comes from the visible eyebrow +
  subtitle text inside the `<summary>`.
- `:focus-visible` renders a real focus ring (the page's only chromatic
  accent) without altering the resting appearance.
- Keyboard: `Tab` reaches each summary in document order; `Enter`/`Space`
  toggles it exactly like a click (browsers dispatch `click` for both).

### De-branding

The original prompt's Module 1 lessons named a real AI product ("Claude")
twice as a specific tool being taught. Both mentions were replaced with the
fictional tool name **Nova** ("What is Nova and 10+ other best AI tools for
design", "Setting up Nova"); layout, weight, and visual role are unchanged.
"GitHub" and "Vercel" were left as-is — they appear as generic developer
infrastructure named in a single lesson title ("GitHub & Vercel Deploy"),
not as the page's brand identity, the same way this spec itself names
Google Fonts as plumbing.

### Assets

None. The design is pure typography, CSS, and Material Symbols Outlined
icon glyphs (Google Fonts) — no photography, video, or SVG art to vendor.
