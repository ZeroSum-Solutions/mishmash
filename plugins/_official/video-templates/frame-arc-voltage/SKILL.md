---
name: video-template-frame-arc-voltage
description: Use this plugin when the user wants an "Arc Voltage Frame" HyperFrames motion video — a high-energy beat-synced title frame where white-hot Lichtenberg arcs strike across a graphite-black canvas on a fixed beat grid, each beat triggering a pulse-ring bloom and a strobe-safe flash, with the title punching in on the downbeat.
license: Apache-2.0
metadata:
  author: nexu-io
  version: "0.1.0"
od:
  mode: video
  scenario: video
  surface: hyperframes
---

# Arc Voltage Frame

A high-energy beat-synced title frame — white-hot Lichtenberg arcs strike across a graphite-black canvas on a fixed beat grid, each beat triggering a pulse-ring bloom and a strobe-safe flash, with the title punching in on the downbeat.

## What this template is

A HyperFrames-ready HTML + CSS + canvas motion composition, bundled as `example.html`. Unlike a scripted intro that plays once, this template runs a genuine **beat-grid trigger clock**: a fixed-BPM timer fires beat events forever, and every visible response (arc strike, pulse ring, flash, title punch) re-derives from that one clock instead of a hand-authored timeline. It renders live at 60fps directly in the browser — no build step, no external assets — and is equally suited to a deterministic headless capture at 16:9, default 15s.

**Best for:** Music / DJ set or festival opener · Product launch with real kinetic energy · Any title card that needs to feel "live to a beat" rather than merely animated

## How it works (so you can reproduce or restyle it)

1. **Beat-grid trigger clock.** Pick a BPM (this build uses 128, a canonical up-tempo electronic tempo). `BEAT_MS = 60000 / BPM`. On every animation frame, if `now >= nextBeatAt`, fire a beat, then `nextBeatAt += BEAT_MS` (loop, not `setInterval`, so it self-corrects against frame jitter). Every 4th beat (`idx % 4 === 0`) is the **downbeat** — bigger arc, brighter ring/flash, and the only trigger for the title punch. This split (steady subdivisions + an accented downbeat) is what makes the motion read as an actual beat-grid rather than one repeating loop.
2. **One shared easing curve for every response.** `arrive(t) = clamp(1.001 - 2^(-10t), 0, 1)` — a branchless, clamped ease-out-expo. Use it for the arc's reveal, the ring's scale (0→2.4), and the title punch's settle-back-to-rest. Reusing one curve everywhere is what gives the piece a single, consistent "fast-strike, soft-settle" personality instead of a grab-bag of easings.
3. **Midpoint-displacement branching arcs (Lichtenberg figures).** Recursively split a segment at its midpoint, offset the midpoint perpendicular to the segment by a random amount, and halve that displacement each recursion level (`disp *= 0.56`). Occasionally (`rng() < 0.32`, only above the leaf level) spawn a shorter child branch at the split point. Redraw the whole tree fresh from a new random seed on every beat — never reuse or loop a static asset. Stagger each segment's reveal by its recursion depth (`order * 8ms`) so the trunk draws fractionally before the tips, reading as a genuine "strike" instead of a pop-in.
4. **Distance-keyed color via an IQ cosine palette.** `color(t) = a + b·cos(2π·c·t)` per channel (Inigo Quilez's public palette formula), solved so `t=0` → white-hot and `t=1` → violet corona. Render it as a single `createRadialGradient` centered on the strike origin with radius = strike length — the gradient's own distance falloff *is* the "color by distance from origin" requirement, so you never need to recolor individual segments.
5. **Pulse-ring bloom, capped to one in flight.** A ring is a plain object (`{x, y, born, big}`), not an array — each beat simply overwrites it, which is the entire "cap at one ring" rule. Draw `scale = arrive(p) * 2.4`, `alpha = (1 - p) * peak`, life ≈ 400–420ms.
6. **Strobe-safe flash discipline.** Localize the flash to a soft `createRadialGradient` centered on the strike origin, radius a fraction of `min(width, height)` — never a full-viewport overlay. Cap alpha at 0.45 (downbeat) / ~0.30 (off-beat), fade linearly to zero within ~240ms, and gate it to the same beat clock as everything else. At 128 BPM that is a trigger rate of ~2.1Hz — verify your own BPM choice keeps this well under the ~3Hz photosensitive-seizure guideline; do not raise the flash rate independently of the beat clock.
7. **Title punch on the downbeat only.** Track `lastDownbeatAt`; each frame compute `k = 1 - arrive(min(1, (now - lastDownbeatAt) / 380))` and drive `transform: scale(1 + 0.055k)` plus a brightness/drop-shadow glow proportional to `k`. Off-beats leave the title alone — the punch is a downbeat-only accent, not a per-beat wobble.

## Workflow

1. Read `example.html` to see the full beat clock, easing, and canvas drawing code in one file.
2. Replace the sample copy (eyebrow, title lines, subcopy, captions) with the user's real content; keep the beat-grid system, timing constants, and palette intact — the rhythmic system *is* the visual signature here, not any single frame of it.
3. If retiming to a different BPM, keep flash duty-cycle and opacity cap in mind (see step 6 above) rather than only scaling the tempo.
4. Keep the composition self-contained; do not introduce external network assets that would break a headless render or violate the sandboxed-preview constraint.
5. Render to MP4 via the html-video / HyperFrames renderer, or preview live as `example.html` directly.

## Attribution

Original composition — no static preset or upstream repo cloned. Concepts and public formulas used, with no source code copied:
- Beat-clock arrival easing concept adapted from darkroomengineering/lenis (MIT) — formula only.
- Branching arcs: classic midpoint-displacement fractal subdivision (public-domain Lichtenberg-figure technique).
- Palette: Inigo Quilez's public cosine-gradient palette formula (iquilezles.org/www/articles/palettes).
