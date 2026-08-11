---
name: nimbus-pricing-table
description: |
  Dark ink-and-gold pricing section for the fictional cloud storage brand **Nimbus Grid**, built as a single self-contained HTML page. A two-column top block pairs pricing copy with a five-row usage table, three plan cards (Starter, Team, Enterprise) follow below, and twelve full-bleed gold bars undulate at the bottom in a scroll-driven wave. Wrapped in a slim header and one-line footer so the section reads as a real page rather than a stranded fragment.
tags:
  - "component"
  - "motionsites"
  - "pricing"
  - "saas"
  - "dark-mode"
triggers:
  - "nimbus grid"
  - "pricing table"
  - "pricing section"
  - "usage pricing"
  - "gold bar wave"
  - "storage pricing"
  - "3 tier pricing"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=nimbus-pricing"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build a dark ink-and-gold pricing section like this one, in this template's own visual system, but for my real product. Follow the build spec exactly — palette, typography, table/plan-card composition, and the scroll-driven bar wave are part of the identity. Ask only for the missing essentials first: brand name, real pricing rows, and plan copy to swap in."
---

# Nimbus Grid Pricing — Gold Bar Wave

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Dark ink-and-gold pricing section for the fictional cloud storage brand **Nimbus Grid**, built as a single self-contained HTML page. A two-column top block pairs pricing copy with a five-row usage table, three plan cards (Starter, Team, Enterprise) follow below, and twelve full-bleed gold bars undulate at the bottom in a scroll-driven wave. Wrapped in a slim header and one-line footer so the section reads as a real page rather than a stranded fragment.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, usage-pricing
   rows, plan names/copy, and CTA destinations. Keep the same number of table
   rows and plan cards unless the user explicitly wants more or fewer.
3. **Preserve the design system.** The palette, type scale, and gold-bar motion
   in the build spec below are the identity — do not substitute fonts,
   recolor the palette by hand, or strip the bar wave. Recoloring should go
   through the root `:root` tokens (the gradients already reference them via
   `color-mix()`), not through literal color edits scattered in the CSS.
4. **Extend by duplicating structure**, never by importing a layout from
   another template. A fourth plan card or a sixth pricing row should copy
   the existing markup pattern, not invent a new one.
5. **Keep motion accessible.** The scroll-driven bar wave must stay behind
   `prefers-reduced-motion`, as the build spec requires — reduced motion
   should leave the bars at their literal base heights, not switch to a
   different treatment.

## Build spec

### Palette

Dark ink-and-gold theme, tokens on `:root`:

- `--bg: #17130d`, page background.
- `--ink: #fff4d5`, primary text and highlight color.
- `--muted: #dacaa1`, secondary text and the "muted" bar variant.
- `--accent: #ead09a` / `--accent-2: #ffd879`, the two chromatic gold
  accents — used for the brand mark, the billing-mode chip, and as the
  gradient source for the non-muted bars.
- `--deep: #4d3f24`, a dark gold-brown token from the prompt's own root
  block (not directly consumed by this section's CSS, kept because the
  prompt's Global Setup declares it site-wide).
- `--line` / `--glass` / `--glass-strong`, translucent ink used for
  hairlines and glassy chip/nav-CTA backgrounds.
- `--bar-glow`, `--bar-gold-deep`, `--bar-muted-gold`, `--bar-muted-deep`:
  four additional root tokens holding the exact opaque RGB colors behind
  the gold bar gradients (`rgb(255,247,222)`, `rgb(87,76,43)`,
  `rgb(201,180,124)`, `rgb(78,69,42)` — none of these match an existing
  token digit-for-digit, so they're kept as their own variables rather than
  approximated onto `--ink`/`--muted`/`--deep`).

The gold bar gradients (`.pricing-bar`, `.pricing-bar.muted`) are built with
`color-mix(in srgb, var(--token) P%, transparent)` instead of literal
`rgba()` stops, referencing `--accent` (an exact match for the prompt's
`rgb(234,208,154)` stop) plus the four dedicated bar tokens above — so a
recolor pass that retints those tokens on `:root` propagates straight into
the bars. `color-mix` against `transparent` reproduces the exact same RGB
channels as the source token at `P%` alpha, so every stop renders
pixel-identical to the prompt's original literal values; this is a plumbing
change, not a color change. The decorative cyan corner blur, the section's
own top-of-page wash, and the neutral near-black overlays stay fully
literal — they weren't the surface this conversion was scoped to.

### Type

`IBM Plex Sans` (400/500, body) and `IBM Plex Mono` (400/500, eyebrow label,
table figures, buttons, nav) from Google Fonts — no substitution needed, both
weights ship as specified.

### Layout

1. **Header** (page chrome) — brand mark + wordmark, an `sr-only` `<h1>` for
   correct heading order, and a two-link nav (`Pricing`, a `Get started` CTA
   pill) anchored to in-page targets.
2. **Pricing section** — the deliverable:
   - `pricing-top`: a two-column grid. Left column is an eyebrow + long-form
     `h2` headline + supporting paragraph. Right column is a usage-cost
     table: a header row with a decorative per-month/per-GiB billing-mode
     indicator, then five label/value rows.
   - `pricing-plan-row`: three plan cards (Starter, Team, Enterprise), each
     a heading, a one-line description, and a pill CTA link.
   - `pricing-bars`: twelve full-bleed vertical bars in an alternating
     gold/muted gradient pattern, fading up out of the section's dark
     background via an overlay gradient.
3. **Footer** (page chrome) — a single copyright line plus one nav link.

### Motion inventory

- **Scroll-driven bar wave** (the section's only motion): on `scroll` and
  `resize`, a progress value is computed from the section's position in the
  viewport, then two sine/cosine waves offset by each bar's index are summed
  into a `--bar-morph` custom property, added onto that bar's literal
  `--bar-height` via `calc()`. A short `transition: height 80ms linear`
  smooths the per-frame updates into a fluid roll across the twelve columns.
- Plan-card link hover/focus (`transition: border-color 160ms ease,
  background 160ms ease;`) is the prompt's own literal value, ported as-is.
  Nav-link and header-CTA hover/focus (invented chrome, not prompt-sourced)
  use a 160ms `cubic-bezier(0.23, 1, 0.32, 1)` ease-out already established
  elsewhere in this repo. No entrance reveals, marquee, or carousel — the
  prompt doesn't specify any for this section.

### Accessibility

- `pricing-bars` is `aria-hidden` (purely decorative); the billing-mode
  indicator carries its own `aria-label`.
- Heading order is `h1` (`sr-only` page title) → `h2` (`#pricing-title`) →
  `h3` (table header, plan headings) — no skipped levels even though the
  section only needs one visible heading tier.
- A skip link jumps straight to `#pricing`.
- `:focus-visible` is styled everywhere interactive (nav links, CTA pills,
  plan links).
- The Enterprise card's "talk to sales" link and the header CTA both resolve
  to the real `#plans` anchor on the plan-card row — no dead in-page links.

### Responsive

The prompt's own two breakpoints: at 820px the copy/table pair and the three
plan cards stack to one column and table rows go label-over-value; at 520px
plan-card width narrows and the eyebrow shrinks. The gold bars stay a fixed
480px tall and full-bleed width (`100vw` with a negative margin, ported
as-is) at every size. Verified with headless Playwright at 1440×900 and
375×812: `document.documentElement.scrollWidth === window.innerWidth` at
both sizes with no extra CSS — the classic "`100vw` wider than the
scrollbar-gutter viewport" failure mode this technique can hit simply
didn't occur, so no defensive `overflow-x: hidden` was added.

### Reduced motion

`@media (prefers-reduced-motion: reduce)` drops the decorative hover/focus
transitions. More importantly, the bar-wave script checks
`matchMedia("(prefers-reduced-motion: reduce)")` before ever attaching its
`scroll`/`resize` listeners (and listens for a live OS-setting change to
detach/reattach). When motion is reduced, `--bar-morph` is never set, so the
bars sit still at their literal `--bar-height` values via the `calc()`
fallback — a dignified static version of the same bar chart, not a
different layout.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="nimbus-pricing-table" type="text/html" title="Nimbus Grid Pricing — Gold Bar Wave">
<!doctype html>
<html>...</html>
</artifact>
```

## Source note

Generated output under a MotionSites unlimited-plan subscription
(`https://motionsites.ai/?prompt=nimbus-pricing`). The upstream prompt text
is design evidence only and is not included in this repository or this file
— everything above describes the page actually built, in this project's own
words. No upstream license claim is made; this is not a `vendored_from`
entry, and there is no standalone `.js` file — all script is inline in
`example.html`.
