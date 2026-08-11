---
name: dreamcore-landing
description: |
  A single-page "scrollytelling" landing page called Step Into Wonder: a
  4.8-screen pinned scroll sequence where painted curtains part over a
  glowing crystal-cave portal, the world zooms and the portal irises open
  toward a sky beyond, then a giant arc of nine pastel destination cards
  sweeps across the closing scroll like a slow ferris wheel. Serif display
  headlines (Viaoda Libre) pair with a plain sans body face (Imprima) over
  a near-black stage, with mouse parallax on every layer and a dignified
  static fallback under reduced motion.
tags:
  - "landing-page"
  - "motionsites"
  - "scrollytelling"
  - "immersive"
  - "fantasy"
  - "dreamcore"
triggers:
  - "dreamcore"
  - "dreamcore landing"
  - "step into wonder"
  - "scrollytelling landing page"
  - "portal reveal"
  - "curtain reveal animation"
  - "arc card slider"
  - "ferris wheel cards"
  - "immersive fantasy landing"
  - "pinned scroll hero"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=dreamcore-landing"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Rebuild Step Into Wonder for a real brand: keep the pinned curtain-and-portal reveal, the mouse parallax, and the closing arc of destination cards exactly as built, and swap in the brand's own name, copy, imagery, and the nine card titles."
---

# Dreamcore Landing — Step Into Wonder

Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single-page immersive scroll experience: an outer 480vh scroll track holds
a pinned (`position: sticky`) 100vh viewport, so the visuals stay fixed on
screen while the user's scroll position drives every transform. On load,
painted curtains slide open over a crystal-cave portal archway; scrolling
then zooms the world and the portal toward its vanishing point until the
portal fades out and a second scene — a sweeping arc of nine pastel
destination cards — rotates into view along the lower third of the frame.
Every layer also drifts gently opposite the mouse cursor.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace the brand and copy.** Swap "Step Into Wonder", the headline
   ("Fall › Into Reverie" / "Forge Beyond the Real"), the body paragraphs,
   the nav labels, and the nine arc-card titles/descriptions for the real
   brand's own language. Keep the same word counts roughly in mind — the
   layout was tuned around short, punchy phrases.
3. **Swap imagery, not structure.** Replace the five full-bleed background
   images and three mini-card photos in `assets/` with same-aspect-ratio
   replacements. Keep the curtain images' transparency (they must stay
   PNG/WebP with alpha) and keep the portal image's bright "hole" roughly
   centered so headline text stays legible over it at every breakpoint.
4. **Preserve the design system.** The palette, type pairing (Viaoda Libre
   serif + Imprima sans), scroll-progress math, and parallax/zoom motion are
   the identity — do not substitute fonts, recolor structurally, or strip
   the entrance sequence.
5. **Extend by duplicating**, never by importing another template's
   section. A third scene would follow the same pattern: a new opacity
   band keyed to `scrollProgress`, plus its own absolutely-positioned UI
   layer inside the same pinned viewport.
6. **Keep motion accessible.** Every transform-driven effect is gated
   behind `prefers-reduced-motion`, which the build spec below describes.

## Build spec

Palette tokens (`:root`, all real parseable colors so MishMash's recolor
pass can shift them):

- `--bg-void: #0a0608` — the near-black stage background (neutral, exempt
  from recolor by design — it fails the lightness floor).
- `--ink-cream` / `--ink-soft` — off-white headline and body text.
- `--accent-amber: #ffd9ac` — the warm "›" glyph and the portal's glow
  overlay.
- `--accent-rose`, `--accent-meadow`, `--accent-sky`, `--accent-gold`,
  `--accent-violet` — the five pastel hues reused across the nine arc
  cards (`#f3cdd6`, `#dcedc2`, `#c3e3f4`, `#f0e4c0`, `#dcd2f2`).

Type: **Viaoda Libre** (Google Fonts serif) for every display heading —
the "Fall › Into" / "Reverie" hero lines, the "Forge Beyond the Real" scene
title, arc-card titles, and mini-card counters — set with `clamp()` so it
scales continuously from 375px to desktop. **Imprima** (Google Fonts sans)
carries nav labels, body copy, and card descriptions.

### Section-by-section layout

1. **Pinned hero frame** (`.hero-frame`, 100vh, inside the sticky
   `.viewport`): five stacked visual layers, bottom to top —
   `world-bg.jpg` (the sky/temple scene revealed beyond the portal),
   `bottom-clouds.webp` (anchored to the bottom edge), the arc-card slider
   (sits *behind* the clouds layer on purpose, so cards appear to rise up
   through them), the portal image plus a `--accent-amber` radial-gradient
   glow, a bottom vignette, the two curtain panels (each with real alpha
   transparency), and a top vignette.
2. **Nav** — absolutely positioned over the frame, z-index above
   everything else. Three-group desktop layout (Worlds/Atelier/Immersions
   — star mark — Craft/Codex/Connect) collapses to Explore / star / Connect
   under 1280px.
3. **Scene 1 copy** — headline, one paragraph, three mini photo cards
   (only the first shows below 768px), four slider dots, and a bobbing
   "Descend" scroll cue (desktop only). Below 1280px this is a single
   centered flex column; at 1280px+ it splits into an absolutely
   positioned left-aligned headline block and a right-aligned card column,
   matching the source layout exactly.
4. **Scene 2** — a centered heading + paragraph that crossfades in as
   scene 1 crossfades out, plus the nine-card arc slider riding a huge
   off-screen circular path that sweeps 80° across the last third of the
   scroll track.

### Motion inventory

- **Entrance (on load):** curtains ease open at 100ms, scene-1 UI fades
  and lifts in on a 0.3s/0.55s/0.8s/0.9s stagger starting at 600ms, and the
  curtains' CSS transition is dropped at 2200ms so the scroll-driven
  transform loop takes over cleanly.
- **Scroll-driven (rAF loop, `ease-in-out` on scroll progress):** the world
  scales to 1.18×, the clouds to 1.4×, the portal irises to 7.5× toward a
  fixed vanishing point and fades out between 65–85% scroll, the curtains
  slide fully off-screen while scaling to 1.3×, and the arc slider rotates
  80° across the final 30% of the track.
- **Mouse parallax:** every layer drifts a few pixels opposite the cursor,
  smoothed with a `lerp` factor of 0.07 inside the same rAF loop.
- **`prefers-reduced-motion: reduce`:** the pinned/sticky mechanic, the
  rAF loop, the mouse listener, and the entrance timers are skipped
  entirely (a single guard clause exits the script early). CSS takes over
  and re-flows the page into three plain stacked blocks — hero, scene-2
  heading, and a static flex-wrap grid of the nine cards — with curtains
  hidden and every fade-in forced to full opacity. Nothing needs motion to
  be readable.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="dreamcore-landing" type="text/html" title="Dreamcore Landing — Step Into Wonder">
<!doctype html>
<html>...</html>
</artifact>
```
