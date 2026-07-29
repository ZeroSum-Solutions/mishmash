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

**Status: FOUNDER-AUTHORIZED FIDELITY ROUND (round 8, post-confirmation-#5 REJECT).**
Round 1 returned REJECT (9 findings); round 2 returned REJECT again; round 2's own confirmation
pass returned REJECT a third consecutive time, firing the program's stop rule and escalating to a
founder-delegated ceremony, which ruled six mechanical defects and authorized one ceremony-bounded
fix round (round 3, disposed below). Round 3's own fidelity-only confirmation (confirmation #1)
returned REJECT on five of those six items plus one regression the round-3 fix itself introduced;
the founder authorized round 4. Round 4's own fidelity-only confirmation (confirmation #2) ruled
the round-4 regression fix CLOSED and item 6 (archive finalization) settled byte-identical, but
found five of round 4's own five fixes still imprecise; the founder authorized round 5. Round 5's
own fidelity-only confirmation (confirmation #3) ruled points 1 and 3 FIXED, probe-verified against
every decoy shape including deeper chains, factory-of-factory, and parenthesized/comma expressions,
with settled areas confirmed AST-hash-identical; the founder authorized round 6, disposed below.
Round 6's own fidelity-only confirmation (confirmation #4) ruled point 5 FIXED (the non-digit
lookaround is exact and PRD-consistent) and the round-4 suite-count-regression removal correct —
both settled — but found points 2 and 4 still failing on structural grounds. **Point 2:** an
independent forensic read of this worktree's actual installed `@vitest/runner@4.1.6` source proved
the JSON reporter's file-level `message` field structurally cannot carry a nested `describe`
block's own `afterAll` failure (it attaches only to that nested suite's own result; only the failed
*state*, never the error, propagates to the file) — no amount of additional reporter-field-reading
could close this, so the founder authorized a full redesign bypassing the JSON reporter for a
runner-script-driven walk of Vitest's own reported task forest (`vitest/node`'s `startVitest`,
`ctx.state.getTestModules()`/`getUnhandledErrors()`). **Point 4:** the round-6 fence regex was a
character class, not an alternation, so it still accepted mixed runs, unlimited indentation before
recognizing a marker, and backtick openers with backtick-containing info strings. The founder
authorized exactly one further scoped round (round 7) implementing the full point-2 redesign and
the point-4 grammar correction, followed by exactly one more fidelity-only confirmation
(confirmation #5). Confirmation #5 ruled point 4 FIXED, permanently closed, and additionally
**validated the point-2 Node-API redesign itself**: the Node API correctly exposes nested-suite and
unhandled errors, and the predicate correctly rejects errors outside the target — target-skip/pass
rejection, control-error rejection, module-failure rejection, and unhandled-error rejection were all
confirmed correct, against this worktree's actually-installed `vitest@4.1.6`. It found no design-level
failure in round 7's redesign, only three implementation defects inside it, and the founder
authorized exactly one further scoped round (round 8, this one) fixing exactly those three, followed
by exactly one more fidelity-only confirmation (confirmation #6). **Defect 1 (exit-code clobbering):**
the generated runner called `process.exit(0)` unconditionally after serializing, overriding Vitest's
own `process.exitCode = 1` for a failed run, so the parent's `runResult.status === 0` check rejected
every genuine red replay — contradicting the accepted-case claim then in this document. Fixed by
letting the runner exit with whatever `process.exitCode` Vitest itself already set
(`process.exitCode ?? 0`) instead of forcing zero. **Defect 2 (spoofable marker):** the marker was a
fixed, predictable string, and extraction trusted the first stdout line with that prefix, so the
executed HEAD test file could raw-write the same prefix plus attacker-chosen JSON ahead of the real
serialization. Fixed with a per-invocation CSPRNG marker generated fresh in the verifier process per
replay and embedded only into that replay's own generated runner source, plus extraction that fails
closed unless the marker appears on stdout **exactly once**. **Defect 3 (exact-one-failure
regression):** failed leaves were stored by `fullName` and only names unequal to the target were
rejected, so two failed leaves that happened to share the target's exact `fullName` filtered each
other out and were silently accepted, violating the single-failed-leaf promise. Fixed by counting
failed leaves by node during the walk (never deduplicated by name), requiring the count to be exactly
one and that leaf's `fullName` to equal the target's. All three fixes are detailed with citations in
Round 8 below. Points 1, 3, 4, and 5, item 6 (archive finalization), the round-4 regression fix, the
const guards, the prelude binding, and both-stream `sh()` all remain settled and untouched — the
ceremony's original analysis (round 2's attribution-authority work, the C9-10 redesign, the floor
corrections, the stale-proof mechanics, and all three author-flagged residual-risk notes in
**Adversarial review** below) likewise. Every finding across all eight rounds is disposed in
**AUTHOR-FLAGGED / DISPOSITIONS** at the end of this document, which is the authoritative change
record; earlier prose in this document reflects the current, fixed state, not the history — the
dispositions section carries the history. Any verdict on this round other than APPROVE goes
directly to the founder, with no further fix round absent explicit founder authorization.

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
  **genuine paired positive+negative control** (round-2 mechanism, an author-flagged residual —
  see **Adversarial review** — whose PAIRING requirement the confirmation round found regressed in
  code and is restored here explicitly): **two DISTINCT passing assertions** in that file — one
  whose name reads as a positive/accepted-path signal, a **different** one whose name reads as a
  rejection/negative-path signal. A single passing assertion whose name happens to satisfy both
  regexes at once (an omnibus name) does **not** count as the pair on its own — this is the same
  at-least-two-assertions bar the parent implementation always enforced; a raw "≥2 passing
  assertions" count, unbound to which two, is not this either.

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
  no fetch), overlays **only the HEAD version of the containing test file** on top.

  **Round 6 (confirmation #4) redesign — Vitest's JSON reporter is bypassed entirely for the
  replay's own pass/fail predicate.** An independent forensic read of this worktree's actually-
  installed `vitest@4.1.6`/`@vitest/runner@4.1.6` sources proved the reporter's per-file `message`
  field only ever carries an error attached directly to the root file task; a NESTED `describe`
  block's own `afterAll` throwing is caught and attached to *that nested suite's own result*
  (`@vitest/runner`'s `failTask`, called from inside the suite's own `afterAll` hook handler) —
  the failed *state* propagates up to every ancestor, but the error object never does. A scenario
  with the target test failed, the control passed, and a clean top-level file `message` could
  therefore still coexist with a real, hidden nested-suite hook failure the reporter never
  surfaces. The reporter also silently drops process-level unhandled errors (it never reads
  Vitest's separate unhandled-errors collection at report time). Both gaps are structural to the
  reporter itself, not fixable by reading more of its fields.

  The replay now generates a **runner script** (verifier-constructed source, written fresh into
  the throwaway detached worktree — never checked-in command text, the same anti-gaming principle
  as the argv construction below) that imports Vitest's own **Node API** (`startVitest` from
  `vitest/node`, resolved from the worktree's own frozen-offline-installed
  `apps/daemon/node_modules`), runs exactly the one replay file with the same config, and — after
  the run completes — walks the run's own **reported task forest** (`ctx.state.getTestModules()`,
  recursively through each module/suite/test's `.children`) plus its **unhandled-errors
  collection** (`ctx.state.getUnhandledErrors()`), serializing `{type, name, fullName, state,
  errors}` for every node to one JSON line on stdout behind a per-invocation marker — a CSPRNG
  value the verifier generates fresh for each replay and embeds only into that replay's own
  generated runner source — extracted only when it appears on stdout **exactly once** (zero or
  multiple occurrences is an evidence failure, never a first-match trust). This is the
  same public "reported tasks" surface Vitest's own reporters are built on, so it is not a fragile
  reach into private internals.

  The replay passes only when, over that serialized forest: exactly one module (file) task exists;
  walking the entire tree and counting every failed test leaf by node — never deduplicated by
  name — that count is exactly one and its `fullName` equals the target test's; the **only**
  errors anywhere belong to the target's own test-level result — no suite or module task may carry
  any error, at any depth; the unhandled-errors collection is empty; and the control test's own
  leaf state is `passed`. The runner process must also exit nonzero: it preserves whatever
  `process.exitCode` Vitest's own run outcome already set instead of forcing a fixed exit status, so
  a genuine red replay reaches the parent as a nonzero exit and an all-green run is rejected outright
  for carrying no red evidence. A missing test, install failure, a spawn error or timeout (surfaced
  distinctly by the verifier's process wrapper, never conflated with an ordinary nonzero exit), a
  missing or unparsable runner output line, or any error anywhere else in the tree is an evidence
  failure, not a pass. The replay's own constructed argv, resolved commits, the full serialized
  forest, and a hash covering the runner's own output plus both process streams are captured in
  **C9-5's own artifact** — the implementer-authored transcript text can no longer substitute for
  that evidence. The current HEAD suite must still independently show the cited test passing.
  Coverage that already existed at `baseCommit` (SSRF, token-binding, etc.) is exempt from the
  red-artifact/replay requirement per this section's "may cite directly" allowance, but never from
  the paired positive/negative-control requirement above, which applies to every `control.testRef`
  regardless of new/old status.
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
(the current HEAD suite's own passing assertions) shows **two DISTINCT** passing assertions — one
under-limit-accepted, one over-limit-rejected — each **bound**, not merely coexisting in the same
file: **same route** (the existing path-derived association terms), **same parsed limit** — the
declaration's own `limit` value must appear in the assertion name as an **exact numeric token**
(bounded by non-digit characters or the string's own start/end, so `limit=10` matches `"...within
the 10 request limit"` but never `"...within the 100 request limit"`) — and, for the over-limit
side specifically, **same declared overflow outcome**, matched the same exact-token way (`429` for
`overflow=reject-429`, `413` for `overflow=reject-413`; `429` never matches inside `1429`). An
unbounded substring test (`fullName.includes('10')`, `fullName.includes('429')`) is explicitly
insufficient — round 3's own first attempt at this binding used exactly that unbounded form,
confirmed still-gameable: "ingest allow 100 requests" satisfies a `limit=10` substring check, and
"ingest reject 100 requests with 1429" satisfies both a `limit=10` and an `overflow=reject-429`
substring check, without naming either fact exactly. A single omnibus assertion whose name happens
to satisfy both the accept- and reject-shaped language does not count as the pair, and an unrelated
same-file assertion that never exactly names the route, the limit, or the overflow code does not
count either. An in-process control (a bounded per-token-hash, per-origin, or per-pairing-attempt
counter, entirely inside `routes/library.ts`) is achievable inside this tranche's lease for all
three current P0 rows; a `library-tokens.ts`-level or `server.ts`-level control is not (ruling 1).

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
| C9-5 | Every `testRef`/`control.testRef` names a real, currently-passing, globally-route-unique test; new controls carry independently-replayed red evidence | Exact `fullName` equality; a path-derived association term must appear; **one global map spans every row's `testRef` AND `control.testRef`** — reuse across two routes fails; "new" decided by an AST-derived test-title match at `baseCommit`; a new control's citation requires an isolated detached-worktree replay at the AST-verified introduction-commit parent (frozen offline install, HEAD-file overlay) — **the replay runs Vitest's own Node API through a verifier-generated runner script, never the JSON reporter**, and passes only when the full reported task forest shows exactly one file and exactly one failed test leaf anywhere in the tree (counted per node, never deduplicated by name), that leaf's `fullName` equal to the target's, the ONLY error anywhere belongs to the target's own assertion failure, no suite/module carries any error, the unhandled-errors collection is empty, and the control test passed; the checked-in transcript's `COMMAND`/output are descriptive only; every `control.testRef` (new or pre-existing) additionally requires a genuine paired positive+negative control in-file — **two DISTINCT passing assertions**, never one omnibus name satisfying both sides |
| C9-6 | Every P0-tier row's size/rate-limit dimension is explicitly, mechanically resolved | For every row with `riskScore.tier === 'P0'` (today: `pair/confirm`, `ingest`, `GET /assets`): `control.mechanism` matches the anchored `ENFORCED kind=... scope=... limit=... windowMs=... overflow=...` grammar exactly, `control.testRef` passes C9-5's full bar (incl. replay for a new control), AND the same file's real-transport coverage shows **two DISTINCT** passing assertions — one under-limit-accepted, one over-limit-rejected — each bound to the same route, the declaration's own parsed `limit`, and (over-limit side) the declared overflow status code, **matched as an exact numeric token (digit-bounded), never an unbounded substring** — or a verified `acceptedRisk` |
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

### Round 4 (founder-authorized fidelity round — round-3 confirmation REJECT, 5 items + 1 regression)

Round 3's own fidelity-only confirmation returned REJECT: five of the six ruled items were found
still-imprecise (not absent — round 3's structural approach for each was directionally correct,
but each left a specific gap the confirmation named exactly), plus one regression round 3's own
fix introduced. Item 6 (archive finalization) was confirmed **IMPLEMENTED** and is untouched
again this round. The founder authorized exactly one further scoped fidelity round, strictly
confined to the same six points.

**Item 1 (exposure classifier — still imprecise → RESOLVED).** Three sub-gaps, each closed:
(a) `matchToolTokenGuard`/`matchBearerGuard` accepted any variable-declaration kind (`let`/`var`),
not just `const` — both guard matchers now check `(declarationList.flags & ts.NodeFlags.Const)`
explicitly. (b) `isApplyExtensionCorsPrelude` matched the call by callee name alone, accepting
zero, wrong-count, or wrong-identity arguments as the prelude — it now requires exactly two
identifier arguments bound to the enclosing handler's own first two parameter names (threaded
through from `collectRouteGuardSignals` via `finalHandler.parameters`). (c) The `isLocalSameOrigin`
veto's `visitExprSubtree` visited an entire condition expression before evaluating which parts of
it could even execute, so an unreachable short-circuited RHS such as `false && isLocalSameOrigin(
...)` still vetoed — `visitExprSubtree` is now itself short-circuit-aware for `&&`/`||`/ternary,
skipping the unreachable operand via `staticBooleanValue` before ever descending into it. See S9-2
(unchanged prose — it already described `const`, exact `applyExtensionCors(req, res)` binding, and
`&&`/`||` dead-branch elimination as the design intent; only the code fell short).

**Item 2 (replay-at-parent — still imprecise → RESOLVED).** Two sub-gaps: (a) the replay accepted
`ok:true` even when an unrelated assertion failed or timed out alongside the target failure and
passing control — `replayRedEvidence` now also requires `numFailedTests === 1` and that no
assertion other than the target has status `failed`. (b) The "stdout/stderr hash" hashed only
`stdout` — `sh()` is rewritten on `spawnSync` (replacing `execFileSync`'s throw-on-nonzero-exit
dance, whose catch block never read `e.stderr`) so both streams are always captured, and the
replay's hash now covers both. PRD unchanged — it already claimed unrelated-failure rejection; only
the verifier needed to catch up.

**Item 3 (AST-only historical titles — still imprecise → RESOLVED).** `rootIdentifierOfChain`
walked through CallExpressions as well as property-access, so for `it.each('/api/library/ingest')(
'real title', fn)` it resolved BOTH the outer title call and the inner `it.each(...)` factory call
to root `it`, recording the route-literal factory argument as a second, false title; it also
accepted any property name (`it.helper(...)`) as a valid modifier. Replaced with
`resolveKnownTestChainRoot` (a fixed allowlist of real Vitest modifiers — `concurrent`,
`sequential`, `skip`, `only`, `todo`, `fails`, `each`, `for`, `runIf`, `skipIf` — every intermediate
property must be one of these) plus explicit chained-vs-plain-call structural handling: a chained
call's inner factory is marked suppressed the moment its outer wrapper is recognized, so it is
never independently re-examined as its own declaration. Verified directly: the exact
`it.each('/api/library/ingest')('real title', fn)` shape now yields only `'real title'`;
`it.helper('route literal')` yields nothing; the 45 titles extracted from the real
`library-*.test.ts` suite are unchanged.

**Item 4 (C9-7 — still imprecise → RESOLVED).** The bullet-line filter accepted any line
*containing* `[C9-N]`, never checking the line was an actual Markdown list item — a plain paragraph
mentioning a tag satisfied the ruled per-route "bullet line" requirement. Fixed with an anchored
`MARKDOWN_BULLET_LINE` pattern (`^\s*(?:[-*+]|\d+\.)\s+`) required in addition to the `[C9-N]` tag.

**Item 5 (ENFORCED transport proof — still imprecise → RESOLVED, PRD updated too).** Transport
coverage was two independent title-regex searches among *arbitrary* passing assertions in the same
file — unbound to the route, the parsed limit, or the declared overflow outcome, so one unrelated
or omnibus assertion name could satisfy both sides. `matchesUnderLimitAssertion`/
`matchesOverLimitAssertion` now additionally require: the route's own path-derived association
terms, the parsed declaration's own `limit` value as a literal substring, and — over-limit side
only — the declared overflow status code (`429`/`413`) as a literal substring; combined with the
regression fix's `hasDistinctSignalPair` helper, the pair must be two DISTINCT assertions. S9-4 in
this document is updated with the same same-limit/same-overflow binding language (the ruling
explicitly required both sides to move together).

**Regression (paired controls — RESOLVED, PRD updated too).** Round 3's `checkTestRef` paired-
control check let one passing assertion whose name matched both `POSITIVE_SIGNAL` and
`NEGATIVE_SIGNAL` satisfy the pair alone, contradicting the parent (round-2) implementation's
at-least-two-assertions requirement and this document's own "at least one ... at least one"
description. `hasDistinctSignalPair` restores the two-distinct-assertion requirement (shared by
both this check and item 5's binding check); S9-3's `control` bullet is reworded to state the
distinctness explicitly rather than leave it implied.

**Item 6 (archive finalization — CONFIRMED IMPLEMENTED, untouched).** No action this round, per
the founder's instruction; `archiveRunArtifacts`, the construct-then-reread-verify design, and the
removal of the round-2 post-success correction are exactly as round 3 left them.

**Verification this round:** typecheck clean; `pnpm guard` 102/102; all 9 canonical self-probes
re-run and passing, plus 6 new targeted regression probes (one per fix: `let` vs `const`, wrong/
absent `applyExtensionCors` arguments, `false && isLocalSameOrigin(...)` no longer vetoing,
`true || isLocalSameOrigin(...)` no longer vetoing, a live/dynamic `&&` left operand still
correctly vetoing) — all passing; the item-3 title parser independently re-verified against the
real 45-title suite, the exact `it.each(route-literal)(title)` shape, and an unknown-helper decoy;
the item-4 bullet-line pattern independently verified against bullet and non-bullet cases; the
item-5 binding logic and the paired-control regression fix independently verified against
legitimate-pair, omnibus-single-assertion, unrelated-unbound-pair, and missing-overflow-code cases.
No settled design (attribution authority, C9-10, floor corrections, stale-proof mechanics, the
three r3 accepted-LOW residuals, or item 6) changed in this round.

### Round 5 (founder-authorized fidelity round #2 — confirmation #2 REJECT, 5 points)

Round 4's own fidelity-only confirmation (confirmation #2) ruled the round-4 regression fix CLOSED
and item 6 settled byte-identical — both untouched again — but found five of round 4's own five
fixes still imprecise in specific, demonstrable ways. The founder authorized exactly one further
scoped fidelity round, strictly confined to those five points.

**Point 1 (exposure classifier — ternary composition gap → RESOLVED).** `staticBooleanValue`
handled literals, negation, `&&`, and `||`, but had no case for `ConditionalExpression` — so
`(true ? false : isLocalSameOrigin(req)) && isLocalSameOrigin(req)` still vetoed: the dead ternary
arm was correctly skipped by the WALKER (`visitExprSubtree`'s existing `ConditionalExpression`
handling), but the ternary's own static value came back `undefined` from the EVALUATOR, so the
outer `&&`'s reachability check (`staticBooleanValue(left) === false`) never fired and the RHS was
visited anyway. Fixed by teaching `staticBooleanValue` itself to evaluate a ternary whose condition
has a determinable static value: the ternary's own value is that branch's static value, evaluated
recursively; an undeterminable condition still yields `undefined`. Dead arms were already, and
remain, skipped by the walker — this only taught the evaluator what the walker already knew. See
S9-2 (prose unchanged; it already described `&&`/`||` dead-branch elimination as the intent).

**Point 2 (replay-at-parent — process-error / reporter-consistency gap → RESOLVED in round 5, one
of its own two reporter-consistency mechanisms found to be a REGRESSION and replaced in round 6 —
see below).** `sh()` collapsed a spawn error or a timeout-induced kill to an ordinary `status:1`,
indistinguishable from a genuine failing test run, so the replay's only red-exit check
(`status !== 0`) treated a process that never ran a single real test as the expected red state.
`sh()` now returns a `processError` flag (set when `spawnSync` reports `.error` or `.signal`), and
the replay fails outright, before even attempting to parse the reporter's output, whenever it's
set — **unchanged, confirmed correct.** Separately, round 5 added two reporter-consistency checks:
the reporter's own top-level `success` field (must be exactly `false` for a genuine failing run;
a `true` value alongside a failed test is self-contradictory reporter output) — **unchanged,
confirmed correct** — and its suite-level counts (`numTotalTestSuites`/`numFailedTestSuites`, both
required to be exactly `1`). **That second check was itself a regression:** those counts are
Vitest's internal SUITE NODES (every `describe` block is its own suite), not files, so a legitimate
single-file replay containing nested `describe` blocks could be wrongly rejected. Round 6 removes
that equality check and replaces it with file-count semantics — see below. See S9-3 (prose
unchanged; it already claimed unrelated-process-failure rejection, which both rounds' fixes serve).

**Point 3 (historical titles — factory/chain context-independence gap → RESOLVED).** `each`, `for`,
`runIf`, and `skipIf` were accepted as ordinary modifiers indistinguishable from terminal ones
(`concurrent`, `skip`, `only`, `todo`, `fails`), so a standalone or assigned factory call (`const
factory = it.each('/api/library/ingest')`) recorded its own factory argument as a title through the
"plain call" branch, and `it.each('/api/library/ingest').helper('real title', fn)` /
`.skip(...)` still leaked the inner route literal because the prior suppression mechanism only
fired when the OUTER callee was recognized as a chained-call shape at all — an unrecognized outer
shape (`.helper`, `.skip` immediately after a factory call) left the inner factory call
un-suppressed. Fixed by replacing context-dependent suppression with a context-FREE predicate,
`isFactoryCall`: any call whose own direct callee chain terminates in a factory modifier is
rejected as a title source unconditionally, wherever it's encountered in the tree -- standalone,
assigned, or an unrecognized inner link. Only the OUTER invocation of a validated (possibly
multi-level) factory chain's result -- via a new recursive `isValidTestChainExpression` -- may
still contribute a title. See S9-3 (prose unchanged; it already described the outer-title-call
pattern, which continues to work).

**Point 4 (C9-7 bullets — fenced/indented-code gap → RESOLVED in round 5; the round-5 fence tracker
itself found still-imprecise and corrected in round 6 — see below).** The bullet-line check was
still line-regex-only: a `- [C9-N] ...`-shaped line inside a fenced code block, or indented 4+
spaces (CommonMark indented-code), is not a rendered Markdown list item, but both satisfied the
check. Round 5 fixed this by tracking fence state, toggling on every triple-backtick
fence-delimiter line and excluding every line while inside a fence — **but the toggle recognized
only triple-backtick fences blindly, with no run-length awareness:** a tilde-fenced decoy was never
excluded, and a longer opening fence (4+ backticks) was wrongly "closed" by a shorter inner
backtick run, exposing whatever followed. Round 6 replaces this with CommonMark's actual fence rule
(see below). The 4+-leading-space exclusion was correct in round 5 and is unchanged.

**Point 5 (ENFORCED transport binding — unbounded-substring gap → RESOLVED in round 5; the round-5
mechanism itself found FIXED-WITH-DEFECT and further corrected in round 6 — see below).**
The numeric bindings added in round 4 were unbounded substring tests
(`fullName.includes(String(parsed.limit))`), so with `limit=10` and `overflow=reject-429`, a
distinct, wrong-magnitude assertion name like `"ingest allow 100 requests under limit"` or
`"ingest reject 100 requests with 1429"` still satisfied the check — neither the limit nor the
overflow code was actually matched exactly. Round 5 fixed this with `containsExactNumericToken`,
requiring the number to appear bounded by non-digit characters (or the string's own start/end) on
both sides, implemented as `\b<n>\b`. **That implementation was itself imprecise** — a word boundary
is NOT exactly a digit boundary, since `\b` also treats letters and underscores as word characters;
round 6 corrects this (see below). S9-4 and the C9-6 table row were updated in round 5 to describe
exact-token matching explicitly, replacing the "literal substring" language the confirmation found
still-gameable; that prose already said "non-digit characters" (not "word characters") and needed
no further correction in round 6 — only the code's `\b`-based implementation was wrong.

**Verification this round:** typecheck clean; `pnpm guard` 102/102; all 9 canonical self-probes and
the round-4 confirmation regression probes re-run and passing; three new ternary-composition probes
(the exact reported `(true ? false : X) && X` shape confirmed no longer vetoing; its live-condition
mirror confirmed still vetoing; a ternary used directly as the whole condition re-confirmed
unaffected); `sh()`'s `processError` field independently verified against a real nonexistent-binary
spawn error, a real timeout-induced kill, and two ordinary exit-code cases (0 and nonzero), plus
stderr-capture; the replay's new reporter-consistency logic independently verified against a clean
case, the exact reported `success:true`-with-failure case, a suite-level-failure case, and the
existing unrelated-failed-assertion case; the item-3 title parser re-verified against the real
45-title suite (unchanged) plus 12 targeted factory/chain cases including the two exact reported
leaks (`const factory = it.each(...)`, `it.each(...).helper(...)`) and confirmation that legitimate
`runIf`/`skipIf` two-level outer invocations still extract correctly; the C9-7 bullet pattern
re-verified against a real bullet, the exact reported fenced-code case, the exact reported
4-space-indented case, a bullet correctly re-counted after a fence closes, and a lightly-indented
(nested-list-shaped) bullet still counting; the item-5 numeric matcher re-verified against the two
exact reported false-positive cases (`10` inside `100`, `429` inside `1429`) plus exact-match and
string-boundary cases. No settled design (attribution authority, C9-10, floor corrections,
stale-proof mechanics, the three r3 accepted-LOW residuals, item 6, or the round-4 regression fix)
changed in this round.

### Round 6 (founder-authorized fidelity round #3 — confirmation #3 REJECT, 3 points)

Round 5's own fidelity-only confirmation (confirmation #3) ruled points 1 (ternary reachability)
and 3 (factory-title suppression) FIXED — both probe-verified against every decoy shape, including
deeper chains, factory-of-factory, and parenthesized/comma expressions — and confirmed settled
areas AST-hash-identical with clean commit integrity. It found three points still needing work.
The founder authorized exactly one further scoped fidelity round, strictly confined to those three.

**Point 2 (replay consistency — NOT FIXED in round 6; round 6's own fix found structurally
insufficient by confirmation #4 and fully redesigned in round 7 — see below).** Round 5's
process-error, parse-failure, and `success !== false` checks all rejected correctly on their own
terms and remain unchanged. Round 6 additionally extended `FileTestResult` with the JSON reporter's
file-level `status`/`message` and removed the round-5 suite-node-counting regression, replacing it
with file-count semantics. **This entire approach was itself structurally incapable of closing the
gap:** an independent forensic read of this worktree's actual installed `@vitest/runner@4.1.6`
source proved a NESTED `describe` block's own `afterAll` failure is attached to that nested suite's
own result, never propagated into the file-level `message` field the JSON reporter exposes — only
the failed *state* propagates to ancestors, never the error object. A scenario with the target
failed, the control passed, and a clean top-level `message` could therefore still hide a real
nested-suite hook failure no field-level check on the reporter's output could ever see, no matter
how many reporter fields were added. Round 7 replaces the entire mechanism, bypassing the JSON
reporter for a runner-script-driven walk of Vitest's own reported task forest — see below.

**Point 4 (rendered Markdown bullets — NOT FIXED in round 6; round 6's own fence tracker found
still-imprecise by confirmation #4 and corrected in round 7 — see below).** Round 5's fence
tracker matched only a triple-backtick prefix with blind state toggling: a tilde-fenced decoy was
never excluded, and a longer opening fence was wrongly closed by a shorter inner run. Round 6 fixed
this by tracking fences per CommonMark's basic rule: a fence OPENS on a line matching only
whitespace then a run of 3+ backtick OR tilde characters, recording the run's character and length;
a line CLOSES the fence only if it is the SAME character with a run length `>=` the opening length
and nothing else but whitespace. **That regex itself, `[`~]{3,}`, was a character CLASS, not an
alternation** — it still matched a MIXED run such as `` ```~ `` as one homogeneous-looking run of
length 4, which CommonMark does not permit (a fence's own run must be entirely one character); a
mixed run could falsely close a real fence or falsely open one. It also allowed unlimited leading
whitespace (a 4+-space-indented marker line was read as a fence before the indented-code exclusion
ever ran) and performed no info-string check (a backtick opener whose info string itself contained
a backtick was wrongly accepted — CommonMark restricts this specifically for backtick fences, since
it is what disambiguates a code-block opener from an inline code span; tilde info strings carry no
such restriction). Round 7 corrects all three — see below.

**Point 5 (numeric boundary — FIXED-WITH-DEFECT, corrected).** Round 5's `containsExactNumericToken`
used `\b<n>\b` — a WORD boundary, not the non-digit boundary the PRD (and round 5's own comment)
already promised. Since `\b` also treats letters and underscores as word characters, a legitimate
digit-bounded-by-non-digit occurrence like `"...limit10requests..."` or `"..._10_..."` incorrectly
failed to match, even though it correctly kept rejecting wrong-magnitude cases (`10` inside `100`,
`429` inside `1429`). Fixed with explicit non-digit lookarounds, `(?<![0-9])<n>(?![0-9])` — `n` is
always a positive integer from a grammar-validated `EnforcedDeclaration` or a fixed literal
(429/413), so direct interpolation carries no regex-injection risk. The PRD's own S9-4 prose already
said "non-digit characters," not "word characters," so it needed no semantic change; the round-5
disposition entry's incorrect justification ("a word boundary is exactly a digit boundary") is
corrected above, and the verifier now genuinely matches what both documents always promised.

**Verification this round:** typecheck clean; `pnpm guard` 102/102; the full existing self-probe
suite re-run (9 canonical exposure probes, the round-4 regression and ternary-composition probes,
the item-3 factory/chain probes including both exact previously-reported leaks) all still passing,
confirming points 1 and 3 genuinely untouched; byte-diff of `staticBooleanValue`/
`isLocalSameOriginReachable`, the title-parser block, `archiveRunArtifacts`, `hasDistinctSignalPair`
plus the `isControl` paired-control block, and the const-guard/prelude-binding matchers against the
prior confirmed-good commit — all confirmed byte-identical. New targeted probes: (a) a simulated
replay payload with the target failed, the control passed, and a file-level `afterAll` error
message — confirmed rejected; (b) a payload for one file containing nested `describe` suites
(`numTotalTestSuites` > 1) with a clean target/control — confirmed still passes (the exact round-5
regression scenario); a file-level-status-mismatch case and a two-file-result case independently
confirmed rejected too; (c) a tilde-fence decoy confirmed excluded; a backtick line inside a tilde
fence confirmed not closing it; a 4-backtick fence with a shorter inner triple-backtick run
confirmed staying open through the following decoy, only closing on a genuine 4+-backtick line,
with the bullet after it correctly counted; a longer closing run and a fully unclosed fence both
confirmed correct; (d)
`limit10requests` and `_10_` confirmed now matching a `limit=10` binding, while `100`/`1429` are
confirmed still rejected, alongside decimal-context and leading-zero-adjacency sanity checks. No
settled design (attribution authority, C9-10, floor corrections, stale-proof mechanics, the three r3
accepted-LOW residuals, item 6, the round-4 regression fix, points 1 or 3, the const guards, or the
prelude binding) changed in this round.

### Round 7 (founder-authorized fidelity round #4 — confirmation #4 REJECT, 2 points)

Round 6's own fidelity-only confirmation (confirmation #4) ruled point 5 FIXED (the non-digit
lookaround is exact and consistent with the PRD's promised lexical contract — a `10.5`-context
match was explicitly ruled consistent with that contract) and the round-4 suite-count-regression
removal correct — both settled and untouched again this round. It found points 2 and 4 still
failing, on structural rather than merely imprecise grounds, and the founder authorized exactly one
further scoped round implementing the redesign/correction below.

**Point 2 (replay error visibility — structural redesign, RESOLVED).** Every prior round's fix to
this mechanism (rounds 3, 5, and 6) worked by reading MORE fields off Vitest's JSON reporter output
— exact assertion status, the reporter's own `success` field, suite counts, then finally the
file-level `status`/`message` fields. Confirmation #4 supplied a forensic proof, read directly
against this worktree's actually-installed `vitest@4.1.6`/`@vitest/runner@4.1.6` sources, that this
entire approach was structurally incapable of closing the gap: a NESTED `describe` block's own
`afterAll` hook failure is caught and attached via `failTask` to *that nested suite's own*
`result.errors` — confirmed directly in `@vitest/runner`'s installed `chunk-artifact.js`, at the
`catch (e) { failTask(suite.result, e, ...) }` handler wrapping the `await $("suite.afterAll", ...)`
call inside the suite-execution routine, and in `failTask`'s own body (`result.state = "fail";
result.errors ??= []; result.errors.push(...)`). A SEPARATE helper, `hasFailed`, walks the tree
afterward and propagates only the FAILED **state** to every ancestor (`suite.result.state = "fail"`
when `hasFailed(suite)`) — never the error object itself. No field the JSON reporter exposes at the
file level can therefore ever carry a nested suite's own hook error; reading more of that reporter's
own output was never going to close this, no matter how many rounds tried.

The fix bypasses the JSON reporter entirely for the replay's own pass/fail predicate. The verifier
generates a **runner script** — verifier-constructed source (`buildReplayRunnerScript`), written
fresh into the throwaway detached worktree, never checked-in command text, the identical
anti-gaming principle the pre-existing verifier-built argv already used — that imports Vitest's own
**Node API**, confirmed directly against this worktree's installed sources:
- `createVitest`/`startVitest` are exported from the `vitest/node` subpath
  (`node_modules/vitest/package.json`'s `"./node"` export → `dist/node.js` → re-exported from
  `dist/chunks/cli-api.*.js`).
- `startVitest(mode, cliFilters, options, ...)` (`cli-api.*.js`) runs collection AND execution and
  resolves to the Vitest instance (`ctx`) once the run completes; `cliFilters: [<relative file
  path>]` narrows a run to exactly that one file, confirmed live against a scratch multi-file
  project (a second, unrelated test file in the same directory never ran).
- `ctx.state.getTestModules()` (`StateManager.getTestModules`, same chunk) returns Vitest's own
  "reported tasks" API — `TestModule`/`TestSuite`/`TestCase` instances, the same public surface
  Vitest's own built-in reporters consume, not a private-internals reach. `TestModule` and
  `TestSuite` both extend `SuiteImplementation`, which exposes `.errors()`
  (`task.result?.errors || []`) and `.state()`; both expose `.children` (an iterable
  `TestCollection`) enabling a full recursive walk. `TestCase` exposes `.result()` returning
  `{ state, errors }` for that one test.
- `ctx.state.getUnhandledErrors()` (`StateManager.getUnhandledErrors`, `Array.from(this.errorsSet)`)
  returns the run's process-level unhandled-errors collection, independent of any reporter and of
  the task tree.

The runner walks the entire forest recursively, serializing `{type, name, fullName, state, errors}`
for every module/suite/test node, plus the unhandled-errors collection, to one JSON line on stdout
behind a per-invocation marker (a CSPRNG value the verifier generates fresh per replay and embeds
only into that replay's own generated runner source; round 8, see below). Vitest's own console
output is not suppressed and may share stdout with the runner's own line, so extraction requires
the marker to appear on stdout **exactly once** — zero or multiple occurrences is an evidence
failure, never a first-match trust. After serializing, the runner closes the Vitest context and
exits with whatever `process.exitCode` Vitest itself already set (`process.exitCode ?? 0`) instead
of forcing a fixed exit status (round 8, see below), so a genuine red run reaches the parent as a
nonzero exit and a genuine all-green run reaches it as zero. All of the above was additionally
validated **empirically**, in isolated scratch temp directories (never the repo worktree, never any
daemon), against a real `vitest@4.1.6` run:
- A nested `describe`'s throwing `afterAll`, alongside a failing target and a passing control:
  the serialized tree shows the nested suite's own `errors` populated with the hook's message,
  while the file's own `errors` stays empty — the replay predicate correctly **rejects** it.
- A standalone unhandled promise rejection, alongside a failing target and a passing control: the
  tree itself is completely clean, but `unhandledErrors` is populated — the replay predicate
  correctly **rejects** it.
- The legitimate shape — a failing target, a passing control, and an unrelated nested `describe`
  with no errors of its own — produces a fully clean tree and an empty unhandled-errors collection;
  `evaluateTaskForestConsistency` reports zero problems for it. (Round 7 validated only this
  predicate in isolation; round 8 additionally validated the full pipeline end-to-end, including the
  runner's real process exit status — see below.)
- `cliFilters` targeting was independently confirmed against a two-file scratch project: only the
  named file's module appears in the result (`moduleCount: 1`), the unrelated file never runs.
- **(Round 8)** The same legitimate shape was driven through the actual parent-process status path,
  not just the predicate: the runner process exited nonzero (matching Vitest's own `process.exitCode`
  for a failed run), and the full acceptance path — predicate plus the `runResult.status === 0`
  rejection — accepted it. A companion all-green scratch run (target and control both passing)
  exited status 0 and was correctly rejected outright for carrying no red evidence.
- **(Round 8)** A test file that raw-writes a decoy line starting with the runner's own marker,
  followed by attacker-chosen JSON, ahead of the real serialization was confirmed to produce two
  marker-prefixed lines on stdout; extraction requires exactly one and rejects the replay when it
  finds zero or more than one.
- **(Round 8)** Two failed test leaves sharing the exact same `fullName` as the target were
  confirmed to be rejected: failed leaves are counted per node during the walk, never deduplicated
  by name, so a count of two fails the replay regardless of what either leaf is named. A duplicate-
  named **passing** sibling next to the real failing target was also probed in both declaration
  orders: the failed-leaf count is unaffected (it is always exactly one, correctly attributed to the
  real failure) and never causes an insecure accept, but the pre-existing, unchanged
  `targetState`/`controlState` matching is itself by `fullName` and is therefore order-dependent
  under a name collision — whichever same-named node the walk visits last determines the observed
  target state, so a passing duplicate visited after the real failure can produce a spurious
  rejection (fails closed, never an insecure accept). This is a pre-existing characteristic of the
  file's `fullName`-as-identity-key trust model, unchanged by round 8 and out of this round's scope;
  duplicate literal test titles are already an ambiguous shape the rest of the verifier does not
  fully disambiguate either.

The replay now passes only when: exactly one module (file) task exists in the forest; walking the
entire tree and counting every failed test leaf by node — never deduplicated by name — that count
is exactly one and its `fullName` equals the target test's; the ONLY errors anywhere belong
to the target's own test-level result — no suite or module task may carry any error, at any depth;
the unhandled-errors collection is empty; the control's own leaf state is `passed`; and the runner
process itself exits nonzero. `sh()`'s existing `processError` flag (round 5, unchanged) still fails
the replay outright, before even attempting to read the runner's output, on a spawn error or
timeout. The transcript hash now covers the runner's own serialized output plus both process
streams, per the ruling. See S9-3, updated with the full mechanism and the forensic citations above.

**Point 4 (fence tracking — grammar correction, RESOLVED).** The round-6 regex, `` [`~]{3,} ``, was
a character CLASS, not an alternation — CommonMark requires a fence's own run to be entirely one
character, but a character class matches ANY mix of the listed characters, so a run like `` ```~ ``
(three backticks then a tilde) was read as one homogeneous-looking run of length 4. Such a mixed
run could falsely close a real fence (exposing whatever followed as if the fence had ended) or
falsely open one. Separately, `^\s*` allowed unlimited leading whitespace before a marker, so a
4+-space-indented line was read as a fence candidate before the indented-code exclusion ever had a
chance to apply; and no info-string check meant a backtick opener whose info string itself
contained a backtick was wrongly accepted as a valid opener.

Fixed with the anchored grammar `^( {0,3})(`{3,}|~{3,})(.*)$` — separate single-character
alternates (`` `{3,} `` or `~{3,}`, never a mixed class) mean a matched run is now provably
homogeneous; the indentation capture is bounded to exactly 0–3 literal spaces, so a 4+-space-
indented line simply fails to match the fence pattern at all and falls through to the unchanged
indented-code exclusion naturally, with no explicit ordering dependency needed. A backtick run
whose info string (`rest`) contains a backtick is rejected as an opener — CommonMark restricts this
specifically to backtick fences, since it is what disambiguates a code-block opener from an inline
code span; tilde info strings carry no such restriction and are accepted unconditionally, including
one containing a backtick. Closing semantics are unchanged: the SAME character, a run length `>=`
the opening length, and nothing else but whitespace on the line. Verified against the exact
`` ```~ `` mixed-run shape (both as a would-be opener, where it correctly opens a 3-backtick fence
with `~` as an ordinary info-string character rather than a 4-length mixed run, and as a would-be
closer inside a real fence, where it correctly fails to close it), a 4-space-indented marker (both
alone and immediately followed by a real bullet, confirming it never suppresses anything), a
backtick opener with a backtick in its info string (confirmed it neither opens a fence nor corrupts
recognition of a later genuine fence), a tilde opener with a backtick in its info string (confirmed
still valid), and a longer closing run.

**Verification this round:** typecheck clean; `pnpm guard` 102/102; the full existing self-probe
suite re-run (9 canonical exposure probes, the round-2-confirmation regression and round-5
ternary-composition probes for point 1, the 14 factory/chain title probes for point 3, the round-5
non-digit-boundary probes for point 5) all still passing. Byte-diff of `staticBooleanValue`/
`isLocalSameOriginReachable` (point 1), the title-parser block (point 3), `containsExactNumericToken`
(point 5), `archiveRunArtifacts` (item 6), `hasDistinctSignalPair` (the round-4 regression fix), the
const-guard/prelude-binding matchers, and `sh()` itself against the prior confirmed-good commit —
all confirmed byte-identical; the working-tree diff against that commit touches exactly three hunks,
all inside the two points' intended regions. New probes: the exact task-forest predicate
(`evaluateTaskForestConsistency`) re-run against the real captured empirical outputs for all three
scenarios (nested-`afterAll`-throws rejected, unhandled-rejection rejected, legitimate-with-nested-
describes accepted), plus synthetic edge cases (a two-module-task forest rejected, a 3-level-deep
clean tree accepted); the fence grammar re-run against the exact mixed-run, indentation, and
info-string shapes named above. No settled design (attribution authority, C9-10, floor corrections,
stale-proof mechanics, the three r3 accepted-LOW residuals, item 6, the round-4 regression fix,
points 1, 3, or 5, the const guards, the prelude binding, or both-stream `sh()`) changed in this
round.

### Round 8 (founder-authorized fidelity round #5 — confirmation #5 REJECT, 3 implementation defects)

Round 7's own fidelity-only confirmation (confirmation #5) ruled point 4 (fence tracking) FIXED and
permanently closed — the PRD matches — and additionally **validated the point-2 Node-API redesign
itself**: the Node API correctly exposes nested-suite and unhandled errors, and the predicate
rejects errors outside the target, confirmed against this worktree's actually-installed
`vitest@4.1.6` APIs and state shapes. Target-skip/pass rejection, control-error rejection,
module-failure rejection, and unhandled-error rejection were all separately confirmed correct. It
found no design-level failure in round 7's redesign — only three implementation defects inside it —
and the founder authorized exactly this round, fixing exactly those three, followed by exactly one
more fidelity-only confirmation (confirmation #6).

**Defect 1 (exit-code clobbering, RESOLVED).** The generated runner called `process.exit(0)`
unconditionally (`buildReplayRunnerScript`) after serializing and closing the Vitest context,
overriding whatever `process.exitCode` Vitest itself had already set for the run. Vitest's own
`TestRun.end()` (invoked automatically inside `startVitest`/`ctx.start`'s own `finally` block, no
CLI-specific logic required) sets `process.exitCode = 1` whenever `hasFailed(modules)` is true, and
its `_checkUnhandledErrors()` does the same for a nonempty unhandled-errors collection — both run
and settle before the runner script's own trailing `process.exit(0)` line ever executed, so that
line silently discarded the correct outcome every single time and forced status `0` regardless of
whether the run was red or green. The parent's own `runResult.status === 0` check
(`replayRedEvidence`) then rejected every genuine red replay, contradicting this document's own
previously-claimed accepted case. Fixed by removing the forced exit and letting the runner exit with
`process.exit(process.exitCode ?? 0)` — Vitest's own determination, preserved rather than clobbered.

**Defect 2 (spoofable marker, RESOLVED).** The marker was a fixed, checked-in string
(`W9_REPLAY_RESULT_JSON:`), and extraction took the first stdout line starting with it
(`.find(...)`). Because the marker was predictable from the verifier's own source, the executed HEAD
test file could raw-write that exact prefix plus attacker-chosen JSON to stdout ahead of the real
serialization, and a first-match extraction would trust whichever line came first — including the
attacker's. Fixed with a per-invocation CSPRNG marker (`generateReplayMarker`, built on
`crypto.randomBytes(16).toString('hex')`) generated fresh in the verifier process for every replay and embedded only
into that replay's own generated runner source (`buildReplayRunnerScript` now takes the marker as a
parameter); the executed test file cannot know it without a deliberate multi-step read of the
runner source mid-replay, the accepted LOW-risk trust profile. Extraction now requires the marker to
appear on stdout **exactly once** (`.filter(...)`, `markerLines.length !== 1`) — zero occurrences
(the runner never reached its own serialization step) or more than one (some other write produced a
colliding prefix) both fail closed as an evidence failure, never a first-match trust.

**Defect 3 (exact-one-failure regression, RESOLVED).** `evaluateTaskForestConsistency` stored failed
leaves in a `string[]` keyed by `fullName` and rejected only the names unequal to the target
(`failedLeaves.filter((f) => f !== targetFullName)`). Two failed leaves that happened to share the
target's exact `fullName` both got filtered out by that comparison and canceled each other from the
"other failed" list, so a second, unrelated failure with a colliding name was silently accepted — an
exact synthetic replay of this shape produced zero problems, violating the single-failed-leaf
promise this document already made. Fixed by counting failed `test`-type nodes by occurrence during
the walk (`failedLeafCount`, incremented once per failed leaf regardless of name, never deduplicated
by a name set) and separately recording the sole failed leaf's own `fullName`
(`soleFailedLeafFullName`); the predicate now requires `failedLeafCount === 1` and that the one
failed leaf's `fullName` equal the target's, rejecting any other count outright. A companion probe
(duplicate `fullName`, one passing and one failing, in both declaration orders) confirmed this fix
never produces an insecure accept: the failed-leaf count is always exactly one and correctly
attributed. It also surfaced a pre-existing, out-of-scope characteristic — the separate, unchanged
`targetState`/`controlState` matching in the same walk is itself by `fullName`, so under a name
collision the state observed for the target is whichever same-named node the walk visits last; a
passing duplicate visited after the real failure can therefore produce a spurious **rejection**
(fails closed), never an insecure accept. This is consistent with the rest of the verifier's existing
`fullName`-as-identity-key trust model (duplicate literal test titles are already an ambiguous shape
elsewhere in this file) and is unchanged by this round; it is recorded here as a known, safe-direction
edge case rather than silently left undocumented.

**Verification this round:** scoped typecheck (`tsc -p scripts/tsconfig.json --noEmit`) clean; full
repository `pnpm typecheck` clean; `pnpm guard` 102/102 — unchanged from round 7, confirming the
guard suite itself was untouched. Byte-diff confirmed unchanged (grep-verified absent from the
diff): `staticBooleanValue`/`isLocalSameOriginReachable` (point 1), the title-parser block (point 3),
`containsExactNumericToken` (point 5), the fence-tracking block including `FENCE_MARKER_LINE` (point
4), `archiveRunArtifacts` (item 6), `hasDistinctSignalPair` (the round-4 regression fix), the
const-guard/prelude-binding matchers, and `sh()` itself. The working-tree diff against the prior
confirmed-good commit touches exactly 7 hunks (51 insertions, 16 deletions, one file), all inside
`buildReplayRunnerScript`, `evaluateTaskForestConsistency`, and `replayRedEvidence` — the same
replay hunk these three defects live in, nothing else.

New probes, all in isolated scratch temp directories against a real installed `vitest@4.1.6` (never
the repo worktree, never any daemon), driving a faithful reconstruction of the actual generated
runner script and the actual predicate logic (verified byte-identical to the committed source aside
from the one necessary, reasoned deviation — an absolute-path import instead of the bare
`vitest/node` specifier, required because the scratch directories have no `node_modules` of their
own) through a real child-process spawn and the real `runResult.status === 0` check, not the
predicate in isolation:
- A legitimate red replay (failing target, passing control, unrelated clean nested `describe`)
  produced a real nonzero runner exit status and was accepted end-to-end.
- An all-green scratch run (target and control both passing) produced a real exit status `0` and
  was rejected outright for carrying no red evidence.
- A marker-spoof test file, given the per-invocation marker through a side channel to simulate the
  accepted worst-case multi-step leak and printing a clean decoy line ahead of the real
  serialization, produced two marker-prefixed stdout lines; extraction correctly rejected the replay
  for finding other than exactly one.
- Two failed test leaves sharing one `fullName` produced `failedLeafCount` `2` and were correctly
  rejected; the duplicate-named-passing-sibling case was probed in both declaration orders with the
  disposition above.
- The prior probe suite was re-run against this round's code unchanged in intent: a nested
  `describe`'s throwing `afterAll` still correctly rejected (nested suite's own `errors` populated,
  file's own `errors` empty); a standalone unhandled promise rejection still correctly rejected
  (`unhandledErrors` populated); the fence-tracking grammar is byte-identical to the round-7
  commit and out of this round's edited scope entirely.

No settled design (attribution authority, C9-10, floor corrections, stale-proof mechanics, the three
r3 accepted-LOW residuals, item 6, the round-4 regression fix, points 1, 3, 4, or 5, the const
guards, the prelude binding, or both-stream `sh()`) changed in this round.
