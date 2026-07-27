# Wave 4 — Local project covers & scale

**Slug:** `mishmash-w4-project-covers`
**Gates on:** W0 landed (its scale baseline is the yardstick this wave must beat)
**Parallel with:** the **W9 ingest tranche** — genuinely disjoint file sets.
**Runs before W3**, which waits on this wave to release `apps/web/src/providers/registry.ts`.
The first draft paired W4 with W3 under a "file lease," but both need that same 2,500+ line
module (`fetchProjectFiles` line 1457 here, `fetchLibraryAssets` line 2563 there).
**Loop:** `loop:red-green-review` (`VERIFICATION-CONTRACT.md` §6)

## Why this wave exists

Backlog I1: "every cloned project, prototype, and item must have the correct thumbnail." The
assessment first called this greenfield — **that was wrong**, and the audit corrected it: the repo
already has clipper screenshot capture, Design Browser capture, preview-annotation
rasterization, deck thumbnails, and the web-clone Playwright path.

**The real gap is lifecycle, not capture:** there is no persisted project-card thumbnail field,
no render job, no invalidation policy, and no renderer. `project-cover.tsx` mounts a **live
sandboxed iframe** of the project's `index.html`, CSS-scaled, with a glyph fallback on 404. That
is clever, and it is also why the card grid gets expensive.

**Hard constraint from the audit:** this wave uses a **local renderer over trusted project files
only**. It must not be coupled to, or reuse, remote URL capture (SSRF/egress threat model) or the
web-clone substrate (under REJECT until W-C lands). Remote capture is W6b's problem, separately
reviewed.

## Scope

**S4-1 — Cover as data.** Add a persisted cover field/record per project (path, generated-at,
source-file hash, dimensions). Contract type in `packages/contracts`.

**S4-2 — Render job.** A bounded, queued local renderer that rasterizes a project's own HTML to
a stored image. Concurrency cap, per-job timeout, and a memory ceiling — a runaway project must
not take the daemon with it.

**S4-3 — Hero/salient crop.** Use `sharp`'s `attention` (or `entropy`) strategy for the crop —
verified MIT/Apache-licensed, actively maintained, and likely already a transitive dependency.
The backlog asks for "whatever fits best — probably the header/hero"; `attention` is exactly that
heuristic.

**S4-4 — Invalidation.** Regenerate when the source file hash changes; never serve a cover that
does not match current content. Stale-cover behavior must be explicit (regenerate-on-view or
background refresh) — not accidental.

**S4-5 — The fallback becomes static. This is a correction, not a preference.**

The first draft said "keep the live iframe for the not-yet-rendered case." Sol found that this
**contradicts C4-5 in the same document**: a renderer that passes an interception-based no-egress
test is irrelevant if the first card view mounts a live iframe that executes the project's HTML
and pulls remote CSS, fonts, scripts, and trackers.

Two separate properties were conflated:

- **`sandbox="allow-scripts"` without `allow-same-origin` is correct and stays.** It gives the
  frame a unique opaque origin, so parent DOM, cookies, and storage are unreachable. That is
  deliberate hardening (`srcdoc.ts:791`, `:1253`), verified directly, and an earlier reviewer
  claim that it was a vulnerability was **refuted**. Do not "harden" it into breaking.
- **An opaque origin does not stop outbound requests.** Sandboxing protects the *parent*; it says
  nothing about egress. That is where "covers stay local" actually leaks.

Revised: the not-yet-rendered state is a **static glyph/skeleton placeholder** — no
network-capable frame. If a live preview is retained anywhere in the grid, it carries a CSP
denying all remote subresource loads, asserted by test. Freeze the sandbox contract in a threat
note (`NM-35C`) so a later refactor cannot silently loosen it.

**S4-6 — Fix the fan-out (NM-27C execution half).** `DesignsTab` currently issues live-artifact
and file-list requests for every project through **unbounded `Promise.all`**, then mounts live
preview iframes — against a **987 MB** store. Add pagination/virtualization, bounded concurrency,
and prove improvement against W0's committed baseline.

**S4-7 — Covers join the backup set.** A new persisted artifact class that W0's archive does not
know about is a silent recovery gap — nobody would notice until a restore came back with blank
cards. Store covers under `RUNTIME_DATA_DIR` per the daemon data contract, extend W0's C0-1
inventory, and prove a restored cover renders.

**S4-8 — Parity.** `od` must be able to trigger/inspect cover generation (`--json`), per repo
policy.

## Explicitly out of scope

Remote URL capture of third-party sites (W6b + NM-22C capture isolation). Restoring brand-extraction
screenshots (NM-17, W6b). Any reuse of `skills/web-clone/` before W-C lands.

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w4.ts`.

| ID | Criterion | Verification |
|---|---|---|
| C4-1 | Covers persist and survive restart | Generate → restart daemon → card renders the stored cover without re-render |
| C4-2 | Crop favors the hero on **adversarial** fixtures | ≥3 hard cases (left-nav hero, carousel, dark hero) with expected bounding boxes and an IoU threshold. One fixture whose hero fills the frame proves the crop cannot miss |
| C4-3 | Invalidation covers the **transitive** render graph | Content hash spans the rendered entry **and** its linked local CSS, images, and fonts. Hashing `index.html` alone serves a stale cover forever after a `styles.css` edit |
| C4-4 | Invalidation is content-driven, not mtime | Touching a file without changing bytes must not regenerate; changing bytes without touching mtime must |
| C4-5 | Renderer is bounded | Concurrency cap, per-job timeout, and an enforced memory ceiling, each proven — including a deliberately pathological project. The ceiling is enforced at the process/limit level, not by a 1-second timeout on a tiny fixture |
| C4-6 | Renderer cannot reach the network | **Process-level** network denial (deny-all proxy or equivalent), asserting **zero** outbound connections — not interception on one HTTP client while the headless browser egresses freely |
| C4-7 | The fallback is not network-capable | Not-yet-rendered state renders a static placeholder; a project whose HTML references a remote tracker produces **no** outbound request on first card view. This is the criterion the original C4-8 contradicted |
| C4-8 | Sandbox contract frozen and documented | If any live frame remains, its `sandbox` flags are asserted by test and its threat model recorded (`NM-35C`), including the deliberate omission of `allow-same-origin` |
| C4-9 | Fan-out bounded | `DesignsTab` issues ≤ N concurrent requests regardless of project count; behavior on mid-page request failure asserted |
| C4-10 | Measurably better, under the **R8 protocol** | Same corpus, same machine, warmup, ≥5 reps, p50 + p95 + peak RSS, beating `scale-baseline-2026-07.md` by the **stated minimum margin** with no axis regressing past its ceiling. "Beats baseline" on a smaller synthetic fixture passes on noise |
| C4-11 | Covers are in the backup set | Stored under `RUNTIME_DATA_DIR` per the daemon data contract; C0-1 restore test extended to prove a restored cover renders |
| C4-12 | Parity + gates | `od` cover subcommand with `--json` exercised behaviorally; W0 capability-manifest harness green; `pnpm guard`, `pnpm typecheck` exit 0 |

## Evals

Fixture set of ~200 synthetic projects (mixed HTML/image/video/empty) to exercise the grid at
scale without touching the founder's real 987 MB store. Record before/after render time, request
count, and peak memory.

## Adversarial review

GPT-5.6 Sol. Focus: can the local renderer be induced to fetch remote content (that would import
W6b's threat model into this wave — the exact coupling the audit forbade)? Can a hostile local
project HTML exhaust CPU/memory despite the caps? Is invalidation actually driven by content, or
by mtime (which lies on checkout)? Does the fan-out fix change behavior when a request fails
mid-page?
