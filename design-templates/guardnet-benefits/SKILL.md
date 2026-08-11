---
name: guardnet-benefits
description: |
  Dark, single-section "Key Benefits" page for a fictional defense-platform
  brand, built as a self-contained three-card grid. Two glass-dark text cards
  (identical "Preemptive Risks / Scouting and Reactions" headline, one body
  paragraph placed mid-card and the other pinned to the card's bottom) flank a
  center video card whose looping, muted clip of an iridescent morphing blob
  is the section's only motion, fading into the card surface at its base. A
  soft blue blob-glow bleeds in from each text card's edge; everything else is
  black-on-black.
tags:
  - "component"
  - "motionsites"
  - "benefits"
  - "cards"
  - "video"
  - "dark-ui"
triggers:
  - "key benefits"
  - "benefits section"
  - "three column benefits"
  - "benefit cards"
  - "video card benefits"
  - "guardnet"
  - "defense platform benefits"
  - "preemptive risk scouting"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=guardnet-benefits"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build the Guardnet Key Benefits section as a self-contained page in this template's own visual system. Follow the build spec below exactly — the three-card layout, the blob glows, and the looping center video are part of the identity. Ask only for the missing essentials first: brand name, real benefit copy, and a replacement clip for the center card."
---

# Guardnet — Key Benefits

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single-section page built to stand alone: a centered "Key Benefits" heading
sits above a three-card grid on a pure black background — two dark text cards
(each with a soft blue blob-glow bleeding in from one edge) flanking a center
card whose looping video of a morphing iridescent blob is the section's only
motion. The section itself is the deliverable; the page around it is only the
padding and background needed for it to read as placed rather than stranded,
with no invented hero, nav, or filler.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, benefit
   headlines, and body copy. Each text card's headline/body pair is the unit
   — keep the mid-card paragraph placement on the left card and the
   bottom-pinned placement on the right card if you keep their current roles,
   or swap which side carries which placement.
3. **Preserve the design system.** The pure-black page, the `neutral-950`
   card surface, the blue blob-glow (`--accent-blob`), and the Jost 300
   typeface are the identity — don't recolor them into a house palette.
4. **Extend by duplicating a card `<li>`**, never by importing a card layout
   from another template. The grid is fixed at 3 columns (`≥768px`); adding a
   fourth card means updating `.benefits-grid`'s `grid-template-columns` to
   match the new count.
5. **Keep motion accessible.** The center video is the section's only motion
   — preserve its `prefers-reduced-motion` fallback (poster swap + JS pause)
   when extending or replacing the clip.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="guardnet-benefits" type="text/html" title="Guardnet — Key Benefits">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished page — see `example.html` for the exact values.

### Palette

- `--bg: #000000` — page and section background, straight black.
- `--card-bg: #0a0a0a` — Tailwind `neutral-950`, the card surface.
- `--accent-blob: #1e3a8a` — the only chromatic root token. It's a real
  parseable color, and it already appears twice in the resting-state render
  (both blob-glows), so nothing needed to be hidden behind the focus ring to
  satisfy the chromatic-token rule.
- `--text-primary: #ffffff` — headings.
- `--text-secondary: rgba(255, 255, 255, 0.7)` — body copy.
- `--focus-ring: var(--accent-blob)` — additive `:focus-visible` outline;
  reuses the existing accent rather than introducing a new hue.

### Type

Jost (weight 300) from Google Fonts. The source prompt specifies "Futura Md
BT Medium," loaded from a third-party webfont CDN
(`db.onlinewebfonts.com`) — not a Google Font and not vendorable as a small
local file. Jost is the nearest Google equivalent (same geometric,
single-story-`a` proportions commonly used as a Futura substitute); every
text node in the source already carries a `font-light` (300) Tailwind
utility, so loading Jost at 300 alone matches every rendered weight — see
Deviations.

### Layout

- `.page-wrap` — `max-width: 1400px`, centered, matching the prompt's literal
  "Section sits inside a `w-full max-w-[1400px]` wrapper on a black page."
  `body` is a flex column centered vertically so the section reads as placed
  rather than stranded on tall viewports.
- `.benefits` (`<section>`) — full-width, black, `padding: 48px 16px` →
  `80px 24px` at `≥640px` → `80px 40px` at `≥768px`.
- `.benefits-heading` (`<h1>`) — "Key Benefits," centered, `font-weight:
  300`, `letter-spacing: -0.04em`, `30px` → `36px` (`≥640px`) → `48px`
  (`≥768px`), `margin-bottom: 48px` → `96px` (`≥640px`).
- `.benefits-grid` (`<ul>`) — 1 column by default, `repeat(3, 1fr)` at
  `≥768px`, `gap: 12px` → `16px` at `≥640px`.
- Every `.benefit-card` (`<li>`) — `height: 380px` → `460px` (`≥640px`),
  `border-radius: 16px`, `background: var(--card-bg)`, `overflow: hidden`.
- **Left/right text cards** — `padding: 24px` → `32px` (`≥640px`); a
  `.benefit-blob` glow (`border-radius: 50%`, `background:
  var(--accent-blob)`, `filter: blur(64px)`, `opacity: 0.4`) positioned
  off-card: left card's glow is `460×460px` centered vertically with its left
  edge `420px` outside the card (only a sliver bleeds in); right card's glow
  is `224×224px` tucked `112px` above/right of the card's own top-right
  corner. An `<h2>` two-line headline sits above a `<p>` body paragraph — the
  left card's paragraph sits `48px`/`80px` below the headline (mid-card); the
  right card's paragraph is pushed to the card's bottom edge (`margin-top:
  auto`).
- **Center video card** — no padding, `flex-direction: column`. A
  `75%`-height video region (`<video>` + poster-image fallback, both
  `object-fit: cover`) sits above a `flex: 1` text region
  (`align-items: center`, left-aligned) holding the `<h2>` headline. A
  `128px`-tall `linear-gradient(to bottom, transparent, var(--card-bg))`
  overlay sits at the video region's base so the clip blends into the card
  surface below it.

### Motion inventory

- **The center card's looping, muted, autoplaying video is the section's
  only motion** — no CSS keyframes, no hover states, no JS-driven animation
  on anything else. This matches the source prompt's explicit statement:
  "No hover states or JavaScript animations. All motion comes from the
  looping background video."
- **`prefers-reduced-motion: reduce`** — additive fallback. A `<video>` and a
  same-sized poster `<img>` (`assets/guardnet-blob-poster.jpg`, the video's
  own first frame) sit stacked in the same slot; a CSS media block swaps
  which one is `display: block`, and a small inline script mirrors the same
  check to pause the underlying `<video>` and strip its `autoplay`/`loop`.
  The default (motion-on) markup and appearance are unchanged.

### Accessibility affordances

- **Real heading hierarchy** — `<h1>` "Key Benefits" at the section level,
  `<h2>` per card headline. The source prompt has no page-level heading
  context (it's a bare component spec); since this section is the page's
  entire reason for existing, promoting its heading to `<h1>` and each card
  headline to `<h2>` is the natural, additive hierarchy (SPEC-BATCH2 §4).
- **Semantic list markup** — the three-card grid is a `<ul>`/`<li>` list of
  benefit items rather than div-soup.
- **No interactive controls exist in this section** — no buttons, links,
  forms, tabs, or accordions, so the tab/accordion/slider/form-specific
  requirements in SPEC-BATCH2 §4 don't apply here. A global
  `:focus-visible` outline rule is defined defensively for any interactive
  element added when this template is extended.
- Decorative layers — both blob-glows, the video, the video's bottom fade,
  and the reduced-motion poster fallback — carry `aria-hidden="true"`; the
  card headlines and body paragraphs are the accessible content.

## Deviations from the source prompt

- **Font substitution:** the source registers "Futura Md BT Medium" from a
  third-party webfont CDN (`db.onlinewebfonts.com`), which is not a Google
  Font and not vendorable as a small local file (no open license found).
  Substituted with Jost (weight 300) from Google Fonts — the closest
  available geometric-sans match. Noted here per SPEC.md's font-substitution
  rule.
- **React + Tailwind → semantic HTML + vanilla CSS/JS**, producing a visually
  identical result (permitted translation).
- **Remote video and its resting frame vendored to `assets/`** instead of
  hotlinked: `guardnet-blob.mp4` (downscaled from the source's native
  1440×1440 to 960×960, re-encoded h264, ~0.62 MB) and
  `guardnet-blob-poster.jpg` (a JPEG of the source video's own first frame,
  used as the reduced-motion fallback and the `poster` attribute) — same
  crop, same content, just served locally (permitted translation).
- **`prefers-reduced-motion` fallback and the `:focus-visible` ring** are
  additive accessibility with no source equivalent, required because the
  source's only motion (an always-playing video) can't be paused by CSS
  alone. Neither appears in, nor alters, the default motion-on render.
- **`<h1>`/`<h2>` heading levels and the `<ul>`/`<li>` grid** are additive
  semantic upgrades per SPEC-BATCH2 §4 — styled with the exact same
  font-size, weight, and margin as the source's plain elements
  (`list-style: none` on the `<ul>`), so the rendered page is unchanged;
  only the accessibility tree differs.
- This design is not monochrome: the blob-glow blue (`#1e3a8a`) is already a
  genuine chromatic root token, visible twice in the resting-state render, so
  no accent color was hidden behind the focus ring to satisfy the
  chromatic-token rule — `--focus-ring` simply reuses `--accent-blob` rather
  than introducing a new hue.
