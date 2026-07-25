---
name: motion
description: |
  Motion (motion.dev, npm package "motion", formerly Framer Motion, repo motiondivision/motion) — the animation library for React and vanilla JS/TS. Covers springs, gestures (hover/tap/drag), layout animation, scroll-linked animation, exit animations (AnimatePresence), and vanilla usage without React. Use when the user wants animation inside a React component, asks about Framer Motion, motion/react, springs, gestures, layout transitions, shared-element/layoutId transitions, or AnimatePresence. States clearly when to reach for Motion instead of GSAP (and vice versa) so the two libraries don't fight on the same page.
triggers:
  - "motion"
  - "framer motion"
  - "motion.dev"
  - "motion/react"
  - "animatepresence"
  - "layout animation"
  - "spring animation"
  - "drag gesture"
od:
  mode: prototype
  category: animation-motion
  upstream: "https://motion.dev"
---

# Motion

> React and vanilla JS animation library, formerly Framer Motion. npm package: `motion`. React entry point: `motion/react`. Repo: https://github.com/motiondivision/motion

## When to Use This Skill

Apply when animating a React component's own mount/unmount lifecycle, gesture response, or layout changes: `<motion.div>` usage, `whileHover`/`whileTap`/`drag`, the `layout` prop, `layoutId` shared-element transitions, `AnimatePresence` exit animations, or scroll-linked values built from `useScroll`/`useTransform`. Also apply for vanilla (non-React) animation via the `animate()` function from the same `motion` package.

**This repository ships 8 GSAP skills** (`gsap-core`, `gsap-timeline`, `gsap-scrolltrigger`, `gsap-react`, `gsap-frameworks`, `gsap-plugins`, `gsap-utils`, `gsap-performance`). Motion and GSAP overlap in capability but are not interchangeable defaults — read "Motion vs GSAP" below before picking one.

## Motion vs GSAP — pick one, don't run both on the same element

**Reach for Motion when:**
- ✅ The animation is tied to a React component's own state/props (enter, exit, variant driven by a boolean/enum).
- ✅ Gesture-driven interaction that must interoperate with React re-renders: `whileHover`, `whileTap`, `drag`.
- ✅ Auto layout animation — `layout` prop or `layoutId` shared-element ("magic move") transitions when the DOM reflows due to list reorder, flex/grid changes, or conditional rendering.
- ✅ Exit animations for components that unmount — `AnimatePresence` is the only ergonomic way to animate something that React is about to remove from the tree.
- ✅ A small, component-scoped interaction that shouldn't need a global animation library import.

**Reach for GSAP instead when:**
- ✅ Scroll-choreographed sequences across many elements/sections, pinning, or scrub — use `gsap-scrolltrigger`. Motion's `useScroll`/`useTransform` can drive a single element's scroll-linked value, but GSAP owns multi-section scroll choreography in this repo.
- ✅ Complex multi-step timelines with labels, nested timelines, or precise position-parameter sequencing independent of component state — use `gsap-timeline`.
- ✅ SVG morphing, line drawing, or other plugin-backed effects (MorphSVG-style, DrawSVG-style) — see `gsap-plugins`.
- ✅ The code must run identically across React, Vue, Svelte, or vanilla with no framework-specific API — GSAP is framework-agnostic; Motion's ergonomic API (`motion/react`) is React-specific (vanilla `animate()` exists but lacks the component/gesture/layout ergonomics).
- ✅ The page already has a GSAP `ScrollSmoother` or GSAP-driven scroll owner — don't introduce a second scroll-linked driver.

If a task genuinely needs both (e.g. GSAP ScrollTrigger choreographing a page section that contains a React modal using `AnimatePresence`), that's fine **as long as they never target the same element's same property**. See the rule below.

## Hard Rule: One Motion Clock Per Element

Motion runs its own internal frame loop (`frame`/`cancelFrame` from the `motion` package, formerly `sync`) independent of GSAP's `gsap.ticker`. **Never run GSAP's ticker and Motion's loop as competing drivers on the same element.** Pick exactly one library to own a given element's animated properties. Two libraries fighting over the same `transform` produces visible jitter because each one overwrites the other's per-frame write.

## Installation

```bash
npm install motion
```

```javascript
import { motion, AnimatePresence } from "motion/react"; // React
import { animate, scroll, stagger, inView } from "motion";  // vanilla, no React
```

The legacy `framer-motion` package still works as a compatibility shim, but new code should import from `motion/react`.

## The `motion` Component

Any HTML or SVG tag has a `motion.*` equivalent (`motion.div`, `motion.svg`, `motion.path`, ...). Animate with `animate`, set an initial state with `initial`, and control timing with `transition`:

```jsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.3, ease: "easeOut" }}
/>
```

Use `variants` to name states and propagate them down a tree instead of repeating inline objects:

```jsx
const list = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } };

<motion.ul variants={list} initial="hidden" animate="show">
  {items.map((i) => <motion.li key={i.id} variants={item}>{i.label}</motion.li>)}
</motion.ul>
```

## Springs

Motion defaults transform-like values (`x`, `y`, `scale`, `rotate`) to a **spring**, and non-physical values (`opacity`, `color`) to a **tween**. Both are set via `transition`:

```jsx
<motion.div animate={{ scale: 1.1 }} transition={{ type: "spring", stiffness: 300, damping: 20 }} />
```

- `stiffness` / `damping` / `mass` — the physical model. Higher stiffness = snappier; higher damping = less bounce.
- `bounce` (0–1) + `duration` — the designer-friendly alternative to stiffness/damping when a target duration matters more than physical accuracy.
- Use a spring for anything that should feel physical or gesture-driven (position, scale, rotation, drag release). Use a tween (`type: "tween"`, or an implicit tween for opacity/color) for value crossfades that don't need bounce.

## Gestures

```jsx
<motion.button
  whileHover={{ scale: 1.05 }}
  whileTap={{ scale: 0.95 }}
  drag="x"
  dragConstraints={{ left: -100, right: 100 }}
  dragElastic={0.2}
  onDragEnd={(event, info) => console.log(info.offset, info.velocity)}
/>
```

`whileHover`, `whileTap`, `whileFocus`, `whileDrag`, and `whileInView` all take a target object (or variant name) applied only while the gesture is active; Motion reverts to `animate` when the gesture ends. Use `useDragControls` when a drag needs to be started programmatically (e.g. from a drag handle icon rather than the whole element).

## Layout Animation

Add `layout` to any `motion` component and Motion automatically animates position/size changes caused by a reflow (list reorder, flex-basis change, conditional siblings) using a FLIP-style technique — no manual before/after measurement needed:

```jsx
<motion.div layout /> // animates both position and size changes
<motion.div layout="position" /> // animates position only, cheaper
```

For shared-element transitions between two different components (e.g. a card that expands into a detail view), give both elements the same `layoutId`; Motion cross-fades and morphs between them automatically, typically wrapped in `AnimatePresence`:

```jsx
<motion.div layoutId={`card-${item.id}`} />
```

Wrap a group of independently-animating siblings in `<LayoutGroup>` when their layout animations need to be aware of each other (e.g. an accordion where sibling panels resize in relation to one another).

## Exit Animations (`AnimatePresence`)

React unmounts components synchronously; `AnimatePresence` delays that removal until an `exit` animation finishes. The animated child needs a stable `key`:

```jsx
<AnimatePresence mode="wait">
  {isOpen && (
    <motion.div
      key="panel"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
    />
  )}
</AnimatePresence>
```

- `mode="sync"` (default) — exiting and entering elements animate simultaneously.
- `mode="wait"` — the exiting element finishes before the next one enters.
- `mode="popLayout"` — the exiting element is removed from document flow immediately (position: absolute) so siblings can reflow into its place while it finishes animating out.

## Scroll-Linked Animation

`useScroll()` returns motion values (`scrollYProgress`, `scrollXProgress`, plus raw pixel variants) that can target the whole page or a scoped container/element via `target`/`container` refs — this makes it possible to scroll-link a single element without becoming a second scroll owner for the page. Feed the progress value through `useTransform` to map it onto any animatable value:

```jsx
const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start end", "end start"] });
const opacity = useTransform(scrollYProgress, [0, 1], [0, 1]);
const y = useTransform(scrollYProgress, [0, 1], [40, 0]);

<motion.div ref={sectionRef} style={{ opacity, y }} />
```

For a simpler "reveal once when it enters the viewport" pattern (not continuously scroll-linked), use `whileInView` with a `viewport` config instead — it's Intersection-Observer-backed, not a per-frame scroll subscription:

```jsx
<motion.div
  initial={{ opacity: 0 }}
  whileInView={{ opacity: 1 }}
  viewport={{ once: true, margin: "-100px" }}
/>
```

`useSpring(scrollYProgress)` smooths a scroll-linked motion value with spring physics — useful for a progress bar that shouldn't jump per-frame.

## Vanilla Usage (No React)

The same `motion` package ships a framework-free API. `animate()` accepts a selector, element, or NodeList and works without any component tree:

```javascript
import { animate, scroll, stagger, inView } from "motion";

animate(".card", { opacity: [0, 1], y: [20, 0] }, { delay: stagger(0.08) });

scroll(animate(".hero-image", { scale: [1, 1.2] }), { target: document.querySelector("#hero") });

inView(".reveal", (element) => {
  animate(element, { opacity: 1, y: 0 });
});
```

Vanilla `animate()` uses the Web Animations API directly for hardware-accelerated `transform`/`opacity`/`filter` animations where possible, falling back to a JS-driven engine for values WAAPI can't animate (springs, motion values derived from other motion values).

## Accessibility: `prefers-reduced-motion`

```jsx
import { useReducedMotion, MotionConfig } from "motion/react";

const shouldReduceMotion = useReducedMotion();
<motion.div animate={{ x: shouldReduceMotion ? 0 : 100 }} />
```

Or set it once for an entire subtree instead of checking it in every component:

```jsx
<MotionConfig reducedMotion="user">
  <App />
</MotionConfig>
```

`reducedMotion="user"` respects the OS setting automatically; `"always"` forces reduced motion regardless of OS setting (useful for testing); `"never"` disables the check (avoid unless the animation itself is the accessible affordance).

## Best Practices

- ✅ Default to a spring for transform-like values (`x`, `y`, `scale`, `rotate`); default to a tween for `opacity`/color crossfades.
- ✅ Scope `useScroll` to a `target`/`container` ref instead of the whole page unless the page truly has no other scroll owner.
- ✅ Use `layout`/`layoutId` instead of manually measuring and animating `width`/`height`/`top`/`left`.
- ✅ Wrap conditionally-rendered elements needing an exit animation in `AnimatePresence` with a stable `key`.
- ✅ Check `useReducedMotion()` or set `MotionConfig reducedMotion="user"` for any animation that isn't purely a state-confirmation micro-interaction.
- ✅ Prefer `LazyMotion` + the `m` component over `motion` in bundle-size-sensitive apps that only need a feature subset (`domAnimation` / `domMax`).

## Do Not

- ❌ Run Motion and GSAP as competing per-frame drivers on the same element's same property — pick one owner.
- ❌ Use `useScroll` to build a second page-level smooth-scroll implementation when GSAP `ScrollSmoother` or Lenis already owns scroll on that page — only one of {native scroll, ScrollSmoother, Lenis} may own scroll at a time; Motion should read scroll position, not compete to control it.
- ❌ Animate `width`/`height`/`top`/`left` directly for anything scroll-linked or frequently re-rendered; use `transform`/`opacity`, or the `layout` prop for FLIP-based size/position changes.
- ❌ Forget the `key` prop on children of `AnimatePresence` — without it, exit animations silently don't fire.
- ❌ Ship a scroll-linked or auto-playing animation without a `prefers-reduced-motion` fallback.
- ❌ Use `framer-motion` imports in new code; import from `motion/react` (or vanilla `motion`) instead.

### Learn More

https://motion.dev/docs
