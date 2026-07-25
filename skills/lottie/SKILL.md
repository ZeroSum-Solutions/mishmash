---
name: lottie
description: |
  Playback of designer-authored Lottie / dotLottie animations exported from
  After Effects via the Bodymovin plugin — airbnb/lottie-web and
  LottieFiles/dotlottie-web. Use when the user has (or will hand off) an
  exported `.json`/`.lottie` animation and needs it played, scrubbed, looped,
  or segment-controlled on the web, or asks about Lottie, dotLottie,
  Bodymovin, or an "After Effects export". Lottie plays back a pre-authored
  timeline; it does not compose one from code — that distinction is the
  whole point of this skill.
triggers:
  - "lottie"
  - "dotlottie"
  - "bodymovin"
  - "after effects export"
  - "lottie-web"
  - ".lottie file"
od:
  mode: prototype
  category: animation-motion
  upstream: "https://github.com/LottieFiles/dotlottie-web"
  craft:
    requires:
      - animation-discipline
      - accessibility-baseline
  example_prompt: |
    Embed the provided .lottie animation as a self-hosted asset, scrub its
    playhead to the page's existing scroll position, and freeze it on a
    representative frame under prefers-reduced-motion.
---

# Lottie

## What Lottie is

Lottie is a **playback format**, not an animation-authoring API. A designer
builds the motion in After Effects; the **Bodymovin** plugin exports the
composition as JSON keyframe data (shapes, paths, fills, transforms sampled
per frame); **lottie-web** (or the newer **dotlottie-web**) parses that data
in the browser and renders it. Nothing about the easing, timing, or shapes
is decided at runtime — it was decided by the designer in the AE timeline.
The agent's job is embedding and playback control, never re-authoring the
motion.

This is the spine of the skill: **Lottie/Rive are designer-authored asset
playback runtimes. GSAP and Motion are code-driven animation** — you write
the tween, you pick the easing, you own every keyframe. Reach for this
skill only when an actual exported asset exists or is being delivered by a
designer; reach for `gsap-core` / `emilkowalski-motion` when the motion is
still something to be written in code.

## When NOT to use this

- **Anything expressible in a few lines of CSS or GSAP** — a hover scale, a
  fade, a spinner, a checkbox check-mark. Shipping a Lottie file (runtime
  library + JSON payload + parse cost) for motion that `transform` or
  `opacity` already does natively is dead weight. If you can draw it in SVG
  and animate it with `gsap-core`, do that instead.
- **No actual After Effects export exists.** Don't invent a Lottie pipeline
  because the brief mentions "animated icon." If nobody is handing off a
  `.lottie`/`.json`, write the animation in code.
- **Real runtime interactivity** — branching based on live app state (hover
  vs. error vs. success, a value the animation must react to). Lottie only
  plays, pauses, and seeks a fixed timeline; it does not have inputs or a
  state graph. That is `skills/rive`, not this.

## Renderer choice: SVG vs. Canvas

`lottie-web` supports `renderer: 'svg' | 'canvas' | 'html'`.

| Renderer | Behavior | Use when |
|---|---|---|
| **svg** (default) | Crisp at any scale, DOM-inspectable, each shape is a real DOM node | A single, light hero animation (roughly <50 shape layers), and only one instance on screen |
| **canvas** | Draws to one bitmap surface; sidesteps per-frame DOM mutation | Heavy scenes (many shape layers, masks, mattes), or more than one instance on screen at once (e.g. a list of cards each with its own animation) |

SVG rendering pays a DOM-write cost on every frame update for every shape;
that cost is invisible on a single simple loop and very visible once you
have several instances or a masked, layered composition. **Canvas wins for
heavy scenes** because the browser only has to composite one bitmap per
frame, not diff a shape tree.

`dotlottie-web` ships a canvas-based renderer (built on the newer Rust/WASM
Lottie renderer) by default, which is why it is the safer default choice
once the scene is non-trivial — you get the canvas win without picking a
renderer flag by hand.

## Prefer `.lottie` over raw `.json`

`.lottie` is a zip container: compressed keyframe JSON plus any embedded
raster/font assets, bundled as one file. Raw `.json` is uncompressed
keyframe data only, with any raster assets as separate requests.

- Use **dotlottie-web** to play `.lottie` files. Fall back to `lottie-web`
  (or dotlottie-web's JSON compatibility mode) only when stuck with a
  legacy `.json` export that hasn't been reconverted.
- Convert `.json` to `.lottie` with LottieFiles' own tooling at export/build
  time, not at runtime.
- **File size is still a real constraint even in `.lottie` form.** A
  "simple-looking" loop can hide thousands of vector points if the AE
  source wasn't cleaned up before export. If a `.lottie` is multiple
  megabytes, that is a signal to go back to the After Effects source and
  simplify it — bake precomps, remove unused layers/assets, reduce mask
  complexity — not a signal to add a runtime workaround.

## Playback API basics

```javascript
import { DotLottie } from "@lottiefiles/dotlottie-web";

const dotLottie = new DotLottie({
  canvas: document.querySelector("#lottie-canvas"),
  src: "/assets/hero-loop.lottie", // self-hosted, see below
  loop: true,
  autoplay: true,
});

dotLottie.play();
dotLottie.pause();
dotLottie.setFrame(42);
dotLottie.setSpeed(1.5);
```

`lottie-web`'s equivalent surface: `loadAnimation({ container, renderer,
loop, autoplay, path | animationData })`, then `anim.play()`, `anim.pause()`,
`anim.stop()`, `anim.goToAndStop(frame, isFrame)`, `anim.goToAndPlay(...)`,
`anim.setSpeed(x)`.

**Segment control.** A single exported file commonly bakes several named
regions into one timeline (e.g. an icon's "idle" and "success" states as two
marker ranges). Read the exported `markers` metadata (name + time +
duration) and play a slice rather than hardcoding frame numbers:

```javascript
anim.playSegments([120, 180], true); // play only the "success" range
```

## Scroll/scrub-driven playback — one motion clock

**Hard constraint.** If an animation's playhead is tied to scroll, it must
be driven by the page's **single existing scroll owner** — never a second,
competing scroll listener. If the page already runs GSAP ScrollTrigger (or
any other scroll-progress source), drive the Lottie frame from that same
progress value; do not attach an independent `scroll` listener just for the
Lottie canvas.

```javascript
// Correct: GSAP ScrollTrigger is the one scroll owner; Lottie just reads its progress.
gsap.registerPlugin(ScrollTrigger);

ScrollTrigger.create({
  trigger: "#lottie-section",
  start: "top top",
  end: "+=1500",
  scrub: true,
  onUpdate: (self) => {
    const totalFrames = dotLottie.totalFrames;
    dotLottie.setFrame(self.progress * totalFrames);
  },
});
```

```javascript
// If there is no other scroll driver on the page, this listener IS the one owner.
// Do not also wire up ScrollTrigger or a second listener alongside it.
window.addEventListener("scroll", () => {
  const progress = getScrollProgress(); // page's single scroll-progress source
  dotLottie.setFrame(progress * dotLottie.totalFrames);
});
```

## `prefers-reduced-motion`

Freeze on a representative frame — never hide the asset outright; the
static artwork is still meaningful content.

```javascript
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function applyMotionPreference() {
  if (reduceMotion.matches) {
    dotLottie.pause();
    dotLottie.setFrame(REPRESENTATIVE_FRAME); // e.g. the loop's most legible frame
  } else {
    dotLottie.play();
  }
}

applyMotionPreference();
reduceMotion.addEventListener("change", applyMotionPreference);
```

## Self-hosted assets, always

Never hot-link a `.lottie`/`.json` **asset** from a third-party CDN (public
LottieFiles asset URLs, a shared jsFiddle/CodePen host, etc.). Download the
exported file into the project's own static asset directory and serve it
same-origin. This is separate from the *library* — installing `lottie-web`
or `@lottiefiles/dotlottie-web` as an npm dependency is normal; hot-linking
the animation **data** is not.

## When file size becomes the problem

- `dotlottie-web`'s WASM runtime has a fixed baseline cost (a few hundred KB
  gzipped) — worth factoring in before reaching for it on a single tiny icon
  where plain `lottie-web` (no WASM) would be lighter to load, even though
  it is heavier per-frame on complex scenes.
- AE exports inflate fast: embedded raster fallback images, expression-driven
  layers, and unbaked masks all bloat the keyframe payload well beyond what
  the visual result would suggest. Check the network tab before shipping;
  a bloated export is a source-file problem to send back, not something to
  patch around at runtime.

## Do Not

- Use Lottie for motion that a CSS transition or a short GSAP tween already
  handles — check `gsap-core` / `emilkowalski-motion` first.
- Attach a second scroll listener to drive Lottie playback when the page
  already has a scroll-progress owner (GSAP ScrollTrigger, a scroll library,
  etc.). One motion clock only.
- Hide the canvas/SVG under `prefers-reduced-motion`. Freeze on a
  representative frame instead.
- Hot-link the `.lottie`/`.json` asset from a third-party or public CDN.
  Self-host it.
- Ship a raw uncompressed `.json` when `.lottie` conversion is available.
- Treat Lottie as capable of live branching logic (hover vs. error vs.
  success). It plays a fixed timeline; for real interactivity use `skills/rive`.

### Learn More

- https://github.com/airbnb/lottie-web
- https://github.com/LottieFiles/dotlottie-web
- https://lottiefiles.github.io/dotlottie-web/
