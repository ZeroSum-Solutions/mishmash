# F004 — 🐞 Canvas preview flickers to raw structure on every update

| Field | Value |
|---|---|
| Captured | 2026-08-18, live team demo |
| Reported by | Devin |
| Type | **Defect** |
| Area | `apps/web/src/components/FileViewer.tsx` — preview asset inlining |
| Severity | **High** — visible on every edit, in the surface the demo is built around |
| Effort | **M** — revised from the original **S** estimate. Verification (Step 3 of the repair pass) found *two* distinct trigger paths (fresh mount, and re-run after a prior successful inline — §2), not one, and they need a shared keyed state machine plus tests at two layers (§5). |
| Reproduces on | Multi-file sites with document-relative asset refs **that are also forced onto the srcDoc render path** — i.e. `shouldUrlLoadHtmlPreview` returns `false` (`file-viewer-render-mode.ts:127-158`), e.g. ≥5 `<section>` elements (`COMPOSITION_METRICS_SECTION_THRESHOLD`, `file-viewer-render-mode.ts:106`) or an external `<script src>` via `htmlNeedsSandboxShim` (`file-viewer-render-mode.ts:291-309`). Ordinary preview HTML defaults to URL-load and is unaffected — "any multi-file site" (the original claim) is too broad. Confirmed input: project `9927784c-…` ("Poetry Website Templates and Palettes" → the **Alex Roth Ceramics** site). This is mutable dev data — re-count qualifying refs with the command in §2 before trusting any number here. |
| Status | ✅ **Confirmed** — root cause read end-to-end in code (§2) *and* independently reproduced live in-browser (§6, 2026-08-18). One sub-question (§6.2: *why* the first frame specifically renders unstyled) stays open but does not block the fix — see §4. |

---

## 1. Raw note (verbatim)

> there's been a little glitching for each of the projects just on the Canvas portion where
> we're viewing the actual websites. Go ahead and look at the poetry website. Go ahead and
> get into that one. It says, oh, actually, sorry, it's Alex Roth Ceramics. It's glitching,
> it will go from an HTML version back to its full structure.

**Naming note:** "Alex Roth Ceramics" is the *site*; the project is named "Poetry Website
Templates and Palettes" (`9927784c-9475-40c7-8353-ec88335afabf`). That mismatch is itself
worth a look — the project got its name from the opening prompt, not from what it became
(`metadata.nameSource: "agent"`).

---

## 2. Root cause

**Corrected 2026-08-18 (PRD repair pass).** The original write-up below named one
mechanism and got several of its own line citations wrong. Verified against the current
repo (`git log -1 --format=%H -- apps/web/src/components/FileViewer.tsx` at the time of
this pass): there are **two distinct trigger paths**, both landing on the same downstream
fallthrough, and the fix (§5) has to cover both.

`inlinedSource` starts at `null` (`FileViewer.tsx:6304`) and `livePreviewSource = inlinedSource ?? deckVisualSource`
(`FileViewer.tsx:7285`) falls through to the **raw, un-inlined** source whenever it is
null. Two separate things drive it to null:

- **Path A — every source-changing re-run (the effect's own clear).** The inlining
  effect's first statement is `setInlinedSource(null)` (`FileViewer.tsx:7676`; the
  `useEffect(() => {` call itself is `:7675`), and this runs synchronously on every effect
  re-fire — including the *second and later* times a given file is shown, after a prior
  inline already succeeded. The re-inline that follows is **not awaited**: the effect uses
  `void inlineRelativeAssets(...).then((next) => { if (!cancelled) setInlinedSource(next); })`
  (`FileViewer.tsx:7685-7689`), so `setInlinedSource(next)` lands on a later tick/render.
- **Path B — fresh mount (no prior inline to fall back to).** `inlinedSource`'s `useState(null)`
  initializer means the *first* render of a freshly-mounted file already has `inlinedSource === null`
  — before the effect has run even once. This path does not depend on the effect's explicit
  clear at all; it is the `??` fallthrough on the state's own initial value. **This is the path §6
  actually measured live** (a fresh mount of `home.html`), not Path A.

Both paths produce a different `srcDoc` string than the eventual inlined one, so the iframe
**re-parses the entire document twice per update**: once raw, once inlined.

### Evidence chain

| # | Location | Fact |
|---|---|---|
| 1 | `FileViewer.tsx:6304` | `const [inlinedSource, setInlinedSource] = useState<string \| null>(null)` — Path B's source |
| 2 | `FileViewer.tsx:7675-7676` | `useEffect(() => {` at `:7675`; its **first statement**, `setInlinedSource(null)`, is at `:7676` — synchronous. Path A's source. |
| 3 | `FileViewer.tsx:7685-7689` | `void inlineRelativeAssets(...).then((next) => { if (!cancelled) setInlinedSource(next); })` — **not** awaited (corrected; the original draft said "awaited"). `setInlinedSource(next)` lands on a later tick regardless. |
| 4 | `FileViewer.tsx:7285` | `const livePreviewSource = inlinedSource ?? deckVisualSource` — the `??` falls through while null |
| 5 | `FileViewer.tsx:7281-7284` | `deckVisualSource` returns the **raw `source`** unchanged when the file is not a deck |
| 6 | `FileViewer.tsx:7313` | `previewSource` resolves to `livePreviewSource` in normal (non-freeze) mode |
| 7 | `FileViewer.tsx:7705-7729` | `srcDoc = buildSrcdoc(previewSource, …)`, memo-keyed on `previewSource` → **new string ⇒ full re-parse** |

**Sequence per update (Path A — re-run after a prior successful inline)**

```
effect runs
  ├─ setInlinedSource(null)          ← synchronous
  │    └─ render: previewSource = RAW source
  │         └─ buildSrcdoc(raw) → iframe re-parses → assets unresolved  ← "full structure"
  └─ void inlineRelativeAssets(…).then(...)   ← NOT awaited, resolves on a later tick
       └─ setInlinedSource(inlined)
            └─ render: previewSource = INLINED source
                 └─ buildSrcdoc(inlined) → iframe re-parses again → styled  ← snaps back
```

**Sequence on mount (Path B — no prior inline exists yet)**

```
mount
  └─ inlinedSource = null (useState initializer, effect hasn't run yet)
       └─ render: previewSource = RAW source → buildSrcdoc(raw) → first parse, unresolved
  └─ effect runs → inlineRelativeAssets(…).then(setInlinedSource(inlined))
       └─ render: previewSource = INLINED source → buildSrcdoc(inlined) → second parse, styled
```

The original draft's R2 ("stop clearing `inlinedSource` to null up front, retain the
previous value") only fixes Path A — there is no "previous value" to retain on a fresh
mount, so Path B needs its own requirement (§5, R2).

### Why this project triggers it every single time

`home.html` references, all **document-relative** (one stylesheet, eleven image
occurrences, one script — verified live against the current file, not a stale count):

```html
<link rel="stylesheet" href="styles.css">
<script src="site.js"></script>
<img src="assets/hero-pendant.jpg">
<a href="lighting.html">
```

**Re-verify the count before relying on it** — `.od/projects/9927784c-.../home.html` is
live dev data that agents keep editing:

```bash
grep -noE '(src|poster|data-src)\s*=\s*"[^"]*"|<link\b[^>]*\bhref\s*=\s*"[^"]*"' \
  ~/projects/mishmash/.od/projects/9927784c-9475-40c7-8353-ec88335afabf/home.html \
  | grep -vE '="(#|/|https?:|data:|mailto:|tel:)'
```

`hasRelativeAssetRefs` (`file-viewer-preview-assets.ts:496-505`) is a **short-circuit
scan** — it returns `true` on the *first* qualifying ref via an early-return flag, it does
not count them (corrected; the original draft said "counts"). It also does not scan anchor
`href`s at all — `lighting.html` above is navigation, not an asset, and is explicitly
excluded by the regex comment at `file-viewer-preview-assets.ts:27`. The guard that has to
stay false for the effect to proceed is `if (!hasRelativeAssetRefs(source) && !projectRootAssetRefs) return;`
at `FileViewer.tsx:7683` (corrected; the original draft cited `:7679`, which is the
`useUrlLoadPreview` early-return one line below the effect's opening `setInlinedSource(null)`).

### Why "reproduces on any multi-file site" was too broad

The inlining effect returns immediately when `useUrlLoadPreview` is true
(`FileViewer.tsx:7677`), and ordinary preview HTML defaults to the URL-load path — see
`shouldUrlLoadHtmlPreview` (`file-viewer-render-mode.ts:127-158`), which returns `true`
(URL-load, unaffected by this bug) unless one of its listed disqualifiers applies. This
project hits **two** of those disqualifiers independently: 8 `<section>` elements trip
`compositionMetricsBridge` (`COMPOSITION_METRICS_SECTION_THRESHOLD = 5`,
`file-viewer-render-mode.ts:106`), and the external `<script src="site.js">` trips
`htmlNeedsSandboxShim` → `forceInline` (`file-viewer-render-mode.ts:291-309`,
wired at `FileViewer.tsx:7470`). Either alone would have forced srcDoc.

**Corrected claim about `design-templates/`.** The original draft asserted "most of
`design-templates/` are single-file, self-contained" as the reason templates look stable
while client sites flicker. A quick regex approximation of `hasRelativeAssetRefs` run over
the corpus during this repair pass found the opposite is closer to true — a large majority
of the 424 template HTML files have relative asset refs of some kind (e.g.
`design-templates/equilibrium-liquid-glass-hero/example.html:11`,
`design-templates/neuralyn-dark-landing/example.html:18`). Do not put a number from this
approximation into the record — the real `hasRelativeAssetRefs`/`eachAssetRef` scan
(`file-viewer-preview-assets.ts`) also covers CSS `url(...)`, `srcset`, and inline
`<style>` blocks that a simple regex misses, so an approximation and the real function will
disagree on the exact count. Re-measure with the real function before citing a number:

```bash
cd ~/projects/mishmash
node --import tsx -e "
  import { hasRelativeAssetRefs } from './apps/web/src/components/file-viewer-preview-assets.ts';
  import { readFileSync, readdirSync, statSync } from 'node:fs';
  import { join } from 'node:path';
  function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.html')) out.push(p);
    }
    return out;
  }
  const files = walk('design-templates');
  const rel = files.filter((f) => hasRelativeAssetRefs(readFileSync(f, 'utf8')));
  console.log(\`\${rel.length} / \${files.length} have relative asset refs\`);
"
```

What does **not** change regardless of the exact count: templates that have zero relative
refs are stable (effect short-circuits, Path A never fires — Path B still can, on fresh
mount, since Path B does not depend on `hasRelativeAssetRefs` at all, only on whether the
file needs inlining *eventually*). The severity/scope of this bug does not hinge on the
`design-templates/` number either way — real client multi-file sites are the reproduction
target, and they are extremely likely to have relative asset refs by construction (that is
how a static multi-file site is normally authored).

**Trigger frequency.** The effect's deps include `source` and `reloadKey`, so Path A
re-runs on every agent edit, file save, and manual reload. During a live demo with the
agent actively editing, it fires constantly. Path B fires once per fresh mount (opening a
file for the first time in a session, or switching to a file whose `inlinedSource` was
cleared because its key changed — see §5, R3).

---

## 3. Ruled out, with evidence

Recording these so nobody re-investigates them.

| Suspect | Verdict |
|---|---|
| **Missing `<base href>` breaking relative refs under srcDoc** | ❌ Ruled out. `FileViewer.tsx:7708` passes `baseHref: projectRawUrl(projectId, assetBaseDirFor(file.name))`. Relative refs *do* resolve on the srcDoc path. |
| **`compositionMetricsBridge` forcing srcDoc** | ⚠️ True but not the cause. `home.html` has **8** `<section>` elements ≥ `COMPOSITION_METRICS_SECTION_THRESHOLD` (5), so `shouldUrlLoadHtmlPreview` returns false and the file is pinned to srcDoc. That explains *which path* is taken — it is stable, so it cannot explain a flicker. |
| **CANVAS-3 / CANVAS-6 / CANVAS-12** (`docs/KNOWN-ISSUES-CANVAS.md`) | Related area, different defects. CANVAS-3 concerns unwired `paletteActive` / `tweaksBridge`; CANVAS-6 concerns injected scripts blanking the canvas. Neither describes this double-parse. **F004 is new.** |

---

## 4. Confidence

**Updated 2026-08-18 (PRD repair pass) — this section was stale.** It previously said
"not yet visually reproduced," which contradicted the Revisions log and §6 below, both of
which already recorded a live reproduction. Current state:

**Root cause: confirmed two ways.** (1) By reading the data flow end to end — every link
in §2's evidence chain was read, not inferred, and re-verified line-by-line during this
repair pass (three of the original citations were off by one or more lines; corrected in
§2). (2) By live browser reproduction (§6, 2026-08-18) — a `MutationObserver` armed before
mount caught both `srcdoc` values and their paint order on a fresh mount, confirming Path B
from §2.

**What is still open.** §6.2's narrower question — *why* the first (raw) frame renders
visibly unstyled rather than picking up `styles.css` via the `<base href>` rebase the same
way the URL-load path would — is not established. This does **not** block the fix: the fix
target is "the raw/unresolved frame is never painted," not "the raw frame, if painted,
happens to look correct." Once Path A and Path B (§2) are closed, no unresolved frame is
shown at all, and the open question about frame 1's specific unstyled appearance becomes
moot for this PRD. It is still worth root-causing separately since the same mechanism could
affect other unrelated code paths — filed as a follow-up in §5.4, not as a blocker here.

---

## 5. PRD — the fix

**Rewritten 2026-08-18 (PRD repair pass).** The prior version of this section had five
problems, all confirmed against the repo during this pass (not just asserted by the audit):
R1 tested internal React state (`previewSource === rawSource`) instead of an
oracle a Playwright test can actually observe, and only covered Path A, missing Path B (the
one actually measured in §6); R2/R3 left Path B's fresh-mount state undefined; R4
contradicted its own success criterion 4 and the intent of issue #4650; R5 never defined
"update"; and the verify commands in the old §5.3 pointed at paths that do not exist in
this repo (`e2e/specs/*.spec.ts` is the **Vitest** business-spec tree, not Playwright — see
`e2e/AGENTS.md` "Naming and tools", `:159`; Playwright UI tests are flat `*.test.ts` files
under `e2e/ui/` importing `@/playwright/suite`). Rewritten below to name the actual files,
cover both paths, and give every requirement a verify command that would actually run.

**Dual-track check (per `AGENTS.md` "Capability exposure (UI/CLI dual-track)"): N/A.** This
PRD fixes an existing preview capability's internal state handling; it adds no new HTTP
endpoint, contract DTO, web surface, or `od` subcommand, so the four-way dual-track
requirement does not apply. If review disagrees, that is itself a finding — flag it, don't
silently add endpoints nobody asked for.

**Duplicate-capability check: none found.** `apps/web/tests/components/FileViewer.srcdoc-reload.test.tsx`
and `FileViewer.srcdoc-reload-races.test.tsx` cover `source`-fetch races (issue #4650,
in-flight-reload races) but neither exercises `inlinedSource`/`inlineRelativeAssets` timing.
No existing test would be duplicated by R1 below.

### 5.1 Requirements

- **R1 · Failing tests first, at two layers, covering both paths.** Per
  `superpowers:test-driven-development` and the "Try the cheapest layer first" guidance in
  root `AGENTS.md`'s Bug follow-up workflow section.
  - **R1a (primary, cheap layer).** New app-local Vitest file
    `apps/web/tests/components/FileViewer.inline-asset-flicker.test.tsx` (sibling to, and
    following the same mock-fetch/fake-timer pattern as, `FileViewer.srcdoc-reload-races.test.tsx`).
    Assert on the **rendered DOM**, not internal state: read
    `container.querySelector('iframe[data-od-render-mode="srcdoc"]').srcdoc` at each commit
    (via `act`/`waitFor` steps with a controlled/deferred `inlineRelativeAssets` mock), and
    assert the observed `srcdoc` sequence never contains a value that (a) is missing the
    `data-od-inline-asset` marker (`file-viewer-preview-assets.ts` emits
    `<style data-od-inline-asset="...">` for every inlined stylesheet — grep the file for the
    exact emission site before writing the assertion, do not guess the attribute name) while
    (b) the source under test has a qualifying relative ref. Cover **both**:
    - Path B: first render after mount, before the mocked `inlineRelativeAssets` resolves.
    - Path A: a second `source` change (simulating an agent edit) after the first inline
      already resolved once.
  - **R1b (confirmation layer).** New Playwright file `e2e/ui/canvas-preview-inline-flicker.test.ts`
    (flat, importing `test`/`expect` from `@/playwright/suite`, per `e2e/AGENTS.md`
    "Naming and tools" — do **not** put this under `e2e/specs/`, that tree is Vitest). Seed a
    small hermetic fixture (2-3 files: an HTML page with ≥5 `<section>` elements or an
    external `<script src>` — either disqualifier from §2 is enough to force srcDoc — plus a
    relative stylesheet that sets a distinguishing, easy-to-assert style, e.g.
    `body { background-color: rgb(1, 2, 3); }`) through the isolated per-worker tools-dev
    daemon (`e2e/lib/tools-dev/`, per root `AGENTS.md`'s e2e harness guidance — do **not**
    reuse the mutable `.od/projects/9927784c-...` sandbox as the fixture; §6.1's own
    caveat is that the corpus there keeps changing). Before navigating to the file,
    `page.addInitScript()` a `MutationObserver` on `document` filtering
    `attributes: true, attributeFilter: ['srcdoc'], subtree: true` — the same technique §6
    used live — recording every `srcdoc` value's length and whether it contains the inline
    marker. Assert the recorded sequence never shows an un-inlined `srcdoc` for a file that
    has a qualifying relative ref, across a fresh navigation (Path B) and a subsequent
    simulated edit via the file-write API (Path A). This test must fail on `main` before any
    source change.
- **R2 · Fresh mount (Path B) does not paint the raw document.** There is no "previous
  inlined value" to fall back to on a fresh mount, so this cannot be "retain the previous
  value" (that's R3). Extend the existing loading gate instead: `initialPreviewLoading`
  (`FileViewer.tsx:11511`, currently `source === null && !sourceEverLoadedRef.current`,
  which already renders the `aria-busy` loader at `FileViewer.tsx:12691`) must **also** stay
  true — i.e. the preview must not paint yet — while the file needs inlining
  (`hasRelativeAssetRefs(source) || projectRootAssetRefs`) and is forced onto the srcDoc
  path, until the first `inlineRelativeAssets` for this file/key either resolves or fails
  (R2 error handling below). Do not invent a second, differently-named loading flag if
  extending the existing one cleanly covers this case — check first.
  - **On failure:** `inlineRelativeAssets(...)` is `async` and its internal fetches already
    swallow individual failures by returning `null` for that asset
    (`file-viewer-preview-assets.ts:519+`, `fetchProjectRelativeText` results checked with
    `asset == null` before use) — it should resolve, not reject, in the overwhelming
    majority of cases. The current effect's `.then(...)` has no `.catch()`
    (`FileViewer.tsx:7685-7689`); add one. On an unexpected rejection, log it (existing
    console/telemetry pattern in this file) and fall back to rendering the raw `source`
    rather than hanging the loader forever — this is a worse-than-ideal but bounded and
    visible outcome, not a silent one, and it does not need a retry policy invented here.
- **R3 · Guard against cross-file/cross-edit staleness (Path A).** Key the retained
  `inlinedSource` value by `projectId + file.name`. On a re-run where that key is unchanged
  (an edit/reload/undo/redo/version-restore on the *same* file — see the additional
  `setInlinedSource(null)` call sites at `FileViewer.tsx:9012, 9077, 9108, 9142, 9271, 10168,
  10224`, all of which pair the clear with a synchronous `setSource(...)` in the same
  handler), retain the previous inlined value on screen until the new one resolves — do not
  drop to raw. On a re-run where the key *changed* (switched to a different file), clear to
  null and fall into R2's loading-gate path instead of showing file A's content under file
  B's chrome. **Retain at most one string at a time** (replace-on-key-change, not an
  accumulating cache) — this keeps memory bounded to what `inlinedSource` already holds
  today; do not build a multi-entry cache, that is out of scope.
- **R5 · Define "update" and require zero visible unresolved frames for each kind.** An
  "update" is any of: fresh mount (Path B, R2); an in-place source change — agent edit,
  Manual Edit patch/undo/redo/conflict-resync, speaker-notes save, Reload click, or version
  restore (Path A, R3, all the call sites listed above); a cross-file switch (R3, falls
  into R2); and a URL-load ↔ srcDoc mode transition (`useUrlLoadPreview` flips — confirm
  whether this can also paint a stale `inlinedSource` from before the transition; add a
  regression if so). Each kind gets its own assertion in R1a/R1b — a single generic
  "no flicker" test is not enough coverage for five different trigger shapes with different
  state transitions.
  - Additional regressions to add, per the failure modes above and per `AGENTS.md`'s
    "Missing regressions" review lens: out-of-order inline completion (a slow first
    inline resolving *after* a second, faster one for a newer key — the `cancelled` flag at
    `FileViewer.tsx:7690-7692` should already guard this; add a test that proves it, don't
    assume), an inline rejection (R2's new `.catch()` path), identical top-level HTML bytes
    with changed `styles.css`/`site.js`/image bytes on Reload (must still re-inline — this is
    why R4 from the original draft is **dropped**, see below), and the existing Comment/Draw/Edit
    freeze invariants already covered by `FileViewer.test.tsx` around `:5200` (run that file
    to confirm no regression, do not re-derive the invariant from scratch).
- **R4 removed.** The original draft's "skip rebuilding srcDoc when only `reloadKey`
  changed and bytes are identical" is dropped, not fixed. It directly contradicts success
  criterion 4 (reload must still force a fresh parse — issue #4650) and, worse, "identical
  top-level HTML bytes" does not imply identical `styles.css`/`site.js`/image bytes; skipping
  the inlining pass on that basis could silently serve stale dependent assets after Reload.
  The `srcDoc` `useMemo` (`FileViewer.tsx:7705-7729`) already skips recomputation when
  `previewSource` is referentially/value-unchanged — no additional work is needed to avoid
  redundant `buildSrcdoc` calls; the only place doing avoidable redundant work is
  `inlineRelativeAssets` re-fetching everything on every Path-A re-run, and per the
  paragraph above, that redundancy is currently load-bearing for reload correctness, not a
  bug to fix here.

### 5.2 Success criteria

1. R1a and R1b both fail on `main` before any source change, and pass after the fix.
2. A fresh mount of a file needing inlining (Path B) never paints a `srcdoc` value lacking
   the inline marker while the source has a qualifying relative ref — verified by R1a and
   R1b, not by a human watching the screen.
3. An in-place edit to an already-inlined file (Path A) never paints an un-inlined `srcdoc`
   after the first successful inline — verified by R1a and R1b.
4. Switching between two files never shows the previous file's inlined content under the new
   file's chrome (guards R3) — verified by R1a.
5. Issue #4650 does not regress — Reload still forces a fresh parse (new `srcdoc` string)
   even when the top-level HTML bytes are identical — verified by the existing
   `FileViewer.srcdoc-reload.test.tsx` staying green, plus a new case for changed dependent
   assets (R5).
6. `pnpm guard`, `pnpm typecheck` exit 0; the existing `FileViewer.test.tsx`,
   `FileViewer.srcdoc-reload.test.tsx`, and `FileViewer.srcdoc-reload-races.test.tsx` all
   stay green (no regression in the freeze/race invariants they already pin).

**Morning review (does not block the overnight run).** Per root `AGENTS.md`'s "Stage human
verification for visible bugs" — green specs are not final acceptance for a visible UI race.
Before this is considered shippable, stand up the buggy-vs-fix comparison the policy asks
for: two namespaced `tools-dev` runtimes, one on `main` and one on the fix branch, both
seeded through the production HTTP file-write API (not a source-level backdoor), and have
Devin drive the Alex Roth Ceramics project (or the R1b fixture) on both to confirm by eye.
The overnight agent should leave both runtimes reachable (record the namespaces/ports it
used) rather than tearing them down, so this takes one look, not a fresh setup, in the
morning. Also flag for review: R2's loading-gate extension means a large multi-file site's
*first* view now waits for inlining to finish before showing anything (up to the ~4s cold
cache case measured in §6.1) instead of painting instantly-but-wrong-then-fixed — confirm
that trade is the one Devin wants; it was not explicit in the original note.

### 5.3 Verification

```bash
cd ~/projects/mishmash
pnpm guard && pnpm typecheck
pnpm --filter @open-design/web test -- FileViewer
cd e2e
pnpm exec playwright test -c playwright.config.ts ui/canvas-preview-inline-flicker.test.ts
```

### 5.4 Follow-up worth filing separately

- **Project naming.** This project is called "Poetry Website Templates and Palettes" while
  containing the Alex Roth Ceramics site (`metadata.nameSource: "agent"` — named from the
  opening prompt). Projects should be renameable, or auto-renamed as intent becomes clear.
  Small, and it caused real confusion during this very demo.
- **§6.2's open mechanism question** (why frame 1 specifically renders unstyled) — worth its
  own investigation since the same mechanism could affect the URL-load path too, but it is
  not this PRD's blocker (see §4).
- **CANVAS-12 reference corrected/removed.** The original draft's follow-up here claimed
  `home.html` was "pinned to srcDoc by `compositionMetricsBridge`" and offered it as the
  measurement corpus for `docs/KNOWN-ISSUES-CANVAS.md`'s CANVAS-12. Verified during this
  pass: **that conflates two different heuristics.** CANVAS-12 is specifically about
  `hasTweaksTemplate` / the `tw-panel` class heuristic (`docs/KNOWN-ISSUES-CANVAS.md:319-343`),
  and `home.html` contains zero `tw-panel` occurrences (`grep -c "tw-panel" .../home.html` →
  `0`) — it does not exercise CANVAS-12 at all. `home.html` *is* forced to srcDoc, but via
  `compositionMetricsBridge` (8 sections ≥ threshold) and independently via
  `htmlNeedsSandboxShim` (external `site.js`) — neither of which CANVAS-12 measures. If
  `compositionMetricsBridge`'s own false-positive/cost profile is worth measuring, that is a
  **new** issue, not an addition to CANVAS-12; do not fold it in there.

---

## Revisions

- 2026-08-18 — captured during team demo; root cause traced through `FileViewer.tsx` the same
  session via `superpowers:systematic-debugging`. No code changed.
- 2026-08-18 — **VISUALLY REPRODUCED AND MEASURED** in the operator's real Chrome against the
  running daemon (pid 83163, `127.0.0.1:7456`). See §6. Confidence moves to CONFIRMED, and the
  fix requirement changes: making inlining faster is NOT a valid fix.
- 2026-08-18 — **PRD repair pass**, applying `docs/plans/2026-08-18-demo-findings/audits/F004-audit.md`
  after independently re-verifying every factual claim in it against the current repo (grep/read,
  not trusted blind). All of the audit's line-citation and count corrections checked out; one
  additional error not in the audit was found and fixed (the §5.4 CANVAS-12 follow-up cited the
  wrong forcing heuristic — see §5.4). Changes: (1) header Status/Reproduces-on/Effort corrected
  for internal contradiction and over-broad scope; (2) §2 rewritten to name **two** trigger paths
  (Path A: re-run after a prior inline; Path B: fresh mount — the one §6 actually measured) instead
  of one, with every `FileViewer.tsx` line citation re-verified (three were off); (3) the
  `design-templates/` "most are single-file" claim replaced with a re-run measurement command,
  since two independent approximations (audit's regex vs. this pass's) disagreed with each other,
  which is itself the argument for not hardcoding either number (cross-cutting rule: no unverified
  counts); (4) §4 updated to stop contradicting §6/Revisions; (5) §5 rewritten end to end: R1 now
  tests DOM-observable `srcdoc` content at two layers (app-local Vitest + Playwright) covering both
  paths, not internal React state covering only one; R2 now specifies the fresh-mount loading-gate
  extension Path B needs plus a `.catch()` for the previously-unhandled inline-rejection case; R3
  unchanged in substance, given explicit key semantics; R4 **removed** (contradicted its own success
  criterion 4 and issue #4650's intent — confirmed by reading `srcdoc.ts` and the reload test file,
  not just the audit's say-so); R5 now enumerates the five distinct "update" shapes instead of
  leaving the word undefined; test paths corrected to the real Playwright/Vitest layout
  (`e2e/ui/*.test.ts` via `@/playwright/suite`, `apps/web/tests/components/`, never `src/`); a
  "Morning review" block added per `AGENTS.md`'s staged-human-verification policy for visible UI
  bugs, scoped so it does not block the overnight run's success criteria; dual-track and
  duplicate-capability checks added explicitly (both N/A, with the reasoning shown, not just
  asserted). No decision in this PRD was found to be genuinely unmade after verification — the
  gaps the audit flagged (fresh-mount state, R4's contradiction, undefined "update") all resolved
  to a determinable engineering answer from the existing codebase's own patterns, so no
  "DECISION REQUIRED" marker was needed. The one open item that remains open on purpose is §6.2
  (why frame 1 specifically renders unstyled) — explicitly scoped out of this PRD's critical path
  in §4, not silently dropped.

---

## 6. Live reproduction (2026-08-18)

**Provenance caveat, added 2026-08-18 (PRD repair pass).** This section's timeline,
lengths, and paint observations were captured in one operator session with no saved
screenshot, trace, or console/network capture — they are not independently re-verifiable
from this doc alone, and the single-session numbers (3,953 ms / 871 ms, 127,746 / 5,264,654
chars, 12 inlined refs) should be read as evidence that motivated the investigation, not as
pass/fail thresholds. §5's success criteria are deliberately qualitative ("zero unresolved
frames observed"), not "under N ms" or "exactly M chars" — do not add a numeric threshold
assertion sourced from this table into R1a/R1b; re-derive any such number from the fixture
those tests actually seed, and note the 12-vs-13-ref difference from §2's live recount is
expected drift in mutable dev data, not a contradiction to resolve.

Method: a `MutationObserver` armed on `iframe[srcdoc]` before the preview mounted, on
`.../conversations/9f56d31f-89f4-4981-91de-a01e58b7cf59/files/home.html`.

### 6.1 Measured timeline — one file open, two full iframe parses

| t (ms) | event | srcdoc length | inlined refs | rel. `styles.css` | `<base>` |
|--------|-------|---------------|--------------|-------------------|----------|
| 19145.6 | iframe seen, srcdoc already set | **127,746** | 1 | 1 | 1 |
| 19390.6 | iframe `load` → **frame 1 painted** | 127,746 | 1 | 1 | 1 |
| 22555.5 | srcdoc **replaced** | **5,264,654** | 12 | 1 | 1 |
| 23344.0 | iframe `load` → **frame 2 painted** | 5,264,654 | 12 | 1 | 1 |

**Wrong content on screen: 19390.6 → 23344.0 = 3,953 ms.** A second run measured 871 ms
(warm cache). Both runs show the same two-value sequence; only the duration varies.

The two srcdoc values differ by **41×** (127 KB → 5.26 MB) and by inlined-asset count
(1 → 12, matching the 12 document-relative refs already recorded in §2).

### 6.2 Frame 1 rendered unstyled — cause NOT yet established

Observed on the live iframes:

```
sandbox="allow-scripts allow-downloads"      // note: NO allow-same-origin
```

**What is established:** frame 1 was on screen and visibly unstyled (default-blue underlined
"Skip to content", logo at natural size), while carrying both a `<base>` tag and a relative
`styles.css` link.

**What is NOT established — corrected 2026-08-18 after external audit.** An earlier draft of
this section claimed the missing `allow-same-origin` makes frame 1 *guaranteed* unstylable.
That inference does not follow. The daemon explicitly returns
`Access-Control-Allow-Origin: *` for raw-file requests whose `Origin` is `null`
(`apps/daemon/src/routes/project/index.ts:3654`), which is exactly the opaque-origin case.
So the stylesheet is not obviously blocked, and the observation supports only "frame 1 was
unstyled", not a sandbox causation.

**To close this, capture for frame 1 specifically:** the stylesheet's resolved URL, its
request status, its `load`/`error` event, any CSP/console violation, and the computed style
of a known element. Until then, treat the mechanism as OPEN.

**What does NOT change:** the two-parse sequence, the 41× size difference, and the multi-second
window are all directly measured and stand on their own. The fix requirement in §5.1 R2 is
justified by the measured double parse alone, independent of why frame 1 is unstyled.

### 6.3 Second hypothesis now ruled out, with evidence

- **RULED OUT: missing `<base href>`.** Already ruled out in §3 by code reading; now
  confirmed empirically — `<base>` is present in *both* frames (`baseTag: 1` each) and
  frame 1 is unstyled regardless. Do not re-investigate this.
- **RULED OUT: "it's just slow / cold cache."** **Corrected 2026-08-18 (PRD repair pass) —
  the reasoning below was internally inconsistent with §6.2's own correction and has been
  replaced; the ruling itself still holds, on different grounds.** Not falsified by "the
  sandbox flags make frame 1 unstylable at any speed" — §6.2 explicitly walked that specific
  claim back as unestablished; citing it here to rule out a different hypothesis was left
  over from before that correction. The actual falsifying evidence is in §6.1: the cold-cache
  run (3,953 ms) and the warm-cache run (871 ms) both show the identical two-value sequence
  (127,746-char unstyled frame, then 5,264,654-char styled frame) — if this were purely a
  network-speed artifact, the warm run would be expected to sometimes skip straight to the
  styled frame or show a shorter/absent unstyled window, not reproduce the same two-frame
  shape at both speeds. §6.2's *mechanism* question (why frame 1 is specifically unstyled)
  stays OPEN either way — only "it's a pure speed artifact, not a real intermediate state" is
  what this bullet rules out.

### 6.4 What was NOT reproduced

Tab-switching between already-open files (`styles.css` → `home.html`) reuses the resolved
5,264,654-char srcdoc and shows **no** double-set. The trigger is a fresh mount, not a tab
switch. A regression test must therefore mount the viewer fresh, not toggle tabs — a test
built on tab-switching would pass on broken code.
