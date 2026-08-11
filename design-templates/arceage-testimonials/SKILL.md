---
name: arceage-testimonials
description: |
  White-on-black customer feedback section for the fictional farm-harvesting
  service **Arceage Ag**, built as a single self-contained HTML page. A
  right-aligned quote sits between two hairline dividers, with an avatar,
  name, and role on the left and a pair of circular prev/next buttons on the
  right. Every heading, quote, name, and role reveals with a character-by-
  character typewriter effect, and switching testimonials slides the quote
  in a spring-eased direction while the author block cross-fades. Wrapped in
  a black page shell with generous breathing room so the white section reads
  as placed rather than stranded.
tags:
  - "component"
  - "motionsites"
  - "testimonials"
  - "carousel"
  - "typewriter"
triggers:
  - "arceage"
  - "customer feedback"
  - "testimonial carousel"
  - "quote slider"
  - "typewriter testimonial"
  - "farm harvesting testimonial"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=arceage-testimonial"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build a customer-feedback quote carousel like this one, in this template's own visual system, but for my real business. Follow the build spec exactly — the right-aligned quote, the typewriter reveal, and the directional slide transition are part of the identity. Ask only for the missing essentials first: brand name, real testimonials, and headshots to swap in."
---

# Arceage Ag Customer Feedback — Directional Quote Carousel

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

White-on-black customer feedback section for the fictional farm-harvesting
service **Arceage Ag**, built as a single self-contained HTML page. A
right-aligned quote sits between two hairline dividers, with an avatar, name,
and role on the left and a pair of circular prev/next buttons on the right.
Every heading, quote, name, and role reveals with a character-by-character
typewriter effect, and switching testimonials slides the quote in a
spring-eased direction while the author block cross-fades. Wrapped in a black
page shell with generous breathing room so the white section reads as placed
rather than stranded.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name and the
   three (or more) testimonial quotes, author names, roles, and headshots.
   Keep the feedback array shape (`quote`, `author`, `title`, `avatar`) —
   the carousel logic indexes into it directly.
3. **Preserve the design system.** The black page shell, the white section,
   the right-aligned quote, the hairline dividers, and the typewriter/spring
   motion are the identity — do not recolor by hand, switch the quote to
   left/center alignment, or drop the character reveal.
4. **Extend by duplicating the feedback array entry**, never by importing a
   different carousel pattern. A fourth testimonial is a fourth array item;
   the prev/next wrap-around math already handles any length.
5. **Keep motion accessible.** The typewriter stagger and the slide spring
   both collapse to an instant, fully-visible state under
   `prefers-reduced-motion`, as the build spec requires.

## Build spec

### Palette

Monochrome by design — the source prompt specifies no chromatic color at
all, so this section carries a genuinely black-and-white identity:

- `--bg-page: #000000` — the page shell behind the section (the prompt's
  page wrapper is `bg-black`; this section overrides to white).
- `--bg-section: #ffffff` / `--text-on-light: #000000` — the section itself.
- `--divider: #D9D9D9` — the two hairline rules.
- `--btn-bg: #D9D9D9` / `--btn-bg-hover: #c9c9c9` — the prev/next circles.
- `--author-title: #6b7280` (Tailwind `gray-500`) — the role line.
- `--accent: #4e85bf` — **not** part of the original design. The prompt is
  strictly monochrome, so there is nothing to recolor without breaking
  fidelity. This token exists solely as the `:focus-visible` outline color
  on the prev/next buttons, satisfying this repo's "at least one genuinely
  chromatic root token" requirement through an additive accessibility
  affordance rather than an invented brand color. It is invisible until a
  keyboard user tabs to a button.

### Type

`Barlow` (Google Fonts, all weights/italics as the prompt's own `@import`)
is the only font this section uses. The prompt also defines `Instrument
Serif` as a second global theme font, but its own text says that font is
"not used in this section" — so `template.json#cdn_fonts` lists Barlow only;
adding an unused font import would be dead weight the section never renders.

### Layout

The section is the entire deliverable — one `<section id="feedback">`,
full-bleed white, centered vertically in a black `<body>`:

1. **Title** — `Customer Feedback`, small/medium/tracking-wide, typewriter
   reveal.
2. **Top divider** — hairline rule, scales in from the left (`scaleX 0→1`).
3. **Quote** — a `<blockquote>`, right-aligned, `font-light`, the current
   feedback's quote text (guillemet-quoted, verbatim), typewriter reveal.
4. **Bottom divider** — same scale-in treatment.
5. **Author + nav row** — flex row (column on mobile): a circular avatar,
   the author's name (`<h3><cite>…</cite></h3>`) and role, both typewriter
   revealed; two circular `<button>`s (real accessible names "Previous
   feedback" / "Next feedback") with left/right chevron SVGs.

Three feedback entries, ported verbatim from the prompt's data array
(quotes use guillemets `«…»`, not curly quotes):

| Author | Role | Avatar |
| --- | --- | --- |
| Maranda Walsh | Operations Manager, GreenAcres Farms | `assets/avatar-maranda.jpg` |
| John Doe | Owner, Valley Wheat Producers | `assets/avatar-john.jpg` |
| Sarah Smith | Chief Agronomist, HarvestYield Co. | `assets/avatar-sarah.jpg` |

"Acreage Ag" (the harvesting partner named inside the quotes) was checked
against known real agribusiness trademarks and found no match — it reads as
a fictional client name coined for this prompt, alongside the equally
fictional "GreenAcres Farms", "Valley Wheat Producers", and "HarvestYield
Co.", so it ships unchanged per the fictional-brand exception.

### Motion inventory

- **Entrance stagger** — the section's five top-level blocks (title, top
  divider, quote area, bottom divider, author+nav row) fade/slide up
  (`opacity 0→1`, `translateY(20px)→0`, `0.6s`/`0.8s ease-out`) with a 50ms
  stagger between each, ported from the prompt's `staggerChildren: 0.05`.
- **Typewriter reveal** — every heading/quote/name/role is split into
  per-character `<span>`s that fade in (`opacity 0→1`, `0.3s ease-out`)
  with a per-character delay of `12ms` (the prompt's `speed: 0.012`) plus a
  base offset matching the prompt's own `delay` props (title `0ms`, quote
  `200ms` after its own reveal, author name `400ms`, role `500ms`).
- **Directional slide** — clicking prev/next runs a small hand-rolled
  spring simulator (`stiffness: 300, damping: 30, mass: 1`, matching the
  prompt's Motion spring transition exactly) that translates the outgoing
  quote to ±100px/opacity 0, then — once it settles — translates the
  incoming quote in from the opposite ±100px offset, mirroring the
  prompt's `AnimatePresence mode="wait"` (exit fully completes before enter
  starts, never simultaneous). The author block cross-fades/traslates
  translates (`translateY ±10px`, `0.2s`) on the same sequential wait/enter
  timing.
- No autoplay: the prompt's carousel is manual-only (arrow clicks), so none
  was invented.

### Accessibility

- Prev/next are real `<button>` elements with `aria-label="Previous
  feedback"` / `"Next feedback"` (verbatim from the prompt), reachable by
  `Tab`, activated by `Enter`/`Space` natively, and carry a visible
  `:focus-visible` outline in the `--accent` token.
- The animated per-character spans are `aria-hidden`; a paired visually-
  hidden (`sr-only`) node holds the full, un-split text with
  `aria-live="polite"` for the title/quote/name/role, so a screen reader
  announces the real sentence once per slide instead of 200 character
  mutations.
- `<blockquote>` wraps the quote and `<cite>` (kept visually unstyled —
  `font-style: normal` — so it doesn't alter the prompt's rendered look)
  wraps the author name, matching FIDELITY's "additive semantic markup"
  allowance.
- `isAnimating` guards double-clicks mid-transition; both buttons are
  `disabled` for the duration of a slide so a rapid click can't desync the
  carousel state from what's on screen.

### Reduced motion

`prefers-reduced-motion: reduce` is checked once at load and short-circuits
both motion systems at their source, not just via CSS overrides: the
typewriter helper skips span-splitting and sets the full text directly, and
the spring runner jumps straight to its target value and fires its
completion callback immediately. A companion `@media
(prefers-reduced-motion: reduce)` block forces every entrance
opacity/transform to its resting state, so the section is fully visible and
interactive with no animation at all, matching the prompt's spirit of a
"dignified static fallback."

### Responsive

The prompt's own breakpoints (Tailwind `sm`/`md`/`lg` = 640/768/1024px):
section padding `32px`→`96px` (with `120px` side padding at `lg`), quote
`24px`→`36px`→`44px`, divider margins `48px`→`80px`, author+nav row stacks
to a column with full-width children below `640px`. Verified with headless
Playwright at 1440×900 and 375×812:
`document.documentElement.scrollWidth === window.innerWidth` at both sizes,
no horizontal overflow.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="arceage-testimonials" type="text/html" title="Arceage Ag Customer Feedback — Directional Quote Carousel">
<!doctype html>
<html>...</html>
</artifact>
```

## Source note

Generated output under a MotionSites unlimited-plan subscription
(`https://motionsites.ai/?prompt=arceage-testimonial`). The upstream prompt text
is design evidence only and is not included in this repository or this file —
everything above describes the page actually built, in this project's own
words. No upstream license claim is made; this is not a `vendored_from`
entry, and there is no standalone `.js` file — all script is inline in
`example.html`.
