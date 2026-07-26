---
name: react-three-fiber
description: |
  React renderer for Three.js (pmndrs/react-three-fiber, "R3F"), plus the drei helper library and the postprocessing effects package (bloom, depth of field, chromatic aberration). Use when the user wants a Three.js scene driven declaratively by React state/props, JSX scene graphs, R3F hooks (useFrame, useThree, useLoader), drei helpers, or post-processing effects. Defers to the threejs skill for raw Three.js concepts (geometries, materials, lights, cameras) rather than duplicating them, and states when a plain Three.js scene is the better choice than pulling in React reconciliation.
triggers:
  - "react three fiber"
  - "r3f"
  - "drei"
  - "postprocessing"
  - "three.js react"
  - "3d in react"
od:
  mode: prototype
  category: 3d-shaders
  upstream: "https://docs.pmnd.rs/react-three-fiber"
---

# React Three Fiber

> React renderer for Three.js. Core: `@react-three/fiber`. Helpers: `@react-three/drei`. Effects: `@react-three/postprocessing`.

## When to Use This Skill

Apply when a Three.js scene needs to be driven by React state/props, composed declaratively as JSX, or interleaved with other React UI: a 3D scene that adds/removes objects reactively, reads component state into the scene (camera position from a prop, mesh color from app state), needs `drei` helpers (`OrbitControls`, `Environment`, `useGLTF`), or needs cinematic post-processing (`Bloom`, `DepthOfField`, `ChromaticAberration`).

## When R3F Is the Wrong Choice

**A single static hero scene rarely needs React reconciliation.** If the scene's job is "render once, look good, maybe auto-rotate," plain Three.js (see **threejs**) is simpler and cheaper:

- ❌ No React tree diffing cost for a scene graph that never changes after mount.
- ❌ No `react-reconciler`/scheduler bundle weight added to a page that otherwise has little or no React.
- ❌ No fighting SSR/hydration for a canvas whose content is identical on every load.

Reach for R3F only when the scene's *inputs* are reactive: it reads live component state/props, objects are added/removed/reordered based on app data, or the 3D view must interoperate with surrounding React UI (HTML overlays via `drei`'s `<Html>`, form controls driving scene parameters, route-based scene swaps). A decorative background canvas with no data dependency is a **threejs** job, not an R3F job.

## Relationship to the `threejs` Skill

R3F is a **reconciler**, not a Three.js replacement. It does not reinvent geometries, materials, lighting models, cameras, or raycasting — those are Three.js concepts and belong to the **threejs** skill. Consult **threejs** first for anything about what a `BufferGeometry`, `MeshStandardMaterial`, `PerspectiveCamera`, or light type actually does. This skill covers only what R3F, `drei`, and `postprocessing` add on top: the JSX-to-Three.js mapping, R3F's hooks, and the ecosystem helpers.

## Setup: `<Canvas>`

```jsx
import { Canvas } from "@react-three/fiber";

<Canvas camera={{ position: [0, 2, 5], fov: 50 }} shadows dpr={[1, 2]}>
  <ambientLight intensity={0.5} />
  <directionalLight position={[5, 5, 5]} castShadow />
  <mesh>
    <boxGeometry args={[1, 1, 1]} />
    <meshStandardMaterial color="orange" />
  </mesh>
</Canvas>
```

`<Canvas>` creates the `WebGLRenderer`, default camera, and scene, and starts R3F's own render loop. `dpr` caps device pixel ratio (pass an array `[min, max]` to clamp on high-DPI displays for performance); `shadows` enables shadow maps.

## The Reconciler Mental Model

Lowercase JSX tags map to Three.js constructors: `<mesh>` → `new THREE.Mesh()`, `<boxGeometry args={[1,1,1]}/>` → `new THREE.BoxGeometry(1,1,1)`. The `args` prop is passed to the constructor; every other prop is set afterward (as a property assignment, or via a Three.js setter when one exists — e.g. `position={[0,1,0]}` calls `.set(0,1,0)`).

- **`attach`** — controls how a child attaches to its parent when it isn't an `Object3D` (e.g. `<meshStandardMaterial attach="material" />`, `<boxGeometry attach="geometry" />`). R3F infers this correctly for common cases; set it explicitly for custom attachments.
- **`<primitive object={...} />`** — wraps an existing Three.js object (e.g. a loaded GLTF scene) that was constructed outside R3F's JSX, so it participates in the scene graph and gets disposed correctly.

## Hooks

- **`useThree()`** — read access to `{ scene, camera, gl, size, viewport, clock }` and the R3F store outside JSX.
- **`useFrame((state, delta) => { ... })`** — runs every frame inside R3F's own render loop, before the frame is rendered. Use it for anything that must update in lockstep with the Three.js render (camera moves, mesh transforms, shader uniforms).
- **`useLoader(GLTFLoader, url)`** — Suspense-based asset loading; throws a promise so wrap the consumer in `<Suspense fallback={...}>`.

## `useFrame` Is R3F's Own Clock

R3F already runs a per-frame render loop functionally equivalent to GSAP's `gsap.ticker` or Motion's internal `frame` loop. **Never also run `gsap.ticker.add()` or a Motion `animate()` targeting the same mesh's position/rotation/scale inside the same Canvas** — that's two drivers writing the same Three.js object per frame, which produces the same jitter as running GSAP and Motion on the same DOM element. Use `useFrame` for anything R3F already owns (camera, mesh transforms, uniforms); reach outside the Canvas to GSAP/Motion only for the surrounding DOM (page scroll, HTML chrome, overlay panels), never for objects living inside the scene graph.

## `drei` Helpers

`@react-three/drei` is a library of pre-built abstractions over common Three.js/R3F patterns — use it before hand-rolling any of the following:

| Helper | Purpose |
|---|---|
| `OrbitControls` / `TrackballControls` | Camera orbit/pan/zoom interaction |
| `PerspectiveCamera` / `OrthographicCamera` | Declarative camera as a JSX child, swappable at runtime |
| `Environment` | HDRI-based lighting/reflections from a preset or custom map |
| `useGLTF` / `useTexture` | Cached, Suspense-based asset loaders (pair with `<Suspense>`) |
| `Html` | Positions real DOM content anchored to a 3D point — the seam between the scene and page UI |
| `ContactShadows` / `SoftShadows` | Cheap fake-shadow ground planes |
| `Instances` / `Instance` | Declarative instanced rendering for many repeated meshes |
| `Center` / `Bounds` | Auto-centers or auto-frames content without manual math |
| `Preload` | Forces asset loading before first paint to avoid pop-in |

```jsx
import { OrbitControls, Environment, useGLTF } from "@react-three/drei";

function Model() {
  const { scene } = useGLTF("/model.glb");
  return <primitive object={scene} />;
}

<Canvas>
  <Suspense fallback={null}>
    <Model />
    <Environment preset="city" />
  </Suspense>
  <OrbitControls enableDamping />
</Canvas>
```

## `postprocessing` (Bloom, Depth of Field, Chromatic Aberration)

`@react-three/postprocessing` wraps the `postprocessing` npm library's `EffectComposer` as JSX. Effects render as a stacked pipeline; **order matters — each `<Effect>` child is a pass applied top to bottom**:

```jsx
import { EffectComposer, Bloom, DepthOfField, ChromaticAberration } from "@react-three/postprocessing";

<Canvas>
  {/* scene content */}
  <EffectComposer>
    <DepthOfField focusDistance={0.02} focalLength={0.05} bokehScale={2} />
    <Bloom luminanceThreshold={0.6} luminanceSmoothing={0.2} intensity={0.8} mipmapBlur />
    <ChromaticAberration offset={[0.0008, 0.0008]} />
  </EffectComposer>
</Canvas>
```

- **`Bloom`** — glow on bright areas; tune `luminanceThreshold` (cutoff before glow starts) and `intensity`; `mipmapBlur` is cheaper and usually looks better than the legacy kernel-based blur.
- **`DepthOfField`** — needs scene depth information; works best focused on a single subject, not an entire evenly-lit scene.
- **`ChromaticAberration`** — cheap, small `offset` values (fractions of a pixel) read as "cinematic lens"; large values read as a glitch effect.
- Post-processing passes are GPU-expensive, especially on mobile. Keep the effect count minimal and gate expensive combinations (bloom + DOF together) behind a capability/quality check.

## Performance

- **`frameloop="demand"`** on `<Canvas>` plus manual `invalidate()` calls — renders only when something actually changed, instead of every frame at display refresh rate. Use for scenes that are mostly static and only update on interaction.
- **Instancing** — use `drei`'s `<Instances>`/`<Instance>` for many copies of the same geometry instead of one `<mesh>` per copy; one draw call versus hundreds.
- **Hoist allocations out of `useFrame`** — never construct a new `Vector3`, array, or material inside the per-frame callback; create it once with `useMemo` or module scope and mutate it in place.
- **Disposal** — R3F disposes objects it created when they unmount. Objects passed in via `<primitive>` (e.g. shared/cached GLTF scenes) are not auto-disposed by default; be deliberate about `dispose={null}` when reuse across mounts is intended.
- **Suspense + `Preload`** — load assets behind a `<Suspense>` boundary and use `drei`'s `<Preload>` to avoid a first-frame pop-in.

## Scroll-Linked or DOM-Synced 3D

When a scene must react to page scroll (a model that rotates as the user scrolls a marketing page), the repo-wide scroll-owner rule still applies: **only one of {native scroll, GSAP ScrollSmoother, Lenis} may own scroll on that page.** Read scroll progress from whichever single source owns it (a ScrollTrigger callback, a Lenis scroll event, or native `scrollY`) and feed the resulting number into the Canvas via a ref or store — do not let Motion's `useScroll`, GSAP ScrollTrigger, and native scroll all independently drive the same mesh.

Any HTML overlay animated in sync with the 3D scene (captions, UI chrome positioned via `drei`'s `<Html>`) must animate only `transform` and `opacity`, same as any other scroll-linked DOM animation — never layout-triggering properties.

## Accessibility: `prefers-reduced-motion`

Disable idle/ambient motion — `OrbitControls autoRotate`, a slowly orbiting hero camera, continuous particle drift — when the user has `prefers-reduced-motion: reduce` set. A single static frame of the scene is an acceptable fallback; it does not require rebuilding the scene, only skipping the per-frame camera/object animation that would otherwise run unconditionally.

## Best Practices

- ✅ Read raw Three.js concepts (geometry, material, lighting, camera math) from **threejs**; use this skill only for R3F/drei/postprocessing specifics.
- ✅ Wrap asset loading (`useGLTF`, `useTexture`, `useLoader`) in `<Suspense>`.
- ✅ Use `useFrame` for anything inside the Canvas; never add a second per-frame driver (GSAP ticker, Motion `animate()`) on the same object.
- ✅ Reach for `frameloop="demand"` on scenes that don't need to redraw every frame.
- ✅ Gate `prefers-reduced-motion` on ambient/auto-rotating camera or particle motion.

## Do Not

- ❌ Reach for R3F for a single static, non-interactive hero scene — use **threejs** directly.
- ❌ Re-explain raw Three.js material/geometry/lighting concepts here — defer to **threejs**.
- ❌ Run GSAP's ticker or Motion's frame loop against the same mesh a `useFrame` callback already animates.
- ❌ Let more than one of {native scroll, GSAP ScrollSmoother, Lenis} drive scroll progress into the same scene.
- ❌ Construct new vectors/arrays/materials inside `useFrame` on every call — hoist them.
- ❌ Animate DOM overlays synced to the scene with layout-triggering CSS properties; use `transform`/`opacity` only.

### Learn More

https://r3f.docs.pmnd.rs
https://github.com/pmndrs/drei
https://github.com/pmndrs/postprocessing
