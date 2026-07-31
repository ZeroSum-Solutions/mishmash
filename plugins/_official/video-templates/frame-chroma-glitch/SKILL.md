---
name: video-template-frame-chroma-glitch
description: Use this plugin when the user wants a "Chroma Glitch Title" HyperFrames motion video — a restrained broadcast-glitch title frame where an irregular clip-path band jitter and an RGB channel-split flash pulse on one fixed rhythmic beat over a drifting scanline, reading as a deliberate transmission cut rather than continuous noise.
license: Apache-2.0
metadata:
  author: nexu-io
  version: "0.1.0"
od:
  mode: video
  scenario: video
  surface: hyperframes
---

# Chroma Glitch Title

A restrained, premium broadcast-glitch title frame. The headline and its duplicate chroma layers pulse through an irregular clip-path band jitter on a fixed rhythmic interval — not constant noise — combined with an RGB channel-split flash and a thin drifting scanline, so it reads as one deliberate "transmission" beat rather than a generic noise filter.

## What this template is

A HyperFrames-ready HTML + CSS (+ a few lines of vanilla JS for the running timecode) motion composition, self-contained in `example.html`. It renders deterministically to MP4 / WEBM at 16:9, default 15s, 60fps.

**Best for:** Tech product reveal · Cyberpunk / hacker aesthetic · Video transition or interstitial title card

## The technique, in order

1. **One shared beat, not continuous noise.** Every layer's animation shares the same duration and the same `--delay-anim` custom property, so all of them hit their glitch window at the same instant. The cycle spends roughly 68% of its time in a perfectly clean, readable state; the pulse itself is a short (~15%) burst.
2. **Irregular clip-path band jitter, applied to the title text itself.** Inside the pulse window, ~15 `clip-path: polygon()` keyframe stops carve out a horizontal band of the headline and nudge it with a small `translate3d`. The stops are irregularly spaced (gaps of 0.4%–1.4% of the cycle, never a uniform step) — evenly-spaced steps read as a loop; irregular ones read as corruption.
3. **RGB channel-split flash, kept small.** Two more duplicate text layers (electric blue, hot magenta), `mix-blend-mode: screen`, sit on top with `opacity: 0` at rest. During a subset of the same pulse marks they flash to ~0.8 opacity with only a **2–3px** offset — a chromatic-aberration nudge, not a cheap 10px+ jump. Restraint here is what reads as "premium broadcast" instead of "noise filter."
4. **One mirrored-slice flash per pulse.** A fourth duplicate layer gets `scale3d(-1,-1,1)` and flashes for exactly one keyframe stop inside the pulse, clipped to a single band. It punctuates the beat once — it is never continuously mirrored.
5. **Hard cuts, not smooth morphs.** Every keyframe stop sets `animation-timing-function: steps(1,end)` so the browser jump-cuts between clip-path/transform states instead of tweening them. Smooth interpolation between polygons looks like a soft blob morph; steps() is what makes it read as digital.
6. **Ambient motion runs independently of the beat.** A `repeating-linear-gradient` scanline texture drifts continuously, a thin scan-beam sweeps top-to-bottom on an eased loop, and a REC dot blinks — all from frame 0, all unrelated to the glitch cycle's timing. This is what keeps the first viewport alive during the ~2s of clean time between pulses.

## Workflow

1. Read `example.html` end to end to see the named layers (`.title-base`, `.title-blue`, `.title-magenta`, `.title-mirror`) and the shared `--delay-anim` rhythm before changing anything.
2. Replace the sample copy (kicker, headline, subtitle, meta labels) with the user's real content; keep the cadence (idle-to-pulse ratio) and the small channel-split offset intact — do not widen the RGB offset past a few px or the effect stops reading as "premium."
3. If the headline text length changes a lot, re-check the clip-path band `Y` ranges still land inside the text's rendered box at the new `clamp()` size.
4. Keep the composition self-contained in one file; do not introduce external network assets that would break a headless render.
5. Render to MP4 via the html-video / HyperFrames renderer.

## Self-review

- [ ] The glitch pulse recurs on a fixed, predictable cadence — never continuous per-frame noise.
- [ ] The clip-path stops inside a pulse are irregularly spaced, not an even step interval.
- [ ] The channel-split offset stays small (2–3px); it is a flash, not a permanent double-exposure.
- [ ] Scanline drift, scan-beam sweep, and the REC blink are all running from frame 0, independent of the glitch cadence.
- [ ] `prefers-reduced-motion: reduce` yields a composed static frame (a tasteful fixed chroma fringe), not a frozen mid-glitch frame.

## Attribution

Source: html-video `templates/frame-chroma-glitch` (license Apache-2.0). Pattern inspired by Codrops "CSS Glitch Effect" (codrops/CSSGlitchEffect) and, for the channel-split concept only, Codrops "Text Distortion Effects" (codrops/TextDistortionEffects) — both under Codrops's own custom permissive clause (not OSI MIT; no LICENSE file; README allows building upon it, no resale; confirmed via a 404 on the license-detection API). Reimplemented from scratch in vanilla CSS/JS; no Codrops or Blotter/WebGL source is copied.
