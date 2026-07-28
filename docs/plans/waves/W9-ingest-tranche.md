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

**Status: CEREMONY-AUTHORIZED FIX ROUND (post-stop-rule).** Round 1 returned REJECT (9 findings);
round 2 returned REJECT again; round 2's own confirmation pass returned REJECT a third
consecutive time, firing the program's stop rule and escalating to a founder-delegated
ceremony. The ceremony's analysis confirmed round 2's attribution-authority work, the C9-10
redesign, the floor corrections, and the stale-proof mechanics as FIXED, and ruled all three
author-flagged residual-risk notes (in **Adversarial review**, below) acceptable-LOW and
settled — **none of that changed in this round.** It then ruled six specific mechanical defects
still blocking (exposure-classifier dead-code acceptance, fabricated/untested red transcripts,
naive quoted-string test-title detection, reusable control citations plus omnibus C9-7 coverage,
C9-6's gameable prose regex, and swallowed archive finalization) and authorized **exactly one**
ceremony-bounded fix round, confined to this document and the verifier, implementing the
ruling's exact fix semantics — "nothing else." Every round-1, round-2, AND ceremony finding is
disposed in **AUTHOR-FLAGGED / DISPOSITIONS** at the end of this document, which is the
authoritative change record; earlier prose in this document reflects the current, fixed state,
not the history — the dispositions section carries the history. Per the ceremony's own failure
path: this round is followed by exactly one fidelity-only confirmation; any verdict other than
APPROVE goes directly to the founder, with no further fix round absent explicit founder
authorization.

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
  AST `CallExpression`/identifier nodes, via a **straight-line dominance grammar** (ceremony round
  3 — round 2's "reachability-aware, top-level, stops-at-first-return" scoping still let a
  recursive descendant search find a guard call inside genuinely dead code; the classifier no
  longer performs any recursive descent at all for positive-guard detection):
  - `0` — `requireLocalDaemonRequest` is a literal identifier among the route's own middleware
    arguments (a real Express middleware, always invoked — no reachability ambiguity there).
  - `1` — the handler's own final callback is block-bodied, and its `body.statements` begin (after
    at most one direct `applyExtensionCors(req, res)` prelude statement) with the EXACT sequence
    `const grant = authorizeToolRequest(...)` immediately followed by a top-level `if (!grant)`
    whose consequent unconditionally returns or throws. Positive detection inspects only these
    direct siblings — never a call inside an `if`/loop/`switch`/`try`/nested block/callback/nested
    function/class, and never a call whose result is discarded.
  - `2` — the same straight-line prefix instead reads `const token = bearerToken(req)`, then
    `const check = validateLibraryToken(..., token)`, then a top-level `if (!check.ok)` (or
    `check.ok === false`) whose consequent unconditionally returns or throws, **AND** no reachable
    call to `isLocalSameOrigin` exists anywhere in the handler. That veto is load-bearing:
    `POST /api/library/pair/revoke`/`rotate` use `bearerToken`+`validateLibraryToken` as the
    caller's *only* accepted proof (self-service bearer, no loopback alternative) — but
    `POST /api/library/ingest` calls the *same pair* of functions too, as one branch of a
    three-way decision that also accepts `isLocalSameOrigin` (loopback) with **no token at all**.
    The veto walk is a bounded recursive reachability search (never entering nested
    function/class bodies, stopping after an unconditional top-level return/throw) with real
    dead-branch elimination: statically-false `if`/`while`/`for` conditions (literal `false`,
    parenthesized-literal `false`, `!`-negation of a boolean literal, determinable boolean-literal
    `&&`/`||`) are skipped, `do...while` always executes its body once, and any condition the
    classifier cannot statically resolve keeps both branches reachable — never assumed dead.
  - `3` — none of the above (including: the guard sequence exists but is inside a branch/loop/
    callback, its result is ignored, it runs after a response operation, or it sits inside a
    statically-dead branch).

  **Nine verifier self-probes** (fixtures run through this exact `collectRouteRegistrations`/
  `classifyExposure` pipeline, never a separate mock) prove the grammar against both real shapes
  and every decoy class the ceremony named: the real `authorizeToolRequest` shape (expect `1`);
  the real `bearerToken`/`validateLibraryToken` shape with an `applyExtensionCors` prelude (expect
  `2`); a guard wrapped in `if (false) {...}` (expect `3`); a guard wrapped in `if (!true) {...}`
  (expect `3`); a guard that only runs under a live, non-static condition (expect `3`, since it
  does not unconditionally dominate); a guard whose result is called but never checked (expect
  `3`); a guard placed after a response write (expect `3`); a reachable `isLocalSameOrigin` call
  vetoing an otherwise-exposure-`2` bearer shape (expect `3`); and the same bearer shape with an
  `isLocalSameOrigin` call inside a statically-dead branch, which must NOT veto (expect `2`). A
  failed self-probe fails BOTH C9-1 and C9-8 outright — the classifier is not trusted for a route
  verdict in a run where it cannot even classify its own known fixtures correctly.
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
  mechanically from the route's own path segments, never a hand-authored per-row table). **Global
  uniqueness (ceremony round 3):** one map from exact test `fullName` to route key spans **every**
  row's primary `testRef` AND **every** row's `control.testRef` together — round 2 only deduped
  primary refs, leaving a control free to reuse a citation another row already owns; that gap is
  closed. A reference's associated-route-key set must have cardinality exactly one; reuse across
  two route keys fails C9-5 for both. The same file as the cited test must **also** contain a
  **genuine paired positive+negative control** (unchanged, settled round-2 mechanism, an
  author-flagged residual — see **Adversarial review**): at least one other passing assertion in
  that file whose name reads as a positive/accepted-path signal, and at least one whose name reads
  as a rejection/negative-path signal — a raw "≥2 passing assertions" count is not this.

  Whether a cited test counts as "new" (needing red evidence) is decided by whether its exact
  **test title** already existed in that file's content at `baseCommit` — and, per the ceremony,
  "existed" now means a real **TypeScript-AST** parse of the file at `baseCommit`, matching only
  the static first argument (string literal or no-substitution template) of a syntactic `it`/
  `test` declaration or a modifier chain rooted at one (including `it.each(...)(...)`'s outer
  title call), compared against the reporter's own leaf `title` field — never a "this quoted
  string appears somewhere in the file" scan, which let an ordinary route-path string falsely
  grant the pre-existing-test exemption (the round-2/round-3 boundary defect). A title that is
  dynamic or that the reporter doesn't expose fails closed as new, requiring replay.

  A genuinely new test's `control`/`testRef` requires a companion **structured** red-transcript
  artifact at `docs/security/library-ingest-red/<slug(testRef)>.txt`:
  ```
  PARENT_SHA: <the commit the test failed on, before this control landed>
  COMMAND: <the exact vitest invocation used to capture this transcript (descriptive only)>
  TEST: <the exact testRef this transcript proves red>
  CONTROL_TEST: <a second fullName in the same file the replay must show passing>
  ---
  <the captured failing output (descriptive only)>
  ```
  **The checked-in `COMMAND` and output body are descriptive only (ceremony round 3) — never
  executed, never trusted as proof.** Real proof comes from the verifier's own replay: it first
  independently determines the test's true **introduction commit** — the first commit in
  `baseCommit..HEAD` whose AST (via the same `it`/`test` parse above) contains the exact new
  declaration — and requires `PARENT_SHA` to equal that commit's first parent, `PARENT_SHA` to be
  a full 40-hex commit satisfying `baseCommit <= PARENT_SHA < HEAD`, and `TEST` to exactly equal
  the `testRef`. It then creates an isolated **detached temporary `git worktree`** at
  `PARENT_SHA`, runs `mise trust` (a fresh worktree's `mise.toml` is untrusted by default and
  `pnpm`/`vitest` are mise-shimmed) followed by a frozen `pnpm install --offline
  --frozen-lockfile` (the shared pnpm content-addressable store makes this genuinely offline —
  no fetch), overlays **only the HEAD version of the containing test file** on top, and runs that
  file with verifier-constructed argv through Vitest's JSON reporter. The replay passes only when
  the child exits nonzero, the exact cited `fullName` appears with status `failed`, and the
  header's `CONTROL_TEST` appears with status `passed` — a missing test, install failure, timeout,
  parse failure, or unrelated process failure is an evidence failure, not a pass. The replay's own
  constructed argv, resolved commits, JSON assertion statuses, stdout/stderr hash, and exit code
  are captured in **C9-5's own artifact** — the implementer-authored transcript text can no longer
  substitute for that evidence. The current HEAD suite must still independently show the cited
  test passing. Coverage that already existed at `baseCommit` (SSRF, token-binding, etc.) is exempt
  from the red-artifact/replay requirement per this section's "may cite directly" allowance, but
  never from the paired positive/negative-control requirement above, which applies to every
  `control.testRef` regardless of new/old status.
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
match. **Per-P0-route bullet association (ceremony round 3, tightened from round 2's "route key
inside the same bullet" rule):** a qualifying bullet line must name **exactly one** P0 route key,
not several — round 2 let one bullet cite several P0 routes at once, or reuse an unrelated
passing citation, and still count as coverage for each. For a controlled P0 row that line must
cite the row's **exact** `control.testRef`; for an accepted-risk P0 row it must cite the row's
**exact** primary `testRef` — not merely any passing test whose name happens to contain the
route's path segment. The cited reference must already be part of the S9-3 global citation map
(above) associated with **only** that same route. One bullet or citation satisfies at most one P0
row; every P0-tier route needs its own (criterion C9-7).

**S9-4 — Resolve the size/rate-limit gap explicitly, for every P0 row.** C9-6 applies to **every
row whose mechanically-verified `riskScore.tier === 'P0'`** (today: `pair/confirm`, `ingest`,
`GET /assets` — see S9-2). Its `sizeRateLimit` field must resolve with either (a) a `control` or
(b) a `DECISIONS.md`-verified `acceptedRisk`.

**(a), ceremony round 3 — anchored declaration grammar, replacing round 2's prose-pattern
regex** (which a phrase like "no rate limit exists" could still pass, since it contains both
`rate` and `limit`; R5 independently forbids documentation from closing a live behavioral gap).
`control.mechanism` must match, in full, the anchored grammar:

```
ENFORCED kind=<request-rate|byte-volume|pair-attempt> scope=<token-hash|origin|pairing-attempt>
  limit=<positive-integer> windowMs=<positive-integer|none> overflow=<reject-429|reject-413>
```

`request-rate` and `pair-attempt` require a positive `windowMs`; `byte-volume` requires
`windowMs=none`. Extra text, zero/negative limits, unknown enum values, and every future/planned/
documented-only/unenforced phrasing fail — none of them matches the complete grammar. **The
declaration remains descriptive evidence only** — mechanism text alone can never close C9-6. It
passes only when, in addition, the row's `control.testRef` (a) passes the full C9-5 bar
(exact-pass, global-uniqueness, route-association, AST-derived historical-title check, and — for
a genuinely new control — the S9-3 replay above) and (b) the same file's real-transport coverage
(the current HEAD suite's own passing assertions) shows **both** an under-limit-accepted **and**
an over-limit-rejected outcome for that route. An in-process control (a bounded per-token-hash,
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
| C9-1 | Route snapshot frozen **at baseCommit**, drift-checked, duplicate-checked, classifier self-verified | `git show <baseCommit>:...library.ts` AST-scanned (scoped to `registerLibraryRoutes`), self-consistent with `FROZEN_IMPACT_FLOORS`' key set, compared to a real daemon boot's live `routeInventory`; any duplicate `{method,path}` at either point is a hard fail; **gated on all 9 exposure-classifier self-probes passing** |
| C9-2 | Existing ingest-security suite is green | Real vitest JSON-reporter run of **glob-discovered** `apps/daemon/tests/library-*.test.ts` files; zero failed, zero pending/skipped, zero `skip`/`only`/`todo` markers (spaced and bracket-alias forms included) |
| C9-3 | Attribution matrix exists and covers exactly the frozen route set | `docs/security/library-ingest-attribution.json` parses as JSON; exactly one row per frozen `{method,path}`, no orphans, no gaps, no duplicates |
| C9-4 | Every row is fully, structurally attributed | Every field clears a placeholder floor (length + denylist + anti-repetition, not mere non-emptiness); `authn` must name its row's mechanically-derived exposure class; `acceptedRisk.decisionRef` resolves to a unique, fully-structured, route-bound, non-self-accepted `### W9-ACCEPT-*` entry in `DECISIONS.md@baseCommit`; evidence reports attributed/unattributed/known-vulnerable counts |
| C9-5 | Every `testRef`/`control.testRef` names a real, currently-passing, globally-route-unique test; new controls carry independently-replayed red evidence | Exact `fullName` equality; a path-derived association term must appear; **one global map spans every row's `testRef` AND `control.testRef`** — reuse across two routes fails; "new" decided by an AST-derived test-title match at `baseCommit`; a new control's citation requires an isolated detached-worktree replay at the AST-verified introduction-commit parent (frozen offline install, HEAD-file overlay, Vitest JSON reporter) proving the exact test failed and a named `CONTROL_TEST` passed; the checked-in transcript's `COMMAND`/output are descriptive only; every `control.testRef` (new or pre-existing) additionally requires a genuine paired positive+negative control in-file |
| C9-6 | Every P0-tier row's size/rate-limit dimension is explicitly, mechanically resolved | For every row with `riskScore.tier === 'P0'` (today: `pair/confirm`, `ingest`, `GET /assets`): `control.mechanism` matches the anchored `ENFORCED kind=... scope=... limit=... windowMs=... overflow=...` grammar exactly, `control.testRef` passes C9-5's full bar (incl. replay for a new control), AND the same file's real-transport coverage shows both an under-limit-accepted and an over-limit-rejected passing assertion — or a verified `acceptedRisk` |
| C9-7 | Threat-model doc extended, mechanically cited, P0-complete | `docs/security/daemon-threat-model.md` carries a "Wave 9" section bounded to the next `## ` heading; every `[C9-N]` bullet's cited test is an exact match; **each P0-tier route requires its own bullet naming exactly that one P0 route key** and citing exactly that row's expected reference (`control.testRef` if controlled, else primary `testRef`), already globally associated with only that route — a bullet naming several P0 routes, or reusing an unrelated citation, no longer counts |
| C9-8 | Full risk-score formula enforced per row | AST-derived `exposure` (straight-line dominance grammar, self-probe-verified, comment-blind, duplicate-checked) matches exactly; `impact >= FROZEN_IMPACT_FLOORS[route]`; `score === exposure+impact` exactly; `tier === tierFor(score)` exactly; **gated on all 9 exposure-classifier self-probes passing** |
| C9-9 | Gates | `pnpm guard` and `pnpm typecheck` exit 0 on the current tree |
| C9-10 | Adversarial review of the **implementation** is on record, non-spoofable | `docs/security/library-ingest-implementation-review.json`: `reviewedCommit` resolves and is a STRICT ancestor of `HEAD`; the owned-path diff between `reviewedCommit` and `HEAD` is empty (review covers the final state); `reviewer` distinct from every author in `baseCommit..reviewedCommit`; `verdict === "APPROVE"` |

Plus the three named infra checks: **GATE-INTEGRITY** (advisory self-hash pin, once an
orchestrator-approved hash exists — the F4 route-snapshot collusion round 1 found is
independently closed by C9-1/C9-8 anchoring to baseCommit regardless of pin timing; the pin's
absence is now also `manifest.gateIntegrityPinned`, a top-level field), **LEASE** (`git diff
--name-only <baseCommit>...HEAD` ⊆ `leases.json@baseCommit`'s `W9-ingest.allow`, read via `git
show`, never the working tree), **HEAD-DRIFT** (HEAD must not move mid-run).

## Verified baseline (this run, pre-implementation, post ceremony round-3 fix)

- Glob-discovered `library-*.test.ts` suite: **45/45 passing** across 9 files.
- Route count: confirmed **23**, agreeing across the baseCommit AST scan and real daemon
  introspection.
- **All 9 exposure-classifier self-probes pass** — verified directly by running the verifier,
  reading its `C9-1.txt` artifact, and confirming `self-probes: 9/9 pass`. The baseCommit
  exposure histogram printed alongside it matches this document's "Exposure (today)" column
  exactly, entry for entry, including `POST /api/library/ingest => exposure 3` (the veto working)
  and both `pair/revoke`/`pair/rotate => exposure 2` (the veto correctly NOT firing on routes that
  never call `isLocalSameOrigin`).
- The item-3 AST title parser (`extractStaticTestTitlesFromSource`) was spot-checked outside the
  verifier against all 9 real `library-*.test.ts` files: every extracted title matches the
  Vitest JSON reporter's own `title` field exactly (cross-checked directly against a captured
  `suite-run.attempt-1.json`); a decoy source with only route-path string literals and a
  commented-out `it(...)` call yields zero titles; `it.concurrent`, `test.fails`, `it.each`'s
  outer title call, and a nested `it` inside a `describe.skip` block all extract correctly, while
  the `describe` title itself does not.
- The item-5 `ENFORCED` grammar parser was checked against 11 cases (3 valid, 8 invalid,
  including "no rate limit exists", a future-tense sentence, `windowMs=none` on `request-rate`, a
  positive `windowMs` on `byte-volume`, a zero limit, a negative limit, trailing text, and wrong
  case) — every case resolved as expected.
- `archiveRunArtifacts`' construct-then-reread-verify path was exercised live: `archiveOk: true`
  in both the canonical and the run-archived manifest, confirmed by reading the manifest back off
  disk after the run, not merely by trusting the process exit code.
- The full git-worktree replay pipeline (`git worktree add --detach` → `mise trust` → `pnpm
  install --offline --frozen-lockfile` → HEAD-file overlay → Vitest JSON reporter run) was
  validated live against a real parent commit and a real existing test file before this round's
  code was written; it has not yet been exercised THROUGH `checkTestRef` end-to-end in this run,
  because no attribution matrix exists yet pre-implementation (C9-5 correctly reports "no matrix
  to check" rather than skipping silently) — see **Adversarial review** for the resulting residual.
- `docs/security/library-ingest-attribution.json`,
  `docs/security/library-ingest-implementation-review.json`: do not exist yet (C9-3 through C9-8
  and C9-10 fail honestly).
- Rate/volume control on any of the three P0 rows: confirmed absent (C9-6 fails honestly).
- `docs/plans/waves/DECISIONS.md` at `baseCommit` (`ff47420b8`, this branch's actual merge-base
  with `origin/main` as of this run — see "Ground facts") carries zero `### W9-ACCEPT-*` entries
  yet, confirmed by direct regex scan, not assumed.

## Adversarial review

GPT-5.6 Sol. Rounds 1 and 2's findings and rulings, and the ceremony's six ruled mechanical
defects, are fully disposed below. Per the ceremony's failure path, this round is followed by
exactly one fidelity-only confirmation; any verdict other than APPROVE goes directly to the
founder. **The three residuals below are the SAME three the ceremony's own r3 confirmation ruled
acceptable-LOW and settled — unchanged, word-for-word, in this round, per the coordinator's
explicit instruction that they must not change:**

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

**One new residual, honestly flagged from this round's own work (not a reopening of any settled
item above):**

- The item-2 replay mechanism (isolated detached worktree, `mise trust`, frozen offline `pnpm
  install`, HEAD-file overlay, Vitest JSON run) was validated directly against a real parent
  commit and a real existing test file before this round's code was written, and its constituent
  functions (the AST title parser, the `ENFORCED` grammar parser) were separately spot-checked
  against real files and a deliberate valid/invalid battery — but the full path has not yet run
  end-to-end THROUGH `checkTestRef` inside a verifier run, because no attribution matrix exists
  yet pre-implementation (there is no `control.testRef` for it to evaluate). The first real
  exercise of this path happens when an implementation branch's matrix cites a genuinely new
  test — a legitimate, structural consequence of this document being authored before any
  implementation exists, not a gap in the mechanism itself.

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

### Round 2 (7 dispositions + rulings + 4 new defects) — superseded by round 3 (ceremony) where noted

**Finding 1 (FIXED-WITH-NEW-DEFECT → RESOLVED in round 2; exposure-classifier mechanism further
replaced in round 3 — see below).** `GET /api/library/assets`'s floor corrected from `0` to `2`
(S9-2 — it calls `runReconcile(false)`, a real mutation; this floor correction is unchanged and
settled). Round 2's own fix made exposure detection reachability-aware, scoped to top-level
statements, comment-blind, and stopping at the first unconditional return — round 3's ceremony
found this still let a recursive descendant search find a guard call inside dead code and
replaced the detection mechanism with the straight-line dominance grammar described in S9-2 and
"Round 3 (ceremony)" below. `GATE-INTEGRITY`'s unpinned state is now a top-level manifest field
(`gateIntegrityPinned`) — unchanged, settled.

**Finding 2 (NOT FIXED → RESOLVED).** Every attribution field now clears a placeholder floor
(length + denylist + anti-repetition); `authn` is checked against its row's mechanically-derived
exposure class; `acceptedRisk.decisionRef` requires an exact match to a unique, fully-structured,
route-bound, non-self-accepted `DECISIONS.md@baseCommit` entry (S9-3).

**Finding 3 (NOT FIXED → RESOLVED in round 2; several of its own mechanisms further replaced in
round 3 — see below).** Round 2 made primary `testRef` unique per row and required a path-derived
route-association term (unchanged, settled). Round 2's own "new" decision (test-title existence at
baseCommit via quoted-string matching), red-transcript format (`PARENT_SHA`/`COMMAND`/`TEST`
header trusted as authored), citation uniqueness (primary refs only), and C9-6 mechanism check
(enforcement-pattern-plus-negation-veto regex) were each found still-gameable by the ceremony and
replaced — see "Round 3 (ceremony)" items 2/3/4/5 below for the current mechanisms. The pairing
check (actual positive+negative signal match on `control.testRef`, not a raw count) is unchanged
and settled — it is one of the three r3 accepted-LOW residuals in **Adversarial review**. C9-7's
P0-bullet requirement is tightened further in round 3 (item 4) from "the route's key somewhere in
the cited bullet" to "exactly one P0 key, citing exactly that row's expected reference."

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

**Finding 7/9 (FIXED-WITH-NEW-DEFECT → RESOLVED in round 2; round 2's own fix itself found
still-swallowing and replaced in round 3 — see below).** Archived per-run manifests rewrite their
own `criteria[].artifact` paths to run-dir-local copies before writing (fully self-contained,
independently re-verifiable without touching the canonical, overwrite-prone `proof/` paths) —
unchanged, settled. `archiveOk` as a top-level manifest field and a hard exit-code
contributor — unchanged, settled. What round 2 got wrong: it computed the true archival outcome
AFTER writing the archived manifest, then patched `archiveOk` in with a "post-success best-effort
correction" wrapped in a silent catch — the ceremony found that correction itself swallowable.
Round 3 removes it; see "Round 3 (ceremony)" item 6 below for the construct-then-reread-verify
replacement.

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

### Round 3 (ceremony — 6 ruled mechanical defects, confined to this document and the verifier)

Three consecutive non-APPROVE verdicts (round 1, round 2, and round 2's own confirmation pass)
fired the program's stop rule. The founder-delegated escalation ceremony's analysis confirmed
round 2's attribution-authority work, the C9-10 redesign, the floor corrections, and the
stale-proof mechanics FIXED, and ruled the three residuals in **Adversarial review** above
acceptable-LOW and settled — **none of that was touched in this round.** It then ruled six
specific mechanical defects still blocking and authorized exactly one ceremony-bounded fix round,
"implement EXACTLY, nothing else," confined to this document and `scripts/waves/verify-w9-ingest.ts`.

**Item 1 (exposure classifier — dead-code acceptance, blocking → RESOLVED).** The classifier's
positive-guard detection no longer performs ANY recursive descendant search. It now recognizes
only two exact statement sequences as direct children of the handler's own `body.statements`
(optionally preceded by exactly one `applyExtensionCors(req, res)` prelude), each requiring its
terminating `if` to unconditionally return or throw — a call inside a branch/loop/callback/nested
function/class, or one whose result is ignored, or one placed after a response operation, no
longer counts, regardless of whether the surrounding branch is live or dead. The `isLocalSameOrigin`
veto keeps a bounded recursive walk but now performs real dead-branch elimination (statically-false
`if`/`while`/`for`, `do...while`'s always-once semantics, unknown conditions kept reachable). Nine
self-probe fixtures — covering both real positive shapes, both dead-branch decoy classes, a
branch-only guard, an ignored-result guard, a post-response guard, and both `isLocalSameOrigin`
veto directions — run through the exact production `collectRouteRegistrations`/`classifyExposure`
pipeline and gate C9-1/C9-8 outright on any failure. See S9-2, and "Verified baseline" above for
this run's 9/9 self-probe pass confirmation with the exposure histogram cross-checked against the
frozen table.

**Item 2 (red evidence — fabricated transcripts, blocking → RESOLVED).** Checked-in `COMMAND` and
output text are now descriptive only, never executed or trusted. `PARENT_SHA` must equal the
independently-computed introduction commit's first parent (the first commit in `baseCommit..HEAD`
whose AST contains the exact new declaration, via item 3's parser), and real proof now comes from
an isolated detached `git worktree` at `PARENT_SHA`, a frozen offline `pnpm install` (after `mise
trust`, discovered necessary via a live smoke test — a fresh worktree's `mise.toml` starts
untrusted), a HEAD-file overlay, and a Vitest JSON-reporter run requiring a nonzero exit, the
cited test `failed`, and a new required `CONTROL_TEST` field's test `passed`. The replay's own
argv/commits/statuses/output-hash/exit-code are captured in C9-5's own artifact. See S9-3.

**Item 3 (historical test-declaration parsing — naive quoted-string match, blocking → RESOLVED).**
Whether a title "existed at baseCommit" is now decided by a real TypeScript-AST parse matching
only the static first argument of a syntactic `it`/`test` declaration (including modifier chains
and `.each`'s outer title call), string-literal/no-substitution-template only, compared against
the reporter's exact leaf `title` field — never a substring scan across the whole file, which let
an ordinary route-path string falsely grant the pre-existing-test exemption. Dynamic/unavailable
titles fail closed as new. See S9-3, and "Verified baseline" for the direct spot-check against all
9 real test files plus a decoy and a modifier-chain fixture.

**Item 4 (citation uniqueness / C9-7 association, blocking → RESOLVED).** One global map from
exact test `fullName` to route key now spans every row's `testRef` AND every row's
`control.testRef` together (round 2 only deduped primary refs). C9-7 now requires each P0 route's
own bullet to name exactly one P0 route key and cite exactly that row's expected reference
(`control.testRef` if controlled, else primary `testRef`), already globally associated with only
that route — a bullet naming several P0 routes, or reusing an unrelated passing citation, no
longer counts. See S9-3's `control` bullet and the threat-model paragraph.

**Item 5 (C9-6 enforcement grammar — gameable prose regex, blocking → RESOLVED).** The keyword
regex (which let "no rate limit exists" pass because it contains both `rate` and `limit`) is
replaced by the anchored `ENFORCED kind=... scope=... limit=... windowMs=... overflow=...`
declaration grammar, with `request-rate`/`pair-attempt` requiring a positive `windowMs` and
`byte-volume` requiring `windowMs=none`. The declaration remains descriptive; C9-6 passes only
when the route-unique `control.testRef` passes the full C9-5 bar (including replay for a new
control) AND the same file's real-transport coverage shows both an under-limit-accepted and an
over-limit-rejected passing assertion. See S9-4, and "Verified baseline" for the 11-case grammar
spot-check.

**Item 6 (archive finalization — swallowed failure, blocking → RESOLVED).** The round-2
post-success "best-effort correction" (which could itself silently swallow a failed rewrite) is
removed entirely. `archiveRunArtifacts` now constructs the archived manifest with `archiveOk:true`
BEFORE writing, then rereads and independently verifies: the file parses, `archiveOk === true`,
its recorded hash matches, and every archived artifact exists with a matching hash — only then may
it return `ok:true`. Any failure at any step returns `ok:false`, and no catch block may preserve or
restore `true`. See "Definition of green" predicate 3 and "Verified baseline" for this run's live
`archiveOk: true` confirmation, reread off disk.

**Confirmation-review scope, restated verbatim from the ruling:** "The confirmation review is
limited strictly to whether `docs/plans/waves/W9-ingest-tranche.md` and
`scripts/waves/verify-w9-ingest.ts` implement items 1–6 exactly as ruled here; it must not reopen
previously fixed findings or the three r3 accepted-LOW residuals, and any regression within the
six ruled mechanisms counts as non-fidelity." Per the ruling's failure path: this round is
followed by exactly one fidelity-only confirmation; any verdict other than APPROVE goes directly
to the founder, with no further fix round absent explicit founder authorization.
