---
name: aurora-launch-glass
description: |
  Premium invite-only waitlist hero: a slow-drifting indigo-to-rose-gold
  aurora gradient mesh breathes behind a frosted-glass signup card, a
  magnetic call-to-action settles under exponential damping, and a
  digit-flip countdown ticks live. Every element is self-driven so the
  card is never static, even with zero user interaction.
  Best for: premium product launches, invite-only betas, founding-cohort
  signups, anything that needs to read expensive and calm rather than
  neon or static.
triggers:
  - "aurora waitlist"
  - "glass waitlist page"
  - "premium coming soon page"
  - "invite-only launch page"
  - "countdown waitlist"
  - "magnetic button landing page"
od:
  mode: prototype
  platform: desktop
  scenario: marketing
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
    sections: [color, typography]
  outputs:
    primary: index.html
  capabilities_required:
    - file_write
  example_prompt: "Make a premium invite-only waitlist page — a slow-drifting aurora gradient mesh behind a frosted-glass signup card, a magnetic call-to-action, and a live countdown — that stays in constant, calm, self-driven motion with no user interaction."
---

# Aurora Launch Skill

A waitlist page dies the moment it goes static: a flat background, a plain
input, nothing moving until someone touches it. This skill builds the
opposite — a card that is quietly alive from the first frame, without
resorting to neon or noise. Five self-driven techniques carry the motion;
none of them wait for a cursor.

## Resource map

```
aurora-launch-glass/
├── SKILL.md      ← you're reading this
└── example.html  ← a working reference build (READ FIRST)
```

## Why every element is self-driven

The gallery/preview surface renders only the first viewport, live, with
**zero interaction and zero scrolling**. A design that relies on hover or
mousemove to come alive will preview as a dead screenshot. Every motion
system here has a synthetic driver that runs with no pointer at all:

- The aurora drifts on its own clock (`t = performance.now()/1000`).
- The magnetic button chases a synthetic idle Lissajous target when the
  pointer is away, and only swaps to a live pointer target when one is
  present — idle motion and real interactivity share one code path.
- The countdown decrements off wall-clock time, not a timer someone starts.

## Workflow

### Step 0 — Read the reference

Read `example.html` end to end before writing anything. Note the five
systems and where each one lives: the palette function, the curl-noise
blob field, the dust sprites, the magnetic-button damping, and the
countdown flip. They are independent — you can reuse any one of them in
an unrelated build.

### Step 1 — Build the aurora backdrop (canvas 2D, no WebGL required)

1. **Palette** — implement Inigo Quilez's public cosine-gradient formula,
   `color(t) = a + b * cos(2*pi*(c*t + d))`, evaluated per RGB channel.
   Don't guess the coefficients: fit them to your real brand anchors. Pick
   3 anchor colors (cool / mid / warm), sample them at `t = 0, 1/3, 2/3`,
   and solve the 3-point DFT for `(a, b, d)` per channel with `c = 1` (see
   `example.html`'s `PAL_A` / `PAL_B` / `PAL_D` — fitted to indigo → rose-gold
   → champagne). Sweep a fine range of `t` afterward and check no sample
   lands in a hue you don't want (e.g. magenta) — a bad fit shows up fast
   this way, before it ships.
2. **Curl-noise drift** — build a 2D value-noise function, then treat it as
   a scalar potential `psi(x, y, t)`. The velocity field is the curl of
   that potential, taken by finite difference: `vx = d(psi)/dy`,
   `vy = -d(psi)/dx`. This is divergence-free by construction, which is
   why it reads as organic swirling instead of blobs sliding on rails.
   Give each blob its own `seed` offset into the potential so the three
   fields differ — that's what keeps them folding around each other
   instead of clumping into one shape.
3. **Bound the drift** — pure curl noise wanders forever. Add a soft
   spring pulling each blob back toward a home position
   (`v += -(pos - home) * springConstant`) so the aurora stays inside the
   viewport instead of drifting off it after a minute of runtime.
4. **Render** — one `createRadialGradient` per blob, color from the
   palette function at `(paletteT + blob.phase)`, composited with
   `globalCompositeOperation = 'screen'` over a dark base fill so blobs
   glow instead of paint solid. Scale the canvas vertically before
   drawing each blob (`ctx.scale(1, ~1.5)`) so they read as aurora
   curtains, not circles.
5. **Glow dust** — scatter 40-60 small sprites with per-particle random
   phase/speed. Draw each as a radial gradient with a bright core fading
   to transparent (approximating a `1/d`-style falloff), composited with
   `globalCompositeOperation = 'lighter'` so overlaps add light instead of
   occluding. Drift position with the particle's own sine phase, not a
   shared clock — that desync is what sells "dust" over "grid of dots."

### Step 2 — Build the magnetic CTA

1. Wrap the button in its own positioned element; you'll transform the
   wrapper, not the button, so click feedback (`:active` scale) stays
   independent of the magnetic offset.
2. Track pointer position relative to the wrapper's center on
   `pointermove` / `pointerleave`.
3. Define a synthetic idle target — two out-of-phase sine waves at
   incommensurate frequencies (a small Lissajous figure) — so the button
   never rests even with no pointer nearby.
4. Every frame: `target = pointerNear ? pointerOffset*pull : idleTarget(t)`,
   then advance position with frame-rate-independent exponential damping:
   `pos += (target - pos) * (1 - Math.exp(-lambda * dt))`. This is the
   correct form — do not use `pos += (target - pos) * const` without the
   `dt`/`exp` term, or the settle speed will change with frame rate.
   `lambda` around 5–7 reads as a confident, quick settle; lower values
   feel sluggish.

### Step 3 — Build the countdown

1. Compute remaining time from a wall-clock start
   (`performance.now()` at load, decremented every frame — no
   `setInterval` needed, the render loop already ticks every frame).
2. Split into day/hour/minute/second, format each as 2 digits.
3. **Flip only on change**, not every frame. Each unit is a small 3D flip
   card: a `.flip-card-inner` with `transform-style: preserve-3d`
   containing a front face (current value) and a back face pre-rotated
   `rotateX(180deg)` (next value). Animate the inner element's own
   rotation from 0 to -180deg.
4. Drive that rotation with a **discrete exponential ease-out arrival
   curve**, distinct from the ambient drift above:
   `ease(p) = clamp(1.001 - 2^(-10*p), 0, 1)` where `p` is elapsed/duration
   (~400-500ms). This is a fast-start, slow-settle arrival — it should
   feel like a decisive snap that eases into place, not a linear spin.
5. On animation end, write the new value into the front face and reset
   rotation to 0deg so the next flip starts clean.

### Step 4 — Compose the glass card

- `backdrop-filter: blur(...) saturate(...)` over a translucent dark fill,
  a 1px near-white border at low opacity, and a soft outer shadow plus an
  inset highlight — that combination is what reads as "frosted glass"
  rather than "semi-transparent box."
- One display serif (or one warm system serif) for the headline, one
  system sans for everything else. Two fonts, no more.
- One accent color (here, champagne-gold) reserved for the single CTA —
  don't spend the accent anywhere else or it stops reading as a call to
  action.

### Step 5 — Self-review (P0)

- [ ] The first viewport is in constant motion at frame 0 — no click,
      hover, or scroll required. Reload the page and confirm nothing is
      frozen at t=0.
- [ ] The palette never drifts into a hue outside the intended brand
      range (spot-check by sampling `palette(t)` across a full sweep).
- [ ] The magnetic button visibly settles (overshoot-free, but not
      instant) toward its target; it still drifts with no pointer present.
- [ ] The countdown only animates the units that actually changed; a
      digit that hasn't changed does not flip.
- [ ] `prefers-reduced-motion: reduce` yields one static, fully composed
      frame — no canvas animation loop, no magnetic offset, no digit
      flip — never a blank or broken layout.
- [ ] Zero external requests: no CDN script/link tags, no remote fonts,
      no remote images, no `fetch`/`XMLHttpRequest`. No storage APIs
      (`localStorage`, `sessionStorage`, cookies) — the page must run
      inside a scripts-only sandboxed iframe.
- [ ] Real, plausible copy: a brand name, a one-line premise, and a
      genuine email-capture form with `type="email"` + `required` and a
      `checkValidity()` guard before submit. No lorem ipsum.
- [ ] Success message uses `role="status"`; the CTA has visible
      hover/active feedback; `<html lang="en">` is set.

## Output

Emit a single self-contained HTML file — all CSS and JS inline, canvas 2D
only (no build step, no WebGL required). Only emit after every P0 box
above is checked.
