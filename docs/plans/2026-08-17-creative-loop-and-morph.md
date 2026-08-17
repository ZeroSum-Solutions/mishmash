# MishMash creative loop: template previews, 3D, tracing, and brand morph

**Status:** DRAFT — awaiting founder approval
**Date:** 2026-08-17
**Owner:** Devin
**Run slug:** `mishmash-creative-loop`

## Outcome

A non-expert can open MishMash, pick any template from the catalogue, see it render
correctly, and turn it into a different brand's site by describing the brand. The
benchmark is a burger restaurant site built to match https://www.cravburgers.shop/.

This plan fixes the mechanical reasons templates fail today, then builds the morph
path on top of a catalogue that actually renders.

## Evidence (measured 2026-08-17, HEAD `6582740a0`)

All figures come from the running daemon and a static classification of
`design-templates/`. They are baselines, not estimates.

- 352 template directories; 344 carry an `example.html`; 8 carry none.
- **277 of 344 (80%) reference at least one `https://` resource.** 281 (82%) load
  Google Fonts.
- 208 of 344 (60%) route to URL-load; 136 route to srcDoc.
- 51 templates are `"kind": "vite"` builds whose whole page is `<div id="root"></div>`
  filled by JS. For these, any asset failure is a blank page, not a degraded one.
- Only **2 of 344** templates escalate to the powered (cross-origin-isolated) preview.
  12+ templates with WebGL/canvas signals sit on the opaque sandbox.

### Root cause 1 — two preview pipelines, two content-security policies

`design-templates/` previews are served under `projectRawFileCsp`
(`apps/daemon/src/server.ts:3489`): `connect-src 'none'`, and no `https:` on
`script-src`, `style-src`, `img-src`, `media-src`, or `font-src`.

NeuForm favourites and UI8 kits render through the Design Library under
`SANDBOXED_PREVIEW_CSP` (`apps/daemon/src/http/sandboxed-preview-csp.ts:22`), which
does permit `https:` on those directives. Its docblock states the split explicitly:
*"This is NOT the policy for agent-generated project raw files."*

That is the whole reason NeuForm and UI8 templates feel reliable and the rest do not.
The templates are not broken; their assets are being dropped.

**The strict policy is correct for what it guards.** `projectRawFileCsp` serves
agent-generated output, which is untrusted. This plan does not weaken it. It
reclassifies vendored `design-templates/` — curated, reviewed, in-repo content — into
the same trust class as the Design Library, and serves template previews under the
curated-content policy.

### Root cause 2 — 3D escalation never reads the code that uses 3D

`htmlNeedsPoweredPreview()` (`apps/web/src/components/file-viewer-render-mode.ts:233`)
is a string scan of `example.html` only. For `vite`-kind templates the three.js /
Worker / WASM calls are compiled into `assets/index-<hash>.js`, which the scan never
opens. Confirmed present in the bundles of `particle-hero`, `woven-light-hero`, and
`valmax-photography-landing`.

Under the default sandbox (`allow-scripts allow-downloads`, opaque origin) a
`new Worker(...)` or WASM streaming call throws `SecurityError`, the scene init aborts,
and nothing is surfaced to the user. The canvas is simply empty.

### Root cause 3 — tracing has a named, deliberate hole

The `#133` anomaly log is complete and tested, with one gap its own commit message
names: uncaught browser exceptions and unhandled promise rejections go only to PostHog.
`AnomalyKind` declares `'unhandled-error'`
(`packages/contracts/src/api/anomalies.ts:22`) but nothing produces it. The hook belongs
beside the window listeners in `apps/web/src/analytics/error-tracking.ts:96`.

Langfuse agent-run tracing is real code but inert: no `LANGFUSE_*` credential exists on
this machine, and the missing-sink path is a silent no-op that does not fall back to the
anomaly log. **Decision taken: Langfuse stays out of scope.** This plan closes the local
gap only.

### Root cause 4 — the browser's screenshot does not reach the agent

`DesignBrowserPanel.takeScreenshot()`
(`apps/web/src/components/DesignBrowserPanel.tsx:1530`) writes to the clipboard and
Design Files. PR #132 wired canvas screenshots into the chat composer but did not extend
it here, so two visually identical Screenshot buttons behave differently.

## Non-goals

- Langfuse credentials, relay, or the 7-slice observability spec.
- Weakening `projectRawFileCsp` for agent-generated files.
- Bookmarks in the design browser.
- Multi-tenant, billing, or hosting work from the operationalization roadmap.

## Success criteria

Each criterion names the command that proves it. Proof artifacts land in
`~/.claude/goal-state/mishmash-creative-loop/proof/`.

| id | criterion | verification |
|---|---|---|
| C1 | A render harness exists that loads every template preview in a real browser and records blocked subresources, console errors, and rendered body size. Baseline captured before any fix. | `pnpm tsx scripts/template-render-report.ts --json` exits 0 and writes a per-template report |
| C2 | Templates rendering with zero blocked subresource requests rises from the C1 baseline to **≥ 95% of 344**. | same harness, post-fix run; compare to baseline artifact |
| C3 | **Zero** templates render a visually blank body (rendered text length 0 and no canvas/img painted). | same harness, `blank` count = 0 |
| C4 | 3D detection reads linked bundles. `particle-hero`, `woven-light-hero`, `valmax-photography-landing`, `webgl-experience` each escalate to powered preview, and each paints a non-blank canvas. | new unit test + harness canvas-pixel check |
| C5 | `projectRawFileCsp` is unchanged for agent-generated project files; a red test proves an agent-written file still cannot reach `https:` or `connect-src`. | `pnpm vitest run` targeted CSP spec |
| C6 | An uncaught `window.onerror` and an `unhandledrejection` each produce an anomaly record of kind `unhandled-error`, visible via `od anomalies --json`. | new spec + CLI output captured |
| C7 | The design browser's screenshot stages into the chat composer by the same path FileViewer uses. | new spec asserting the staging call |
| C8 | A morph path exists: given a template slug and a brand brief, it produces a new project whose layout structure is preserved and whose brand tokens (palette, type, copy) are replaced. Reachable from both UI and CLI per the repo's dual-track rule. | `od` command runs end-to-end; spec asserts structure preserved + tokens changed |
| C9 | **The gauntlet.** A burger site built through the morph path is compared blind against a captured screenshot of cravburgers.shop by 3 independent critics with fresh context and labels stripped. **≥2 of 3 pick ours.** Verdicts recorded verbatim. | recorded critic verdicts in proof dir |
| C10 | Repo gates green: `pnpm guard`, `pnpm typecheck`, web unit suite, daemon unit suite, `validate-design-catalog`. | each command's exit code captured |

## Execution notes

- Work happens on a feature branch off `main`. `main` is currently clean at
  `6582740a0` and equals `origin/main`.
- `CONTRIBUTING.md` requires a PR with the template filled in, and the repo prefers
  issue-first for non-trivial features. Opening the PR is the founder's call; this run
  stops at a clean branch.
- Red-spec-first per the repo's `AGENTS.md`: every fix lands with a failing test first.
- Dual-track UI/CLI rule applies to C8.
- The `.env.local` in this repo carries provider keys; an isolated `OD_DATA_DIR` does
  not scrub them. Do not claim any run is credential-free on the data dir alone.

## Open question carried into the run

C2's 95% target assumes the CSP reclassification is sufficient. If the C1 baseline shows
a large class failing for an unrelated reason, the target is renegotiated with evidence
rather than quietly lowered.
