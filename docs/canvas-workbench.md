# The Canvas / Workbench

How the project canvas is actually put together, what it can do, and which of those things are
proven by a test.

Verified against `a8dd0663e`. Every behavioural claim below traces to a spec named in
`docs/canvas-feature-inventory.json`; run `pnpm exec tsx scripts/canvas-coverage-report.ts` to
check the mapping has not drifted. Where something is **not** proven, this document says so
rather than implying otherwise.

---

## It is three layers behind one route

There is no server route per project. Opening a project is client-side navigation inside a
single static shell.

```
apps/web/app/[[...slug]]/page.tsx      the only App-Router page — an optional catch-all.
  │                                    generateStaticParams returns one empty slug, so
  │                                    `next build --output export` emits a single shell that
  │                                    the daemon's SPA fallback serves for every deep link
  └─ client-app.tsx ──► src/App.tsx    dynamic import, ssr:false. App.tsx runs its own router
       │                               (src/router.ts) off window.location
       └─ ProjectView.tsx              LAYER 1 — per-project shell (10,094 lines)
            │                          resizable ChatPane ⇄ FileWorkspace split, keyboard and
            │                          pointer resize handle, focus mode, manual-edit divider
            └─ FileWorkspace.tsx       LAYER 2 — tabbed canvas shell (7,812 lines)
                 │                     Design System tab, Canvas tab, Pages dropdown, and
                 │                     dynamically opened file / terminal / side-chat /
                 │                     browser / live-artifact tabs
                 └─ FileViewer.tsx     LAYER 3 — per-file renderer (14,639 lines)
                      └─ HtmlViewer    :5967 — the live preview canvas itself
```

Two modules complete the surface:

- **`file-viewer-render-mode.ts`** (308 lines) — a pure function deciding how the preview
  loads. See below; this is the most load-bearing module in the canvas.
- **`PreviewDrawOverlay.tsx`** (2,158 lines) — the annotation layer composited over any
  preview.

## The render-mode decision is the thing to understand first

`shouldUrlLoadHtmlPreview` picks between two ways of getting HTML into the preview iframe:

| mode | how | when |
|---|---|---|
| **URL load** | iframe `src` points at the daemon, assets fetched per-request | the default — faster, real URLs, real relative paths |
| **srcDoc inline** | full HTML injected as a string, bridges injected alongside | forced whenever an interactive bridge must inject |

**Interactive bridges only work through srcDoc.** Comment/inspect selection, deck navigation,
palette, edit mode, tweaks and draw all inject script into the document; on the URL path there
is nothing to inject into. So every bridge that needs to run is a *disqualifier* that forces
srcDoc.

Both iframes stay mounted at once and are swapped by CSS visibility, so toggling render mode
does not cause a reload flash. `iframeRef.current` is kept pointed at the active one.

Receive filters use `isOurIframe(ev.source)` to accept messages from either iframe. Signals
that must come only from the *active* iframe additionally re-check
`ev.source === iframeRef.current?.contentWindow`.

This contract is also stated in `AGENTS.md` § "Chat UI conventions". All eight exported
functions and all eleven disqualifier branches are covered by
`apps/web/tests/components/file-viewer-render-mode.test.ts` (71 specs).

> **Every branch now has a producer.** `tweaksBridge` is fed by `hasTweaksTemplate`, and the
> `paletteActive` branch — which no caller ever set — was removed with the rest of the
> palette hooks when CANVAS-3's palette half was descoped. See CANVAS-3 in
> `docs/KNOWN-ISSUES-CANVAS.md`.

## Capturing pixels has three tiers, and only one of them works here

`captureExportImageSnapshot` in `FileViewer.tsx` walks them in order:

| tier | mechanism | available here? |
|---|---|---|
| **Off-screen render** | `POST /api/projects/:id/export/image` → daemon → `desktop-renderer` sidecar → Playwright Chromium | **yes** — plain HTTP, any browser |
| **Host compositor** | Electron `webContents.capturePage` of the visible preview region | **no** — this fork ships no Electron shell |
| **In-iframe bridge** | SVG `<foreignObject>` rasterised to a canvas inside the artifact | present, but fails on real artifacts |

The middle tier is the one the original design leaned on for anything needing *viewport*
pixels, and it is gone. The bottom tier is a last resort that Chromium frequently refuses to
paint; it answers `snapshot image failed` or `empty-render` and the code treats a uniform canvas
as a failure rather than shipping a blank frame.

So: **the off-screen renderer is the only capture path that actually works in the web Studio.**
It is not gated on `isOpenDesignHostAvailable()` — that predicate asks whether the current
*browser* is Electron, which has nothing to do with whether the *daemon* can render. A runtime
genuinely without a renderer answers 501, which the client reports as `unavailable` so the older
fallbacks still apply.

### Full-page or viewport, and why the caller has to say which

The renderer answers two shapes, and the difference matters more than it looks.

By default it renders `fullPage: true` — the whole document. That is right for anything that
just hands you an image, so **Copy screenshot** and **Export as image** opt in with
`allowOffscreenRender: true` and take it as-is.

It is wrong for anything that composites *onto* the image. `PreviewDrawOverlay` re-paints the
user's marks scaled by the preview frame's rect against the returned image's pixel dimensions,
so a full-page render would land every mark somewhere the user did not draw it. Annotation
capture therefore asks for the other shape, with `viewportClip: true`: the request carries the
frame's width, height and scroll offset, and the renderer scrolls there and clips to the
viewport. Same document, same box, same offset — which is what makes the overlay's arithmetic
true rather than approximately true.

Two details are load-bearing:

- **`viewportScrollY` is presence-checked, never truthiness-checked.** `0` is the top of a
  document — the most ordinary case there is — and collapsing it back to "no clip" would
  silently return a full-page render for exactly that case.
- **`readPreviewViewportRect` returns null rather than guessing.** A cross-origin preview frame
  will not report its scroll offset; defaulting to 0 would produce a confidently wrong
  background for a user who had scrolled, which is worse than a capture that fails.

The mode is reachable from the CLI too, per `AGENTS.md` § "Capability exposure":

```bash
od export index.html --project p1 --format image --width 1280 --height 800 --scroll-y 1600
```

## What the canvas can do

81 capabilities are catalogued in `docs/canvas-feature-inventory.json`, grouped as below.
Counts are proven / total, from the coverage gate.

| group | proven | what it covers |
|---|---|---|
| `canvas-surface` | see gate | preview canvas, zoom, viewport switching, deck and present modes, source toggle, share, export, deploy, version history |
| `catalog` | see gate | design systems, kits, plugins, connectors, brand references, library, marketplace sources |
| `upload-attach` | see gate | drag-and-drop, folder import, Figma import, kit asset upload, plugin and skill import, storyboard uploads |
| `editing` | see gate | manual edit mode, comment pods, draw/mark annotation, inspect, tweaks |
| `runtime-wiring` | see gate | render-mode decision, daemon discovery, preview lifecycle, live reload |

The gate prints current numbers rather than this document repeating them, because a hardcoded
count is a claim that rots. Run:

```bash
pnpm exec tsx scripts/canvas-coverage-report.ts
pnpm exec tsx scripts/canvas-coverage-report.ts --group editing
pnpm exec tsx scripts/canvas-coverage-report.ts --json
```

It exits non-zero on either drift that matters: a capability naming no test, or a capability
naming a test that no longer exists on disk. The second is the sneaky one — a renamed spec
leaves the list still claiming coverage that is gone.

A capability may also be marked `not_applicable` with a written justification, for entries
that record a documented *absence* rather than a behaviour. That field is deliberately a
string, not a boolean: an unexplained exemption is how a real gap gets quietly excused.

## Running it

```bash
pnpm tools-dev run web --daemon-port 17456 --web-port 17573
```

`pnpm tools-dev` is the only supported lifecycle entry point — there is deliberately no root
`pnpm dev` or `pnpm start` (see `AGENTS.md` § Local lifecycle for why).

## Verifying it

```bash
pnpm guard                                      # 104 policy/style/manifest guards
pnpm typecheck                                  # whole workspace
pnpm --filter @open-design/web test             # 491 files
pnpm --filter @open-design/daemon test          # 619 files
pnpm --filter @open-design/e2e test:ui:critical # Playwright critical path
pnpm exec tsx scripts/canvas-coverage-report.ts # canvas capability coverage
```

There is no root `pnpm test` or `pnpm build` alias, by design. Test commands are
package-scoped.

### A note on writing canvas specs

Two traps have already caught real specs in this tree, both worth knowing before you add one.

**Style specs must respect `@media` nesting.** A flat regex over a stylesheet will match a
selector inside every media block and report the narrowest override as the base value. That is
how a compact-desktop assertion started failing when a phone touch-target rule landed. The
media-aware parser in `apps/web/tests/styles/home-hero-compact-controls.test.ts` is the pattern
to copy; eleven other style specs still carry the old media-blind helper (CANVAS-7).

**Do not bind a correctness assertion to a short wall-clock budget.** `resolveDaemonUrl`
swallows a discovery timeout and returns a default URL, so a budget too tight for a loaded
machine surfaces as a confusing assertion about the wrong port rather than as a timeout. Give
process-spawning specs room (CANVAS-8).

More generally: a spec you have not watched fail is not evidence. Break the thing it guards,
confirm it goes red, then restore. Several specs in this tree passed for years while asserting
nothing, and only mutation showed it.

## What is broken

`docs/KNOWN-ISSUES-CANVAS.md` lists every open defect with a runnable repro and a reason it
was not fixed. Two are worth knowing before you work on the editing surfaces, because both
look like features that exist:

- **The Tweaks panel cannot be opened in the canvas** (CANVAS-1). The srcDoc bridge hides it
  before first paint and waits for a host toggle that was never built.
- **The Inspect panel is unreachable** (CANVAS-2). `inspectMode` has no setter that ever sets
  it `true`.

In both cases the artifact-side half, the analytics enum and the render-mode flags exist. Only
the host-side activation is missing.
