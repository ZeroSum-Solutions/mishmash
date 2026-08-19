F004 — canvas-preview-double-parse-flicker

## Factual accuracy

- The document’s status is stale and internally contradictory: “visual repro pending” at [F004:12](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F004-canvas-preview-double-parse-flicker.md:12) and “Not yet visually reproduced” at [F004:111](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F004-canvas-preview-double-parse-flicker.md:111) conflict with “VISUALLY REPRODUCED” at [F004:172](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F004-canvas-preview-double-parse-flicker.md:172).

- Evidence-chain locations are slightly wrong:

  - Claimed `setInlinedSource(null)` at `FileViewer.tsx:7675`; actual call is [FileViewer.tsx:7676](/Users/zero-suminc./projects/mishmash/apps/web/src/components/FileViewer.tsx:7676), while `:7675` is the `useEffect` declaration.
  - Claimed `inlineRelativeAssets(...)` is “awaited” at `:7684-7690`; actual code uses `void inlineRelativeAssets(...).then(...)` at [FileViewer.tsx:7685](/Users/zero-suminc./projects/mishmash/apps/web/src/components/FileViewer.tsx:7685)–`:7689`, with no `await`.
  - Claimed the relative-reference guard is at `:7679`; actual guard is [FileViewer.tsx:7683](/Users/zero-suminc./projects/mishmash/apps/web/src/components/FileViewer.tsx:7683).

- The reproduced fresh-mount sequence does not prove that the explicit null clear causes frame 1. `inlinedSource` already initializes to `null` at [FileViewer.tsx:6304](/Users/zero-suminc./projects/mishmash/apps/web/src/components/FileViewer.tsx:6304); after the source fetch resolves at [FileViewer.tsx:7113](/Users/zero-suminc./projects/mishmash/apps/web/src/components/FileViewer.tsx:7113), `inlinedSource ?? deckVisualSource` exposes raw source at [FileViewer.tsx:7285](/Users/zero-suminc./projects/mishmash/apps/web/src/components/FileViewer.tsx:7285) before the inlining effect can resolve. Removing only `setInlinedSource(null)` therefore cannot fix the fresh-mount reproduction.

- “Reproduces on any multi-file site with document-relative assets” is false. The inlining effect exits immediately for URL-load previews at [FileViewer.tsx:7677](/Users/zero-suminc./projects/mishmash/apps/web/src/components/FileViewer.tsx:7677), and ordinary preview HTML uses URL-load unless one of the listed disqualifiers applies at [file-viewer-render-mode.ts:127](/Users/zero-suminc./projects/mishmash/apps/web/src/components/file-viewer-render-mode.ts:127). This project is forced to srcDoc by eight sections and independently by its external `site.js`, which matches [file-viewer-render-mode.ts:299](/Users/zero-suminc./projects/mishmash/apps/web/src/components/file-viewer-render-mode.ts:299)–`:306`; that does not generalize to every multi-file site.

- Claimed asset count **12**; current input has **13 qualifying asset references and 0 root-relative references**: one stylesheet at [home.html:11](/Users/zero-suminc./projects/mishmash/.od/projects/9927784c-9475-40c7-8353-ec88335afabf/home.html:11), eleven image occurrences at `home.html:139,176,181,186,223,237,250,263,277,290,316`, and one script at [home.html:494](/Users/zero-suminc./projects/mishmash/.od/projects/9927784c-9475-40c7-8353-ec88335afabf/home.html:494). `hasRelativeAssetRefs` does not “count”; it returns after finding the first qualifying value at [file-viewer-preview-assets.ts:496](/Users/zero-suminc./projects/mishmash/apps/web/src/components/file-viewer-preview-assets.ts:496). Anchor links such as `lighting.html` are explicitly not scanned at [file-viewer-preview-assets.ts:27](/Users/zero-suminc./projects/mishmash/apps/web/src/components/file-viewer-preview-assets.ts:27).

- “Most of `design-templates/` are single-file/self-contained” is false. Applying the repository’s actual reference scan found **375 of 424 HTML files with relative asset references**, versus 49 without. Representative counterexamples are [equilibrium-liquid-glass-hero/example.html:11](/Users/zero-suminc./projects/mishmash/design-templates/equilibrium-liquid-glass-hero/example.html:11) and [neuralyn-dark-landing/example.html:18](/Users/zero-suminc./projects/mishmash/design-templates/neuralyn-dark-landing/example.html:18).

- The exact §6 timeline, lengths, PID, paint observations, second-run timing, and tab-switch result are not independently verifiable: the finding contains no screenshot, trace, console/network capture, observer output, or hashed input snapshot. The current mutable project input no longer matches the recorded 12-reference count.

- §6’s inference “opaque origin ⇒ frame 1 is guaranteed unstylable” does not follow from its evidence. The iframe is indeed opaque-origin because its sandbox omits `allow-same-origin` at [FileViewer.tsx:12845](/Users/zero-suminc./projects/mishmash/apps/web/src/components/FileViewer.tsx:12845), but the daemon explicitly grants `Access-Control-Allow-Origin: *` to raw-file requests whose origin is `null` at [routes/project/index.ts:3654](/Users/zero-suminc./projects/mishmash/apps/daemon/src/routes/project/index.ts:3654). The observation supports “frame 1 was unstyled,” not the claimed sandbox causation or guarantee. Proving that requires the stylesheet’s resolved URL, request/status, `load`/`error`, console/CSP result, and computed style.

## Repo-rule compliance

- UI/CLI dual-track is not triggered: this is an internal correctness fix to an existing preview capability, not a new user-facing capability. No new HTTP endpoint, contract DTO, or `od` subcommand is required if scope remains as written.

- The proposed Playwright location is unmergeable. `e2e/specs/` is the Vitest business-spec lane; Playwright UI files must be flat `*.test.ts` files under `e2e/ui/` and import the repository suite at [e2e/AGENTS.md:159](/Users/zero-suminc./projects/mishmash/e2e/AGENTS.md:159). The command naming `specs/canvas-preview-stability.spec.ts` violates both [AGENTS.md:153](/Users/zero-suminc./projects/mishmash/AGENTS.md:153) and [apps/AGENTS.md:29](/Users/zero-suminc./projects/mishmash/apps/AGENTS.md:29).

- The app-local red test belongs under `apps/web/tests/`, not `src/`; the PRD never specifies its actual file.

- Repository policy requires staged human verification for visible race/UI defects at [AGENTS.md:313](/Users/zero-suminc./projects/mishmash/AGENTS.md:313). An overnight agent can prepare the comparison and automated evidence, but cannot truthfully mark final visual acceptance complete while nobody is awake.

## Unattended executability and missing work

- R1 misses the reproduced bug: it only tests behavior “once an inlined version has already been produced,” while §6 says the trigger is a fresh mount. It also names internal `previewSource` state rather than a falsifiable DOM/browser oracle.

- R2 and R3 leave the fresh-mount/key-switch state undefined. Clearing on a new key recreates raw fallback unless the PRD explicitly requires an inlining-pending state that keeps the accessible loader visible. The current loader stops as soon as `source` becomes non-null at [FileViewer.tsx:11511](/Users/zero-suminc./projects/mishmash/apps/web/src/components/FileViewer.tsx:11511).

- R4 contradicts success criterion 4: “do not rebuild the srcDoc string” conflicts with “reload still forces a fresh parse when bytes are identical.” Current behavior deliberately embeds `reloadKey` at [srcdoc.ts:487](/Users/zero-suminc./projects/mishmash/apps/web/src/runtime/srcdoc.ts:487). Worse, unchanged HTML does not imply unchanged `styles.css`, `site.js`, or images; skipping the inlining pass can silently leave edited dependencies stale.

- R5 does not define “update” or “parse.” Fresh mount, source edit, file-watch refresh, manual reload, version restore, mode transition, and cross-file switch have different required semantics and must have separate assertions.

- R2 only mentions the effect clear, but there are additional clears during manual edit, undo/redo, reload, and version restore, including [FileViewer.tsx:9012](/Users/zero-suminc./projects/mishmash/apps/web/src/components/FileViewer.tsx:9012), [FileViewer.tsx:10168](/Users/zero-suminc./projects/mishmash/apps/web/src/components/FileViewer.tsx:10168), and [FileViewer.tsx:10224](/Users/zero-suminc./projects/mishmash/apps/web/src/components/FileViewer.tsx:10224). The PRD must classify which remain intentional.

- The Playwright criterion “never paints unresolved CSS” is not implementable as written with polling because the transient frame can be missed. It needs a `MutationObserver`/load-event recorder armed before a freshly seeded file mounts, using the isolated Playwright tools-dev fixture required at [AGENTS.md:298](/Users/zero-suminc./projects/mishmash/AGENTS.md:298). The mutable `.od` project cannot be the test fixture.

- Missing regressions include: out-of-order inlining completion, rejected asset fetch, identical HTML with changed CSS/JS/image bytes, file switch while inlining, URL-load↔srcDoc transitions, reload failure fallback, and the existing Comment/Draw/Edit freeze invariants at [FileViewer.test.tsx:5200](/Users/zero-suminc./projects/mishmash/apps/web/tests/components/FileViewer.test.tsx:5200).

## Silent-damage risks

- R4 can make Reload show stale CSS, JavaScript, or images.
- Retaining an unkeyed or incompletely keyed value can display another file/project or let a late promise overwrite the current file.
- Rendering nothing without extending `initialPreviewLoading` produces an empty focusable iframe instead of the existing `aria-busy` loading surface at [FileViewer.tsx:12691](/Users/zero-suminc./projects/mishmash/apps/web/src/components/FileViewer.tsx:12691).
- Holding the previous value indefinitely after an inlining failure silently conceals newly saved content.
- A per-file cache of 5 MB inlined strings could create unbounded memory growth unless eviction/ownership is specified.

VERDICT: NOT-READY

Before execution, the PRD must define a keyed pending/error state machine that covers fresh mounts, reconcile R4 with dependency freshness and issue #4650, move the Playwright test to `e2e/ui/` with a pre-mounted mutation/load oracle and hermetic fixture, and specify which existing null-clear and preview-freeze paths must remain.

