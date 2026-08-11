---
name: cursor-follow-hero
description: |
  Fullscreen hero for the fictional NFT-collection brand **Orbis.Nft**. A
  deep-navy backdrop hosts a generative scene — a canvas starfield, a
  receding planet, and a dashed orbit-ring system carrying glowing
  "collection" nodes — that visitors steer by moving the cursor left and
  right, exactly like scrubbing a video timeline. A soft neon glow trails
  the pointer itself, an oversized Anton headline anchors the bottom-left
  corner, and a rotated Condiment cursive accent reads "Nft collection" in
  blend-mode exclusion over the scene. Idle visitors and touch devices get a
  slow ambient auto-drift instead of a dead frame, and
  `prefers-reduced-motion` swaps the whole thing for one static, fully
  legible composition.
tags:
  - "landing-page"
  - "motionsites"
  - "hero-section"
  - "cursor-interaction"
  - "pointer-follow"
  - "canvas-animation"
  - "space"
  - "nft"
  - "dark-mode"
triggers:
  - "orbis"
  - "orbis.nft"
  - "nft collection"
  - "nft drop landing"
  - "cursor follow hero"
  - "pointer follow interaction"
  - "mouse scrub video"
  - "video scrub hero"
  - "starfield hero"
  - "orbit rings"
  - "planet reveal hero"
  - "space hero"
  - "dark navy hero"
  - "neon accent hero"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=cursor-follow"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Orbis.Nft — Cursor-Follow Orbit Hero as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, layout, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any collection imagery to swap in."
---

# Orbis.Nft — Cursor-Follow Orbit Hero

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Fullscreen hero for the fictional NFT-collection brand Orbis.Nft. The whole
page is one 100vh section: a fixed nav floats above a generative deep-space
scene that the visitor drives by moving the cursor horizontally, with a
low-left headline block and a neon cursor-trailing glow layered on top.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headline,
   nav labels, and CTA copy. The scene itself (starfield, planet, orbit
   rings) is procedural — no imagery to swap, just recolor the tokens below.
3. **Preserve the design system.** The navy/cream/neon palette, the Anton +
   Condiment type pairing, and the pointer-driven motion are the identity —
   don't substitute fonts or strip the scrub interaction.
4. **Extend by duplicating sections** below the hero if more content is
   needed, matching this template's palette, type scale, and motion
   vocabulary — never importing a section from another template.
5. **Keep motion accessible.** Every animated layer already respects
   `prefers-reduced-motion`; preserve that branch when extending the page.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="cursor-follow-hero" type="text/html" title="Orbis.Nft — Cursor-Follow Orbit Hero">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

### Palette tokens (`:root`)

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#010828` | Page/hero background, scrim end-stop |
| `--bg-deep` | `#000210` | Reserved deep-shade token |
| `--cream` | `#eff4ff` | Headline, logo, star color, nav icon (closed state) |
| `--accent` | `#6fff00` | Neon brand accent — CTA dot, orbit nodes, cursor-follow glow |
| `--accent-soft` | `hsl(84 100% 74%)` | Lighter accent gradient stop |
| `--accent-dim` | `hsl(84 85% 32%)` | Reserved darker accent token |
| `--accent-glow` | `hsl(84 100% 55% / 0.32)` | Translucent accent used in nebula/CTA glows |

Neutral UI chrome (nav pill, mobile dropdown, gray text states) stays
literal Tailwind-gray values, matching the source prompt exactly; only the
brand-identity color is tokenized for recolor.

### Type

- **Anton** (`font-grotesk` in the source) — the hero `<h1>`, uppercase,
  fluid `clamp(40px, 11px + 7.7vw, 90px)`, line-height 1.05 under 640px and
  1 above it.
- **Condiment** (`font-condiment`) — the cursive "Nft collection" accent,
  fluid `clamp(24px, 10px + 3.7vw, 48px)`, rotated -1deg,
  `mix-blend-mode: exclusion`, absolutely positioned over the top-right of
  the headline block. Both are on Google Fonts exactly as named in the
  source prompt — no substitution needed.
- Nav, buttons, and the pointer hint use the system sans stack (the source
  prompt never names a body font for this hero).

### Layout

1. **Fixed nav** — logo (inline geometric SVG mark, `fill: var(--cream)`)
   left; a dark pill of five nav buttons (`Device` active, `Real Stories`,
   `Science`, `Plans`, `Reach Us`) centered on desktop; a dark
   `Reserve Yours` CTA with a pulsing neon status dot right; a hamburger
   toggle on mobile that opens a white full-width dropdown with the same
   five items plus the CTA, centered.
2. **Hero scene** (stacked absolutely inside the 100vh section, back to
   front): a `<canvas>` starfield (three parallax layers, per-star
   twinkle), a CSS radial nebula wash, a CSS sphere ("planet") that sinks
   and shrinks as the scrub progresses, an inline SVG of three dashed
   orbit ellipses carrying three glowing "collection" nodes that rotate
   with scrub progress, and a bottom scrim gradient for text legibility.
3. **Hero text** — bottom-left anchored column: the three-line Anton
   headline ("Beyond earth / and ( its ) familiar / boundaries") with the
   Condiment accent floating over its top-right corner.
4. **Cursor-follow glow** — a soft blurred neon circle
   (`mix-blend-mode: screen`) that eases toward the raw pointer position
   every frame; invisible until the first real pointer move, and hidden
   entirely on touch/reduced-motion.
5. A small "Move your cursor to drift through orbit" hint sits bottom-right
   on fine-pointer desktop only, fading out on first interaction.

### Motion inventory

- **Scrub-driven scene progress.** Faithful port of the source prompt's
  mouse-scrub-video mechanic: horizontal mouse delta × `0.8` sensitivity
  accumulates into a clamped `[0, 1]` target every `mousemove`, exactly like
  the prompt's `targetTime`/`SENSITIVITY` model. Instead of driving
  `video.currentTime` with seek-chaining, the target is chased every
  `requestAnimationFrame` tick by a `current += (target - current) * 0.09`
  lerp — continuous, jank-free easing that reproduces the "no dropped
  seeks" intent vanilla, per the build brief's ask for exact rAF easing on
  this interaction. The eased value drives a `--progress` CSS custom
  property that the planet, nebula, and orbit rotation all read.
- **Cursor-follow glow.** A second, independent rAF lerp (`ease 0.18`)
  chases the raw pointer position for the glowing orb — the more literal
  "cursor follow" read that gives the template its name.
- **Idle / no-fine-pointer drift.** Before the first pointer move, and for
  any device without a fine pointer (`(hover:hover) and (pointer:fine)`
  fails), the scrub target auto-drifts on a slow sine cycle instead of
  sitting frozen — the "meaningful touch fallback" the build brief asked
  for.
- **Entrance.** Scene layers and hero text fade/scale in once on load
  (`sceneFadeIn`, `heroFadeUp`, `scriptFadeIn`).
- **Nav micro-motion.** CTA status-dot pulse ring, CTA hover glow, mobile
  dropdown slide/fade.
- **`prefers-reduced-motion: reduce`** — the rAF loop never starts; the
  scene paints exactly one static frame at a fixed progress, all entrance
  animations resolve to their end state instantly, and the cursor-follow
  orb and pointer hint are removed (`display: none`) rather than merely
  paused, per the brief's ask for a dignified static fallback that still
  reads well.

### Deliberate deviation: the assigned background footage

The prompt's `remote_media` URL resolves to a real, valid MP4 — but every
frame of it is a pastel 3D mascot creature waving on a grassy hill, not
space or NFT footage of any kind (confirmed by inspecting the first,
middle, and last frame). Using it as the fullscreen background, even
color-graded toward the brand's navy/neon palette, still reads as a
mismatched stock clip rather than a designed hero. Rather than ship that
mismatch or invent unrelated imagery, this build replaces the video with a
procedural, non-WebGL scene (canvas starfield + CSS/SVG planet and orbit
rings) built directly from the prompt's own copy — "Beyond earth and its
familiar boundaries" reads literally as departing Earth's orbit, and the
orbit-ring nodes stand in for the "Nft collection" being showcased. The
mouse-scrub mechanic, sensitivity constant, and easing model are preserved
exactly; only the pixel content changed. No video asset is vendored into
this template as a result — `assets/` was omitted entirely.
