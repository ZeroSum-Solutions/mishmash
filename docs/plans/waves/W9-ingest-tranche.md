# Wave 9 — Library ingest tranche (route hardening, first tranche)

**Slug:** `mishmash-w9-ingest-tranche`
**Gates on:** W0 (landed)
**Runs beside:** W4 (`docs/plans/waves/W4-project-covers.md`) — genuinely disjoint file sets, Burst 3.
**Blocks:** W3 (`docs/plans/waves/W3-library-launch.md`, criterion C3-4) — this tranche must be
**green**, recorded in its own manifest, before W3 exposes `/library` to real users.
**Loop:** `loop:tranche` (`VERIFICATION-CONTRACT.md` §6)
**Verifier:** `scripts/waves/verify-w9-ingest.ts`
**Write lease:** `docs/plans/waves/leases.json` → `waves["W9-ingest"]` — verbatim:
`apps/daemon/src/routes/library.ts`, `apps/daemon/src/library-store.ts`,
`apps/daemon/tests/library-*.test.ts`, `docs/security/**`, `scripts/waves/verify-w9-ingest.ts`,
`docs/plans/waves/DECISIONS.md`. The last entry landed on `main` at `ff47420b8` (round-1
disposition, ruling 2) — confirmed directly by reading `origin/main`, not assumed.

**Status: FIX ROUND 2 (final round under the 2-fix-round cap).** Round 1 returned REJECT with 9
findings; round 2 returned REJECT again — "FIXED-WITH-NEW-DEFECT" on several, "NOT FIXED" on
others, plus 4 new blocking defects this round's own fixes introduced. Every round-1 AND round-2
finding is disposed in **AUTHOR-FLAGGED / DISPOSITIONS** at the end of this document, which is
the authoritative change record; earlier prose in this document reflects the current, fixed
state, not the history — the dispositions section carries the history.

This document is an **expansion**, not an implementation. Per the NM-41C gate
(`W5-W11-gated.md` lines 8–24), it is written and frozen *before* any implementation work
starts, and it is reviewed by GPT-5.6 Sol — a reviewer who did not write it and will not
implement it — before it is unfrozen for a `/goal` run.

---

## Why this tranche exists

`W5-W11-gated.md` (Wave 9 section) records Sol's finding directly: "NM-22 is not executable as
one 'harden all routes' wave." The real daemon HTTP surface is 340 method registrations (334
excluding `OPTIONS`) across 35 route files plus 6 bootstrap routes in `server.ts` — not the ~239
the original assessment claimed. Route hardening is ordered by threat boundary, highest risk
first: agent spawn → filesystem → deploy (BYOK tokens) → external fetch (SSRF) → **Library
ingest** → imports → long tail. Library ingest is pulled out of that rolling order into its own
gated slug, `mishmash-w9-ingest-tranche`, specifically **because W3 cannot safely expose
`/library`** (currently hidden behind `LIBRARY_UI_VISIBLE = false`) until the daemon's write
surface for externally-supplied content has been threat-modeled, tested, and attributed.

`routes/library.ts`'s own file header already states the shape of the problem: three classes of
caller reach this file — the local web UI / CLI (loopback / same-origin), the browser extension
(cross-origin `chrome-extension://…`, gated by a pairing-bound capability token), and the pairing
handshake itself (reachable pre-pairing, gated by a short-lived code). Two real vulnerability
classes have already been found and fixed here (SSRF via `POST /api/library/ingest` with
read-back exfiltration through the then-unauthenticated `/raw` route, and capability-token
identity binding), each with a red-then-green regression spec already in the tree
(`apps/daemon/tests/library-ingest-ssrf.test.ts`,
`apps/daemon/tests/library-ingest-token-binding.test.ts`). **This tranche's job is not to
rediscover those** — it is to turn the file's *entire* route surface into a
mechanically-generated, complete attribution matrix per `VERIFICATION-CONTRACT.md` §6, with an
independently-reviewed implementation before it counts as done.

## Ground facts (verified directly in this tree)

- **The route count is 23, not "the ingest route."** `registerLibraryRoutes` in
  `apps/daemon/src/routes/library.ts` registers exactly 23 `GET`/`POST`/`DELETE`/`OPTIONS`
  handlers under `/api/library/*` and `/api/tools/library/*` — verified two independent ways
  every verifier run: a real daemon boot's own `routeInventory`, and a scoped AST scan of
  `registerLibraryRoutes`'s body read from `baseCommit` via `git show`. Both agree.
- **Gate shape, exactly:** of the 23 registrations, **6** carry `requireLocalDaemonRequest`
  (`POST /pair`, `GET /connection`, `POST /sync`, `DELETE /assets/:id`, `POST
  /assets/:id/apply`, `POST /assets/:id/edit-as-page`). **2** carry `authorizeToolRequest` (the
  `/api/tools/library/*` pair). **2** carry a self-service bearer check — proof of possession of
  the caller's own token, no loopback requirement (`POST /pair/revoke`, `POST /pair/rotate`);
  their two `OPTIONS` preflight siblings run no check of their own. **1** (`POST
  /library/ingest`) runs a three-way branch: extension-shaped origin + its own bound token, OR
  `isLocalSameOrigin` (loopback), OR reject — the loopback ALTERNATIVE is what keeps this row out
  of the self-service-bearer bucket even though it also calls the same `bearerToken`/
  `validateLibraryToken` pair revoke/rotate use (see "AST classifier" below — this exact
  ambiguity was caught and fixed before submission). **1** (`POST /library/pair/confirm`) is
  gated only by the short-lived pairing code plus the zero-config extension-origin bypass. The
  remaining **11** carry **no route-level authorization code at all**, relying entirely on
  `server.ts`'s global `/api` origin middleware (`server.ts:2209-2287`), which lets any request
  presenting **no `Origin` header** straight through — every non-browser local caller. 6+2+2+1+1+11
  = 23. `GET /api/library/assets/:id/raw` is in that 11-route no-gate group and is the read-back/
  exfiltration half of the SSRF story the ingest test file's own header comment describes.
- **`GET /api/library/assets` mutates — it is not a plain read.** It calls `await
  runReconcile(false)` (`library.ts:537`) before listing, which inserts new `library_assets` rows
  for design systems and agent deliverables it discovers (`library-sync.ts`). This mutation is
  throttled **program-wide**, not per-caller (`RECONCILE_THROTTLE_MS = 10_000` in
  `routes/library.ts`) — a real, existing, if coarse, rate control the implementer may cite
  directly if a test proves it, per S9-3's citation allowance. This route's frozen impact floor
  is corrected to `2` (see S9-2) — round 2 caught this after round 1 froze it at `0`. Every other
  `GET` route was re-audited for the same hidden-mutation shape: `/connection`, `/assets/:id`,
  `/clipper-probe` are pure reads; `/raw`, `/figma`, `/element` stream stored bytes with no
  write; `/events` adds an in-memory, non-persisted, non-cross-request SSE listener only. None of
  those qualify.
- **There is no request- or byte-volume control on any `/api/library/*` route.** `POST
  /api/library/ingest` gets a **128 MB** body-size allowance (`server.ts:2074`,
  `app.use('/api/library/ingest', express.json({ limit: '128mb' }))`, registered ahead of the
  global 4 MB default so a full-page clipper capture doesn't 413) with **no accompanying
  request-volume or byte-volume cap for the clipper/token caller class**. The 3 MB
  `LIBRARY_UPLOAD_MAX_BYTES` + MIME allowlist (`packages/contracts/src/api/library.ts`) applies
  **only** to `sourceKind === 'manual-upload'`. A URL-based ingest (`body.url`) is capped at
  25 MB by `fetchRemoteBytes`, but that cap does not apply to `dataUrl`/`text` bodies. Separately,
  `apps/daemon/src/connectors/service.ts:472-476,864-892` implements a real per-run,
  per-connector call-rate limiter (`CONNECTOR_RUN_RATE_LIMIT_CALLS`, `enforceRunLimits`, a genuine
  429) and `express-rate-limit@8.4.1` is present in `pnpm-lock.yaml` — but only as a **transitive**
  dependency of `@modelcontextprotocol/sdk`, never imported by `apps/daemon/src`, `apps/web/src`,
  or `scripts/` (grep-confirmed). Neither applies to `/api/library/*`.
- **The pairing code has no attempt throttle.** `startPairing()` (`library-tokens.ts`) mints a
  6-digit code with a 5-minute TTL and no attempt counter. `POST /api/library/pair/confirm` is
  reachable pre-pairing from any extension-shaped origin (the zero-config bypass). This is a
  genuine, narrow brute-force window this tranche's risk-ranking rule surfaces as a P0 row.
- **The SSRF and token-binding fixes are already landed, with red-before-green specs.**
  `apps/daemon/tests/library-ingest-ssrf.test.ts`,
  `apps/daemon/tests/library-ingest-token-binding.test.ts`,
  `apps/daemon/tests/library-ingest-concurrent-hash-race.test.ts`, and
  `apps/daemon/tests/library-token-revoke-rotate.test.ts` all exist, boot a real daemon, and
  exercise real HTTP against real SQLite-backed state — no mocked transport
  (`VERIFICATION-CONTRACT.md` §3 R2). This tranche may cite them directly per S9-3/S9-5's
  allowance — it does not require re-deriving new controls where a real test already proves one.
  Glob-discovered `library-*.test.ts` suite this run: 45/45 passing across 9 files.
- **This branch's `baseCommit` now includes the `DECISIONS.md` lease amendment.** `HEAD` is a
  merge of `origin/main` into this branch (`00460978d`); `git merge-base origin/main HEAD` is
  `ff47420b8`, the exact commit that landed the amendment. (Round 1's text asserted the opposite
  — a stale claim from before that merge happened; corrected here to what the verifier's own
  `baseCommit` resolution actually reports, not asserted from memory.)

## Scope

**S9-1 — Freeze the route snapshot at baseCommit, with drift detection.** The frozen set is
derived by parsing `git show <baseCommit>:apps/daemon/src/routes/library.ts` through a real AST
scan scoped to `registerLibraryRoutes`'s own function body (never the whole file — comments are
lexer trivia a `ts.forEachChild` walk never visits, so a matching identifier in a comment cannot
leak in). That baseCommit-derived set is checked for self-consistency against
`FROZEN_IMPACT_FLOORS`' key set (S9-2 — the one literal table this expansion freezes, and also
the canonical frozen-route list, avoiding two sources of truth) and then checked for drift
against a **live daemon boot's** own `routeInventory`, filtered to `/api/library/*` and
`/api/tools/library/*`. Any duplicate `{method,path}` registration — at baseCommit, at HEAD, or
in the live daemon's own inventory — is a hard fail in its own right, never a silent
last-write-wins pick. `POST /api/backup` / `POST /api/restore` are registered from inside this
same file (`registerBackupRoutes(...)`, line 365) but implemented in and owned by W0's
`apps/daemon/src/backup/routes.ts` — different path prefix, excluded by the path filter,
**confirmed intentional (ruling 4).**

**S9-2 — State the risk-ranking rule: exposure is exact and AST-derived; impact is a frozen,
reviewer-owned floor.** Score = `exposure(0–3) + impact(0–3)`.

- **Exposure** — the *weakest* caller class the route's own gate code accepts, derived from real
  AST `CallExpression`/identifier nodes, **reachability-aware**: guard-signal detection is scoped
  to the handler's own **top-level statements** (never nested inside an `if`/loop/nested-function,
  so a decoy call inside dead code cannot count) and stops scanning at the first unconditional
  top-level `return`/`throw` (anything after is genuinely unreachable JS):
  - `0` — `requireLocalDaemonRequest` is a literal identifier among the route's own middleware
    arguments (a real Express middleware, always invoked — no reachability ambiguity there).
  - `1` — a real, reachable top-level `CallExpression` to `authorizeToolRequest`.
  - `2` — real, reachable top-level `CallExpression`s to both `bearerToken` and
    `validateLibraryToken`, **AND** the handler does not also call `isLocalSameOrigin` anywhere.
    That last clause is load-bearing: `POST /api/library/pair/revoke`/`rotate` use `bearerToken`+
    `validateLibraryToken` as the caller's *only* accepted proof (self-service bearer, no
    loopback alternative) — but `POST /api/library/ingest` calls the *same pair* of functions at
    its own top level too, as one branch of a three-way decision that also accepts
    `isLocalSameOrigin` (loopback) with **no token at all**. Without the `isLocalSameOrigin` veto,
    the classifier would misclassify ingest as exposure `2` instead of `3` — caught and fixed
    against the real handler before this document was submitted, not merely from a reviewer
    finding.
  - `3` — none of the above.
- **Impact — a FROZEN, reviewer-owned FLOOR per route, not implementer-declared.** Every one of
  the 23 frozen routes gets a literal floor in this document and in the verifier's
  `FROZEN_IMPACT_FLOORS` (the two match; C9-1 checks this). A row may claim `impact >= floor`
  (raising it if an implementer finds the route does something *worse* than this floor assumed)
  but never below. **Changing a floor requires a reviewed gate amendment to this document, not an
  implementation-branch edit.** Floor definitions:
  - `0` — returns metadata only / no persisted mutation (a pairing code held only in transient
    in-memory state before confirmation counts as `0`, not a mutation).
  - `1` — returns previously-stored bytes/derived content back to the caller.
  - `2` — mutates a row, or moves/copies bytes already inside daemon-owned storage, under caller
    direction — **or is triggered by an unauthenticated caller into a real, if throttled,
    background mutation** (`GET /api/library/assets`'s reconcile-on-list).
  - `3` — accepts caller-supplied bytes, or fetches a caller-supplied URL, into daemon-owned
    storage.

  Tiers: `score 5–6 = P0`, `score 4 = P1`, `score 0–3 = P2`, mechanically enforced (`tier ===
  tierFor(exposure+impact)` exactly, criterion C9-8).

  **The full frozen table:**

  | Route | Exposure (today) | Impact floor | Floor score | Floor tier |
  |---|---|---|---|---|
  | `POST /api/library/pair` | 0 | 0 | 0 | P2 |
  | `OPTIONS /api/library/pair/confirm` | 3 | 0 | 3 | P2 |
  | `POST /api/library/pair/confirm` | 3 | 2 (mints a token row) | 5 | **P0** |
  | `GET /api/library/connection` | 0 | 0 | 0 | P2 |
  | `POST /api/library/pair/revoke` | 2 | 2 (deletes a row) | 4 | P1 |
  | `OPTIONS /api/library/pair/revoke` | 3 | 0 | 3 | P2 |
  | `POST /api/library/pair/rotate` | 2 | 2 (deletes+inserts a row) | 4 | P1 |
  | `OPTIONS /api/library/pair/rotate` | 3 | 0 | 3 | P2 |
  | `OPTIONS /api/library/ingest` | 3 | 0 | 3 | P2 |
  | `POST /api/library/ingest` | 3 | 3 (fetches caller URL / accepts caller bytes) | 6 | **P0** |
  | `GET /api/library/clipper-probe` | 3 | 0 (`{ok:true}`, no data) | 3 | P2 |
  | `GET /api/library/assets` | 3 | **2** (reconcile-on-list inserts rows — corrected, round 2) | **5** | **P0** |
  | `POST /api/library/sync` | 0 | 2 (forced bulk reconcile-driven inserts) | 2 | P2 |
  | `GET /api/library/assets/:id` | 3 | 0 | 3 | P2 |
  | `DELETE /api/library/assets/:id` | 0 | 2 (deletes row + unlinks bytes) | 2 | P2 |
  | `GET /api/library/assets/:id/raw` | 3 | 1 (serves stored bytes back) | 4 | P1 |
  | `GET /api/library/assets/:id/figma` | 3 | 1 (serves stored sidecar bytes back) | 4 | P1 |
  | `GET /api/library/assets/:id/element` | 3 | 1 (serves stored sidecar bytes back) | 4 | P1 |
  | `POST /api/library/assets/:id/apply` | 0 | 2 (copies stored bytes into a project) | 2 | P2 |
  | `POST /api/library/assets/:id/edit-as-page` | 0 | 2 (creates project/conversation rows, writes a file) | 2 | P2 |
  | `POST /api/tools/library/search` | 1 | 0 (read-only) | 1 | P2 |
  | `POST /api/tools/library/apply` | 1 | 2 (copies stored bytes into a project) | 3 | P2 |
  | `GET /api/library/events` | 3 | 0 (SSE subscribe, no persisted mutation) | 3 | P2 |

  **Guaranteed P0 today: `POST /api/library/pair/confirm`, `POST /api/library/ingest`, and `GET
  /api/library/assets`** (the third added in round 2). Guaranteed P1: `pair/revoke`, `pair/rotate`,
  `.../raw`, `.../figma`, `.../element`. C9-6's per-P0-row rate/volume-control requirement and
  C9-7's per-P0-route threat-model-bullet requirement key off the row's **mechanically-verified**
  tier, so this set narrows automatically as real hardening (e.g., adding
  `requireLocalDaemonRequest` to a route) legitimately lowers its exposure — the floors only ever
  set a minimum, they do not freeze the final answer.

**S9-3 — Mechanically-generated attribution matrix, with structured (not free-text) content.** A
companion machine-readable file, `docs/security/library-ingest-attribution.json`, one row per
frozen route (exactly 23, no orphans, no gaps, no duplicates), each row carrying the six required
fields from `VERIFICATION-CONTRACT.md` §6: `owner`, `authn`, `authz`, `inputValidation`,
`sizeRateLimit`, `testRef`. **None of the six may be a bare placeholder** — a floor of 12
characters, a denylist of stock filler (`x`, `n/a`, `tbd`, `none`, `unknown`, …), and a
repeated-character check together close the "`x` passes because it's non-empty" gap. `authn`
additionally must contain the keyword naming its own row's **mechanically-derived exposure
class** (`requireLocalDaemonRequest`/`loopback` for exposure 0, `authorizeToolRequest`/"tool
token" for 1, `bearer`/"self-service"/"proof of possession" for 2, `none`/"no gate"/"zero-config"
for 3) — the one field the PRD claims is partially mechanical is now actually checked against the
mechanism, not merely present.

Every row also carries `riskScore` (`{exposure, impact, score, tier}`, formula-enforced per S9-2)
and, **for every route whose mechanically-derived `exposure === 3`**, exactly one of:

- `control: { mechanism: string, testRef: string }` — a real, currently-passing test, bound by
  **exact `fullName` equality**, additionally required to relate to its own row by a
  **path-derived association term** (e.g. `ingest`, `pair`, `revoke`, `confirm`, `raw` — computed
  mechanically from the route's own path segments, never a hand-authored per-row table), and
  **unique**: no two rows may share the same primary `testRef`. Whether a cited test counts as
  "new" (needing red evidence) is decided by whether its exact **test title** — not merely its
  containing file — already existed in that file's content at `baseCommit`; a test appended to an
  already-existing file no longer rides along on the file's own pre-existing citation-exemption. A
  genuinely new test's `control`/`testRef` requires a companion **structured** red-transcript
  artifact at `docs/security/library-ingest-red/<slug(testRef)>.txt`:
  ```
  PARENT_SHA: <the commit the test failed on, before this control landed>
  COMMAND: <the exact vitest invocation used to capture this transcript>
  TEST: <the exact testRef this transcript proves red>
  ---
  <the captured failing output>
  ```
  `PARENT_SHA` must resolve to a real commit and be an ancestor of `HEAD` (not merely a
  40-hex-looking string); `TEST` must exactly equal the `testRef` it's attached to; the output
  body must be non-trivial and carry a `RED`/`FAIL` marker (R1: both transcripts recorded — the
  green half is already captured by the suite's own JSON report). Separately, the same file must
  contain a **genuine paired positive+negative control**: at least one other passing assertion in
  that file whose name reads as a positive/accepted-path signal, and at least one whose name reads
  as a rejection/negative-path signal — a raw "≥2 passing assertions" count is not this; R4 is
  about proving the SAME mechanism accepts the right caller and rejects the wrong one, not about
  test-file population size. Coverage that already existed at `baseCommit` (SSRF, token-binding,
  etc.) is exempt from the red-artifact/pairing requirement per this section's "may cite directly"
  allowance.
- `acceptedRisk: { decisionRef: string }` — **not implementer-authored JSON.** `decisionRef` must
  **exactly equal** (never substring-match) a **unique** `### W9-ACCEPT-<slug>` heading in
  `docs/plans/waves/DECISIONS.md` **as read at `baseCommit`** (`git show`, never the working
  tree), whose block carries all five required fields:
  ```
  ### W9-ACCEPT-<slug>

  - Route: `METHOD /path`
  - Accepted risk: <what is being left open>
  - Accepter: <name, distinct from any commit author in baseCommit..HEAD>
  - Date: YYYY-MM-DD
  - Rationale: <why this is acceptable>
  ```
  The entry's `Route:` field must exactly equal the row's own `{method} {path}` (a decisionRef
  cannot be reused across unrelated routes without the route matching), and its `Accepter` must
  not equal any commit author's name/email across `baseCommit..HEAD` — an implementation-branch
  edit cannot author its own accepted risk, and a duplicate heading ID anywhere in the file makes
  that ID **unresolvable everywhere**, not just ambiguous at the second occurrence. Per the
  round-2 external-receipt ruling: **`DECISIONS.md`-at-baseCommit is the sufficient, sole
  mechanism** — no second, independently-verifiable "external receipt" path is built or needed.

A row with all six fields populated but no `control`/`acceptedRisk` on an `exposure===3` row does
**not** count as attributed. The verifier's evidence for C9-4 reports three explicit counts every
run: **attributed**, **unattributed** (`exposure===3`, neither control nor accepted risk — a true,
uncontrolled gap), and **known-vulnerable** (`exposure===3`, a verified accepted risk on file — a
consciously-accepted, still-open item).

`docs/security/daemon-threat-model.md` is extended with a "Wave 9" section, in the same style as
its existing `[C0-N]` bullets: every claim tagged `[C9-N]`, quoting a test `fullName` by **exact**
match, and — **the specific route's own `{method} {path}` string must appear inside the SAME
bullet line that carries a valid citation**, for every P0-tier route (criterion C9-7) — a route
name appearing anywhere else in the section's surrounding prose does not count as coverage.

**S9-4 — Resolve the size/rate-limit gap explicitly, for every P0 row.** C9-6 applies to **every
row whose mechanically-verified `riskScore.tier === 'P0'`** (today: `pair/confirm`, `ingest`,
`GET /assets` — see S9-2). Its `sizeRateLimit` field must resolve with either (a) a `control`
whose `mechanism` text is **semantically checked**, not just keyword-matched: it must match an
enforcement-shaped pattern (rate/volume/throttle language paired with limit/cap/enforce/reject/429
language) **and must not match a negation pattern** — "no rate limit exists" contains both `rate`
and `limit` but is a negation, and is explicitly rejected, not merely a keyword hit — or (b) a
`DECISIONS.md`-verified `acceptedRisk`. An in-process control (a bounded per-token-hash,
per-origin, or per-pairing-attempt counter, entirely inside `routes/library.ts`) is achievable
inside this tranche's lease for all three current P0 rows; a `library-tokens.ts`-level or
`server.ts`-level control is not (ruling 1).

**S9-5 — Endpoint tests per tranche.** Every attributed row's `testRef` must name a real,
currently-passing, route-associated, unique-per-row test. Existing coverage may be cited directly
per S9-3's allowance. `POST /api/library/pair/confirm`'s attempt-throttle absence, `POST
/api/library/ingest`'s volume-cap absence, and `GET /api/library/assets`'s per-caller (as opposed
to program-wide) reconcile-trigger exposure are the three P0 rows S9-4 forces a real resolution
for.

**S9-6 — Adversarial verification of the implementation, not just this expansion.**
`W5-W11-gated.md`:155 requires "adversarial verification per tranche," and
`VERIFICATION-CONTRACT.md` G-14 requires commit-bound review records with reviewer ≠ author.
Criterion C9-10 requires `docs/security/library-ingest-implementation-review.json` —
`{reviewer, model, reviewedCommit, verdict}`.

**Design rationale (round 2 — the original `commit === HEAD` design was structurally
impossible and is not used here):** an in-repo file committed in commit X cannot contain X's own
SHA — at the moment the record is authored, X's SHA does not exist yet, and once you learn it and
add it, that's a *different*, later commit. Instead, the record names `reviewedCommit`, a
**strict ancestor of `HEAD`** — the already-real, already-known SHA of the commit that carries the
**complete** implementation (routes, store, tests, matrix, threat-model doc). The gate verifies:
(a) `reviewedCommit` resolves to a real commit and is a strict ancestor of `HEAD` (never `HEAD`
itself); (b) `git diff --name-only reviewedCommit HEAD` over the tranche's owned
implementation/evidence paths (`routes/library.ts`, `library-store.ts`, `tests/library-*.test.ts`,
the attribution JSON, the threat-model doc) is **empty** — proving nothing in what the review
claims to cover changed after the point it reviewed, so a review committed later necessarily
covers the FINAL state; (c) `reviewer` is distinct from every commit author across
`baseCommit..reviewedCommit` (the full implementation range, not merely `HEAD`'s own tip author —
closing the round-1 defect where a later same-author commit could dodge the check trivially). This
makes a clean green run **feasible**: commit the whole implementation first as some real commit P;
a distinct reviewer reviews P; the review record naming P is committed afterward, even as `HEAD`
itself, adding only that one file — P's SHA is already stable by construction, so there is no
chicken-and-egg problem, and the record cannot spoof either its own reviewed-state or its
reviewer's distinctness from the work it reviews.

## Explicitly out of scope

- The other five W9 tranches (agent spawn, filesystem, deploy/BYOK, external fetch, imports/long
  tail) — they stay in rolling W9 per `W5-W11-gated.md`.
- `apps/daemon/src/library.ts`, `library-tokens.ts`, `library-sync.ts`,
  `brands/safe-fetch.ts`, `security/library-token-lifecycle.ts` — load-bearing for ingest
  security but outside this tranche's write lease. **Ruling 1: existing behavior in these files
  may be attributed without modification; no lease amendment.**
- AI enrichment, embeddings, semantic search, bookmark import (W5).
- Anything the flag `LIBRARY_UI_VISIBLE` gates for end users (W3's problem) — this tranche's
  output is a **precondition** W3 consumes, not a UI change.

## Definition of "green" (for W3's C3-4 to consume mechanically)

W3's own verifier must implement every one of the following predicates against
`~/.claude/goal-state/mishmash-w9-ingest-tranche/proof/manifest.json` before treating this
tranche as a satisfied precondition — every predicate is required, none is advisory:

1. The file exists and parses as JSON.
2. `manifest.wave === "W9-ingest"`.
3. `manifest.wroteOk === true`. The verifier writes a `wroteOk:false` placeholder BEFORE any
   criterion runs (overwriting whatever a prior run left), and **now aborts the entire run if
   that placeholder write itself fails** (round 2: previously the write's result was discarded).
   Only a fully completed run ends with `wroteOk:true`. `wroteOk:false` or a missing manifest
   must read as **not green**, never advisory.
4. `manifest.treeDirty === false`.
5. The **set** of `manifest.criteria[].id` equals **exactly**: `{C9-1, C9-2, C9-3, C9-4, C9-5,
   C9-6, C9-7, C9-8, C9-9, C9-10, GATE-INTEGRITY, LEASE, HEAD-DRIFT}` — 13 IDs, no fewer, no more,
   no duplicates. A short or empty `criteria` array fails this predicate outright.
6. Every one of those 13 entries has `status === "pass"`. No criterion here is `human:`-marked
   (§3 R7); `status: "blocked-on-founder"` should never legitimately appear, and fails this
   predicate if it does.
7. For every entry, `artifact` is non-null and re-hashing the file at that path with SHA-256
   equals the recorded `artifactSha256`.
8. `manifest.commit` is an ancestor of (or equal to) the commit W3's own verifier is currently
   checking (`git merge-base --is-ancestor <manifest.commit> <candidate>`).
9. **No drift in ANY of the tranche's evidence paths since `manifest.commit`** (round 2:
   broadened from the original two-file list, which left tests, the matrix, the threat-model doc,
   the review record, `DECISIONS.md`, and the verifier itself free to change or vanish
   post-green without invalidating W3's read):
   ```
   git diff --name-only <manifest.commit>...<candidate> --
     apps/daemon/src/routes/library.ts
     apps/daemon/src/library-store.ts
     apps/daemon/tests/library-*.test.ts
     docs/security/library-ingest-attribution.json
     docs/security/daemon-threat-model.md
     docs/security/library-ingest-implementation-review.json
     docs/security/library-ingest-red/**
     docs/plans/waves/DECISIONS.md
     scripts/waves/verify-w9-ingest.ts
   ```
   must be empty. Any diff here means the manifest is stale evidence for the *current* tree — W3
   must require a fresh W9 verifier run before treating the precondition as met.
10. `manifest.gateIntegrityPinned` is readable directly (round 2: a top-level field now, not
    buried in `GATE-INTEGRITY`'s prose evidence). If `false`, W3 additionally needs the
    orchestrator's own external approval receipt for this PRD/verifier pair to treat the pin's
    absence as legitimate rather than merely unremarked.

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w9-ingest.ts`.

| ID | Criterion | Verification |
|---|---|---|
| C9-1 | Route snapshot frozen **at baseCommit**, drift-checked, duplicate-checked | `git show <baseCommit>:...library.ts` AST-scanned (scoped to `registerLibraryRoutes`), self-consistent with `FROZEN_IMPACT_FLOORS`' key set, compared to a real daemon boot's live `routeInventory`; any duplicate `{method,path}` at either point is a hard fail |
| C9-2 | Existing ingest-security suite is green | Real vitest JSON-reporter run of **glob-discovered** `apps/daemon/tests/library-*.test.ts` files; zero failed, zero pending/skipped, zero `skip`/`only`/`todo` markers (spaced and bracket-alias forms included) |
| C9-3 | Attribution matrix exists and covers exactly the frozen route set | `docs/security/library-ingest-attribution.json` parses as JSON; exactly one row per frozen `{method,path}`, no orphans, no gaps, no duplicates |
| C9-4 | Every row is fully, structurally attributed | Every field clears a placeholder floor (length + denylist + anti-repetition, not mere non-emptiness); `authn` must name its row's mechanically-derived exposure class; `acceptedRisk.decisionRef` resolves to a unique, fully-structured, route-bound, non-self-accepted `### W9-ACCEPT-*` entry in `DECISIONS.md@baseCommit`; evidence reports attributed/unattributed/known-vulnerable counts |
| C9-5 | Every `testRef` names a real, currently-passing, route-associated, unique test | Exact `fullName` equality; a path-derived association term must appear in the citation; no two rows share a primary `testRef`; "new" is decided by test-TITLE existence at baseCommit (not file existence); new tests require a structured red transcript (`PARENT_SHA` resolves + is an ancestor of `HEAD`, `TEST` matches exactly) plus a genuine paired positive+negative control in-file |
| C9-6 | Every P0-tier row's size/rate-limit dimension is explicitly, semantically resolved | For every row with `riskScore.tier === 'P0'` (today: `pair/confirm`, `ingest`, `GET /assets`): a `control` whose `mechanism` matches an enforcement pattern and NOT a negation pattern, with a `testRef` passing C9-5's full bar, or a verified `acceptedRisk` |
| C9-7 | Threat-model doc extended, mechanically cited, P0-complete | `docs/security/daemon-threat-model.md` carries a "Wave 9" section bounded to the next `## ` heading; every `[C9-N]` bullet's cited test is an exact match; every P0-tier route's own key appears inside the SAME cited-and-valid bullet line |
| C9-8 | Full risk-score formula enforced per row | AST-derived `exposure` (scoped, comment-blind, duplicate-checked, reachability-aware) matches exactly; `impact >= FROZEN_IMPACT_FLOORS[route]`; `score === exposure+impact` exactly; `tier === tierFor(score)` exactly |
| C9-9 | Gates | `pnpm guard` and `pnpm typecheck` exit 0 on the current tree |
| C9-10 | Adversarial review of the **implementation** is on record, non-spoofable | `docs/security/library-ingest-implementation-review.json`: `reviewedCommit` resolves and is a STRICT ancestor of `HEAD`; the owned-path diff between `reviewedCommit` and `HEAD` is empty (review covers the final state); `reviewer` distinct from every author in `baseCommit..reviewedCommit`; `verdict === "APPROVE"` |

Plus the three named infra checks: **GATE-INTEGRITY** (advisory self-hash pin, once an
orchestrator-approved hash exists — the F4 route-snapshot collusion round 1 found is
independently closed by C9-1/C9-8 anchoring to baseCommit regardless of pin timing; the pin's
absence is now also `manifest.gateIntegrityPinned`, a top-level field), **LEASE** (`git diff
--name-only <baseCommit>...HEAD` ⊆ `leases.json@baseCommit`'s `W9-ingest.allow`, read via `git
show`, never the working tree), **HEAD-DRIFT** (HEAD must not move mid-run).

## Verified baseline (this run, pre-implementation, post round-2 fix)

- Glob-discovered `library-*.test.ts` suite: **45/45 passing** across 9 files.
- Route count: confirmed **23**, agreeing across the baseCommit AST scan and real daemon
  introspection.
- The AST classifier's own exposure histogram (printed as informational evidence on every C9-1
  run, even pre-implementation) was checked directly against this table's "Exposure (today)"
  column before submission: `POST /api/library/ingest => 3` (not `2` — the misclassification
  found and fixed during this round, verified with the bug present AND after the fix, not just
  asserted fixed).
- `docs/security/library-ingest-attribution.json`,
  `docs/security/library-ingest-implementation-review.json`: do not exist yet (C9-3 through C9-8
  and C9-10 fail honestly).
- Rate/volume control on any of the three P0 rows: confirmed absent (C9-6 fails honestly).
- `docs/plans/waves/DECISIONS.md` at `baseCommit` (`ff47420b8`, this branch's actual merge-base
  with `origin/main` as of this run — see "Ground facts") carries zero `### W9-ACCEPT-*` entries
  yet, confirmed by direct regex scan, not assumed.

## Adversarial review

GPT-5.6 Sol. Rounds 1 and 2's findings and rulings are fully disposed below. This is the final
fix round under the 2-fix-round cap; a further REJECT fires the program's stop rule. Residual
uncertainty flagged honestly rather than hidden, since a reviewer would find it either way:

- The paired positive/negative-control check (S9-3) is a **name-pattern proxy**, not true
  semantic verification of test intent — it cannot detect a file with two passing tests that
  happen to match both regexes by coincidence rather than by actually proving accept-vs-reject
  for the same mechanism. This is the best mechanically-feasible signal identified across two
  review rounds; a stronger version would need actual assertion-body analysis, judged out of
  proportion for this tranche.
- C9-10's `reviewer` distinctness check is name/email-string-based, not cryptographic identity —
  a reviewer and an implementer sharing a git identity (unlikely in this program's actual
  reviewer/author separation, but not impossible in principle) would defeat it. No stronger
  binding was available without inventing a signing infrastructure this program doesn't have.
- The `routeAssociationTerms` mechanism derives association purely from URL path segments; it
  was verified to produce a non-empty term set for all 23 routes (see sanity check in this
  round's work), but has not been exercised against a REAL populated matrix (none exists
  pre-implementation) to confirm it doesn't over-reject a legitimately-named test.

---

## AUTHOR-FLAGGED / DISPOSITIONS

### Round 1 (9 findings, 5 rulings) — superseded by round 2 where noted

**F1 risk ranking gameable** — round-1 fix (frozen floors, AST scoping) partially held; round 2
found the floor table itself had one wrong entry and the classifier accepted dead code. Both
fixed in round 2 below.

**F2 attribution self-attested** — round-1 fix (mechanical `exposure===3` trigger,
`DECISIONS.md`-at-baseCommit reference) was directionally right but insufficiently strict; round
2 closes it fully (placeholder floors, structured decision entries).

**F3 test/report coverage gameable** — round-1 fix (exact fullName, red artifact, `>=2`
assertions) closed the crudest exploit (`"e"` substring match) but left several others; round 2
closes them.

**F4 frozen route set implementer-mutable** — round-1 fix (baseCommit-derived AST) is confirmed
correct and unchanged in round 2 (Sol: "the original route-literal co-edit path is closed").

**F5 W3 stale-proof / vacuous green** — round-1 fix (exact 13-ID set, `wroteOk`) closed the
empty-array defect; round 2 broadens the drift-check path list and makes the placeholder write's
own failure fatal.

**F6 no adversarial-implementation-review criterion** — round-1 added C9-10 but with a
structurally impossible design (`commit === HEAD`); fully redesigned in round 2.

**F7/F9 baseline reproducibility, false ground facts** — both fixed in round 1 and confirmed
still fixed in round 2 (Sol: "FIXED — ground facts").

**Ruling 1 (no lease widening)** — encoded, unchanged, reconfirmed by round 2 ("faithfully
encoded").

**Ruling 2 (DECISIONS.md redirect)** — round-1 encoding used substring containment against
`DECISIONS.md`; round 2 tightens to an exact, unique, structured entry ID (below).

**Ruling 3 (don't lease the PRD path)** — encoded, unchanged, reconfirmed by round 2 ("faithfully
encoded").

**Ruling 4 (`/api/backup`/`/api/restore` exclusion confirmed)** — encoded, unchanged, reconfirmed
by round 2 ("faithfully encoded").

**Ruling 5 (tighten risk ranking)** — round-1 encoding was incomplete (one floor wrong, AST
classifier decoy-gameable); fully closed in round 2 (below).

### Round 2 (7 dispositions + rulings + 4 new defects) — current state

**Finding 1 (FIXED-WITH-NEW-DEFECT → RESOLVED).** `GET /api/library/assets`'s floor corrected
from `0` to `2` (S9-2 — it calls `runReconcile(false)`, a real mutation). Exposure detection is
now reachability-aware, scoped to top-level statements, comment-blind, and stops at the first
unconditional return (S9-2). `GATE-INTEGRITY`'s unpinned state is now a top-level manifest field
(`gateIntegrityPinned`).

**Finding 2 (NOT FIXED → RESOLVED).** Every attribution field now clears a placeholder floor
(length + denylist + anti-repetition); `authn` is checked against its row's mechanically-derived
exposure class; `acceptedRisk.decisionRef` requires an exact match to a unique, fully-structured,
route-bound, non-self-accepted `DECISIONS.md@baseCommit` entry (S9-3).

**Finding 3 (NOT FIXED → RESOLVED).** Primary `testRef` is now unique per row; citations require
a path-derived route-association term; "new" is decided by test-title existence at baseCommit,
not file existence; the red transcript is now a structured `PARENT_SHA`/`COMMAND`/`TEST` header
with real ancestry verification; the pairing check requires an actual positive+negative signal
match, not a raw count; C9-6's mechanism text is checked against an enforcement pattern AND a
negation-veto; C9-7 requires the P0 route's own key inside the same cited-and-valid bullet line
(all: S9-3/S9-4/S9-5).

**Finding 4 (FIXED-WITH-NEW-DEFECT → RESOLVED).** The base mechanism (baseCommit AST derivation)
was already correct per Sol; the remaining verifier-integrity gap (floor table alterable under an
absent pin) is addressed by making the pin's absence explicit (`gateIntegrityPinned`) rather than
claiming false protection — the floor table's bytes are already inside this file's own
self-hash scope, so a FUTURE pin would catch tampering; what round 2 fixes is visibility of the
pin's current absence, not a claim that it's already fail-closed pre-pin (it structurally cannot
be, by the same two-phase design every other wave verifier uses).

**Finding 5 (NOT FIXED → RESOLVED).** "Definition of green" predicate 9 now names every evidence
path (tests, matrix, threat-model doc, review record, `DECISIONS.md`, this verifier itself), not
two files. The initial `wroteOk:false` placeholder write's result is now checked; a failed write
aborts the run.

**Finding 6 / new C9-10 defect (RESOLVED).** C9-10 fully redesigned around `reviewedCommit` (a
strict ancestor of `HEAD`) instead of `commit === HEAD` — see S9-6's design-rationale paragraph
for the complete mechanism and why it makes a clean pass feasible while closing the spoofing
vectors.

**Finding 7/9 (FIXED-WITH-NEW-DEFECT → RESOLVED).** Archived per-run manifests now rewrite their
own `criteria[].artifact` paths to run-dir-local copies before writing (fully self-contained,
independently re-verifiable without touching the canonical, overwrite-prone `proof/` paths).
Archive failure is no longer swallowed — `archiveOk` is a top-level manifest field and now a hard
exit-code contributor.

**External-receipt ruling.** Encoded as instructed: `DECISIONS.md`-at-baseCommit is the sole,
sufficient mechanism; no second external-receipt path was built.

**MEDIUM/LOW.** Both resolved: archived-manifest self-containment and archive-failure-fails-the-
run above; the stale baseline sentence corrected in "Ground facts" to reflect this branch's
actual, verified `baseCommit` (`ff47420b8`, which DOES contain the DECISIONS amendment) rather
than the pre-merge assumption.

**Self-caught issue, not a named finding.** While rewriting the exposure classifier for
reachability (round-2 finding "AST classifier accepts dead/unreachable calls"), a **second,
independent** misclassification was found by direct dry-run against the real codebase before
submission: `POST /api/library/ingest` calls the exact same `bearerToken`+`validateLibraryToken`
pair that `pair/revoke`/`rotate` use for their self-service-bearer pattern, which would have
classified ingest at exposure `2` instead of `3` even with the reachability fix applied. Closed
by vetoing the self-service-bearer classification whenever `isLocalSameOrigin` is present
anywhere in the handler (S9-2) — verified directly against `routes/library.ts` (`isLocalSameOrigin`
appears only in ingest's handler, never in revoke/rotate) and confirmed via the classifier's own
printed histogram both before and after the fix, not asserted from reading the diff alone.
