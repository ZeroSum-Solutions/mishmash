# Reverse-engineering a WebGL/Canvas heavy frontend site

Use this when recon determines a site is a WebGL/Canvas/Three.js heavy frontend (`window.THREE` present, or multiple `<canvas>` elements, or `<script type="x-shader/*">` present).

> This doc covers **how to read a rendering architecture**; the **evidence discipline** for reverse-engineering (SOURCE/PARTIAL/GUESS grading, no-compensation, the baseline-first gate) and the **runtime-capture fallback when source can't be found** are in `effect-extraction.md`. Use the two together.

## General teardown steps

1. **Get the single-file source first.** Many demo sites are entirely self-contained in one HTML file (GitHub raw / view-source) — don't rush to run Playwright against the live site.
2. **Count canvases, read SVG defs, grep for shaders**: how many `<canvas>` elements? Any `<filter>`? Where are the shader scripts? — these three things determine the rendering architecture.
3. **Determine "what the WebGL is actually computing"** (key — decides whether to trust secondhand analysis):
   - grep `texture2D` / `sampler2D` -> sampling a texture / framebuffer
   - grep a `for` loop with `+= dS` / `map(` / `MAX_STEPS` -> ray-marching (step-based)
   - grep `b*b` / a discriminant / `sqrt(` + a quadratic equation -> **analytic intersection** (closed-form solve, common for spheres/planes)
   - ⚠️ Don't assume ray-marching by gut feel — refractive-glass demos are often an analytic sphere intersection.
4. **Find the GPU<->DOM bridge**: if the WebGL canvas isn't displayed directly but instead goes through `toDataURL` / feeds `<feImage>` / `feDisplacementMap`, it's generating a **data map** (displacement/normal/depth) for another layer to use. This is a signature advanced-frontend technique, and the layer most often gotten backwards by secondhand analysis.
5. **Read physics/audio separately**: usually a pure-JS module decoupled from rendering, verifiable on its own.

## Transferable advanced patterns worth keeping

- **Displacement-map refraction of the DOM**: an offscreen WebGL pass computes a PNG where RG = displacement and B = an auxiliary value, and SVG's `<feDisplacementMap scale=N>` uses it to distort the real HTML. The `scale` on the GPU side and the SVG side must be kept in sync. This can produce liquid glass, magnifiers, water ripples, or any "lens laid over the page" effect, and **what's being refracted is the live, interactive DOM** — something Three.js's `MeshPhysicalMaterial(transmission)` cannot do (it can only give "the look of a glass sphere", not "refract the entire web page").
- **One shader + a mode uniform, multi-purpose**: refraction/reflection/shadow/foreground share a single fragment shader, branching on `u_mode`. Saves code and compile time.
- **Downres auxiliary data + skip frames when static**: displacement/reflection/shadow maps are visually insensitive to resolution -> downsample to 1/2 or 1/4. When objects are still -> stop rendering entirely (settleFrames). Standard performance pattern for heavy-frontend sites.
- **Fullscreen big-triangle instead of a quad**: 3 vertices `[-1,-1, 3,-1, -1,3]` cover the whole screen, saving one diagonal.

## Clone-path decision

- **1:1 reproducible + license allows it** -> use the real source directly, edit copy/colors/parameters (a single-file native site kept byte-for-byte = most faithful).
- **Want an approximate effect, fidelity doesn't matter** -> find a similar open-source template and swap content (e.g. awesome-threejs). But note: **swapping the implementation approach often loses the original site's signature mechanism** (e.g. this case's "refract the real DOM") — confirm first whether that mechanism is actually the selling point the user wants.
- **Site-specific math (intersection formulas/magic numbers) needs rewriting when migrated**: an analytic "sphere" intersection swapped to a different shape needs a different formula (or genuinely needs SDF/ray-marching); hand-tuned magic numbers like refractive index, Fresnel coefficient, absorption need retuning for a different material.

## Verification (hard requirement)
Start a local server -> open in a browser -> capture console (no JS/WebGL compile errors allowed) -> screenshot against the original.
Honestly note anything that couldn't be verified: e.g. Playwright's synthetic PointerEvent has `isTrusted=false` and won't trigger drag hit-testing logic — **write that down truthfully in NOTES, don't fake "the drag worked"**. For physics-based sites, "two loads produce different initial states" can indirectly prove the engine is actually running.
