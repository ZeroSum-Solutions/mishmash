---
name: modern-hr-dashboard
description: |
  Single-screen HR operations dashboard for a fictional company, "Talvex."
  A warm cream backdrop with a huge blurred yellow blob glow sits behind a
  frosted-glass card grid: a pill navbar with a full nav-link set and a
  mobile hamburger dropdown, a greeting row with a proportional pipeline
  segment bar and three stat blocks, then six cards — a profile photo card,
  a hand-built activity bar chart, an SVG focus-timer ring with a real
  countdown, an induction/onboarding column with a dark pending-actions
  list, a native accordion of benefit categories, and a weekly team
  calendar. Explicit three-breakpoint grid (mobile stack, tablet 2-column,
  desktop 4-column with per-cell placement), all inline CSS/JS, no chart
  library, one genuinely chromatic accent, and a full
  `prefers-reduced-motion` fallback.
tags:
  - "dashboard"
  - "motionsites"
  - "hr"
  - "glassmorphism"
  - "data-viz"
  - "calendar"
  - "warm-light"
triggers:
  - "hr dashboard"
  - "talvex"
  - "employee dashboard"
  - "people ops dashboard"
  - "onboarding dashboard"
  - "hr management dashboard"
  - "focus timer dashboard"
  - "team calendar dashboard"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=modern-hr-dashboard"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "dashboard"
  scenario: "operations"
  example_prompt: "Build an HR operations dashboard like this one, in this template's own visual system, but for my real company. Follow the build spec exactly — palette, card grid, chart, and motion are part of the identity. Ask only for the missing essentials first: company name, the signed-in person's name, and any team photos to swap in."
---

# Modern HR Dashboard — Talvex

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single-screen HR operations dashboard for a fictional company, "Talvex."
Every surface is a frosted `backdrop-filter` card floating over a fixed,
full-bleed SVG background: a flat base rect under one huge, heavily
Gaussian-blurred yellow blob, so warmth pools in the lower half of the
viewport without ever becoming a literal gradient on any card. The whole
page fits one viewport on desktop (`height: 100vh`, `overflow: hidden`) and
becomes a scrolling stack on mobile/tablet, all driven by a single DOM tree
and CSS breakpoints rather than duplicated markup per screen size.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real company name, the
   signed-in person's name, task/calendar copy, and photography. Keep
   swapped images at the same crop and aspect ratio as the originals —
   the profile card in particular depends on a portrait-oriented photo.
3. **Preserve the design system.** The `--accent` / `--dark` / `--gray`
   tokens, the card radius and shadow values, the type scale, and the
   motion set in the build spec below are the identity — do not substitute
   fonts, recolor the palette, or strip the blurred background blob.
4. **Extend by duplicating a card**, never by importing a layout from
   another template. A seventh dashboard card follows the same `.card` +
   `.card-body` vocabulary as the existing six and needs an explicit
   placement rule added to all three grid breakpoints.
5. **Keep motion and controls accessible.** The accordion uses native
   `<details>`/`<summary>`, the focus timer's play/pause/reset are real
   buttons with a live countdown, the mobile nav is a real disclosure with
   `aria-expanded`/`aria-controls`, and every animation stays behind
   `prefers-reduced-motion`, as the build spec requires.

## Build spec

### Palette & tokens (`:root`)

- `--accent: #FFD85F` — the one genuinely chromatic token (yellow), used on
  the "Placed" pipeline pill, the Friday activity bar, the focus-timer ring,
  the induction "Task" segment, and done-state checkmarks.
- `--dark: #303030` — primary text and dark fills (nav pill, stat numbers,
  the induction task panel).
- `--gray: #898989` — secondary text, borders, icon tint.
- `--bg-base: #E3E5E6` — the flat rect under the blurred background blob.
- `--card-bg: rgba(255,255,255,0.6)` with `backdrop-filter: blur(64px)` —
  every card surface.
- `--card-shadow: 0 2px 20px rgba(0,0,0,0.06)`; the profile photo card uses
  a slightly heavier `0 2px 20px rgba(0,0,0,0.10)`.
- Font: **Manrope** (400–800) from Google Fonts, substituted for the
  prompt's "Sofia Pro Medium" (served from a non-Google `onlinewebfonts.com`
  stylesheet, which SPEC.md's asset rules don't allow). Applied at
  `font-weight: 500` on every element by default, matching the prompt's
  single "Medium" weight everywhere rather than the browser's default bold
  headings.
- `border-radius: 24px` on every card (`rounded-3xl` in the source spec).

### Background

A `position: fixed` full-bleed `<svg viewBox="0 0 1280 832" preserveAspectRatio="xMidYMid slice">`: a flat `#E3E5E6` rect, then a single yellow blob path behind an SVG filter chain (`feFlood` → `feBlend` → `feGaussianBlur`, `stdDeviation="250"`) that produces the soft, borderless glow pooling toward the bottom of the page. `z-index: 0`, `pointer-events: none`; all page content sits in a `z-index: 10`, `max-width: 1400px` centered shell above it.

### Layout — three explicit breakpoints

One DOM tree (navbar → greeting row → six-card grid) with CSS handling all
three shapes rather than three mounted copies:

- **Mobile (< 768px):** single-column flex stack, cards in reading order
  (profile → activity → focus timer → induction → accordion → calendar).
- **Tablet (768–1023px):** 2-column CSS grid; profile/activity/focus-timer/
  accordion each take one cell, calendar and induction each span both
  columns. Reordered via `order` (not duplicated markup) so the visual
  sequence matches the source spec without leaving a stranded empty grid
  cell.
- **Desktop (≥ 1024px):** 4-column × 2-row grid with explicit per-card
  placement — profile / activity / focus-timer across row 1, induction
  spanning both rows in column 4, accordion and a 2-column-wide calendar
  filling row 2.

### Cards

1. **Profile photo card** — full-bleed portrait photo, a `backdrop-filter:
   blur(18px) saturate(140%)` scrim masked to the bottom third
   (`mask-image: linear-gradient(...)`, a neutral black-to-transparent
   overlay — not a brand gradient, so it stays a literal value per SPEC.md),
   and an info bar with the fictional profile's name/role and a salary pill.
2. **Activity card** — a logged-hours stat plus a 7-bar chart (Sun–Sat)
   whose bar heights are computed in JS from each `data-value` against the
   container's real measured height (not CSS percentage heights, which
   don't resolve reliably inside a flex item whose own height is itself
   flex-resolved). The Friday bar is the one accent-colored bar with a
   static "5h 23m" callout pill above it.
3. **Focus timer card** — an SVG progress ring built from a `stroke-dasharray`
   arc (70% of the circumference, rotated -90° to start at 12 o'clock) plus
   60 tick marks generated by JS trigonometry, with the ticks inside the
   arc's own 70% omitted so only the remaining un-covered ticks show. Real
   play/pause/reset buttons drive an actual `setInterval` countdown from
   02:35.
4. **Induction (onboarding) card** — a three-segment proportional progress
   bar (Task / in-review / remaining) over a dark "Pending Actions" panel:
   five task rows with icon, title, time, and a checkbox that's either an
   accent-filled checkmark (done, strikethrough title) or an outlined empty
   circle.
5. **Accordion card** — four native `<details>`/`<summary>` benefit
   categories with a custom rotating chevron; "Hardware" ships open by
   default with a thumbnail, device name, and a "more" button.
6. **Calendar card** — a month header, a six-day header row (one day
   bolded as "today"), and an hour-labeled time grid with two absolutely
   positioned events (a dark all-hands, a light induction briefing), each
   carrying an overlapping avatar-group stack.

### Motion inventory

- A staggered fade-up reveal (`opacity 0→1`, `translateY(16px)→0`) on the
  navbar, greeting row, and each card on load. The animation's `forwards`
  fill is deliberately cleared via a JS `animationend` listener once each
  element settles — a filled `transform: none` endpoint still resolves to
  a real identity matrix in the computed style, which is enough to trap a
  positioned descendant's `z-index` inside an accidental stacking context
  (this is exactly what happened to the mobile nav dropdown during
  verification; see the note on it below).
- Activity bars animate in from `0` to their computed height with a
  persistent CSS `transition`, so a window resize glides to the new target
  instead of resetting to zero and flashing flat.
- Chevron rotation on accordion open/close; hover/background transitions on
  every pill and icon button.
- `@media (prefers-reduced-motion: reduce)` collapses every animation/
  transition duration to near-zero and forces the reveal's resting state.

### Accessibility

- Real `<button>` elements throughout (nav links, icon pills, timer
  controls, accordion "more" button) — native keyboard focus and Enter/
  Space activation, verified in a driven browser pass.
- Mobile hamburger nav is a disclosure pattern: `aria-expanded`,
  `aria-haspopup`, `aria-controls`, closes on outside click and `Escape`,
  and returns focus to the trigger.
- Accordion uses native `<details>`/`<summary>` for built-in keyboard and
  screen-reader semantics rather than a hand-rolled ARIA widget.
- The bar chart and the calendar's event grid each carry one
  `role="img"` summary `aria-label` describing the data, with the
  decorative bars/labels/lines marked `aria-hidden`.
- `:focus-visible` shows a visible accent outline without altering any
  resting-state appearance.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="modern-hr-dashboard" type="text/html" title="Talvex — HR Dashboard">
<!doctype html>
<html>...</html>
</artifact>
```
