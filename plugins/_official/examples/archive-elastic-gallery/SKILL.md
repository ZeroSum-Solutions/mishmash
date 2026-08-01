---
name: archive-elastic-gallery
description: |
  A perpetually-reshuffling gallery grid choreographed entirely by a
  self-driven boomerang playhead: differential per-column lag stretches the
  grid like taffy, a perspective depth-shuffle cycles between two 3D recipes
  every loop, and one tile auto-fires a sliced-band reassembly plus a
  character-scramble caption on a timer. No real scroll or hover input is
  ever required — the whole first viewport is in constant, beautiful motion
  from frame 0.
triggers:
  - "elastic gallery"
  - "self-driving gallery"
  - "archive gallery"
  - "perpetual motion grid"
  - "taffy grid"
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
  craft:
    requires: [animation-discipline]
---

# Archive Elastic Gallery Skill

Produce a single self-contained `index.html` — a gallery grid that never
sits still: a synthetic scroll playhead drives differential column lag, a
cycling 3D depth-shuffle, and a timed auto-hover reveal, all live from frame
0, with zero real scroll or pointer input required.

## Why this renders in the standard sandbox

This tile draws with plain DOM transforms and Canvas 2D — it never calls
`getContext('webgl2')` — so MishMash serves it in the default opaque
`<iframe sandbox="allow-scripts">`, no cross-origin isolation or GPU pipeline
needed. Canvas 2D here only paints procedural gradients and noise (it never
loads an external image into the canvas), so `canvas.toDataURL()` never
taints and works fine without `allow-same-origin`.

## Resource map

```
archive-elastic-gallery/
├── SKILL.md      ← you're reading this
└── example.html  ← the complete, working artifact (READ FIRST)
```

## The four-layer choreography

### 1. Self-driven playhead (replaces real scroll)

One `requestAnimationFrame` loop computes a synthetic scroll target with a
smooth sine boomerang: `target = (sin((t/period - 0.25) * 2π) + 1) / 2`, so
it eases 0 → 1 → 0 every cycle with no linear ramps or hard corners. Every
pattern below reads from this single `target`, never from `scrollY`.
(Damping-follows-target lineage: darkroomengineering/lenis, MIT —
reimplemented here as plain exponential smoothing; no Lenis source used.)

### 2. Differential column lag (ElasticGridScroll, MIT)

Bucket grid items into columns by `index % columnCount` — not by DOM order.
Each column smooths toward the shared `target` with its own time constant:
`tau = tauBase + |colIndex - center| * tauScale`, so center columns react
fast and edge columns lag behind. Translate each column by its own smoothed
value (alternating sign per column for a ribbon shape) and add a small
`skewY` proportional to `target - smoothed` — the momentary gap between
where a column *should* be and where it *is* — so lagging columns visibly
stretch like taffy and snap back the instant the boomerang reverses.

### 3. Perspective depth-shuffle (Scroll3DGrid, MIT)

Give every tile a fixed random seed (`rotX`, `rotY`, `z`, `brightness`) at
build time. Each frame, lerp that seed by its *own column's* smoothed
progress (so depth inherits the same elastic lag) through whichever of two
named recipes is currently active, and swap recipes once per full boomerang
loop. Because every recipe term is `seed * progress`, all transforms rest at
zero exactly when `progress` is near zero — the loop boundary — so the
recipe swap lands on a resting frame and is never visible as a pop.

### 4. Auto-firing hover: sliced bands + caption scramble (ClipHoverEffect, MIT)

A second, independent timer cycles a "spotlight" through the tiles in a
shuffled order (not left-to-right) so one tile is always mid-reveal,
holding, or closing. On activation: split that tile into N horizontal
bands, each seeded with its own random Y offset and animated back to rest on
a 900ms ease-out — only the currently spotlit tile ever carries band
elements in the DOM, so the grid stays cheap everywhere else. In parallel,
drive the caption's characters through a random-glyph pool that resolves
left-to-right as the reveal progresses, and cross-fade the tile's frame and
caption from ink-on-bone to bone-on-ink for the duration of the spotlight.

## Canvas-generated imagery (no remote assets)

Each tile's "photograph" is a small offscreen `<canvas>`: a randomized
linear-gradient plate in one of two families (deep ink-navy or bone/cream),
a radial vignette, and a shared noise-grain texture composited with
`globalCompositeOperation = 'overlay'`. Convert it to a data URL once at
boot and reuse the exact same URL for both the tile's resting image and its
reveal bands, so the bands are seamless with the resting state the instant
they finish reassembling.

## Palette discipline

Bone `#f2ede4` / ink-navy `#1c2333`, strictly two-tone — even the swatch
"photography" stays inside that family, varying only in lightness and
warmth, so the auto-hover invert (bone-on-ink ↔ ink-on-bone) reads as a
clean tonal flip rather than a color clash. Do not introduce a third hue
family; that is what keeps this the fleet's one deliberately light,
archival-feeling tile.

## Self-review (P0)

- [ ] Motion starts at frame 0 with zero interaction — no scroll, no hover, no click.
- [ ] The grid never truly rests: elastic lag, depth-shuffle, and auto-hover all loop continuously and independently.
- [ ] The recipe swap at each loop boundary is invisible (every transform is near zero there).
- [ ] Only the currently active tile ever has band elements in the DOM.
- [ ] `prefers-reduced-motion` renders one static, fully-composed frame — no rAF loop runs, nothing scrambles.
- [ ] Zero network requests: no CDN script/font/image, no fetch/XHR; canvas imagery is procedural only.
- [ ] Copy is real museum-label prose for an invented archive — no lorem ipsum.

## Credits / attribution

- playhead damping lineage: darkroomengineering/lenis (MIT) — reimplemented, no source copied
- differential column lag: codrops/ElasticGridScroll (MIT) — pattern only
- perspective depth-shuffle: codrops/Scroll3DGrid (MIT) — pattern only
- sliced-band reveal + caption scramble: codrops/ClipHoverEffect (MIT) — pattern only
- imagery: Original (canvas-generated, no remote assets)

Keep this attribution intact if you fork the file. Replace imagery only with
license-clean assets (original / AI / canvas-generated) — never scraped
photography.
