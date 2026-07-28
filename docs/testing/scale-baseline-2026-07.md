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
| search | 3 ms | 4 ms | Content-proof search probe against the frozen corpus project (`searchProbe` in the JSON): `GET /api/projects/<searchProbe.projectId>/search?q=<searchProbe.needle>`, asserting the response names `searchProbe.expectFile` + `searchProbe.expectLine` with a snippet containing `searchProbe.expectSnippetContains`, plus an unmarked negative-control nonce query asserting zero matches. See "Known issue" below for the full history. |

## Known issue: search scenario (resolved)

**Fully resolved by the 2026-07-28 r2d verifier amendment
(`scripts/waves/verify-w0.ts` commit `41c9dbf1a`).** History, in order:

1. **Original**: the scenario-selection logic picked the **first** route in
   the daemon's route-registration order whose path matched `/search/i`,
   which was `POST /api/xai/search` (`apps/daemon/src/routes/xai.ts`) — an
   X.AI/Grok search endpoint gated on X.AI credentials. Every request 401'd
   before any real search work happened (samples `[1, 1, 0, 1, 1]`, p50/p95
   1ms).
2. **r2 amendment** (commit `e9cff6c52`): changed the selection to prefer a
   `/library\/search/i` route first. This correctly stopped hitting the
   external X.AI route, but resolved to `POST /api/tools/library/search` —
   an agent tool-track endpoint (`apps/daemon/src/routes/library.ts`,
   `authorizeToolRequest(req, res, 'library:search')`) gated by a per-run
   tool token (`apps/daemon/src/tool-tokens.ts`) minted only for a live,
   already-running agent turn. An unauthenticated HTTP probe has no such
   token and got `401 TOOL_TOKEN_MISSING` on every call — a different
   401, still not a functioning search (samples `[3, 2, 1, 2, 1]`, p50 2ms /
   p95 3ms).
3. **r2b amendment** (commit `c0d5c7d24`): the scenario resolved a REAL
   project id from the booted corpus (`GET /api/projects`, the first project
   with a string id) and timed `GET
   /api/projects/:id/search?q=w0-verifier-smoke` — unauthenticated, real
   file search over `PROJECTS_DIR`, no external or tool-token credential
   required, and genuinely returning `200`. **Sol (adversarial review)
   rejected this as gameable**: the fixed query `w0-verifier-smoke`
   intentionally matches nothing, so the probe's only assertion was "returns
   2xx" — an always-empty-`200` stub handler would pass identically to a
   real search, so the scenario never actually proved search worked.
4. **r2c amendment** (commit `dcf483dab`): the committed baseline declared a
   frozen `searchProbe: { projectId, needle, expectFile }` (top level of
   `scale-baseline-2026-07.json`). The scenario asserted a KNOWN MATCH — the
   positive probe (`q=<needle>`) must return `>=1` match whose
   `file === expectFile` on every timed repetition — **and** a negative
   control (a random nonce query must return `2xx` with zero matches). The
   chosen probe used needle `doctype` against `steady-landing.html`,
   matching `<!doctype html>` at line 2 (samples `[5, 3, 4, 2, 2]`, p50 3ms /
   p95 5ms). **Sol rejected this too**: `doctype`/`<!doctype html>` is
   universal HTML boilerplate — every HTML document starts with it, so a
   list-only stub could special-case the literal query string `doctype` and
   fabricate a plausible-looking match (`file`, a guessed line 1 or 2, a
   snippet containing `<!doctype html>`) without ever reading the file. The
   probe proved the ROUTE was reachable, not that the SEARCH actually read
   file content.
5. **r2d amendment** (commit `41c9dbf1a`, current): `searchProbe` gains two
   frozen fields, `expectLine` (integer) and `expectSnippetContains` (a slice
   of the real matched line that strictly extends the needle — load-validated
   to include the needle case-insensitively and not equal it). The positive
   match must now carry `file === expectFile`, `line === expectLine`, AND
   `snippet` containing `expectSnippetContains` — a value the request body
   never carries, so only an implementation that actually reads and returns
   the matched line's real content can produce it. The negative nonce is now
   unmarked (`crypto.randomBytes(9).toString('hex')`, no recognizable
   prefix), closing the "stub special-cases a `w0-`/`w0-neg-`-prefixed nonce"
   gap too.

**Chosen probe target**, read from `apps/daemon/src/projects.ts`'s
`searchProjectFiles` (query is regex-escaped then matched case-insensitively
per line, restricted to textual MIME files; `match.file` is the file's path
relative to the project root, `f.name`/`f.path` from `listFiles`) before
picking a needle: same project and file as before —
`bde3b40d-f47e-418f-b8d2-66701c4de690` / `steady-landing.html` (single
top-level file, `name === path`, `text/html` MIME) — but a genuinely
**distinctive** line this time, not boilerplate. Needle `rings`: a plain
alphanumeric token (no regex metacharacters) occurring **exactly once** in
the entire 1003-line file, on line 593 — `<p class="lede">Steady is a habit
tracker without the guilt. No streaks to protect, no red rings to close —
just a calm, honest record of the things you're trying to do more
often.</p>` (194 characters, well under the route's 220-char snippet
truncation, so the full line survives verbatim).
`expectSnippetContains: "red rings to close"` is a content-specific phrase
from that same line, several words longer than the needle, that no stub
could derive from the query string `rings` alone.

Re-measured live against the amended logic (isolated daemon boot, same
corpus, same R8 protocol — 1 discarded warmup + 5 timed reps, same full
match assertion the verifier uses: `file === expectFile && line ===
expectLine && snippet.includes(expectSnippetContains)`), 3 independent runs:
`searchProbe.projectId` confirmed listed in `GET /api/projects` every run;
the positive probe (`q=rings`) returned `200` with exactly one match — file
`steady-landing.html`, line `593`, snippet containing `red rings to close`
— satisfying the full content-proof assertion on every one of the 5 timed
repetitions in every run; the unmarked negative-control nonce (a fresh
random 18-hex-char string each run) returned `200` with zero matches every
time. Combined `httpOkAll` was `true` in all 3 runs. Observed samples across
runs: `[3,4,3,3,3]` (p50 3/p95 4), `[2,2,1,2,2]` (p50 2/p95 2), `[2,3,1,2,2]`
(p50 2/p95 3). Recorded the first run — `[3, 4, 3, 3, 3]`, p50 3ms, p95
4ms — with `toleranceBandPct: 50` (the cap), chosen because its ±50% window
(`[1.5, 4.5]` for p50, `[2, 6]` for p95) comfortably covers the full spread
observed across all 3 runs, not just the recorded one.
