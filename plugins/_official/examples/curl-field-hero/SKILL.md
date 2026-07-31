---
name: curl-field-hero
description: |
  A full-viewport curl-noise flow-field hero — several thousand particles
  advect along a genuine divergence-free vector field (the curl of a
  multi-octave noise potential) so they swirl and braid without ever
  clumping, colored by a continuous cosine-gradient palette, organized by a
  slow orbiting attractor standing in for cursor input, under a spare
  editorial title-card overlay. Produced as a single self-contained
  `index.html`. Use when the brief asks for a "curl noise", "flow field",
  "vector field", "particle flow", "divergence-free", or "generative
  current/flow" visual.
triggers:
  - "curl noise"
  - "flow field"
  - "vector field"
  - "curl field"
  - "particle flow"
  - "divergence-free"
  - "generative field"
od:
  mode: prototype
  platform: web
  scenario: design
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
    sections: [color, typography]
  craft:
    requires: [animation-discipline]
---

# Curl Field Hero Skill

Produce a single self-contained `index.html` that renders a full-viewport,
canvas2D generative hero: thousands of particles advecting along a real
divergence-free curl-noise field, finished with a spare editorial title-card
overlay on top.

## Why this ships in the default sandbox

This artifact needs no elevated preview mode. It only calls `canvas2D` +
`requestAnimationFrame` — no `new Worker(`, no `SharedArrayBuffer`, no
`getContext('webgl2')` — so it runs correctly inside MishMash's default
opaque `<iframe sandbox="allow-scripts">` preview. Do not add the
`powered-preview` tag unless you actually introduce one of those APIs.

## Resource map

```
curl-field-hero/
├── SKILL.md      ← you're reading this
└── example.html  ← a working curl-noise particle flow field (READ FIRST)
```

## Workflow

### Step 0 — Read the reference

Read `example.html` end to end. Note the shape: a scalar potential `ψ(x,y,t)`
built from three offset noise octaves; velocity is the **curl** of that
potential, `v = (∂ψ/∂y, -∂ψ/∂x)`, taken via central finite differences. This
is an exact vector-calculus identity — the field is divergence-free
*everywhere*, not approximately, which is why particles braid and re-converge
instead of drifting apart or piling up. A synthetic attractor (a slow 3:2
Lissajous point) adds a point-vortex bias — also exactly divergence-free — so
flow visibly organizes around a "ghost cursor" with zero real pointer input.
Color comes from an IQ cosine-gradient palette baked into a small set of
pre-rendered radial-gradient sprites, blended with `globalCompositeOperation
= 'lighter'` for additive glow.

### Step 1 — Choose the field's mood

- **Oceanic current** (default): slow drift, cyan-to-indigo palette, teal-black
  ground — reads as a scientific instrument reading a live current.
- **Aurora**: widen palette hue spread toward violet/green-white, raise the
  vortex strength for sharper braids, thinner trail fade for more streak.
- **Magnetic filament**: tighten `FIELD_SCALE_CSS` for finer turbulence, push
  particle count up, cut the attractor's radius so filaments coil tightly.
- **Ink in water**: slow the field drift way down, lengthen particle
  `maxAge`, lower the trail-fade alpha so blooms linger longer.

### Step 2 — Build `index.html`

- **One file, zero external requests.** No CDN, no remote fonts/images — the
  glow sprites and any texture (e.g. film grain) are canvas- or
  `data:`-URI-generated.
- **True curl, not a hack.** Compute one scalar potential (sum a few offset
  noise octaves for richness), then take its curl via 4 finite-difference
  samples (`x±e`, `y±e`). Do **not** just jitter velocity randomly — the
  entire "never clumps" claim depends on the curl identity actually holding.
- **Cheap noise.** A single-octave value-noise function (hash the 4
  surrounding grid corners, smoothstep-interpolate) is enough per octave;
  don't reach for 6-octave fbm per particle — that's shader-only-cheap
  territory, not per-particle-on-CPU-thousands-of-times-a-frame territory.
- **Pre-render glow sprites, never per-particle gradients.** Build one small
  offscreen canvas per palette bucket (~32-48 buckets) at init; every frame
  just `drawImage` the right bucket with `'lighter'` blending. Creating a
  `createRadialGradient` per particle per frame is the #1 way this pattern
  drops below 60fps.
- **Trail fade, not full clear.** Paint a low-alpha rect of the background
  color each frame (`'source-over'`) before the additive particle pass — this
  is what makes braided paths visible instead of a bare scatter of dots.
- **Bake a synchronous warm-up before the first paint.** Run the same
  simulate+draw step ~40 times with a fake incrementing clock right after
  init, before the real `requestAnimationFrame` loop starts. This guarantees
  frame 0 already shows established trails and staggered particle phases —
  never a "big bang" burst from a blank canvas. Reuse *one* tick function for
  both the warm-up and the live loop; don't fork the physics into two copies.
- **Synthetic attractor, not real pointer input.** A slow Lissajous point
  (two sine waves, incommensurate-ish frequency ratio like 3:2) that locally
  biases the field is what the brief means by "standing in for cursor input"
  — do not wire up real `mousemove` for the graded first-viewport motion.

### Step 3 — Overlay + brand

- Keep the overlay spare: a small-caps kicker, a hairline rule, one oversized
  numeral, one short caption line. Write real copy for a plausible fictional
  brand (an "atlas"/"observatory"/"survey" framing suits an oceanic or
  scientific-instrument mood) — never lorem ipsum.
- Fluid, `clamp()`-based vw type scale (structure inspired by
  darkroomengineering/satus, MIT) so the numeral holds scale discipline
  against the particle field at any viewport size.
- Monospace stack, warm off-white (not pure `#fff`), generous negative space
  — the overlay should read as a title card sitting *on top* of the field,
  not a HUD/stats panel. Resist the urge to add live particle-count/fps
  readouts here — that's exactly the "tech demo" tell this pattern exists to
  avoid.

### Step 4 — Self-review (P0)

- [ ] Velocity is a true curl of a scalar potential (finite differences of
      the *same* potential in x and y) — not independently-jittered per-axis
      noise.
- [ ] Renders continuously at ~60fps with the full particle count.
- [ ] Frame 0 (first paint, no interaction) already shows moving, glowing,
      braided particles — never an empty canvas that fills in over time.
- [ ] `prefers-reduced-motion: reduce` produces one fully composed static
      frame (run the warm-up loop longer, then stop — never schedule
      `requestAnimationFrame`).
- [ ] Zero external requests: no CDN script/font/image, no `fetch`/XHR, no
      `localStorage`/`sessionStorage`/cookies — everything works inside
      `<iframe sandbox="allow-scripts">`.
- [ ] Palette stays inside its stated hue band (no accidental drift into a
      hue the brief explicitly ruled out).
- [ ] Overlay copy is real, English, and spare — kicker + rule + numeral +
      one caption line, no stat tiles.
