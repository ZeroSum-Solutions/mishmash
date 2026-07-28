# Scale baseline — 2026-07

**Wave:** W0 (NM-27C, measure-only). Machine data in
`scale-baseline-2026-07.json` (versioned; the R8 protocol JSON companion to
this prose). Fixing anything the numbers below reveal is explicitly **not**
this wave's job (the `Promise.all` `DesignsTab` fan-out fix is W4's) — this
file only establishes the yardstick later waves are measured against
(`VERIFICATION-CONTRACT.md` §3 R8, and `G-4` in `GLOBAL-GOAL.md`, which pairs
this baseline with W4's own scale criterion under the same protocol and
corpus).

## Corpus

A read-only `cp -R` snapshot of the operator's live `~/projects/mishmash/.od`
data root, taken 2026-07-27. **2,849 files, 1,142,043,038 bytes (~1.09 GB)**
— the real project store the PRD names (~987 MB was the estimate at PRD-
writing time; the live store has grown since). This is the actual store, not
a synthetic filler directory sized to pass a byte-count floor: every file is
copied verbatim from the real `.od` tree (`projects/`, `library/`,
`artifacts/`, `design-systems/`, `brands/`, `connectors/`, `app.sqlite`, …).

The original `cp -R` preserved two pnpm-managed directory symlinks
(`node_modules/playwright`, `node_modules/playwright-core` under one seeded
project) pointing *outside* the snapshot into the live repo's
`node_modules/.pnpm/…` store. A content-hashing walk that does not
special-case a symlink resolving to a directory reads it like a regular
file and fails with `EISDIR`. Dereferenced into real in-snapshot copies on
2026-07-27 so the corpus is genuinely self-contained (reconstituting it
never needs a path outside `corpus.path`) and so the walk in
`scripts/waves/verify-w0.ts` does not crash; the file/byte counts and
`corpus.sha256` above reflect the dereferenced tree.

The live daemon at `~/projects/mishmash` was never touched, stopped, or
pointed at by a writable connection — only a plain filesystem read (`cp -R`)
against its data directory, per this wave's safety contract. The corpus
lives outside the repo at `/Users/zero-suminc./.cache/mishmash-w0-scale-corpus`
(not committed — 1+ GB does not belong in git); `scale-baseline-2026-07.json`
records its path, content sha256 (every file hashed, sorted by relative
path), and an explicit `isRealStoreSnapshot: true` declaration so this
baseline cannot be silently satisfied by an unrelated same-sized directory
later.

## Machine

`Devins-MacBook-Pro.local-darwin-arm64-16cpu` (`os.hostname()-platform()-arch()-cpus().length` +
`cpu`, matching the verifier's own fingerprint computation exactly).
Baselines are machine-local by design — the R8 protocol's tolerance bands
are meaningless across different hardware, and this file's `machine.fingerprint`
field is what ties a re-run to "this same box."

## Protocol

R8 (`VERIFICATION-CONTRACT.md` §3): 1 discarded warmup iteration, then 5
timed repetitions per scenario, reporting p50 **and** p95 (not p50 alone), a
`toleranceBandPct` per scenario (capped at 50%), a `nonRegressionCeiling` of
25% (a later wave's live measurement worse than baseline by more than this
fails on regression grounds), and a `minimumImprovementThreshold` of 10%
(what a later wave must beat by to claim an improvement, not 0.1% noise).

`cold-start` boots a genuinely fresh daemon process per repetition (not a
re-used connection) against the full corpus; the other four scenarios share
one long-lived daemon, each running its own warmup-then-5-reps loop.

## Scenarios

| Scenario | p50 | p95 | Notes |
|---|---|---|---|
| cold-start | 1320 ms | 1371 ms | Fresh `node dist/cli.js` process boot (module eval + plugin registry seed + SQLite migrate) against the full ~1.07 GB corpus. |
| project-list | 21 ms | 23 ms | `GET /api/projects` |
| designs-tab-fan-out | 1 ms | 3 ms | `GET /api/projects/:id/files` against a real project id from the corpus. |
| memory-high-water | 130848 KB | 130848 KB | Peak RSS of the daemon process, sampled via `ps -o rss=` across the same warmup+5-rep window as the other scenarios (flat across reps — one long-lived process, no GC pressure induced by this smoke). |
| search | 1 ms | 1 ms | See "Known issue" below — the timings are for a 401 rejection, not a functioning search. |

## Known issue: search scenario

The verifier's own scenario-selection logic (mirrored here) picks the
**first** route in the daemon's route-registration order whose path matches
`/search/i`. In the current route registration order that is
`POST /api/xai/search` (`apps/daemon/src/routes/xai.ts`) — an X.AI/Grok
search endpoint gated on X.AI credentials, not a project- or library-scoped
search. With no `XAI_API_KEY`/OAuth token configured (the correct state for
a clean environment, and the state both this baseline run and the wave
verifier's own environment are in), every request 401s
(`no xAI credentials — sign in with your SuperGrok subscription, set
XAI_API_KEY, or configure a key in Settings`) before any real search work
happens. The sub-millisecond timings above measure that immediate rejection,
not a search.

This is a route-selection artifact in the scenario picker, not something
`apps/daemon/src/routes/xai.ts` or route registration order can be changed
to fix from within this wave's write lease (`docs/plans/waves/leases.json`,
W0 grants `apps/daemon/src/backup/**`, `apps/daemon/src/security/**`, and
`apps/daemon/src/routes/library.ts` specifically — not `xai.ts` or
`server.ts`, where registration order is decided). Recorded here rather than
worked around; see the wave's completion report for the full reproduction.
