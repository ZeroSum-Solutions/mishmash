---
name: athletic-premium-landing
description: |
  Two-screen dark hero landing page for the fictional premium athletic footwear
  brand **IGNIS**, built as a single self-contained HTML file with inline CSS
  and vanilla JS. Low-poly rock formations with glowing molten crack veins
  anchor both full-viewport scenes; a bespoke faceted "energy crystal" emblem
  floats and slow-bobs in the hero, echoing the brand's cushioning/energy-return
  story instead of any photographic product shot. Pairs **Manrope** (sans body
  and display type) with **Instrument Serif** (italic accent line-breaks) for
  an editorial, high-contrast type rhythm. A GSAP-style bubble menu (stagger-in
  pill nav), scroll-triggered fade-ups, an SVG line-chart draw-in, and a subtle
  cursor-parallax on the rock/emblem art carry the motion.
tags:
  - "landing-page"
  - "motionsites"
  - "dark-hero"
  - "athletic"
  - "editorial"
  - "premium"
triggers:
  - "ignis"
  - "athletic"
  - "sneaker"
  - "footwear"
  - "sportswear"
  - "premium landing"
  - "dark hero"
  - "cushioning"
  - "energy return"
  - "landing page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=nike-premium-landing"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build IGNIS — Premium Athletic Landing as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: the real brand name, real product copy, and any imagery to swap in for the crystal emblem."
---

# IGNIS — Premium Athletic Landing

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.
> The upstream prompt was Nike-branded (name, copy, and a swoosh-style mark); this
> build replaces every trademarked element with an original fictional brand,
> original copy in the same voice, and original vector artwork.

Two-screen dark hero landing for **IGNIS**, a fictional premium athletic
footwear brand. Screen one carries the wordmark, a bubble-style nav, the
headline stack, and a floating faceted "energy crystal" emblem set against a
glowing low-poly rock formation. Screen two slides up over it (a solid-black
section with a top shadow) to make the engineering case: a translucent stat
card, a large mixed-type headline, and a two-tone badge stack.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace the brand and copy.** Swap the `IGNIS` wordmark text, the
   `#mark` symbol path, and every headline/stat/badge string for the user's
   real brand, product claims, and numbers.
3. **Preserve the design system.** The dark palette, the Manrope/Instrument
   Serif pairing, the low-poly rock-and-glow art direction, and the motion
   choreography below are the identity — do not swap in a light theme, a
   different type pairing, or drop the reduced-motion handling.
4. **Swap the crystal emblem deliberately.** It stands in for a hero product
   shot without depending on photography. If the user supplies real product
   imagery, replace `.crystal-figure`'s `<svg>` with an `<img>` of matching
   aspect ratio and keep the `.crystal-parallax` wrapper (it carries the
   pointer-parallax and the float animation contract).
5. **Extend by duplicating a scene**, never by importing a section from
   another template. The two-scene structure mirrors the source prompt
   exactly; add further scenes in this template's own vocabulary if the
   user needs more content.
6. **Keep motion accessible.** Every animation stays behind
   `prefers-reduced-motion`, as the build spec below requires.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="athletic-premium-landing" type="text/html" title="IGNIS — Premium Athletic Landing">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished `example.html`.

### Palette

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#050505` | Page and scene background (neutral, literal) |
| `--ink` | `#f6fcff` | Primary text, emblem outline, laces/upper detail |
| `--ink-dim` / `--ink-faint` | `rgba(246,252,255,.68)` / `.42` | Secondary copy |
| `--accent` | `#da3a16` | Chromatic brand accent — molten veins, stat number, badge gradient |
| `--accent-warm` | `#ff9a52` | Secondary gradient stop, vein core, emblem glow |
| `--accent-soft` | `rgba(218,58,22,.28)` | Ambient radial glow stop |
| `--line` | `rgba(255,255,255,.12)` | Hairline borders (bubble, pills, stat card) |
| `--rock-1` / `--rock-2` / `--rock-3` | `#131313` / `#1e1e1e` / `#0a0a0a` | Neutral rock-facet fills (literal by design) |

Every gradient on a brand surface (`.ambient-glow`, `.badge-mark`) resolves
through `var(--accent*)` stops, so recoloring the two accent tokens recolors
the molten glow, the veins, and the badge in one pass.

### Type

- **Manrope** (400/500/600/700) — body, nav, stat labels, most of both
  headlines.
- **Instrument Serif** (italic) — the accent line-breaks inside each
  headline (`<em>`), the `78%` stat figure. Both are the exact families the
  source prompt specified and both are native Google Fonts, so no
  substitution was needed.

### Sections

1. **Scene 1 — Hero.** Full-viewport dark scene. A low-poly mountain-range
   SVG (jagged polygon silhouette + a few lighter facet triangles) sits along
   the bottom third, with three glowing "molten" crack veins (blurred glow
   copy + crisp warm core copy per vein) running through the peaks. A
   centered header holds the `IGNIS` wordmark (reusable `#mark` SVG symbol)
   and a circular bubble-menu toggle, top-right. The faceted crystal emblem
   floats upper-right among the peaks. A four-line centered headline sits at
   the bottom, mixing regular Manrope lines with italic Instrument Serif
   lines.
2. **Scene 2 — Engineering.** Solid-black scene with a top box-shadow so it
   visually slides over scene 1 on scroll. A translucent, blurred stat card
   (top-left) shows a `78%` figure next to a hand-drawn SVG line chart that
   draws in via `stroke-dashoffset` on reveal. A large two-line/two-line
   mixed-type headline sits bottom-left. A two-part badge stack (a white
   label pill over a gradient-filled square carrying the `#mark` glyph)
   sits bottom-right. A second, smaller rock/vein arrangement occupies both
   bottom corners for continuity with scene 1.

Both scenes share one `<svg style="display:none">` symbol definition for the
diamond/gem brand mark, referenced via `<use>` in the wordmark and the badge
— avoids duplicating the path.

### Motion inventory

- **Ambient glow breathe** — `.ambient-glow`, a `var()`-driven radial
  gradient, pulses opacity/scale on an infinite alternate loop.
- **Molten vein pulse** — each glow/core vein pair fades in and out on a
  staggered 4s loop.
- **Crystal float** — the emblem bobs and gently rocks (`translateY` +
  `rotate`) on an 8s ease loop; the pointer-parallax below is applied to a
  separate wrapper (`.crystal-parallax`) so the two transforms never fight.
- **Pointer parallax** — on fine-pointer devices only, the hero rock SVG and
  the crystal wrapper drift a few pixels toward the cursor via a damped
  `requestAnimationFrame` loop.
- **Scroll reveals** — every headline line, the stat card, and the badge
  stack fade/slide up via `IntersectionObserver`, staggered per line through
  `transition-delay`; each observer entry disconnects after firing once.
- **Stat chart draw-in** — the mini line-chart path animates
  `stroke-dashoffset` from full to zero when the stat card enters view.
- **Bubble menu** — the toggle morphs its two bars into an X; the pill nav
  scales/fades in with a per-item `transition-delay` stagger and closes on
  overlay click, pill click, or `Escape` (focus returns to the toggle).
- **Sticky-scroll seam** — scene 2's top box-shadow reads as a "slide over"
  cue as the user scrolls from scene 1 into scene 2.

All of the above is vanilla CSS keyframes/transitions plus plain
`IntersectionObserver`/`requestAnimationFrame` JS — no GSAP, no video, no
WebGL. Every animated property collapses to a static, fully-visible end
state under `@media (prefers-reduced-motion: reduce)`, and the pointer-
parallax script checks the same media query before attaching its listener.

### Asset note

The source prompt's product imagery was Nike product photography (visible
swoosh and "AIR" wordmark on the shoe itself); the two Mux/CDN hero videos it
referenced had also expired (403) by build time. Rather than vendor
trademarked photography or leave a broken remote reference, the hero's
floating element was redesigned as an original faceted "energy crystal"
emblem — vector art that visually rhymes with the page's low-poly rock
motif and doubles as a literal metaphor for the "energy return" cushioning
copy in scene 2. `example.html` therefore ships with **zero external media**
(no `assets/` folder): every visual is inline SVG/CSS, and the only remote
reference is the Google Fonts stylesheet link recorded in `template.json`.
