---
name: od-scroll-animations
description: Add scroll-linked animation to a site being built from a user's idea — scroll-triggered reveals, pinned sections, scrubbed sequences, and parallax depth, choreographed with generated GSAP ScrollTrigger code and delivered as a single self-contained HTML file.
od:
  scenario: scroll-animations
  mode: scenario
---

# Scroll Animations

Use this plugin when the user gives an idea, a brand, a product, or a page and asks
MishMash to build it with scroll-triggered motion — "scroll animations", "GSAP
ScrollTrigger", "pin this section", "parallax on scroll", "reveal on scroll", or any
site where scroll position should drive the animation, not just a hover or a page-load
transition.

This is a generation tool, not an effect extractor: there is no reference URL. The only
input is the user's idea.

## Scope

The goal is one self-contained HTML page built around the user's idea, with real GSAP
ScrollTrigger code tying selected sections' animation to the visitor's scroll position.
Unlike `od-scroll-film`, this is not a single continuous cinematic narrative told in
chapters — it is an ordinary page (landing page, product page, portfolio, whatever the
idea calls for) where scroll-linked motion is used deliberately in the sections that
earn it, not applied uniformly to every section as decoration.

## Workflow

### 1. Read The Idea, Then Choose Where Scroll Motion Earns Its Place

Read the user's idea and lay out the page's normal section structure first (hero,
feature sections, proof, CTA — whatever the idea calls for). Then decide, section by
section, whether scroll-linked motion serves that section or would just be noise:

- A hero usually **animates from frame 0** (see §4) rather than waiting on scroll.
- A feature list, a stat block, a gallery, or a proof section are the usual candidates
  for scroll-triggered treatment.
- Not every section needs scroll motion. A page where every single section pins,
  scrubs, or parallaxes reads as a tech demo, not a real site — restraint is part of
  the craft.

### 2. Choreograph Each Scroll-Linked Section

For every section that gets scroll-linked treatment, choose the primitive that tells it
best. Mix primitives across the page — using the same one everywhere is what makes a
site feel like a template instead of a considered build:

- **pin** — freeze the section in the viewport (`pin: true`) while its internal motion
  plays out against continued scrolling. Use for a section that needs room to breathe:
  a held stat, a slow reveal, a number that counts up.
- **scrub** — tie a tween or timeline's progress directly to scroll delta within a
  pinned range (`scrub: true` or a numeric lag for a trailing feel). This is what makes
  a section feel *driven by* the scroll rather than merely *triggered by* it.
- **parallax** — layer foreground/midground/background elements that move at different
  scroll-linked rates to fake depth. Use sparingly and only where the section has
  actual depth to sell — parallax with nothing behind it just looks like drift.
- **reveal** — a one-shot entrance (mask/clip-path, opacity+transform) fired once when
  the section's trigger crosses the viewport (`toggleActions`, not `scrub`). This is the
  default, lowest-risk choice for most feature/proof sections.
- **scale** — grow or shrink an element against scroll progress, e.g. an image or a
  numeral that rises from small and off-frame to full-bleed and centered. The house
  precedent is `plugins/_official/examples/velar-luxury-real-estate` (the building
  image that rises, centers, and scales to 1.45x while pinning toward the following
  section) — read `example.html` there before choreographing a scale-driven section.

## Related Skills

- `skills/gsap-scrolltrigger` — ScrollTrigger API reference (pin, scrub, start/end
  syntax, batching, `containerAnimation`, refresh/cleanup). Read before writing the
  animation code.
- `craft/animation-discipline.md` — motion timing, easing, and `prefers-reduced-motion`
  rationale.
- `craft/accessibility-baseline.md` — baseline accessibility requirements that still
  apply to a motion-heavy page.
- `craft/anti-ai-slop.md` and `craft/typography.md` — avoiding generic AI-template
  copy, type, and layout choices.
- `od-scroll-film` — the sibling scenario for a single continuous cinematic
  scroll-driven narrative told in chapters, rather than scroll motion applied
  selectively across an otherwise ordinary page.

### 3. Build With Generated GSAP ScrollTrigger Code — Hard Constraint

This is a **hard constraint from `AGENTS.md`'s Design authority section**
(`docs/decisions/gsap-licensing.md`): GSAP's license permits AI-generated GSAP *code*
by name, but prohibits shipping a **visual, no-code motion-authoring UI** that competes
with Webflow's animation builder. That line governs this skill directly:

- Write real `gsap` + `ScrollTrigger` code into the output file. Do not hand-roll a
  parallel scroll-animation engine and call it GSAP, and do not fabricate a
  timeline/keyframe editing surface for the end user to drag, scrub, or key handles in.
- The **only** visual motion control the shipped artifact may expose to a viewer is the
  existing global `--motion` multiplier (`design-templates/tweaks/SKILL.md`,
  Off / Subtle / Lively → `--motion-mult`). If you wire up `--motion` support, read
  `getComputedStyle(document.documentElement).getPropertyValue('--motion-mult')` in JS
  and multiply GSAP tween `duration` / `scrub` lag / ScrollTrigger `end` distances by
  it — never add a bespoke per-section speed dial, easing picker, or scrubber. Wiring
  up `--motion` at all is optional; exceeding it is not.
- See `skills/gsap-scrolltrigger` for the ScrollTrigger API reference (pin, scrub,
  start/end syntax, `containerAnimation` for faked horizontal scroll, refresh/cleanup
  rules) before writing the animation code.

**Vendor GSAP inline — never a CDN `<script src>`.** The shipped artifact must run with
zero network requests (see §5), but "generated GSAP code" means the real library, not a
reimplementation. Reconcile the two by pinning and inlining:

1. Pin an exact GSAP version — **`3.14.2`**, matching the version already referenced
   elsewhere in this repository (`plugins/_official/examples/hyperframes/SKILL.md`,
   `plugins/_official/scenarios/od-scroll-film/SKILL.md`). Re-read
   `docs/decisions/gsap-licensing.md` before bumping it.
2. At generation time (when you, the agent, have network access — the *shipped*
   artifact does not), fetch the pinned `gsap.min.js` and `ScrollTrigger.min.js` UMD
   builds and inline their full text verbatim inside `<script>` tags in the output
   document's `<head>`, before any code that calls
   `gsap.registerPlugin(ScrollTrigger)`.
3. If you cannot reach the network to fetch the pinned build, stop and tell the user
   that scroll-animation generation needs one-time network access to vendor GSAP. Do
   not silently fall back to a `<script src="https://cdn...">` tag (breaks the
   zero-network sandbox contract) and do not silently swap in a hand-rolled animation
   engine and present it as GSAP.

### 4. `prefers-reduced-motion` Fallback — Mandatory

The page must be **fully readable with animation off**, not degraded:

- Under `@media (prefers-reduced-motion: reduce)`, disable pin/scrub/parallax and let
  every section lay out in normal document flow, top to bottom — all copy and imagery
  visible without scrolling-as-playback, just scrolling as reading.
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
- **Animates from frame 0.** The hero (or whichever section reads first) must already
  read as composed on first paint — no flash of unstyled content, no blank page while
  GSAP boots, and any ambient/looping decorative motion in that first section runs from
  load rather than waiting on a scroll trigger. Scroll-scrubbed motion legitimately
  starts at rest at scroll position 0; "frame 0" means the *page*, not necessarily
  every tween, is fully composed and alive on load.
- **English-only.** All copy and labels.

### 6. Client-Owned Aesthetics

There is no house look for a scroll-animated site. Typography, palette, pacing, and
mood come entirely from the user's idea and any brand material they supply — read
`AGENTS.md`'s "Design authority" section before making any styling call. Infer a
fitting direction from the brief (see `craft/anti-ai-slop.md` and
`craft/typography.md`), never reach for a previous build's palette or type scale
because it is familiar.

## Self-Review (P0)

- [ ] Scroll-linked motion is used deliberately in sections that earn it, not applied
      uniformly to every section on the page.
- [ ] At least two distinct choreography primitives across the scroll-linked sections —
      not the same primitive repeated everywhere.
- [ ] Real `gsap` + `ScrollTrigger` code, vendored inline and pinned to `3.14.2` — no
      `<script src="https://cdn...">`, no hand-rolled scroll-animation engine
      presented as GSAP.
- [ ] No user-facing timeline/keyframe/per-section speed UI of any kind; the only
      motion control, if any, is the shared `--motion-mult` multiplier.
- [ ] `prefers-reduced-motion: reduce` renders every section in normal readable
      document flow with no sections pinned and no scrub/parallax running.
- [ ] Zero network requests: grep the file for `http` and bare `//` URLs.
- [ ] Frame 0 (first paint, no scroll) already shows a fully composed first section.
- [ ] All copy is real, plausible, English — no lorem ipsum.
- [ ] Palette, type, and pacing come from the user's brief, not a repeated house look.

## Credits / Attribution

- Scale-through section handoff after
  `plugins/_official/examples/velar-luxury-real-estate` (same repository) —
  reimplemented generically, not scene-specific.
- GSAP ScrollTrigger vendoring and `prefers-reduced-motion` protocol follow the same
  shape as the sibling `od-scroll-film` scenario (same repository) — reimplemented for
  a section-by-section page instead of a chaptered narrative.
