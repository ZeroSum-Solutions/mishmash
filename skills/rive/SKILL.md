---
name: rive
description: |
  Playback and interaction wiring for designer-authored Rive (`.riv`) files —
  rive-app/rive-wasm and rive-app/rive-react. Use when the user has (or will
  hand off) a `.riv` file and needs its state machine driven by real app
  state (hover, loading, success, a live numeric value), or asks about Rive,
  `.riv`, a Rive state machine, or rive-react. Rive files carry a runtime
  state graph, not just a timeline — the agent's job is wiring inputs, never
  authoring the graph itself.
triggers:
  - "rive"
  - ".riv file"
  - "rive state machine"
  - "rive-app"
  - "rive react"
od:
  mode: prototype
  category: animation-motion
  upstream: "https://github.com/rive-app/rive-wasm"
  craft:
    requires:
      - animation-discipline
      - accessibility-baseline
  example_prompt: |
    Wire the provided .riv file's state machine inputs to the app's existing
    UI state (hover, loading, success) and freeze it on the state machine's
    default idle state under prefers-reduced-motion.
---

# Rive

## What Rive is

A `.riv` file is authored in the Rive editor and contains vector art plus a
**State Machine**: a graph of states connected by transitions, gated by
typed **Inputs** (Number, Boolean, Trigger). The designer builds the graph
and its transition logic in the editor; the runtime's job is to set input
values from real application state and let the state machine decide what to
render next. Nothing about *which* transition fires is decided in app code —
only the input values are. That is the whole difference from Lottie: Rive
files ship a decision graph, not a fixed timeline.

**This is the spine of the skill: Lottie/Rive are designer-authored asset
playback runtimes. GSAP and Motion are code-driven animation** — same
framing as `skills/lottie`, but Rive's asset carries live interactivity
where Lottie's only carries a linear (or segment-addressable) timeline.

## What makes Rive different from Lottie

| | Lottie | Rive |
|---|---|---|
| What's authored | A fixed keyframe timeline | A state machine graph with typed inputs |
| Runtime control | Play / pause / seek / segment | Set Number/Boolean inputs, fire Triggers |
| Branching at runtime | None — segments are manually selected | Native — the graph picks the transition |
| Typical fit | A hero loop, an icon animation, a scroll-scrubbed illustration | A button/toggle with real hover/press/success states, an interactive character, a loader that must react to real progress |

If the deliverable only ever needs to play the same sequence from start to
finish (or scrub linearly with scroll), that's Lottie. If the deliverable
needs to *react* — different visual outcome depending on live app state —
that's Rive.

## When to use Rive vs. Lottie vs. GSAP

- **Rive**: the asset must react to live, changing app state (hover vs.
  pressed vs. loading vs. error vs. success), or exposes a continuous input
  (e.g. a drag progress, a slider value, a live percentage) that the graph
  blends against.
- **Lottie**: the asset is a fixed illustrative animation — a hero loop, an
  icon, a scroll-scrubbed sequence — with no runtime branching.
- **GSAP/Motion**: there is no exported asset at all; the motion is going to
  be authored in code against DOM/SVG elements.

## When NOT to use this (blunt)

- **Anything a CSS transition or a short GSAP tween already does** — a hover
  scale, a color crossfade, a simple spinner. Loading the Rive WASM runtime
  for that is dead weight; the state-machine machinery buys nothing a
  three-line `gsap.to()` doesn't already deliver.
- **No actual `.riv` export exists.** Don't propose a Rive pipeline because
  the brief says "interactive icon" — if nobody is handing off a `.riv`
  file, that interactivity is a `gsap-core` / `emilkowalski-motion` job.
- **Purely linear playback with no branching.** If the state machine has one
  state and no meaningful inputs, it isn't earning its runtime cost over
  Lottie — check whether `skills/lottie` is the better fit for that asset.

## State machines: inputs and triggers

Three input types, all defined in the Rive editor and read/written by name
at runtime:

- **Boolean** — on/off flags (e.g. `isHovered`, `isOpen`).
- **Number** — continuous values the graph blends against (e.g. `progress`,
  `scrollFraction`).
- **Trigger** — one-shot fire-and-forget events (e.g. `onSuccess`,
  `onSubmit`) that advance the graph once, then reset.

Drive inputs from **real application state**, never from synthetic timers
invented just to "show off" the animation:

```javascript
// Vanilla rive-wasm
import { Rive, StateMachineInput } from "@rive-app/canvas";

const riveInstance = new Rive({
  src: "/assets/submit-button.riv", // self-hosted, see below
  canvas: document.querySelector("#rive-canvas"),
  autoplay: true,
  stateMachines: "ButtonSM",
  onLoad: () => {
    const inputs = riveInstance.stateMachineInputs("ButtonSM");
    const isHovered = inputs.find((i) => i.name === "isHovered");
    const onSubmit = inputs.find((i) => i.name === "onSubmit");

    button.addEventListener("pointerenter", () => (isHovered.value = true));
    button.addEventListener("pointerleave", () => (isHovered.value = false));
    button.addEventListener("click", () => onSubmit.fire());
  },
});
```

```jsx
// rive-react
import { useRive, useStateMachineInput } from "@rive-app/react-canvas";

function SubmitButton({ isSubmitting }) {
  const { rive, RiveComponent } = useRive({
    src: "/assets/submit-button.riv", // self-hosted
    stateMachines: "ButtonSM",
    autoplay: true,
  });

  const loadingInput = useStateMachineInput(rive, "ButtonSM", "isLoading");
  if (loadingInput) loadingInput.value = isSubmitting; // driven by real app state

  return <RiveComponent />;
}
```

## Layout and Fit/Alignment

Rive canvases scale via `Fit` (`Contain`, `Cover`, `Fill`, `FitWidth`,
`FitHeight`, `ScaleDown`, `None`) and `Alignment` (e.g. `Center`), set at
load time (`layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center })`).
Pick `Contain` unless the design explicitly wants cropping — `Cover`
clips artwork outside the canvas bounds, which is usually not what an
illustrative asset wants.

## The WASM runtime cost

Every Rive-rendered surface pays a **fixed WASM baseline** to load the
runtime (comparable in shape to Lottie's dotlottie-web WASM cost) — this
cost is roughly shared across however many `.riv` instances run on the
page, so a page with several small Rive assets amortizes it better than a
page with exactly one. Choose the canvas wrapper (`@rive-app/react-canvas`)
for typical UI-scale assets; reach for the WebGL2 wrapper
(`@rive-app/react-webgl2`) only for large or effects-heavy scenes where
canvas 2D compositing becomes the bottleneck — it is not the default.

## One motion clock (hard constraint)

If a Rive Number input is driven by scroll (e.g. a `scrollProgress` input
blending a graph transition), it must read from the page's **single existing
scroll owner** — never spin up a second, competing scroll listener just for
the Rive canvas.

```javascript
// Correct: reuse the page's one scroll-progress source (e.g. GSAP ScrollTrigger).
ScrollTrigger.create({
  trigger: "#rive-section",
  start: "top top",
  end: "+=1200",
  scrub: true,
  onUpdate: (self) => {
    scrollProgressInput.value = self.progress * 100; // same owner, not a new one
  },
});
```

## `prefers-reduced-motion`

Rive has no built-in universal "freeze" call. Pause the instance and hold
it on the state machine's default/idle state rather than hiding the canvas
— the static artwork is still meaningful content:

```javascript
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function applyMotionPreference() {
  if (reduceMotion.matches) {
    riveInstance.pause(); // holds on whatever frame/state is current — default/idle
  } else {
    riveInstance.play();
  }
}

applyMotionPreference();
reduceMotion.addEventListener("change", applyMotionPreference);
```

If the graph autoplays into a looping idle state, pause immediately on load
under reduced motion rather than after a loop has already played, so the
first frame shown is the intended static one.

## Self-hosted assets, always

Never hot-link a `.riv` file from a third-party host, including Rive's own
community/catalog CDN URLs. Download the file into the project's own static
asset directory and serve it same-origin. Installing `@rive-app/react-canvas`
(or `rive-wasm` directly) as an npm dependency is normal; hot-linking the
`.riv` **data** is not.

## Do Not

- Use Rive for motion that CSS or a short GSAP tween already handles — check
  `gsap-core` / `emilkowalski-motion` first.
- Attach a second scroll listener to drive a Rive input when the page
  already has a scroll-progress owner. One motion clock only.
- Hide the canvas under `prefers-reduced-motion`. Pause on the
  default/idle state instead.
- Hot-link the `.riv` asset from a third-party or public CDN. Self-host it.
- Drive inputs from synthetic timers instead of real app/UI state.
- Reach for Rive when the asset never branches — a single-state graph with
  no meaningful inputs is a `skills/lottie` job, not this one.

### Learn More

- https://github.com/rive-app/rive-wasm
- https://github.com/rive-app/rive-react
- https://rive.app/community/doc/
