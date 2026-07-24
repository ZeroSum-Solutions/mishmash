# Flagship example · Glass Marbles (real architecture vs. AI fabrication)

Original site https://chiuhans111.github.io/marbles/ · author Hans Chiu · single file, 1067 lines · license **NONE**.
Full line-by-line teardown in `current-project-dir/marbles-clone/TEARDOWN.md`; this is the condensed version for the skill.

## Real architecture in one sentence

A fullscreen WebGL fragment shader **analytically** (quadratic equation `b*b-c`) solves for the ray-sphere intersection, runs up to 4 refraction/reflection iterations, and encodes the optical result into a **displacement-map PNG** (RG = pixel displacement, B = Fresnel value); an SVG `<filter>`'s `feDisplacementMap(scale=200)` then uses that image to distort the **real, live, interactive page DOM** (background color blocks + heading text).

> The glass marble you drag around is essentially a lens, and behind the lens is this HTML page. WebGL never touches DOM pixels — the actual refraction is done by the SVG filter. Physics and audio are both hand-written, zero libraries.

## Three pillars (real implementation details)

1. **WebGL optics**: analytic sphere intersection (not ray-marching); refractive index N=1.3, 4 iterations; Fresnel `0.05+0.95*pow(1-cosθ,2.0)` (exponent 2, not Schlick's 5); 2 internal bubbles + a paraboloid colored core + Beer-Lambert volumetric absorption; **one shader reused via a `u_mode` branch** (0 refraction/1 reflection/2 foreground highlight/3 shadow); displacement encoding `DISPLACEMENT_SCALE=200` kept strictly in sync with the SVG side.
2. **SVG filter compositing**: 4 canvases (1 main + 3 offscreen), each offscreen canvas's `toDataURL` fed to `<feImage>` every frame. Real chain: shadow `feGaussianBlur(8)` -> `feBlend multiply` onto the DOM -> refraction `feDisplacementMap` -> reflection `feDisplacementMap` -> `feGaussianBlur(2)` -> the reflection map's B channel (Fresnel) used as an alpha mask via `feColorMatrix` -> two-step `feComposite`. The `SourceGraphic` being refracted is `#container`, which has `filter:url(#marble-filter)` applied.
3. **Physics**: fully hand-written — `mass=r³`, gravity 0.8, 3D elastic collision (restitution 0.8, resolved only when close), ground restitution 0.55 + micro-bounce settling to zero, quaternion rolling, drag-lift `targetZ=200`; rendering fully stops when settled (`settleFrames`).
4. **Audio**: procedural Web Audio synthesis (zero files), fundamental frequency `800+(60-r)*20` + 5 harmonics, volume scaled by collision speed.

## ⚠️ Where the AI analysis doc got it wrong (a cautionary case — remember these failure patterns)

That `marbles-site-clone-analysis.md` doc's prose **conceptual skeleton was basically right** (the 8 steps and the three-pillar direction were correct), but **the accompanying "clone code blocks" were almost entirely fabricated**:

| Fabricated | Reality | Failure pattern (general warning) |
|---|---|---|
| ray-marching + SDF + `MAX_STEPS=100` + normal via 6-tap finite differencing | Analytic intersection, normal via `normalize(rp-center)` | **Don't assume a refraction demo uses ray-marching by gut feel** — spheres have a closed-form solution, and many demos use the analytic approach because it's faster and more accurate |
| `sampler2D uBackground` sampling the DOM as a texture | The shader never reads the background; refraction works via a displacement map handed to SVG | **Got the GPU<->DOM layering backwards** — this drops the single most important architectural idea |
| `feBlend screen` + a single displacement + `feComposite over` for the shadow | Double displacement + a Fresnel mask + multiply for the shadow | **A secondhand analysis's filter chain can't be trusted — verify node by node against real source** |
| `MARBLE_COUNT=5`, array sized to 10 | Hardcoded to 2 | Even constants were guessed |
| Screen-center NDC coordinates | Top-left pixel coordinates with a Y-flip | Coordinate-system convention was pure guesswork |

**Lesson**: treat an AI-written "clone blueprint" as a reference for its conceptual skeleton only — **never copy a single line of its code blocks directly**; it must be checked against real source. This is where this skill's rule #1 comes from.
