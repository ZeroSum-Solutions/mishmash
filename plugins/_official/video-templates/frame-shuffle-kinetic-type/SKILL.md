---
name: video-template-frame-shuffle-kinetic-type
description: Use this plugin when the user wants a "Shuffle Kinetic Type" HyperFrames motion video — a looping decode/scramble title card
license: MIT
metadata:
  author: nexu-io
  version: "0.1.0"
od:
  mode: video
  scenario: video
  surface: hyperframes
---

# Shuffle Kinetic Type

A looping title card where the headline perpetually decrypts itself.

## What this template is

A HyperFrames-ready HTML + CSS + vanilla JS motion composition, bundled as `example.html`. The reference build renders at 1920×1080 (16:9) and is built to loop indefinitely — a 15s render captures roughly one and a half full cycles of the motion signature described below.

**Best for:** Title sequences · Cold opens · Season/episode cards · Broadcast idents

## The motion signature

This is one continuous director loop over two words (swap in the user's real headline word(s)). Each word runs through four beats, then the next word begins:

1. **Enter + scramble.** The word's characters slide up into view (`translateY(118%) → 0`, `transition-delay: calc(var(--i) * 24ms)`) while each character is already cycling a random glyph from a fixed pool on a recursive ~15ms timer.
2. **Decode wave.** Characters resolve to their real letter left-to-right, one `CHAR_STAGGER` (90ms) apart. The character that just resolved flashes the crimson accent for ~170ms before settling to paper-white — the wave reads as a moving edge of color, not a single-color reveal.
3. **Breathe.** Once fully resolved, the whole word pulses: `scale(0.94 → 1.03 → 1)` under `font-variation-settings: "wght"/"wdth"` keyframes, and a thin rule beneath the word grows in sync. Only two named eases are used anywhere: `--ease-out-expo` for slides, `--ease-in-out-quart` for the breathe/rule.
4. **Reverse + re-shuffle.** The wave runs backward — right-to-left, last-resolved character breaks first — un-resolving the word back into random glyphs, then the whole line slides up and out (still scrambling underneath), and the next word slides in already mid-shuffle to restart at step 2.

The whole thing is one `async` loop (`for (;;) { await playWord(...) }`), which is its own re-entrancy guard: there is exactly one call site advancing the sequence, so no separate `isAnimating` flag is needed.

## Workflow

1. Read `example.html` end to end — the `<style>` block owns the type scale/easing tokens, the `<script>` block owns `buildWord`, `playWord`, and `directorLoop`.
2. Replace `WORDS`, the kicker (`.kicker`), and the byline (`.byline`) with the user's real headline word(s) and brand copy; keep the four-beat timing and the crimson-only-on-the-resolve-edge color rule intact — that restraint is what keeps it reading as premium instead of noisy.
3. If the new headline word count changes materially, sanity-check `CHAR_STAGGER` / `HOLD_MS` still land the breathe pulse and the CSS `kt-breathe` animation duration in sync (they're coupled: `HOLD_MS` should equal the CSS animation's total run time).
4. Keep the composition self-contained; do not introduce external network assets (fonts, images, scripts) that would break a headless render.
5. Render to MP4 via the html-video / HyperFrames renderer.

## Self-review

- [ ] Decode wave direction reverses correctly on the un-resolve pass (last-resolved character breaks first).
- [ ] Only the resolve/un-resolve edge ever shows the crimson accent; resting text is paper-white or dimmed, never crimson.
- [ ] Loop has no visible seam between the last word's exit and the first word's re-entry.
- [ ] `prefers-reduced-motion: reduce` shows a fully static, already-resolved composed frame — no scrambling, no ticking timecode.

## Attribution

Character decode/scramble wave inspired by Codrops "TypeShuffleAnimation" (MIT), rewired from a one-shot on-load trigger into this infinite resolve/breathe/reverse director. Per-character overflow-hidden translateY stagger inspired by Codrops "TypographyMotion" (MIT), rewired from a click-gated reveal into a self-driven line swap. Fluid vw-based type scale and named easing tokens inspired by darkroomengineering/satus (MIT). No GSAP or Lenis source is included; all motion code is original vanilla CSS/JS.
