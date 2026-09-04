# Known issues — Canvas / Workbench

Open defects found by the 2026-08-15 canvas hardening run
(`docs/plans/2026-08-15-canvas-workbench-hardening.md`) that are **not fixed**.
Everything here was confirmed against the code at `a8dd0663e`; nothing is carried over on
the strength of an older report.

Most fixed defects are not listed here — they are in the branch's git history. The exceptions
are the few marked **RESOLVED** below, kept because tests and source comments cite them by id,
and because two of them correct a diagnosis this file previously stated as fact.

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

## CANVAS-2 — The Inspect CSS panel is permanently unreachable — RESOLVED

**Severity:** high · **Area:** editing · **Status:** fixed; the activator exists

The missing activator landed in `1ad65485f`. `FileViewer.tsx` now ships an Inspect toolbar
button (`:12162`, `data-testid="inspect-mode-toggle"`) whose handler `activateInspectTool`
(`:10452`) sets `setInspectMode(true)` at `:10471`, and the panel's second condition is
produced by the selection bridge's `setActiveInspectTarget` at `:9285`. The state declaration
this entry cited as "every setter sets it back to `false`" is at `:6399`; the `false` setters
are the ordinary tool-exclusivity resets every other `activate*Tool()` performs.

**Repro.** Open an HTML artifact, click the Inspect button in the viewer toolbar, then click
an annotated element: the InspectPanel renders (`FileViewer.tsx:13208`).

---

## CANVAS-3 — `paletteActive` and `tweaksBridge` never reach the render-mode decision — RESOLVED

**Severity:** medium · **Area:** runtime-wiring · **Status:** fixed; `tweaksBridge` wired,
the palette half descoped by Devin on 2026-09-03

**`tweaksBridge` — wired.** `FileViewer.tsx` computes `tweaksTemplateBridge` from
`hasTweaksTemplate(routingHtmlSource)` and passes it into `urlLoadDecision`, so an artifact
shipping the class-based tweaks template now takes the srcDoc path where its bridge can
inject. The precision cost of that heuristic is tracked separately as CANVAS-12.

**The palette half — descoped, and the hooks removed.** There was never anything to wire it
to: the palette bridge was never injected (`FileViewer.tsx` passed `paletteBridge: false` to
`buildSrcdoc`), nothing in `apps/web/src` posted the `od:palette` message the bridge listened
for, and no host palette state existed. `paletteActive`, the `paletteBridge` / `initialPalette`
options, `injectPaletteBridge` and its `od:palette` listener were a hook for a surface that
was never built. For the record, at `aab82edc2` — the last commit that carried them — they sat
at `file-viewer-render-mode.ts:41` and `:137`, `runtime/srcdoc.ts:46-47`, `:479-481` and
`:1124-1316` (the `od:palette` listener at `:1309`), `FileViewer.tsx:7895` and
`scripts/template-render-report-lib.ts:129`.

**The decision.** Building the producer means designing a palette surface — feature work, not
wiring, and the same toolbar CANVAS-1 is waiting on. Devin chose removal on 2026-09-03: the
hooks are deleted, so the render-mode decision and `buildSrcdoc` no longer offer a capability
the product does not have. `apps/web/tests/runtime/srcdoc-palette-hooks-removed.test.ts` holds
that line. A future palette starts from an agreed surface and a bridge written for it, not
from this one.

**Not affected.** The always-on tweaks bridge stays; CANVAS-1 is untouched and still needs its
own product decision.

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

## CANVAS-6 — Dynamically-injected preview scripts can blank the canvas with no recovery — RESOLVED

**Severity:** medium · **Area:** runtime-wiring · **Status:** resolved by the daemon, not by the
viewer; the notice this entry once described has been removed as untrue

**What the entry described.** An artifact whose boot script is attached with
`document.createElement('script')` rather than a literal `<script src>` ships no tag for
`htmlNeedsSandboxShim` or the srcDoc asset inliner to read. The preview iframes are sandboxed
without `allow-same-origin`, so the request for that linked file carried
`Sec-Fetch-Site: cross-site` with no `Origin`, and the shared `/api` origin gate refused it
(`net::ERR_BLOCKED_BY_ORB`). The canvas was blank in both transports with nothing saying why.
W2.5 answered that by naming the shape (`htmlBuildsScriptAtRuntime`) and rendering a notice over
the preview.

**What changed.** Decision D-11, option B taught the origin gate to admit one extra shape: a GET
for a project raw asset that the browser itself classified as a preview subresource. `script` is
one of the accepted destinations, so the request the shape above produces is now served. Measured
at `ee7d42eb4` on a tools-dev runtime through the real app, on both transports: the linked file
loads and runs, and the notice was on screen saying it could not. See
`e2e/ui/preview-runtime-script.test.ts`, which asserts the artifact's own DOM side effect and the
notice's absence together.

The detector, the notice component, and its two i18n keys are therefore removed. Nothing replaced
them, because after the daemon change this shape has no failure of its own left to explain. A
runtime-attached script that names a project file loads like any other project asset. One that
names a cross-origin URL is governed by the preview response's own
`script-src 'self' 'unsafe-inline' 'unsafe-eval'`
(`apps/daemon/src/routes/project/index.ts`, `projectPreviewCsp`) — the same policy that governs a
literal `<script src="https://…">` tag, so it is a property of the URL, not of attaching the
script at runtime, and a notice scoped to the runtime-attached shape would be arbitrary.

**Repro (historical).** Preview an HTML artifact whose only script tag attaches another script at
runtime. Before D-11 the canvas was empty; at `ee7d42eb4` and after, the artifact renders.

**Still open — and newly fixable.** Loading the file and surviving a Web Storage read at eval are
separate questions, and only the first one changed. The storage shim (`injectSandboxShim`,
`apps/web/src/runtime/srcdoc.ts`) is injected by the srcDoc pipeline alone, so a runtime-attached
script that reads `localStorage` at eval still throws on the URL-load path — the other half of what
this entry originally described. Making that shape a render-mode disqualifier would now actually
repair it; the removed detector's docblock refused exactly that on the ground that srcDoc could not
run the script either, and D-11 removed the ground. It needs its own red spec (an artifact whose
linked boot file reads Web Storage at eval) and its own PR, and it has to weigh the cost the
original decision named: every artifact that merely mentions the pattern would pay for the slower
srcDoc render. Left to the owner as an actionable follow-up, not as a limitation.

**Also still open, deliberately.** The powered preview (`htmlNeedsPoweredPreview`) remains the only
path that gives an artifact a real same-origin document. Escalating to it off a source-text
heuristic is a product decision, not a hardening call. Left to the owner.

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

## CANVAS-8 — `resolveDaemonUrl` silently falls back to a default port — RESOLVED

**Severity:** medium · **Area:** runtime-wiring · **Status:** fixed; the fallback fails closed

Each discovery probe in `apps/daemon/src/daemon-url.ts` now reports whether it reached a
conclusion. `defaultDaemonUrlOrFailClosed` returns `DEFAULT_DAEMON_URL` only when every probe
concluded that nothing is listening; a probe that ran out of budget or failed for a reason
other than "not there" raises `DaemonUrlDiscoveryError` carrying the reasons. An `od` client
can therefore no longer address a different daemon than the user's because discovery was slow.

The `od` CLI turns that error into the repository's structured envelope — code
`daemon-url-unresolved`, exit 76 — naming `--daemon-url` and `OD_DAEMON_URL` as the two ways
out (`apps/daemon/src/cli.ts`, `cliDaemonUrl`).

**Repro.** Put a `pnpm` on `PATH` that never answers, unset `OD_DAEMON_URL` and
`OD_SIDECAR_IPC_PATH`, and run `od project list --json`: it exits 76 with the envelope
instead of writing against port 7456. Covered by
`apps/daemon/tests/daemon-url-fail-closed.test.ts` and
`apps/daemon/tests/daemon-url-cli-fail-closed.test.ts`.

---

## Not a defect

**`stock-media-gap`** — there is no native stock-media picker; `DesignBrowserPanel` ships two
static outbound links (`DesignBrowserPanel.tsx:459`). The absence is the specified behaviour,
not a bug. Recorded in `docs/canvas-feature-inventory.json` as `not_applicable` so the
coverage gate neither demands a fake test for it nor stays permanently red.

---

## CANVAS-9 — Two Playwright critical specs fail on `main` — RESOLVED

Both were root-caused and fixed; the detail lives in the branch history. Kept as a stub only
because CANVAS-13..15 below were found while fixing them and reference this entry.

- `app-restoration.test.ts:76` matched `getByRole('button', { name: /^Open$/ })`, but the
  produced-files row IS the button and its accessible name is the file path. Confirmed from the
  browser's own accessibility tree in the saved failure snapshot (`button "workspace-artifact.html"`),
  not by reading the component. Now matched by its `file-ops-row-open-<path>` test id.
- `app.test.ts:104` was pinning a value that is not a fixed default — see CANVAS-16. It was
  observed failing **both ways on the same commit** (expecting `hyperframes-html` and receiving
  the Seedance id, then the exact reverse, then two back-to-back runs of identical code where one
  passed 22/22 and the other failed), which is what ruled out the "stale fixture" reading the
  first failure alone supported. The spec now asserts the defaults that are real (aspect,
  duration) and only that *some* model rode along.

---

## CANVAS-10 — Playwright specs were load-flaky under the default worker count — RESOLVED

**Severity:** low · **Area:** test infrastructure · **Status:** fixed, and one earlier
diagnosis in this entry was wrong

Symptom, as first recorded: `workspace-keyboard-flows`'s Shift+Enter spec timed out inside
the full critical run and passed alone; `app-manual-edit` then failed a *different* subset on
each of four full-suite runs of the same commit, always on a 30s timeout and never on a
content assertion. One failure was diagnostic — the click on Share reported
`locator resolved to <button aria-label="Share" …>` and then timed out, so the control existed
and simply never became actionable inside the budget.

**Measured cause.** A Playwright worker here is not a browser context. Each one owns a whole
tools-dev runtime — its own daemon and its own Next dev server — so the config's default of two
workers ran two entire applications side by side. On a 16-core laptop, over
`app-manual-edit` + `app-restoration` at `--grep @critical` (13 specs):

```bash
OD_PLAYWRIGHT_WORKERS=1 pnpm exec playwright test -c playwright.config.ts \
  ui/app-manual-edit.test.ts ui/app-restoration.test.ts --grep '@critical'   # 13 passed, 3.7m
OD_PLAYWRIGHT_WORKERS=2 …                                                    # 5 failed,  8.4m
```

Two workers were **2.3× slower in wall clock as well as red**, so the parallelism was costing
time rather than saving it and the "flaky" specs were reporting that accurately. The individual
specs that timed out at 30s took 11.5s and 5.3s single-worker.

**Fix.** `e2e/playwright.config.ts` defaults to one worker locally. CI is unaffected: it sets
`OD_PLAYWRIGHT_WORKERS` explicitly from `nproc/2`
(`.github/actions/configure-ci-parallelism`), so raising the count stays a deliberate
per-runner choice.

**Correction to this entry's earlier text.** It claimed each runtime "starts a
`desktop-renderer` sidecar holding a Playwright Chromium", and that the suite therefore paid
for several browsers plus several daemons. That is wrong: `runBoundedRenderOnce`
(`apps/daemon/src/sidecar/desktop-renderer/render.ts:288`) launches a browser **per render**
and tears it down in a `finally` — "a fresh browser per render, not a long-lived singleton",
as its own docblock says. Idle runtimes hold no Chromium at all. The cost is the daemon plus
the Next dev server, which is what the measurement above actually shows.

**Left open deliberately.** `playwright.visual.config.ts` still defaults to three workers. Its
per-test budget is 240s rather than 45s, so it does not obviously share this failure mode, and
it was not measured here — changing it on the strength of a different suite's numbers would be
the same guessing this entry replaced.

---

## CANVAS-11 — Tool activation deferred behind a manual-edit flush has no cancellation

**Severity:** low · **Area:** editing · **Status:** open, pre-existing but widened

When manual Edit is open, activating another preview tool defers behind
`exitManualEditModeAfterFlush().then(...)` with no epoch or cancellation token. Clicking a
second tool before the flush resolves can run both continuations, leaving two tools active and
breaking the mutual exclusion each activator otherwise maintains.

```bash
grep -c "exitManualEditModeAfterFlush().then" apps/web/src/components/FileViewer.tsx
```

Pre-existing: the baseline `a8dd0663e` has 3 of these deferred activations (Draw, Comment,
Comment-create). The Inspect and Tweaks restoration on this branch follows the same established
pattern rather than inventing a new one, which takes it to 5 — so the branch widens an existing
gap rather than introducing it.

**Why it is not fixed here.** A correct fix threads a monotonic epoch (or an abort flag) through
all five activation paths and their continuations. That is a change to shared tool-switching
behaviour affecting every preview tool, and it deserves its own PR with its own specs rather than
riding along inside a restoration change.

Surfaced by an independent Grok 4.5 adversarial review of the branch diff.

---

## CANVAS-12 — Forcing srcDoc on a `hasTweaksTemplate` match has an unmeasured false-positive cost

**Severity:** low · **Area:** runtime-wiring · **Status:** open, needs measurement

CANVAS-3's fix wires `tweaksBridge: hasTweaksTemplate(source)` into `urlLoadDecision`, so any
artifact whose source matches the tweaks template takes the heavier srcDoc path. That is correct
for real tweaks artifacts — it is the only path where the bridge can inject.

The open question is precision. `hasTweaksTemplate` is a source-text heuristic, so an artifact
that merely *mentions* the panel's class names would be pushed onto srcDoc: full HTML inlined
into the parent document, higher memory, slower first paint, and the toolbar toggle enabled for a
panel that is not really there. The existing `passiveLargeHtmlPreview` short-circuit limits the
worst case but does not eliminate it.

**Repro / how to measure.** Count how many shipped templates the heuristic claims a tweaks panel
for, then confirm by eye how many actually render one:

```bash
grep -rl "tw-panel" design-templates/ | wc -l   # artifacts that would now be forced to srcDoc
grep -rl "tw-panel" design-templates/           # inspect each for a real panel vs a passing mention
```

**Why it is not fixed here.** Nothing is known to be broken — the risk is a cost, not a
regression, and tightening the heuristic without measuring its current false-positive rate would
be guessing. Measure against the real artifact corpus in `design-templates/` first.

Surfaced by the same Grok 4.5 review.

---

## CANVAS-13 — Annotation (Mark / Draw) capture had no working path in a browser — RESOLVED

Annotation capture could not take the fix Copy screenshot took, because it is the one caller
that composites onto the image it receives: `PreviewDrawOverlay` re-paints the user's marks
scaled by the preview frame's rect against the snapshot's pixel dimensions, so a full-page
render would place every mark somewhere the user did not draw it.

The renderer now answers a **viewport-clipped** request — same document, same viewport size,
same scroll offset — which is the only render that arithmetic is true against.
`DesktopExportArtifactInput.viewportScrollY` carries it (presence-checked, since `0` is the
top of a document and not a missing value); `capturePage` scrolls and clips to the viewport;
`POST /api/projects/:id/export/image` validates it and requires `width`/`height` with it; and
per `AGENTS.md` § "Capability exposure" the same mode is drivable from the CLI:

```bash
od export index.html --project p1 --format image --width 1280 --height 800 --scroll-y 1600
```

The Electron slide-renderer path has no viewport-clip mode and answers 501 rather than
silently serving a full-page render, so callers fall back instead of compositing onto wrong
pixels. A cross-origin preview frame refuses to report its scroll offset;
`readPreviewViewportRect` returns null there rather than guessing 0, for the same reason.

---

## CANVAS-14 — Current-slide capture of a runtime-managed deck had no path in a browser — RESOLVED

Three places decide what counts as a slide, and one disagreed with the other two. The
`<deck-stage>` runtime fallback and the off-screen renderer both use `DECK_SLIDE_SELECTOR`
(`.slide, [data-screen-label], .deck-slide, .ppt-slide`); the srcDoc host bridge looked only
for `.slide`. A deck built from `<deck-stage>` / `data-screen-label` therefore reported
`count: 0`, the viewer never learned an active index, and `planDeckImageCapture` refused the
off-screen renderer for it — rendering with no index stitches *every* slide, a wrong answer
rather than a degraded one.

The renderer could always have served these decks; only the host's half of the agreement was
missing. `slides()` now falls back to `DECK_SLIDE_SELECTOR` — strictly last, after both
existing `.slide` passes, so decks that already worked count exactly as before, decoy markup
included.

---

## CANVAS-15 — A screenshot on an unfocused tab hung, and stranded the button — RESOLVED

`copyImageDataUrlToClipboard` awaited `navigator.clipboard.write()`, which Chromium never
settles while the document lacks focus — neither resolving nor rejecting. `handleCopyScreenshot`
clears its in-flight guard in a `finally`, so a promise that never settled left the control dead
until reload, with the toast pinned on "Copying screenshot…". Pre-existing, but previously
unreachable: capture failed first, so the `finally` always ran. Fixing capture exposed it.

Two guards, because focus can be lost at two different moments: the write is not attempted at
all on an unfocused document (attempting it is what hangs), and a write that stalls after focus
was lost mid-flight gives up at `CLIPBOARD_WRITE_TIMEOUT_MS`. The refusal reports `'unfocused'`
rather than `'denied'` and carries its own message, because the user's own next click fixes it —
which is not true of a browser refusing outright.

---

## CANVAS-16 — The Video surface had no declared default skill — RESOLVED

`NewProjectPanel.skillIdForTab` resolved the Media→Video tab as
`list.find((s) => s.defaultFor.includes('video'))?.id ?? list[0]?.id`. Nothing declared
`od.default_for: video`, so `list[0]` decided — and that choice fed a loop: when the winner was
`hyperframes` an effect rewrote `videoModel` to `hyperframes-html`, otherwise it stayed on
`DEFAULT_VIDEO_MODEL`. Catalog order was choosing which provider a user's first video project
billed against, and two runs of identical code disagreed.

`design-templates/video-shortform` now declares it. The product had already said twice that
"Video" means generative video — `home-hero/media-surfaces.ts` filters `hyperframes-html` out
of the video surface's model list and gives hyperframes its own separate surface — so this
makes an existing intent explicit rather than choosing a new one. HyperFrames stays reachable
through its own surface and its templates.

One level down, `VIDEO_MODELS` carried **two** `default: true` entries on different providers
(Volcengine `doubao-seedance-2-0-260128` and `openrouter/bytedance/seedance-2.0:1080p`), and
`DEFAULT_VIDEO_MODEL` resolves through `find` — so reordering the list would have moved the
default onto a different account. The Volcengine entry keeps the flag because it is the one
`find` already returned; the change makes the existing behaviour deliberate rather than
positional. Both halves are now pinned by tests, so `e2e/resources/playwright.ts` asserts the
default model id again.

---

## CANVAS-17 — Export as image routed around the off-screen renderer — RESOLVED

Export as image shared `captureExportImageSnapshot` with Copy screenshot and the same defect:
the daemon renderer was reachable only when `isOpenDesignHostAvailable()` was true, which asks
whether the current browser is the Electron shell about a capability that lives in the daemon
and answers over plain HTTP. It now opts into `allowOffscreenRender`, which is safe here for
the same reason it is safe for Copy screenshot — this flow composites nothing onto the result.

**A correction to this entry's earlier text.** It said flipping the flag "reorders a precedence
that eight specs pin" and that they would have to be rewritten. Not one assertion needed
changing. The obstacle was that `exportProjectImageDataUrlMock` was a bare `vi.fn()` returning
`undefined` — a shape the real function cannot produce. Giving it the honest default
(`{ ok: false, unavailable: true }`, what a runtime with no renderer actually answers) left all
eight passing on their original assertions, because "renderer unavailable → bridge chain" is
exactly what they were pinning.

---

## CANVAS-18 — Image, Audio and Prototype tabs still resolve their default skill by catalog order

**Severity:** low · **Area:** project creation · **Status:** open, deliberately out of CANVAS-16's scope

`skillIdForTab` uses the same `?? list[0]?.id` fallback for every tab, and only `deck` and
`video` declare `od.default_for`. Image, Audio and Prototype therefore still resolve to
whichever skill the merged `skills/` + `design-templates/` scan reaches first.

The consequence is narrower than CANVAS-16's, which is why it was not fixed alongside it: no
effect derives a model from those tabs' skills. `DEFAULT_IMAGE_MODEL` and `DEFAULT_AUDIO_MODEL`
decide the model regardless, so catalog order chooses only which SKILL.md body the agent
receives — a quality question, not a billing one. `apps/daemon/tests/skill-default-surface.test.ts`
requires a declared default for the billing-relevant surfaces only, and names these three in a
comment so the omission is deliberate rather than forgotten.

**Repro.**

```bash
grep -rn "default_for" skills/*/SKILL.md design-templates/*/SKILL.md   # deck and video only
```

**Why it is not fixed here.** Picking the right default prototype/image/audio skill is three
more product calls, each wanting its own look at the catalogue rather than a batch decision
made while fixing something else.

---

## CANVAS-19 — The default video model follows provider readiness, not the declared default

**Severity:** low · **Area:** project creation · **Status:** open, found while closing CANVAS-16

CANVAS-16 removed the two order-dependent inputs to the Video tab's default. A third input
survives, and it is environmental rather than positional: `MediaModelCards` steers a
not-ready selection onto the first model whose provider IS ready
(`NewProjectPanel.tsx`, the `firstAvailableModelId` effect). `DEFAULT_VIDEO_MODEL` is
`doubao-seedance-2-0-260128` (Volcengine); a runtime with no Volcengine credential persists
`openrouter/bytedance/seedance-2.0:1080p` instead.

The effect is deliberate and mostly right — offering a model the user cannot run is worse
than substituting one they can. What is undecided is whether the *declared* default should
win when nothing is configured at all, which is the case a fresh install is in.

**Repro.** Create a project through New project -> Media -> Video without touching the model
picker, on a runtime with no Volcengine credential, and read the persisted
`metadata.videoModel`. It is the OpenRouter id, not `DEFAULT_VIDEO_MODEL`.

**Why it is not fixed here.** Same class of product call as CANVAS-16 — it decides which
provider a first video project bills against — and the substitution is a real feature, not a
bug, so changing it needs the decision rather than a patch. `e2e/resources/playwright.ts`'s
`video-basic` scenario asserts aspect and duration, which are genuinely fixed defaults, and
leaves the model id alone.

---

### Reviewed and dismissed, with evidence

Two findings from that review did **not** survive checking, recorded so they are not re-raised:

- *"Gating routes with `requireLocalOrigin` may break the `od` CLI, which sends no Origin header."*
  It does not. `isLocalSameOrigin` (`apps/daemon/src/origin-validation.ts:263`) returns true for a
  missing Origin when the `Host` header is an allowed local host, which is exactly what the CLI
  sends. Confirmed live against the running daemon: a foreign `Origin` gets 403 on all three
  newly-gated routes, while the same requests with no Origin proceed to real handling (400 / 404,
  and the pets sync actually ran). Captured in
  `~/.claude/goal-state/mishmash-canvas-hardening/proof/C10-origin-cli-evidence.txt`.
- *"`od:tweaks-panel-state` should require the active iframe like `od:tweaks-available` does."*
  The asymmetry is deliberate and is the documented contract: `AGENTS.md` § "Chat UI conventions"
  names `od:tweaks-available` specifically as the signal that must re-check
  `ev.source === iframeRef.current?.contentWindow`, while echoes are accepted from either mounted
  iframe. The implementation matches that contract.
