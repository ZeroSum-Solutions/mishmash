---
name: agency-marquee-reveal
description: >
  Produce a perpetually-looping, self-contained agency landing hero: a
  synthetic ping-pong playhead (0→1→0, run through frame-rate-independent
  exponential damping so it trails like real scroll momentum) drives a
  velocity-reactive infinite marquee, a word-by-word igniting headline, and
  a sticky Fold-style panel handoff — all playing from frame 0 with zero
  scrolling and zero user interaction. One self-contained HTML file, 60fps,
  zero dependencies.
triggers:
  - agency landing
  - marquee reveal
  - scroll story hero
  - kinetic headline
  - synthetic playhead
  - velocity marquee
  - self-driven scroll
  - perpetual loop hero
  - fold transition
  - darkroom style landing
od:
  category: kinetic-landing
  surface: web
  mode: prototype
  platform: desktop
  scenario: marketing
  featured: 3
  audience: agencies, design studios, founders shipping a landing page
  tone: cold, confident, always in motion
  scale: single viewport, perpetual loop
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  craft:
    requires:
      - animation-discipline
      - typographic-rhythm
inputs:
  - id: brand
    label: Brand identity
    description: Agency wordmark, positioning line, founding year, header meta (location / volume tag).
  - id: hero
    label: Hero statement
    description: One sentence, 8-10 words, split word-by-word for the ignite reveal. Pick one word as the brass-underline accent.
  - id: capabilities
    label: Marquee capability list
    description: 4-6 short capability phrases for the infinite ticker, each pair separated by a rule glyph.
  - id: credentials
    label: Credential / tag row
    description: 3-5 short proof chips (founding year, roster size, ships launched, awards).
  - id: fold
    label: Next-chapter fold panel
    description: A numbered eyebrow ("II — …"), one short statement, and a supporting line previewing "what's next".
parameters:
  output_format:
    type: enum
    values: [standalone-html]
    default: standalone-html
  period_seconds:
    type: number
    default: 11
    description: Full ping-pong cycle length (seconds) for the synthetic playhead. Shorter reads more urgent; longer reads more stately.
  damping_lambda:
    type: number
    default: 3.2
    description: Exponential smoothing rate applied to the playhead every frame. Higher = snappier tracking; lower = more trailing lag.
outputs:
  - path: <out>/index.html
    description: Self-contained HTML, all CSS/JS inline, zero external dependencies, zero network requests, sandbox-safe (no fetch/storage).
capabilities_required:
  - file-write
example_prompt: |
  Build an agency-marquee-reveal landing hero for "Basalt & Rule", a
  brand-and-motion studio. Hero statement "We build the machinery
  ambitious brands run on.", marquee capability list (Brand Systems,
  Product Design, Motion Engineering, Growth Architecture), credential
  row (EST. 2014, 60 SHIPS LAUNCHED, SOTD × 9), fold panel "III — THE
  METHOD / Research. System. Motion. Launch."
---

# agency-marquee-reveal

Produce a single-viewport agency landing hero that is **never at rest**. A
real scroll-story site scrubs its motion to `scrollY`; this skill fakes
that input with one self-driven synthetic playhead so the entire
choreography — marquee, headline ignition, section handoff — loops forever
from the moment the document mounts, with no scrolling and no click.

This exists because a gallery/preview surface only ever shows the first
viewport, live, with zero interaction. A site that only comes alive on
scroll is a static screenshot there. This skill compresses the scroll-story
into a loop that is always mid-gesture.

> Pattern lineage (feel reimplemented in vanilla JS/CSS, no source copied,
> all MIT): the damped playhead-follow math borrows from
> **darkroomengineering/lenis**; the velocity-reactive marquee, the
> `ProgressText` word reveal, the `--progress`-driven sticky **Fold** panel
> handoff, and the `useReveal` `data-reveal` stagger contract borrow from
> **darkroomengineering/satus**.

## The synthetic playhead

Everything on the page reads from one number, `pos` (0 → 1), instead of
`window.scrollY`:

1. **Target** — a plain ping-pong triangle wave of wall-clock time:
   `x = (elapsed % PERIOD) / PERIOD; target = x < 0.5 ? x*2 : 2 - x*2`.
2. **Follow** — `target` is chased with frame-rate-independent exponential
   damping so it trails like real momentum instead of teleporting:
   `pos += (target - pos) * (1 - Math.exp(-LAMBDA * dt))`.
3. **Velocity** — `(pos - prevPos) / dt`, the frame-to-frame delta. This is
   what the marquee reads to decide how fast it should be moving *right
   now*. Because the damped playhead tracks a constant-speed triangle
   wave, its own velocity is roughly *constant* through the body of each
   ramp and dips toward zero only briefly at each ping-pong turn (a
   direction reversal has to pass through zero velocity to get there) — so
   the marquee surges through most of each ramp and eases to a graceful
   crawl right at the turn. A rescale constant (`VELOCITY_GAIN`) brings
   that swing into a legible range; without it the raw 0→1-per-`PERIOD`
   velocity is too small to read as motion at all.

`pos` is written once per frame to a single CSS custom property,
`--progress`, on `<html>`. Everything that only needs a smooth 0→1 value
(the hero recede, the fold panel rise) reads `var(--progress)` straight in
CSS — no per-element JS writes needed for those. Only the word ignition and
the marquee offset need per-frame JS, because they need per-element color
math and cumulative offset the CSS custom-property alone can't express.

## What you get

- **Velocity-reactive infinite marquee** — two identical duplicated groups
  in one flex track; the last observed (gain-rescaled) velocity scales the
  base speed via `1 + min(abs(velocity) / 5, 3)`, wrapped with modulo
  against one group's measured width. It surges through the body of each
  ramp and eases to a graceful crawl at each turn — never a hard stop.
- **Word-by-word igniting headline** — the hero sentence is split into
  `.word` spans, each owning an even `1/n` slice of `pos`. A word's color
  lerps `bone-dim → bone` across its slice, plus a brass glow that peaks
  mid-transition (`sin(wp * π)`) — a "catching light" flare, not a hard cut.
  Because `pos` ping-pongs, words de-ignite symmetrically on the return
  swing instead of staying lit forever — that symmetry is what keeps the
  headline reading as *alive* on every subsequent loop, not just the first.
- **Sticky Fold-style handoff** — a fixed-height panel pinned to the
  viewport bottom, translated by `(1 - progress) * <its own height minus a
  small resting sliver>`. At rest it peeks a few `svh` above the fold edge
  (unmistakably "there's more below"); at peak it's fully seated. The hero
  above it recedes by `translate3d(0, progress * -5svh, 0)` and dims
  slightly — the "next panel swallowing the hero" read — without ever
  fully whiting out or hiding the headline.
- **`useReveal` `data-reveal` stagger** — on load, every `[data-reveal]`
  element gets an auto-assigned `--reveal-index` (its DOM order), and a
  shared keyframe staggers by `index * 90ms`. One-time boot-in polish,
  independent of the perpetual loop.
- **Fluid vw-based type scale** — every size token is
  `clamp(min, calc((px * 100vw) / 1440), max)`: a fluid scale keyed to a
  1440px reference design width, clamped so small preview surfaces never
  break. `--ease-out-expo` / `--ease-in-out-quart` are the *only*
  cubic-beziers referenced anywhere.

## Page structure

```text
1. Header bar      — wordmark + tiny tracked meta (mono, reveal-once)
2. Marquee ticker  — infinite capability list, velocity-reactive offset,
                     brass hairline rules top/bottom, brass rule glyphs
3. Hero center     — eyebrow (+ brass underline) · word-igniting headline
                     (one word carries a static brass underline accent) ·
                     supporting line · credential/tag row (reveal stagger)
4. Fold panel      — absolutely positioned, pinned to the stage bottom;
                     rises/recedes with --progress; numbered eyebrow +
                     short statement + supporting line
```

## Workflow contract

### 1. Gather the brief
Agency identity, one hero sentence (8-10 words — the ignite reveal reads
best with 7-10 word slices), 4-6 marquee capability phrases, 3-5 credential
chips, and the fold panel's next-chapter copy (numbered eyebrow + one
statement + one line).

### 2. Tune the playhead
Pick `period_seconds` and `damping_lambda` to match the brand's temperament
— a punchier, younger brand can run a shorter period (7-8s) and higher
lambda (4-5, snappier tracking); a stately, established one can run longer
(12-14s) and lower lambda (2-2.5, more trailing lag). Don't go below ~2.5
lambda or above ~18s period — both start reading as sluggish rather than
confident.

### 3. Write `example.html`
Mirror the structure of [`example.html`](./example.html). Component
primitives already defined in its `<style>` block:

- `.word` / `.word--accent` — ignite-reveal spans; mark exactly one word
  `--accent` for the static brass underline.
- `.marquee-track` / `.m-item` / `.m-rule` — the velocity-reactive ticker.
- `[data-reveal]` — auto-indexed entrance stagger; apply to the header,
  eyebrow, sub-line, and each tag chip individually.
- `.fold` / `.fold-inner` — the sticky handoff panel; keep its content
  top-anchored so a shallow reveal reads as an intentional "peek", not a
  clipped accident.
- `--progress` — read directly in CSS (`calc(var(--progress) * ...)`) for
  anything that's a smooth, non-cumulative 0→1 transform/opacity.

Keep the palette disciplined: brass-ochre is reserved for the marquee
hairlines/rule glyphs, the eyebrow underline, the one accent-word
underline, and the ignition glow itself. Nothing else on the page should
carry it — tag borders, fold labels, and body copy all stay bone/stone.

### 4. Self-check before delivering (P0)
- [ ] Motion starts on the very first animation frame — no click, no
      scroll, no hover required.
- [ ] The marquee visibly surges through the body of each ramp and eases
      to a graceful crawl at each ping-pong turn — never a hard stop, and
      never a flat, unreactive constant speed.
- [ ] Words ignite left-to-right and de-ignite symmetrically on the return
      swing — the loop must still look alive on cycle two, not just cycle
      one.
- [ ] The fold panel rises and recedes but never fully covers or hides the
      headline at any point in the cycle.
- [ ] `prefers-reduced-motion: reduce` renders one fully composed static
      frame (a fixed mid-cycle `--progress`, words statically colored, the
      rAF loop never started) — not a frozen mid-transition glitch.
- [ ] Zero external requests: no CDN, no Google Fonts, no remote images —
      grep the file for `http` and bare `//` URLs.
- [ ] Works inside `<iframe sandbox="allow-scripts">` — no `fetch`, no
      `localStorage`/`sessionStorage`/cookies, no same-origin reads.
- [ ] All copy is real, plausible brand copy — no lorem ipsum.

## Files in this skill

```text
agency-marquee-reveal/
├── SKILL.md          # this contract
└── example.html      # canonical self-driven-loop rendering
```

## Boundaries

- **Do not** wire this to real `scrollY`, `IntersectionObserver`, or any
  user-input listener — the whole point is that it runs identically with
  zero interaction. If a downstream build wants real scroll-scrubbing
  later, that's a different skill; keep this one self-driven.
- **Do not** copy GSAP or Lenis source, or load either as a script tag.
  Reimplement the *feel* (damped follow, velocity-reactive motion) in
  vanilla JS — the formulas above are the whole trick.
- **Do not** let the fold panel's resting (pos = 0) height reach zero —
  it must always show a small "there's more" sliver, or the loop reads as
  a static hero with an occasional unexplained slide-up rather than a
  continuous story.
- **Do not** introduce a second chromatic accent. Brass-ochre or nothing.
- **Do not** add glass/blur surfaces or gradient-blob backgrounds — flat
  matte panels and hairline rules only.

## See also

- Upstream inspiration: [`darkroomengineering/satus`](https://github.com/darkroomengineering/satus)
  (MIT) — `ProgressText`, the velocity-reactive marquee, `Fold`, and
  `useReveal`. [`darkroomengineering/lenis`](https://github.com/darkroomengineering/lenis)
  (MIT) — the damped-follow smoothing math.
- Sibling example: [`webgl-liquid-metal`](../webgl-liquid-metal/) — another
  from-frame-0 continuous-motion example, generative-shader lane instead of
  DOM/CSS.
