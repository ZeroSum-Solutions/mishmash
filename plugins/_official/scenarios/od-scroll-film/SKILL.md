---
name: od-scroll-film
description: Turn a user's idea into a long-form, scroll-driven cinematic story site — one continuous narrative told through pinned scenes, scrubbed reveals, parallax depth, and chapter transitions, delivered as a single self-contained HTML file.
od:
  scenario: scroll-film
  mode: scenario
---

# Scroll Film

Use this plugin when the user gives an idea, a brand, a product, or a story and asks
MishMash to build a "scroll film", a "cinematic scroll site", a "scrollytelling" page,
or any single continuous page that unfolds as the visitor scrolls rather than as
separate sections stacked and read in the usual way. The output reads like a short film
where the scrollbar is the playhead.

This is a generation tool, not an effect extractor: there is no reference URL. The only
input is the user's idea.

## Scope

The goal is one self-contained HTML page that tells one story from beginning to end,
using real GSAP ScrollTrigger code to tie the narrative's pacing to the visitor's
scroll. It is not a landing page with a hero and some scroll-triggered fade-ins bolted
on — the scroll *is* the narrative device, the way a director's cut is the film.

## Workflow

### 1. Derive The Narrative Beats

Read the user's idea and turn it into **5 to 9 narrative beats** — enough to earn the
word "film", few enough to stay buildable in one sitting. Fewer than 5 reads as a
regular landing page with scroll effects; more than 9 usually means the beats need
merging, not that the site needs to get longer.

For each beat, write a compact spec, not prose:

- `id` — short slug, e.g. `origin`, `problem`, `turn`, `proof`, `close`.
- `title` / `kicker` — the chapter's on-screen heading and small overline label.
- `copy` — the real, plausible English copy for that beat. Never lorem ipsum.
- `visualMoment` — the one image/shape/number/quote that beat exists to land.
- `mood` — tone and pacing note (quiet, propulsive, triumphant, somber...) that should
  show up in easing choices and section duration, not just in copy.

A beat sequence has a shape, not just a list — most stories want something like
setup → tension → turn → proof → resolution. Treat the first and last beats specially:
the first beat is what a visitor sees with zero scroll input (frame 0, see below), and
the last beat is the one place a definitive, non-looping ending is appropriate.

### 2. Choreograph Each Scene

For every beat, choose which scroll-linked primitive tells it best. Mix primitives
across the film — using the same one for all nine beats is what makes a scroll site
feel like a template instead of a film:

- **pin** — freeze the scene in the viewport (`pin: true`) while its internal motion
  plays out against continued scrolling. Use for beats that need room to breathe: a
  held image, a slow reveal, a stat that counts up.
- **scrub** — tie a tween or timeline's progress directly to scroll delta within a
  pinned range (`scrub: true` or a numeric lag for a trailing feel). This is what makes
  a scene feel *driven by* the scroll rather than merely *triggered by* it.
- **parallax** — layer foreground/midground/background elements that move at different
  scroll-linked rates to fake depth. Use sparingly and only where the story has actual
  depth to sell (a skyline, a stack of documents, a crowd) — parallax with nothing
  behind it just looks like drift.
- **reveal** — a one-shot entrance (mask/clip-path, opacity+transform) fired once when
  the beat's trigger crosses the viewport (`toggleActions`, not `scrub`). Use for beats
  that should land like a beat, not glide like a camera move.
- **scale** — grow or shrink an element against scroll progress, e.g. an image or a
  numeral that rises from small and off-frame to full-bleed and centered. The house
  precedent is `plugins/_official/examples/velar-luxury-real-estate` (the building
  image that rises, centers, and scales to 1.45x while pinning toward the following
  section) — read `example.html` there before choreographing a scale-driven scene.

**Chapter transitions** — how one beat hands off to the next — are part of the
choreography, not an afterthought. Options, mixed deliberately rather than defaulted to
one everywhere:

- Crossfade while unpinning.
- Mask-wipe (clip-path sweep) between scenes.
- Vertical overlap: the next scene's wrapper carries a negative top margin
  (`margin-top: -100vh`) and a higher `z-index` so it slides up and over the scene
  before it, the way velar's gallery section overlaps its dark stats band.
- A hard cut, used once, deliberately, as a rhythm break — never as the default because
  it was easier to write.

**Progress cues** — the visitor needs to feel like they are somewhere in a film, not
scrolling blind. Ship a persistent, fixed-position element (a chapter counter like
`03 / 07`, a dot rail, or a thin progress bar) that updates from `ScrollTrigger`
callbacks (`onUpdate`, `onToggle`) driven by the aggregate scroll fraction across
pinned scenes — never by polling `scrollTop` on a separate interval.

### 3. Build With Generated GSAP ScrollTrigger Code — Hard Constraint

This is a **hard constraint from `AGENTS.md`'s Design authority section**
(`docs/decisions/gsap-licensing.md`): GSAP's license permits AI-generated GSAP *code*
by name, but prohibits shipping a **visual, no-code motion-authoring UI** that competes
with Webflow's animation builder. That line governs this skill directly:

- Write real `gsap` + `ScrollTrigger` code into the output file. Do not hand-roll a
  parallel scroll-animation engine and call it a scroll film, and do not fabricate a
  timeline/keyframe editing surface for the end user to drag, scrub, or key handles in.
- The **only** visual motion control the shipped artifact may expose to a viewer is the
  existing global `--motion` multiplier (`design-templates/tweaks/SKILL.md`,
  Off / Subtle / Lively → `--motion-mult`). If you wire up `--motion` support, read
  `getComputedStyle(document.documentElement).getPropertyValue('--motion-mult')` in JS
  and multiply GSAP tween `duration` / `scrub` lag / ScrollTrigger `end` distances by
  it — never add a bespoke per-scene speed dial, easing picker, or scrubber. Wiring up
  `--motion` at all is optional; exceeding it is not.
- See `skills/gsap-scrolltrigger` for the ScrollTrigger API reference (pin, scrub,
  start/end syntax, `containerAnimation` for faked horizontal scroll, refresh/cleanup
  rules) before writing the timeline code.

**Vendor GSAP inline — never a CDN `<script src>`.** The shipped artifact must run with
zero network requests (see §5), but "generated GSAP code" means the real library, not a
reimplementation. Reconcile the two by pinning and inlining:

1. Pin an exact GSAP version — **`3.14.2`**, matching the version already referenced
   elsewhere in this repository (`plugins/_official/examples/hyperframes/SKILL.md`).
   Re-read `docs/decisions/gsap-licensing.md` before bumping it.
2. At generation time (when you, the agent, have network access — the *shipped*
   artifact does not), fetch the pinned `gsap.min.js` and `ScrollTrigger.min.js` UMD
   builds and inline their full text verbatim inside `<script>` tags in the output
   document's `<head>`, before any code that calls
   `gsap.registerPlugin(ScrollTrigger)`.
3. If you cannot reach the network to fetch the pinned build, stop and tell the user
   that scroll-film generation needs one-time network access to vendor GSAP. Do not
   silently fall back to a `<script src="https://cdn...">` tag (breaks the zero-network
   sandbox contract) and do not silently swap in a hand-rolled animation engine and
   present it as GSAP.

### 4. `prefers-reduced-motion` Fallback

The film must be **fully readable with animation off**, not degraded:

- Under `@media (prefers-reduced-motion: reduce)`, disable pin/scrub/parallax and let
  every scene lay out in normal document flow, top to bottom, in beat order — all copy
  and imagery from every beat visible without scrolling-as-playback, just scrolling as
  reading.
- Detect this before creating any `ScrollTrigger` instance
  (`window.matchMedia('(prefers-reduced-motion: reduce)').matches`) rather than
  creating triggers and then trying to neutralize them — GSAP's own
  `matchMedia()`/`gsap.matchMedia()` helper is the idiomatic way to branch cleanly
  between the motion and reduced-motion builds of the same timeline code.
- Reduced motion is independent of, and takes priority over, any `--motion` setting
  (`design-templates/tweaks/SKILL.md` §5: default to *Off* whenever
  `prefers-reduced-motion` is set, regardless of a stored `--motion` preference).

### 5. Delivery Constraints

- **One file.** Ship a single self-contained `index.html` — all CSS and JS inline, the
  vendored GSAP build inline (§3), no external stylesheets, fonts, or images.
- **Zero network requests.** No CDN script/font/image, no `fetch`/XHR, no
  `localStorage`/`sessionStorage`/cookies — the artifact must run correctly inside
  MishMash's sandboxed `<iframe sandbox="allow-scripts">` preview.
- **Animates from frame 0.** The first beat must already read as a composed scene on
  first paint — no flash of unstyled content, no blank page while GSAP boots, and any
  ambient/looping decorative motion in that first scene runs from load rather than
  waiting on a scroll trigger. Scroll-scrubbed motion legitimately starts at rest at
  scroll position 0; "frame 0" means the *page*, not necessarily every tween, is fully
  composed and alive on load.
- **English-only.** All copy, labels, and progress-cue text.

### 6. Client-Owned Aesthetics

There is no house look for a scroll film. Typography, palette, pacing, and mood come
entirely from the user's idea and any brand material they supply — read
`AGENTS.md`'s "Design authority" section before making any styling call. Treat this
the way an editorial art director treats a genuinely new commission: infer a fitting
direction from the brief (see `craft/anti-ai-slop.md` and `craft/typography.md`),
never reach for a previous scroll-film's palette or type scale because it is familiar.

## Self-Review (P0)

- [ ] 5-9 narrative beats, each with a distinct choreography primitive — not the same
      primitive repeated for every beat.
- [ ] At least one deliberate chapter-transition technique beyond a plain hard cut.
- [ ] A persistent progress cue driven by `ScrollTrigger` callbacks, not polling.
- [ ] Real `gsap` + `ScrollTrigger` code, vendored inline and pinned to `3.14.2` — no
      `<script src="https://cdn...">`, no hand-rolled scroll-animation engine
      presented as GSAP.
- [ ] No user-facing timeline/keyframe/per-scene speed UI of any kind; the only motion
      control, if any, is the shared `--motion-mult` multiplier.
- [ ] `prefers-reduced-motion: reduce` renders every beat in normal readable document
      flow with no scenes pinned and no scrub/parallax running.
- [ ] Zero network requests: grep the file for `http` and bare `//` URLs.
- [ ] Frame 0 (first paint, no scroll) already shows a fully composed first scene.
- [ ] All copy is real, plausible, English — no lorem ipsum.
- [ ] Palette, type, and pacing come from the user's brief, not a repeated house look.

## Related Skills

- `skills/gsap-scrolltrigger` — ScrollTrigger API reference (pin, scrub, start/end
  syntax, batching, `containerAnimation`, refresh/cleanup). Read before writing the
  timeline code.
- `craft/animation-discipline.md` — motion timing, easing, and `prefers-reduced-motion`
  rationale.
- `craft/accessibility-baseline.md` — baseline accessibility requirements that still
  apply to a cinematic, motion-heavy page.
- `craft/anti-ai-slop.md` and `craft/typography.md` — avoiding generic AI-template
  copy, type, and layout choices.
- `plugins/_official/examples/velar-luxury-real-estate` — the hand-built precedent for
  pin + scale-through scene choreography and progress-band sticky handoff; read
  `example.html` before choreographing a scale-driven scene.

## Credits / Attribution

- Chapter-card kicker + progress-rail convention follows the common long-form
  scrollytelling pattern popularized by outlets like Pudding.cool and the New York
  Times — original implementation, no source copied.
- Scale-through scene handoff after `plugins/_official/examples/velar-luxury-real-estate`
  (same repository) — reimplemented generically, not scene-specific.
