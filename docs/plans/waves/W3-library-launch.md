# Wave 3 — Library dark-launch readiness

**Slug:** `mishmash-w3-library-launch`
**Gates on:** W0 (landed) **+ the W9 ingest tranche** (green) **+ W4 landed**
**Runs:** serially, after W4. The first draft called this parallel-with-W4 under a "file lease" —
but `apps/web/src/providers/registry.ts` carries `fetchLibraryAssets` (line 2563, this wave) and
`fetchProjectFiles` (line 1457, W4) in one 2,500+ line module. A lease across a file both agents
must edit is not a control. It also gated only on W0 while W9's own text said ingest hardening
must precede Library exposure — this wave is the single most dangerous thing the program turns on,
so that contradiction is resolved in favor of the stricter reading.
**Loop:** `loop:red-green-review` (`VERIFICATION-CONTRACT.md` §6)

## Why this wave exists — and why it is NOT a flag flip

Backlog items B1–B3 read as "build a drag-and-drop reference system." **It already exists.**
Behind `apps/web/src/features/libraryUi.ts` → `LIBRARY_UI_VISIBLE = false` sits: `LibrarySection`
(global asset registry with source/kind badges, back-links, SSE `/api/library/events`),
`LibraryUploadModal` (choose-files, drag & drop, paste of image/file/clipboard/text/JSON, size
policy), the `clipper/` MV3 extension (full-page HTML snapshot, design-system extract, Figma JSON,
element picker, bulk images, screenshot), and daemon `library.ts` + `library-store.ts` (SQLite).

**Both auditors flagged the naive reading as the biggest scoping risk in the plan.** The flag's
own comment says the surface is *intentionally* hidden "for this release," and the router tests
**actively assert `/library` stays hidden**. A feature flag set by a prior release decision is a
statement about product readiness — not a forgotten boolean. Flipping it without knowing why it
was set risks resurfacing an unfinished surface wired into nav, composer, and the clipper.

## Scope

**S3-1 — Recover the hide decision (do this first).**
Git archaeology on `libraryUi.ts` and the router tests: which commit set it, what the message and
PR said, what was incomplete. If the reason is recorded, the rest of this wave targets *that* gap
list. If it is not recoverable, say so explicitly and treat the surface as unproven.

**S3-2 — Enumerate every gate.** Seven gate expressions across six files (`router.ts` gates
**twice** — route parse *and* route build — plus `EntryNavRail`, `EntryShell`,
`ComposerPlusMenu`, `DesignFilesPanel`, `DesignSystemAssetDropzone`). The assessment said six
sites; the real count is seven expressions. Test **both** flag states.

**S3-3 — Secure the ingest path.** Apply W0's capability-token binding to clipper ingest before
any exposure. The Library is the daemon's write surface for externally-supplied content; it is
the highest-risk thing this program turns on.

**S3-4 — Enabled-state integration proof.** Component-level a11y and unit tests exist; **no test
proves navigation + upload + SSE + error + persistence work together with the flag on.** Build
that integration test.

**S3-5 — Error/empty/degraded states (NM-28C, Library slice).** Project APIs currently collapse
failures into `[]`/`null`, so "daemon down" renders as "no items." Distinguish: loading, empty,
daemon-unreachable, storage-error, partial-success — each with a recovery action.

**S3-6 — Accessibility gate (NM-29C, Library slice).** axe, keyboard/focus order, screen-reader
naming, contrast, reduced-motion, zoom/reflow on the newly exposed surface.

**S3-7 — Controlled rollout, daemon-owned.** Replace the compile-time constant with a
**server-persisted** flag so exposure is reversible without a rebuild and survives restart. Two
traps both reviewers named: a browser-local toggle is not a rollout control, and an env var read
once at module load lets a test re-import the module and "prove" a toggle that production cannot
perform. The production bundle must also *contain* both branches — otherwise tree-shaking removes
the enabled path and the flag is decorative.

**S3-8 — UI/CLI parity.** Library capabilities must reach `od` (`--json`, `--prompt-file` where
applicable) over the same `/api/*` contract — repo policy, and the harness from W0 enforces it.

## Explicitly out of scope

AI enrichment, embeddings, semantic search, bookmark import (all W5 — and all gated behind W5's
data-lifecycle contract). This wave makes the existing surface **safe, correct, and reachable**;
it does not make it smarter.

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w3.ts`.

| ID | Criterion | Verification |
|---|---|---|
| C3-1 | Hide reason recovered, or **bounded** evidence of the search | Named commits, PR bodies, and issue refs inspected are listed. "Unrecoverable" is legal only with that evidence trail — otherwise it is a free pass claimed in one sentence, and it must then default to treating **every** S3-2…S3-8 gap as open |
| C3-2 | Gate registry is **data-driven**, not a hardcoded seven | Gates enumerated from a registry the runtime also reads; a newly added gate site appears automatically. Hardcoding today's 7 while S3-7's rollout control adds an 8th is a self-inflicted miss |
| C3-3 | Both flag states tested per gate | Hidden-state and enabled-state behavior asserted for every registry entry |
| C3-4 | Ingest requires a bound capability token | Red spec from an untrusted extension origin rejected; W9 ingest tranche green as a **precondition**, recorded in the manifest |
| C3-5 | Enabled-state E2E runs against a **real daemon** | `tools-dev` fresh data root: navigate → upload → **real SSE wire format** → row in SQLite → reload shows it. **MSW / mocked `EventSource` / mocked `fetch` are forbidden here** (§3 R2) — a mocked SSE emitter satisfying this criterion was the reviewers' worked example |
| C3-6 | Degraded-state matrix is complete | All five distinguishable: loading, empty, daemon-unreachable, storage-error, partial-success — each with a recovery action. Testing daemon-down alone leaves four collapsing to "no items" |
| C3-7 | Error taxonomy comes from the **API** | Distinguishing states are carried by contract error codes, not UI copy. Copy-only distinguishers still ship `[]` from the API and lie to every other consumer, including `od` |
| C3-8 | a11y gate green on **populated** surfaces | axe on populated Library + upload modal + ingest-in-progress; keyboard-only traversal reaches every control. axe on an empty list proves nothing |
| C3-9 | Rollout is **daemon-owned** and persisted | Toggle persists server-side and survives restart; both states reachable without a rebuild. Browser-local state or a module-load env var read is not a rollout control |
| C3-10 | The client bundle contains **both** branches | Production build asserted to include the enabled path — otherwise tree-shaking eliminates it and "runtime toggle" is fiction |
| C3-11 | Parity is behavioral | Each `od library …` subcommand exercised command-by-command with `--json` against the same `/api/*` contract. `od library` already exists (`cli.ts:7783`), so mere existence proves nothing |
| C3-12 | Gates | `pnpm guard`, `pnpm typecheck` exit 0; web + daemon tests green, no `skip`/`only`/`todo` added |

## Adversarial review

GPT-5.6 Sol. Focus: is any gate site missed (the count was already wrong once)? Can ingest be
reached without a token by any path — including the no-`Origin` local caller? Does the
integration test actually exercise SSE, or does it assert a mocked event? Are error states
distinguishable to a *user*, or only in code? What still rots with the flag on that the tests do
not cover?
