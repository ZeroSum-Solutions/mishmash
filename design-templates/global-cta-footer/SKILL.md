---
name: global-cta-footer
description: |
  Dark, video-lit CTA band and footer combo for the fictional no-code workflow
  product **Highframe**, built as a single self-contained HTML page. A
  full-bleed looping garden video sits behind a serif headline, a supporting
  line, and two calls to action; a frosted-glass footer overlaps the band by
  -120px and carries three link columns, a brand panel with a waitlist form,
  and a copyright/social/legal bottom bar. Ships both the desktop composition
  and a distinct mobile composition (lime-accented hero, accordion footer)
  behind one 768px breakpoint.
tags:
  - "component"
  - "motionsites"
  - "cta"
  - "footer"
  - "waitlist"
  - "dark-mode"
triggers:
  - "highframe"
  - "cta band"
  - "cta footer"
  - "global footer"
  - "footer with waitlist"
  - "waitlist footer"
  - "saas footer"
  - "cta band footer combo"
  - "overlapping footer"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=global-cta-footer"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build a CTA band and footer combo like this one — full-bleed background video behind a serif headline and two CTAs, with a frosted-glass footer overlapping the band — in this template's own visual system, but for my real product. Follow the build spec exactly — palette, typography, the -120px overlap, and the desktop/mobile motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, footer links, and a background video or image to swap in."
---

# Highframe — Global CTA + Footer

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Dark, video-lit CTA band and footer combo for the fictional no-code workflow
product **Highframe**, built as a single self-contained HTML page. A
full-bleed looping garden video sits behind a serif headline, a supporting
line, and two calls to action; a frosted-glass footer overlaps the band by
-120px and carries three link columns, a brand panel with a waitlist form,
and a copyright/social/legal bottom bar. Ships both the desktop composition
and a distinct mobile composition (lime-accented hero, accordion footer)
behind one 768px breakpoint — see "Two-file → one file" below.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headline,
   supporting line, footer link lists, and a background video or image sized
   to the same full-bleed treatment.
3. **Preserve the design system.** The palette, type pairing, the footer's
   -120px overlap, and the reveal/Ken-Burns motion in the build spec below
   are the identity — do not substitute fonts, recolor by hand, or drop the
   overlap for a plain stacked layout.
4. **Extend by duplicating structure**, never by importing a layout from
   another template. A fourth footer column or an extra CTA button should
   copy the existing markup pattern.
5. **Keep motion accessible.** The Ken-Burns loop, both reveal systems, and
   the accordion transition must stay behind `prefers-reduced-motion`, as the
   build spec requires.

## Build spec

### Palette

Tokens on `:root`, exactly as the prompt's `COLOR SYSTEM` block:

- `--ink: #0c0d0d`, `--paper: #f4f3f0` — the two neutral anchors (dark body
  text-on-light-pill, light body-and-buttons).
- `--lime: #c7ef6b` — the one chromatic accent, visible in the resting
  render (the mobile hero's emphasized "actually" and the lime radial glow
  behind the mobile footer's mail icon), and reused as the `:focus-visible`
  ring color everywhere in the page. Nothing was injected to satisfy the
  chromatic-token rule; this design already carries a real accent.
- `--lime-deep: #b6e34f`, `--green: #16331f` — declared as the prompt marks
  them desktop-only tokens, kept for a recolor pass even though this build's
  CSS doesn't consume them directly (the prompt's own root block lists them
  as page-wide tokens, not as values this specific band/footer paints with).
- `--muted` / `--line` switch value at the 768px breakpoint exactly as
  specified (`rgba(255,255,255,.72)`/`.16` desktop, `.65`/`.13` mobile);
  `--card: rgba(255,255,255,.055)` is declared mobile-only per the prompt.
- Body background switches `#000` (desktop) → `#060707` (mobile) at 768px.
- The lime radial-glow gradient behind the mobile footer's mail icon is
  rewritten to two dedicated `--glow-a`/`--glow-b` root tokens holding the
  exact original `rgba(199,239,107,.18)` → transparent stops, so a recolor
  pass on `--lime`-adjacent tokens can reach it — a plumbing change, not a
  color change. The footer's near-black frosted-glass gradient and the
  mobile shimmer line stay literal (neutral scaffolding).

### Type

`Hanken Grotesk` (400/500/600/700 — body, nav, buttons, UI) and
`EB Garamond` (400/500/600 + italics — h1 headings and the mobile footer's
"Skip the dev queue" heading), both from Google Fonts exactly as specified.
Material Icons Round (Google Fonts) supplies the desktop ghost button's
`play_circle` glyph; the mobile ghost button uses an inline SVG play-circle
per the prompt's own split (desktop: font glyph, mobile: SVG).

### Layout

1. **CTA band** (`.hero`, full-bleed background video) — the deliverable's
   first half:
   - Desktop: left-aligned copy column (h1 with an italic `<em>`, a serif
     sub-line, a primary pill button and a ghost button), max-width 620px.
   - Mobile: centered `.phone` column (max-width 430px) with a hidden-by-default
     status badge, the same headline/sub-line restyled, and a stacked CTA
     pair with different labels ("Start Free Trial" / "Watch Demo" vs.
     desktop's "Get started for free" / "Watch demo") — ported verbatim,
     including the capitalization difference between the two variants.
2. **Footer** (`.foot-desktop` / `.foot-mobile`) — the deliverable's second
   half, directly below the band:
   - Desktop: frosted-glass panel overlapping the band by `margin-top:
     -120px`, a 4-column grid (Product / Resources / Company link lists +
     a brand column with a waitlist pill form), then a bottom bar
     (copyright, social icons, legal links).
   - Mobile: a black panel with a top shimmer line, a mail-icon badge, an
     `h2` ("Skip the dev queue"), an email-capture form, a 4-section
     accordion (Product / Resources / Company / Legal — Legal lives in the
     bottom bar on desktop but in its own accordion section on mobile, per
     the prompt), a social-icon row, and a brand lockup card.

### Two-file → one file

The prompt describes two standalone HTML files (desktop/mobile) swapped by a
React iframe switcher at a 768px `matchMedia` breakpoint. This build folds
both into one file: the desktop and mobile hero/footer blocks are both
present in the DOM, toggled by the same 768px `@media` breakpoint via
`display`. This is the multi-file → single-file translation SPEC.md
requires, not a content change — both variants are full, independently
faithful reproductions of their respective spec sections, not a merged
compromise. One `<video>` element serves both; only its `object-position`,
`transform`, Ken-Burns animation, and `loop` attribute (removed and replaced
with a `timeupdate` listener that seeks back to `0` at 2 seconds, mobile
only) change by breakpoint, exactly as specified.

### Motion inventory

- **Ken-Burns background video** (desktop only): `scaleX(-1) scale(1.12)` to
  `scaleX(-1) scale(1.2)`, `26s ease-in-out infinite alternate`. Mobile drops
  the Ken-Burns animation and repositions via `object-position: center top`
  plus the 2-second loop-reset behavior described above.
- **Desktop hero reveal**: `.reveal` elements fade up (`translateY(22px)` →
  `0`, `opacity 0→1`, `.8s cubic-bezier(.2,.7,.2,1)`) with staggered delays
  (h1 `.12s`, sub `.26s`, CTA row `.4s`) on load. If the tab loads hidden,
  content snaps to its final state instantly and re-plays the reveal once
  `visibilitychange` reports the tab visible — the prompt describes this
  behavior in prose (no literal JS was supplied), so the implementation is
  an equivalent port, not a verbatim one.
- **Mobile hero reveal**: `.r` elements (`translateY(20px)→0`,
  `.75s cubic-bezier(.16,1,.3,1)`) fire immediately on load.
- **Mobile footer reveal**: the same `.r` class, triggered by
  `IntersectionObserver` at `threshold: 0.08`, staggered exactly as listed
  (mail icon `0s` → brand card `.43s`).
- **Accordion**: chevron rotates 180° (`.26s cubic-bezier(.4,0,.2,1)`), panel
  `max-height` animates `0 → 300px` on the same curve, one section open at a
  time (opening one closes any other via JS).
- **Button micro-interactions**: desktop primary CTA lifts
  `translateY(-2px)` with a stronger shadow on hover; mobile primary CTA
  scales to `.975` at `.9` opacity on `:active` — both exactly as specified.

### Accessibility

- Footer link groups are real `<nav aria-label="…">` landmarks around
  `<ul>` lists (Product, Resources, Company, Social, Legal — both desktop
  and inside every mobile accordion panel).
- Desktop column headers and the mobile footer heading are real `<h2>`/`<h3>`
  elements, not styled `<div>`s.
- Accordion triggers are real `<button aria-expanded aria-controls>` inside
  an `<h3>`, controlling a `role="region" aria-labelledby` panel — the
  custom-markup path SPEC-BATCH2 §4 allows when the visual (animated chevron
  + 300px max-height transition) demands more than `<details>`.
- Both email-capture forms (`#waitlist-desktop`, `#waitlist-mobile`) are real
  `<form>`s with a `<label>` (visually hidden, `.sr-only`) per input, correct
  `type="email"`/`autocomplete="email"`, and **no `action` to a live
  endpoint** — submit is intercepted, validity is checked, and an inline
  `role="status" aria-live="polite"` message replaces the default browser
  behavior.
- `:focus-visible` is styled on every interactive element, using `--lime` as
  the ring color.

### Responsive

The prompt's own breakpoints, folded into one file: `1100px` (h1 62px→54px),
`860px` (hero-copy padding tightens, footer grid 4-col→2-col, brand column
spans full width, bottom bar stacks), and `768px` (full desktop↔mobile
composition swap, body background `#000`↔`#060707`). A `768px`-and-`760px`
-tall combined query shrinks the mobile h1 clamp and bottom-aligns the hero
body, matching the prompt's `max-height: 760px` rule. Verified with headless
Playwright at 1440×900 and 375×812: `document.documentElement.scrollWidth
=== window.innerWidth` at both sizes.

### Reduced motion

`@media (prefers-reduced-motion: reduce)` disables the Ken-Burns animation
(the video holds its base flipped position), neutralizes both reveal systems
(content renders fully visible, no translate/opacity transition), and drops
the accordion's transition (it still opens/closes, just without the animated
height/chevron sweep) and the hover/active micro-transitions.

### Deviations (reason required for every one)

- **Nav bar and dashboard-preview iframe are omitted from both variants.**
  The prompt's own preview screenshot shows the full original page (nav +
  dashboard mockup + hero + footer), but this build's assignment is a
  *section* — "CTA band + footer combo" — and SPEC-BATCH2 §2 is explicit
  that a section build must not "invent a whole landing page" around itself.
  The nav is top-of-page site chrome, not part of a CTA+footer pattern; the
  dashboard iframe points at `dashboard-orchestrator.html`, a file the
  prompt itself says is "not described here" — building it would mean
  inventing unspecified product-UI content rather than reproducing anything
  the prompt actually specifies. Dropping both left the CTA copy and the
  video as the band's full content, which is what the task description
  calls "enough deliberate content above [the footer] that it reads as
  placed rather than stranded."
- **`.hero` changed from `overflow: visible` (prompt's literal value) to
  `overflow: hidden`.** The prompt sets `overflow: visible` so the (omitted)
  dashboard iframe can visually spill past the hero's box. With the
  dashboard gone, nothing needs to spill; `overflow: visible` instead let
  the Ken-Burns-scaled, absolutely-positioned video bleed past the viewport
  edge and produce a genuine `document.documentElement.scrollWidth` overflow
  at 1440px (confirmed by measuring `scrollWidth` vs. `innerWidth` inside
  the page, not assumed from a screenshot). `overflow: hidden` clips exactly
  the video pixels that were already outside the visible hero box, so the
  rendered result is unchanged — this is a consequence of the nav/dashboard
  omission above, not an independent stylistic choice.
- **Desktop horizontal gutter (64px)** — the prompt gives vertical padding
  for `.hero-copy` and the footer grid but never states a horizontal page
  gutter (it would normally come from the now-omitted nav's own padding).
  64px is a judgment call consistent with the nav height (88px) and footer
  rhythm (72px/64px vertical); FIDELITY.md permits judgment exactly where
  the prompt is silent.
- **Desktop waitlist submit-button label ("Join waitlist")** — the prompt
  gives the pill's background/text color, radius, and padding but never
  states its visible label (only the mobile button's label, "Sign up for
  waitlist", is given). "Join waitlist" is a judgment call for the missing
  string.
- **Several `box-shadow`/gradient-opacity values described only in direction,
  not in numbers** — the waitlist pill's inset highlight, the mobile mail-
  icon and social-icon "glow" shadows, the mobile input's focus ring, and
  the mobile footer shimmer line's peak opacity. The prompt says these exist
  and roughly how ("glow", "brighter", "stronger") without exact values;
  each was set to a value consistent with the frosted-glass/lime language
  used elsewhere on the same variant.
- **Mobile `max-height: 760px` h1 clamp** — the prompt says only "h1 clamped
  smaller" without new numbers; implemented as `clamp(38px, 11vw, 48px)`
  (down from the base `clamp(44px, 12vw, 58px)`).
- **Generic icon glyphs** (play-circle, mail, chevron, arrow, X/Twitter,
  LinkedIn, GitHub marks) use standard minimal SVG paths. The prompt gives
  exact SVG path data only for the brand logo (reproduced verbatim, reused
  at every size the prompt calls for: 28px/26px/22px); it specifies sizes
  and colors for the other icons but not path data, so their shapes are a
  judgment call.
- **Double space in the desktop bottom-bar copyright line** ("(c) 2026␣␣
  Highframe. All rights reserved.") is reproduced verbatim via `&nbsp;`,
  including the exact single-space version of the same line in the mobile
  brand card ("(c) 2026 Highframe. All rights reserved.") — the prompt's two
  variants genuinely differ here and neither was "corrected" to match the
  other.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="global-cta-footer" type="text/html" title="Highframe — Global CTA + Footer">
<!doctype html>
<html>...</html>
</artifact>
```

## Source note

Generated output under a MotionSites unlimited-plan subscription
(`https://motionsites.ai/?prompt=global-cta-footer`). The upstream prompt
text is design evidence only and is not included in this repository or this
file — everything above describes the page actually built, in this
project's own words. No upstream license claim is made; this is not a
`vendored_from` entry, and there is no standalone `.js` file — all script is
inline in `example.html`. The vendored hero background video
(`assets/hero-bg.mp4`, ~2.4MB, transcoded to 720p/muted/no-audio from the
prompt's linked source file) is the only asset in `assets/`.
