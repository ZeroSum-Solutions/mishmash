# Known issues — Canvas / Workbench

Open defects found by the 2026-08-15 canvas hardening run
(`docs/plans/2026-08-15-canvas-workbench-hardening.md`) that are **not fixed**.
Everything here was confirmed against the code at `a8dd0663e`; nothing is carried over on
the strength of an older report.

Fixed defects are not listed here — they are in the branch's git history.

Each row states a repro you can run and a reason it was left open. "Not fixed" always has a
reason; none of these are open merely because the run ended.

---

## CANVAS-1 — The Tweaks panel cannot be opened inside the canvas

**Severity:** high · **Area:** editing · **Status:** open, needs a product decision

The srcDoc tweaks bridge hides an artifact's own tweaks panel before first paint and waits
for the host to re-show it. The host never does, because the receiver and the toolbar button
were never built. The panel is therefore unreachable in the MishMash preview.

The bridge is injected into **every** srcDoc build (`apps/web/src/runtime/srcdoc.ts:426`) and:

- sets `data-od-tweaks-hidden` on `<html>` synchronously, before the body parses, so the
  panel never paints (`srcdoc.ts:3333`);
- force-hides the artifact's own restore affordance with
  `.tw-restore { display: none !important; }`, commented "the host toolbar is the only entry
  point" (`srcdoc.ts:3327`);
- listens for `od:tweaks-panel-visible` to un-hide (`srcdoc.ts:3414`);
- posts `od:tweaks-available` and `od:tweaks-panel-state` to the host (`srcdoc.ts:3359,3368`).

None of the other half exists:

```bash
# nothing posts the message that reopens the panel — only the bridge's own comment + listener
grep -rn "od:tweaks-panel-visible" apps/web/src apps/daemon/src design-templates/
# nothing receives the availability/state signals
grep -rn "od:tweaks-available\|od:tweaks-panel-state" apps/web/src | grep -v runtime/srcdoc.ts
# no toolbar button: 'tweaks' appears once, in an analytics enum, never as a value
grep -n "'tweaks'" apps/web/src/components/FileViewer.tsx
```

**Repro.** Open any artifact containing a `.tw-panel` (see `design-templates/tweaks/`) in the
workbench preview. The panel does not appear and there is no control to summon it. Open the
same file outside MishMash — the panel works, because the bridge is not injected there.

**Why it is not fixed here.** Re-enabling this surface is a product and licensing decision,
not a hardening one. `AGENTS.md` § Design authority treats the tweaks `--motion` control as
live GSAP-licence exposure and instructs that visual motion authoring must not be expanded
without written Webflow consent. Making the panel reachable again changes that exposure, so
it needs an explicit ruling rather than a quiet re-wiring.

**Documentation conflict worth resolving.** `AGENTS.md:409-411` asserts the `--motion` control
"exists today" as present-tense exposure. That is accurate for exported and deployed
artifacts, but not for the in-app canvas, where the control is unreachable. Whoever rules on
the above should correct that sentence to match whichever behaviour is chosen.

---

## CANVAS-2 — The Inspect CSS panel is permanently unreachable

**Severity:** high · **Area:** editing · **Status:** open, needs the missing activator

`InspectPanel` renders only when `inspectMode && activeInspectTarget`. `inspectMode` is
initialised `false` and **every** setter sets it back to `false`:

```bash
grep -n "setInspectMode(" apps/web/src/components/FileViewer.tsx
# :7414, :10112, :10140, :10171, :10194  — all setInspectMode(false)
# declaration at :6359 — useState(false).  No setInspectMode(true) exists anywhere.
```

The whole protocol behind it is consequently dead in production: `od:inspect-mode`,
`od:inspect-set`, `od:inspect-reset`, `od:inspect-replay`, and the `od:comment-target`
listener gated on `if (!inspectMode) return` (`FileViewer.tsx:8994-9034`).

As with CANVAS-1, `'inspect'` is present in the artifact-toolbar analytics enum
(`FileViewer.tsx:6170`), implying a button that was never built.

**Repro.** There is no sequence of clicks that opens the Inspect panel.

**Why it is not fixed here.** The fix is to add a missing activator — a toolbar control that
calls `setInspectMode(true)` — which is feature restoration, outside a hardening run's scope.
It is small and well-understood, and should be its own PR with its own UI review.

---

## CANVAS-3 — `paletteActive` and `tweaksBridge` never reach the render-mode decision

**Severity:** medium · **Area:** runtime-wiring · **Status:** open, one-line fix but unsafe alone

`shouldUrlLoadHtmlPreview` disqualifies URL-loading when `paletteActive` or `tweaksBridge` is
set (`file-viewer-render-mode.ts:104,113`), because those bridges can only inject through
srcDoc. The caller never sets either field:

```bash
grep -rn "paletteActive\|tweaksBridge" apps/web/src
# only file-viewer-render-mode.ts — the type declaration and the two checks. No producer.
```

`FileViewer.tsx` builds `urlLoadDecision` at `:7363-7377` with eleven fields and omits both.
`hasTweaksTemplate(source)` *is* computed (`:308`) but feeds only
`previewTextNeedsFullSourceForSafeInline`, an unrelated full-text heuristic — it never
reaches the URL-vs-srcDoc decision.

**Consequence.** An artifact shipping the class-based tweaks template URL-loads by default,
which is precisely the path where its bridge cannot inject.

**Why it is not fixed here.** Wiring `tweaksBridge: hasTweaksTemplate(source)` is a plausible
one-line change, but it would force srcDoc rendering to feed a consumer that does not exist
(CANVAS-1) — a real performance cost for no user-visible gain. Fix it together with CANVAS-1,
in whichever direction that decision goes, or delete both flags if the bridges are being
retired.

---

## CANVAS-4 — Deleting the last owned design system leaves a dangling selection

**Severity:** low · **Area:** catalog · **Status:** open, intended behaviour undefined

Deleting the currently-default design system when no other user-owned system remains resolves
successfully but never calls `onSelect`. `selectedId` — propagated as `config.designSystemId`
through `EntryShell` and `App.tsx` — keeps pointing at an id that no longer exists. No toast,
no fallback.

**Repro.** Render `DesignSystemsTab` with a single user-owned draft that is also the selected
default; confirm delete. `deleteDesignSystemDraft` resolves `true`; `onSelect` is never
invoked. Pinned by a test in
`apps/web/tests/components/DesignSystemsTab.publish-unpublish-delete.test.tsx`.

**Evidence.** `apps/web/src/components/DesignSystemsTab.tsx:385`

**Why it is not fixed here.** The correct behaviour is genuinely unspecified — null the
selection, fall back to a bundled system, show a toast, or refuse the delete. The mechanical
fix (calling `onSelect` with a sentinel) cannot be expressed without widening the
`(id: string) => void` prop, which is an API change that deserves a deliberate choice.

---

## CANVAS-5 — Critique Theater "Live" replay speed is a no-op

**Severity:** low · **Area:** canvas-surface · **Status:** open, known placeholder

Selecting **Live** in the replay-speed picker flushes every event with a fixed 0ms delay —
identical to "instant". The label promises real-time pacing the code never delivers.

**Evidence.** `apps/web/src/components/Theater/hooks/useCritiqueReplay.ts:56-60` documents it
as a placeholder queued as a Phase 7+ follow-up; implementation at `:184-188`
(`baseDelay = speed === 'live' ? 0 : …`). Exposed as a user-selectable option at
`apps/web/src/components/Theater/TheaterTranscript.tsx:19`.

**Why it is not fixed here.** Implementing true cadence replay is a feature. The cheaper
honest fix — removing the option until it works — is a UX decision, not a hardening call.

---

## CANVAS-6 — Dynamically-injected preview scripts can blank the canvas with no recovery

**Severity:** medium · **Area:** runtime-wiring · **Status:** open, documented limitation

An artifact whose boot script is attached via `document.createElement('script')` rather than a
literal `<script src>` tag is routed to URL-load. If that script reads `localStorage` or
`sessionStorage` at module-eval time the iframe throws and the preview renders blank. Nothing
surfaces the cause; the only recovery is knowing to append `?forceInline=1`.

**Evidence.** `apps/web/src/components/file-viewer-render-mode.ts:180-186` documents exactly
this as a remaining known limitation.

**Why it is not fixed here.** Detecting dynamically-constructed script tags reliably from
source text is a heuristic change to the disqualifier set, with real false-positive cost
(every false positive forces a slower srcDoc render). It deserves its own spec and benchmark.

---

## CANVAS-7 — Twelve style specs each carry their own media-query-blind CSS parser

**Severity:** medium · **Area:** test infrastructure · **Status:** open, systemic

Twelve files under `apps/web/tests/styles/` each define a private `cssDeclarations` that scans
the stylesheet with a flat regex and ignores `@media` nesting. Any spec whose selector also
appears inside a media query asserts the override rather than the base value. These pass by
luck and turn red the moment a responsive rule lands — which is exactly how `#128` broke
`home-hero-compact-controls` (fixed on this branch).

```bash
grep -rln "function cssDeclarations" apps/web/tests/  # 12 files
```

**Why it is not fixed here.** Only the one failing file was in scope. The fix is to promote
the media-aware parser now in `apps/web/tests/styles/home-hero-compact-controls.test.ts` into
a shared test helper and migrate the other eleven — a mechanical change that should land on
its own so any behavioural surprises it uncovers are attributable.

---

## CANVAS-8 — `resolveDaemonUrl` silently falls back to a default port

**Severity:** medium · **Area:** runtime-wiring · **Status:** open, correctness hazard

When discovery exceeds its budget, `resolveDaemonUrl` returns `http://127.0.0.1:7456` with no
signal to the caller. On a loaded machine an `od` CLI client can therefore address a
*different* daemon than the one the user is running, and then mutate project data through it.

**Evidence.** `apps/daemon/src/daemon-url.ts:40-44` (fallback), `:60`, `:77` (both catch
blocks discard the reason). Reproduced deliberately on this branch by forcing the budget to
1ms — the caller cannot distinguish "no daemon found" from "discovery timed out".

**Why it is not fixed here.** The spec-level flake this caused **was** fixed, but changing the
product's fallback semantics (fail loudly? return a discriminated result?) is a behaviour
change to a path every CLI invocation depends on, and belongs in its own PR with its own red
spec.

---

## Not a defect

**`stock-media-gap`** — there is no native stock-media picker; `DesignBrowserPanel` ships two
static outbound links (`DesignBrowserPanel.tsx:459`). The absence is the specified behaviour,
not a bug. Recorded in `docs/canvas-feature-inventory.json` as `not_applicable` so the
coverage gate neither demands a fake test for it nor stays permanently red.
