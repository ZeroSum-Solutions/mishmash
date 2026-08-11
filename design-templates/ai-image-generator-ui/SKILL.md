---
name: ai-image-generator-ui
description: |
  A centered "Core Features" section for an AI image generator product: an
  eyebrow badge, a two-line heading, a subtitle, and a row of three
  gradient-topped feature cards (Smart Prompt Suggestions, API Access,
  Project Library). Pure display component — no JavaScript, no hover states,
  no animation — built with Inter and CSS-only gradient artwork plus two
  vendored SVG illustrations.
tags:
  - "web-app"
  - "motionsites"
  - "features-section"
  - "ai-product"
  - "gradient-cards"
triggers:
  - "core features section"
  - "ai image generator features"
  - "feature cards"
  - "gradient feature cards"
  - "ai product landing"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=ai-image-generator-ui"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "web-app"
  scenario: "marketing"
  example_prompt: "Build a centered Core Features section like this one, in this template's own visual system, but for my real AI product. Follow the build spec exactly — palette, card layout, and typography are part of the identity. Ask only for the missing essentials first: product name, the three feature titles, and any real screenshots to swap into the API Access and Project Library cards."
---

# AI Image Generator UI — Core Features

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single centered marketing component that introduces three product
capabilities as gradient-topped cards, sitting on its own white page with
generous top/bottom padding so it reads as a deliberate section rather than a
stranded fragment. Every color, spacing, and typography value is copied
verbatim from the source design; the only translation is CSS custom
properties standing in for literal gradient stops so MishMash's recolor pass
can retarget the palette.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real product name, the
   three feature titles/descriptions, and real product screenshots for the
   API Access and Project Library cards (swap `assets/network.svg` and
   `assets/library-icon.svg`, keeping the same crop and centering).
3. **Preserve the design system.** The `--c1-*` gradient tokens, the type
   scale, the 20px card radius, and the 340px card height are the identity —
   do not substitute fonts, recolor the palette, or add hover/motion effects
   the source design does not have.
4. **Extend by duplicating a card**, never by importing a layout from another
   template. A fourth card follows the same `.c1-card` + numbered-variant
   pattern as the existing three.
5. **Keep it static.** The source design is deliberately motion-free; do not
   add hover states, transitions, or scroll reveals unless the user
   explicitly asks for them.

## Build spec

### Palette & tokens (`:root`)

- `--c1-badge-1: #F5C344`, `--c1-badge-2: #F28482`, `--c1-badge-3: #B567C2`
  — the eyebrow badge's clipped-text gradient.
- `--c1-orange: #FFB347`, `--c1-yellow: #F9ED96`, `--c1-purple: #E5A1F5`,
  `--c1-pink: #F8ACA0` — the three cards' radial-gradient tops, reused for
  the bold-phrase text gradient inside card 1.
- `--c1-neutral-bg: #F4F8F9` — the shared card background/gradient floor
  (neutral scaffolding, kept literal-equivalent but plumbed as a token since
  it is a gradient stop).
- `--accent: #B567C2` — genuinely chromatic; exposed for MishMash's recolor
  pass (drives the `:focus-visible` outline).
- Body text neutrals stay literal: `#0f172a` (title), `#64748b` (subtitle,
  search icon stroke), `#1e293b` (card headings, pill text), `#475569`
  (prompt-box body text).

### Layout

- **Page shell:** white body, `80px` top/bottom + `20px` left/right padding,
  flex-centered, Inter (400/500/600) throughout.
- **Header block:** uppercase gradient-text eyebrow badge ("Core Features")
  → `<h2>` title ("Built for Speed & Quality", 2.75rem/500, scales to
  2.25rem under 600px) → two-line subtitle ("Everything you need to go /
  from idea to image").
- **Grid:** 3 equal columns / 24px gap, dropping to 2 columns under 900px and
  1 column under 600px.
- **Card 1 — Smart Prompt Suggestions:** orange-to-yellow radial gradient
  top; a white prompt-preview box with three gradient-clipped bold phrases;
  a pill reading "Add more details" with a purple sparkle glyph; a static
  cursor-arrow SVG positioned beside the pill (baked into the design, not a
  live hover state).
- **Card 2 — API Access:** purple-to-pink radial gradient top; a vendored
  network-diagram illustration (`assets/network.svg`) showing a source node
  fanning out to four connection-status pills.
- **Card 3 — Project Library:** yellow-to-purple radial gradient top; a
  masked graph-paper mesh overlay; a vendored layered-folder illustration
  (`assets/library-icon.svg`); a "Search in library" pill with an inline
  magnifying-glass icon.

### Motion inventory

None. The source design specifies no animation, no JavaScript, and no hover
effects — this is a pure static display component. A
`prefers-reduced-motion` block is still present (neutralizing `transition`
and `animation` globally) as a dignified, forward-compatible fallback in
case the page is later extended with motion.

### Accessibility affordances (additive — do not change the rendered look)

- The header and each card use real semantic elements (`<section>`,
  `<article>`, `<h2>`/`<h3>`, `<p>`).
- The decorative UI-mockup pieces inside each card (the prompt-preview box,
  the "Add more details" pill, the cursor glyph, the network/folder
  illustrations, the search pill) are marked `aria-hidden="true"` since they
  are illustrative artwork rather than functional controls or informational
  content; the card's real content is its `<h3>` heading.
- `:focus-visible` carries a visible outline using the chromatic `--accent`
  token, additive only — it never alters the resting appearance.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="ai-image-generator-ui" type="text/html" title="AI Image Generator UI — Core Features">
<!doctype html>
<html>...</html>
</artifact>
```
