# Decision: the sanctioned motion stack

**Status:** Accepted
**Date:** 2026-07-25
**Depends on:** `docs/decisions/gsap-licensing.md` (GSAP is `RETAINED`)
**Enforced by:** `e2e/tests/motion-gate.test.ts`

## Context

This repository can now *measure* motion quality. Before the gate existed, adding
animation libraries was unfalsifiable — anything looked fine on a fast machine. The
gate changes the order of operations: measurement first, then libraries.

An audit identified the libraries that award-tier animated sites actually depend on.
Adopting all of them at once is how a codebase ends up with two scroll owners, two
motion clocks, and no way to tell which one is dropping frames. This decision records
the stack and, more importantly, the invariants that keep it coherent.

## Decision

### The invariants (these outrank library choice)

1. **One motion clock.** A single driver ticks all animation. GSAP's `gsap.ticker` is
   that driver. Nothing else runs a competing `requestAnimationFrame` loop that mutates
   the same properties.
2. **One scroll owner.** Exactly one of {native scroll, GSAP ScrollSmoother, Lenis} owns
   scroll on a page. Never two.
3. **Compositor-only for scroll-linked motion.** `transform` and `opacity` only. No
   scroll-linked animation of layout-triggering properties.
4. **Never read layout inside a scroll handler.** Batch through `requestAnimationFrame`.
   Interleaving a `getBoundingClientRect()` read with a layout-triggering write is the
   exact anti-pattern the gate's janky fixture reproduces.
5. **One physics engine per project.** Rapier *or* matter-js. Never both.
6. **`prefers-reduced-motion` is honored**, and smooth scroll is *disabled* under it
   rather than shortened.

### The stack

| Role | Choice | Status |
|---|---|---|
| Timeline / scroll choreography | GSAP + ScrollTrigger | in repo (`skills/gsap-*`) |
| Smooth scroll | Lenis | in repo (`skills/lenis`) |
| React component motion | Motion | in repo (`skills/motion`) |
| 3D / WebGL in React | react-three-fiber + drei + postprocessing | in repo (`skills/react-three-fiber`, `skills/threejs`) |
| Designer-authored playback | Lottie, Rive | in repo (`skills/lottie`, `skills/rive`) |
| Shader-first / lightweight WebGL | OGL | not yet adopted |
| DOM image distortion | curtains.js | not yet adopted |
| Kinetic typography | GSAP SplitText | available (free since 3.13) |
| Page transitions | native View Transitions; swup for MPA | not yet adopted |
| Pointer / gesture | use-gesture | not yet adopted |
| 3D physics | react-three-rapier | not yet adopted |

**Motion vs GSAP boundary.** Motion owns React-component-scoped work — gesture and
state-driven animation, `layout`/`layoutId`, `AnimatePresence` exits. GSAP owns scroll
choreography, multi-step timelines, and framework-agnostic/SVG work. They must never
drive the same property on the same element.

### Adoption rule

Anything in the "not yet adopted" rows enters **one at a time**, and each entry must
ship with a fixture that passes `e2e/tests/motion-gate.test.ts`. A library that cannot
demonstrate a gate-passing reference is not adopted. This is the whole point of having
built the gate first.

## Consequences

- `e2e/resources/motion-gate-fixtures.ts` carries a `REFERENCE_FIXTURE_HTML` built to
  these invariants, asserted green by the gate. It is the executable form of this
  decision — if the invariants stop producing smooth motion, the gate says so.
- The audit's remaining library recommendations are explicitly *deferred*, not rejected.
- Volume is not the goal. The repository already has 153 design systems and 113
  templates; more inventory has negative marginal value. The bottleneck is retrieval,
  motion decomposition, and verification.

## Not covered

Aesthetic quality. The gate measures smoothness, not beauty — a perfectly smooth
animation can still be ugly or wrong. Nothing here substitutes for design judgment.
