---
name: rocket-faq-accordion
description: |
  Dark, monochrome FAQ accordion section for a fictional AI design-education
  product ("UI Rocket"), built as a single self-contained page. Three category
  tabs (General, AI & Capabilities, Integrations & Security) filter a
  right-hand column of five accordion questions each; native
  `<details>`/`<summary>` elements carry the disclosure semantics and animated
  open/close, and a "Got Questions?" contact card sits under the category
  list. A cursor-tracked 1px spotlight ring traces every card and button, and
  scroll-triggered fade-up motion staggers the header and each FAQ row.
tags:
  - "component"
  - "motionsites"
  - "faq"
  - "accordion"
  - "dark-theme"
triggers:
  - "faq"
  - "accordion"
  - "faq accordion"
  - "rocket faq"
  - "ui rocket"
  - "category tabs"
  - "questions"
  - "dark faq section"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=rocket-faq"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build the Rocket FAQ accordion section as a self-contained page in this template's own visual system. Follow the build spec below exactly — palette, category/tab structure, and motion are part of the identity. Ask only for the missing essentials first: brand name, real FAQ copy, and a contact email."
---

# Rocket FAQ — Accordion FAQ Section

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A pure black-and-white FAQ section built to stand alone as its own page. The
section itself is the deliverable — a slim page wrapper centers it vertically
so it reads as placed rather than stranded, with no invented hero, nav, or
filler sections around it.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real category names,
   questions/answers, and contact email. Keep the 3-category / 5-question
   shape unless the user explicitly wants more or fewer — the sticky
   left-column layout and the single-open accordion behavior both assume a
   short, scannable category list.
3. **Preserve the design system.** The palette is deliberately grayscale;
   don't introduce brand color into the FAQ cards, pills, or text. The one
   chromatic token (`--accent`) is reserved for the focus ring — see Palette
   below — and should stay that way even when rebranding.
4. **Extend by duplicating a category or an accordion item**, never by
   importing a layout from another template. Update the `FAQS` object in the
   inline `<script>` and the initial server-rendered "General" category
   markup together, or the no-JS fallback will show stale content.
5. **Keep motion accessible.** The accordion's animated height, the fade-up
   entrances, and the chevron rotation all read `prefers-reduced-motion` and
   fall back to an instant, static state — preserve that when extending.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="rocket-faq-accordion" type="text/html" title="Rocket FAQ — Accordion FAQ Section">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished page — see `example.html` for the exact values.

### Palette

- `--background: #000000`, `--foreground: #ffffff` with `/60`, `/70`, `/80`
  opacity steps used for secondary and tertiary text.
- `--surface: rgba(255,255,255,0.10)` — card and pill fill; `--surface-hover:
  rgba(255,255,255,0.16)` — open-accordion-card fill.
- `--hairline: rgba(255,255,255,0.10)` / `--hairline-15: rgba(255,255,255,0.15)`
  — borders.
- `--accent: #4e85bf` — the one genuinely chromatic root token, used **only**
  as the `:focus-visible` outline color. The source design has no color
  anywhere in it (it's intentionally grayscale), so this token is additive
  accessibility plumbing, not a design element: it never appears in the
  resting-state render, only on keyboard focus, which is why it can exist
  without breaking fidelity to the monochrome original.

### Type

Inter (400/500/600) for all text. Material Symbols Outlined (Google Fonts) for
the accordion chevron glyph (`expand_more`), rendered at 16px inside a 28px
circular button.

### Layout

- `<section id="faq">`, max-width 1080px container, `padding-block: 48px`
  (`64px` at ≥640px).
- **Header:** pill badge ("• FAQ") + large heading ("Answers to the questions
  / that come up most.") on the left, a short paragraph aligned to the
  bottom-right on desktop (stacks below on mobile).
- **Body grid:** `280px` fixed left column / flexible right column at
  ≥1024px, single column stacked below that.
  - **Left column:** three category buttons acting as a vertical tablist
    (`role="tablist"`/`"tab"`), the active one filled with `--surface`; below
    it, a "Got Questions?" card with a mailto CTA. The category list is
    `position: sticky` on desktop.
  - **Right column:** the active category's five questions as native
    `<details>`/`<summary>` cards, one open at a time.

### Motion inventory

- **Fade-up entrance:** header pill/heading/paragraph and each FAQ card start
  `opacity:0, translateY(24px)` and reveal via `IntersectionObserver`
  (threshold 0.3, fires once), transitioning `0.6s cubic-bezier(0.22,1,0.36,1)`
  with a staggered `transition-delay` (`0.15s * row index` for FAQ rows).
  Category switches re-render the right column, so the new rows replay the
  same staggered entrance.
- **Accordion open/close:** native `<details>` combined with a JS-measured
  `scrollHeight` transition (`height 0.2s ease-out`, mirroring the source's
  Radix `accordion-down`/`accordion-up` timing) and a 28px chevron button that
  rotates 180° over `0.2s`. Assistive tech gets `aria-hidden`/`inert` toggled
  on the collapsed panel so it isn't reachable while visually hidden — the
  `open` attribute alone doesn't guarantee that once the UA's default
  `display:none` rule is overridden to allow the height transition.
- **Spotlight ring:** every card, pill, and button gets an absolutely
  positioned 1px ring whose `radial-gradient` position follows
  `--spot-x`/`--spot-y`, written on `mousemove` relative to the element's own
  bounding rect (defaults to off-canvas at `-200px` so it's invisible until
  hovered).
- Everything above is neutralized under `prefers-reduced-motion: reduce`:
  transitions collapse to near-zero duration and elements render in their
  final state immediately.

### Accessibility affordances

- Category switcher uses the ARIA tabs pattern: `role="tablist"`/`"tab"`,
  `aria-selected`, roving `tabindex` (selected tab is the only one in the tab
  sequence), and Arrow Up/Down **and** Left/Right (the list is vertical, but
  both pairs are wired since the source spec calls out Left/Right generically
  for tab-like controls), plus Home/End.
- Accordion disclosure is native `<details>`/`<summary>` — keyboard-operable
  and screen-reader-legible with zero JS. The inline `<script>` intercepts the
  click to animate height and to enforce "only one open per category," but
  the underlying semantics (and a no-JS fallback of instant, un-animated
  toggling) are the browser's own.
- Visible `:focus-visible` ring on every interactive element (tabs, accordion
  triggers, the mailto link), using the one chromatic accent token.

## Deviations from the source prompt

- The source specifies React + Radix UI Accordion + framer-motion; this is
  translated to semantic HTML, vanilla CSS, and vanilla JS producing the same
  visual result (multi-file → single file; CDN libraries → inline vanilla
  equivalents — both permitted translations).
- `--accent` is an additive accessibility token with no source equivalent
  (the source design has no color); see Palette above.
- The prompt's `FadeUp` delay for the pill reads "delay 1" while the heading
  and paragraph read "delay 0.1" / "delay 0.2" immediately after — read as a
  stepped 0/0.1/0.2 stagger (pill first, no delay) rather than literally
  waiting 1 second before the first element animates in, which would have the
  heading and paragraph appear before the pill. This is a motion-choreography
  read, not a visual change: the static render is identical either way.
