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
`docs/plans/waves/DECISIONS.md`. The last entry was added on `main` as part of round-1 review
disposition (ruling 2, below) — verified directly at `origin/main` during this fix round, not
assumed.

**Round 1 status: FIXED, resubmitted.** GPT-5.6 Sol returned REJECT on the first draft with 9
findings (verbatim record: `~/.claude/goal-state/mishmash-w9-ingest-tranche/reviews/
sol-r1-findings.md`) plus 5 explicit ambiguity rulings. Every finding and every ruling is
disposed in **AUTHOR-FLAGGED / ROUND 1 DISPOSITIONS** at the end of this document — that section
is now the authoritative change record; earlier drafts of this document are superseded.

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
identity binding — any installed extension, paired or not, could otherwise present an
extension-shaped `Origin`), each with a red-then-green regression spec already in the tree
(`apps/daemon/tests/library-ingest-ssrf.test.ts`,
`apps/daemon/tests/library-ingest-token-binding.test.ts`). **This tranche's job is not to
rediscover those** — it is to turn the file's *entire* route surface, not just the two rows
someone already found bugs in, into a mechanically-generated, complete attribution matrix per
`VERIFICATION-CONTRACT.md` §6, so that what remains unattributed is *visible and counted*
instead of silently assumed safe — and, per round 1's finding 6, that the tranche's own
*implementation* is itself independently reviewed before it can count as done, not just its
expansion.

## Ground facts (verified directly in this tree; two corrected in round 1 — finding 8)

- **The route count is 23, not "the ingest route."** `registerLibraryRoutes` in
  `apps/daemon/src/routes/library.ts` registers exactly 23 `GET`/`POST`/`DELETE`/`OPTIONS`
  handlers under `/api/library/*` and `/api/tools/library/*` (verified by booting the real
  daemon and reading its own `routeInventory` — see "Route snapshot" below, and independently by
  a scoped AST scan of `registerLibraryRoutes`'s own body). `POST /api/library/ingest` is one row
  among 23, not the whole surface — the pairing/token lifecycle (`/pair`, `/pair/confirm`,
  `/pair/revoke`, `/pair/rotate`), the asset reads (`/assets`, `/assets/:id`, `/assets/:id/raw`,
  `/assets/:id/figma`, `/assets/:id/element`), `/sync`, `/clipper-probe`, `/events` (SSE), and the
  agent tool-token track (`/api/tools/library/search`, `/api/tools/library/apply`) all sit in the
  same file and all need a row.
- **Gate shape, exactly (corrected — round 1 finding 8):** of the 23 registrations, **6** carry
  `requireLocalDaemonRequest` (`POST /pair`, `GET /connection`, `POST /sync`, `DELETE
  /assets/:id`, `POST /assets/:id/apply`, `POST /assets/:id/edit-as-page`) — not 9, the first
  draft's error, which conflated this file's own count with `daemon-threat-model.md`'s unrelated
  repo-wide figure of 24. **2** carry `authorizeToolRequest` (the `/api/tools/library/*` pair).
  **2** carry a self-service bearer check — proof of possession of the caller's own token, no
  loopback requirement (`POST /pair/revoke`, `POST /pair/rotate`) — not 4; their two `OPTIONS`
  preflight siblings run no state check of their own and are correctly bucketed with the
  no-route-level-gate group below, not inherited from their POST sibling. **1** (`POST
  /library/ingest`) runs its own three-way branch (capability-token-bound-to-origin OR loopback).
  **1** (`POST /library/pair/confirm`) is gated only by the short-lived pairing code plus the
  zero-config extension-origin bypass. The remaining **11** — `OPTIONS /pair/confirm`, `OPTIONS
  /pair/revoke`, `OPTIONS /pair/rotate`, `OPTIONS /ingest`, `GET /clipper-probe`, `GET /assets`,
  `GET /assets/:id`, `GET /assets/:id/raw`, `GET /assets/:id/figma`, `GET /assets/:id/element`,
  `GET /events` — carry **no route-level authorization code at all**, relying entirely on
  `server.ts`'s global `/api` origin middleware (`server.ts:2209-2287`), which lets any request
  presenting **no `Origin` header** straight through regardless of route — every non-browser
  local caller (`od` CLI, an agent's `fetch`, or any other local process). 6+2+2+1+1+11 = 23.
  `GET /api/library/assets/:id/raw` is in that 11-route no-gate group and is the read-back/
  exfiltration half of the SSRF story the ingest test file's own header comment describes.
- **There is no request- or byte-volume control on any `/api/library/*` route (narrowed —
  round 1 finding 8).** The first draft's "no rate limiting anywhere in the daemon" was
  overbroad and factually wrong: `apps/daemon/src/connectors/service.ts:472-476` declares
  `CONNECTOR_RUN_RATE_LIMIT_CALLS`/`CONNECTOR_RUN_TOTAL_CALL_LIMIT`/`CONNECTOR_RUN_LIMIT_TTL_MS`,
  and `:864-892`'s `enforceRunLimits` genuinely enforces a per-run, per-connector call cap with a
  429 (`CONNECTOR_RATE_LIMITED`) — but this governs *agent-run connector tool calls*, an entirely
  different surface, not Library ingest. Separately, `express-rate-limit@8.4.1` is present in
  `pnpm-lock.yaml` — but as a **transitive** dependency of `@modelcontextprotocol/sdk`, never
  imported by any file under `apps/daemon/src`, `apps/web/src`, or `scripts/` (grep-confirmed).
  Neither fact puts any control on `/api/library/*`. The correct, narrow claim: `POST
  /api/library/ingest` gets a **128 MB** body-size allowance (`server.ts:2074`,
  `app.use('/api/library/ingest', express.json({ limit: '128mb' }))`, registered ahead of the
  global 4 MB default specifically so a full-page clipper capture doesn't 413) with **no
  accompanying request-volume or byte-volume cap for the clipper/token caller class**. The 3 MB
  `LIBRARY_UPLOAD_MAX_BYTES` + MIME allowlist (`packages/contracts/src/api/library.ts`) applies
  **only** to `sourceKind === 'manual-upload'` — the route's own comment says clipper captures
  are "exempt: the extension curates its own payloads." A URL-based ingest (`body.url`) is capped
  at 25 MB by `fetchRemoteBytes` (`MAX_REMOTE_BYTES`), but that cap does not apply to
  `dataUrl`/`text` bodies. This asymmetry — generous body limit, no volume cap, size/MIME check
  that only fires for one of three caller branches — is exactly what the size/rate-limit
  attribution field must force a decision on, not silently pass over (S9-4).
- **The pairing code has no attempt throttle.** `startPairing()` (`library-tokens.ts`) mints a
  6-digit code with a 5-minute TTL and no attempt counter. `POST /api/library/pair/confirm` is
  reachable pre-pairing from any extension-shaped origin (the zero-config bypass). This is a
  genuine, narrow brute-force window this tranche's risk-ranking rule (below) surfaces as a
  P0 row, not a "creates a token" afterthought — and round 1's finding 3 confirmed the first
  draft's mechanism let this specific, named gap go unresolved even after being identified in
  prose; S9-4/C9-6 now bind to it mechanically (below).
- **The SSRF and token-binding fixes are already landed, with red-before-green specs.**
  `apps/daemon/tests/library-ingest-ssrf.test.ts`,
  `apps/daemon/tests/library-ingest-token-binding.test.ts`,
  `apps/daemon/tests/library-ingest-concurrent-hash-race.test.ts`, and
  `apps/daemon/tests/library-token-revoke-rotate.test.ts` all exist, boot a real daemon, and
  exercise real HTTP against real SQLite-backed state — no mocked transport (satisfies
  `VERIFICATION-CONTRACT.md` §3 R2). Per this PRD's brief: **this tranche formalizes these into
  attributed rows; it does not require re-deriving new controls where a real test already
  proves one.** Full glob-discovered `library-*.test.ts` suite this run: 45/45 passing across 9
  files (verified directly; see "Verified baseline" below).

## Scope

**S9-1 — Freeze the route snapshot at baseCommit, with drift detection (mechanism corrected —
round 1 finding 4).** The first draft embedded the 23 `{method, path}` pairs as a literal
constant in the verifier and compared it to the **same commit's** live behavior — meaning an
implementation branch that edited `routes/library.ts`, the frozen literal, and the verifier
together in one commit could fabricate "no drift." Fixed: the frozen set is now derived by
parsing `git show <baseCommit>:apps/daemon/src/routes/library.ts` through a real AST scan scoped
to `registerLibraryRoutes`'s own function body (never the whole file, so a decoy registration or
a matching identifier name in an unrelated comment cannot leak in — comments are lexer trivia; a
`ts.forEachChild` walk never visits them). That baseCommit-derived set is checked for
self-consistency against `FROZEN_IMPACT_FLOORS`' key set (S9-2 — the single literal table this
expansion freezes) and then checked for drift against a **live daemon boot's** own
`routeInventory` (`apps/daemon/src/route-registration-guard.ts`), filtered to `/api/library/*`
and `/api/tools/library/*`. Any duplicate `{method,path}` registration — at baseCommit, at HEAD,
or in the live daemon's own inventory — is a hard fail in its own right, never a silent
last-write-wins pick (a duplicate decoy registration is itself the attack, not noise to average
away). `POST /api/backup` / `POST /api/restore` are registered from inside this same file
(`registerBackupRoutes(...)`, line 365) but implemented in and owned by W0's `apps/daemon/src/
backup/routes.ts` — different path prefix, excluded by the path filter, **confirmed intentional
by ruling 4** (below).

**S9-2 — State the risk-ranking rule, with impact FROZEN as reviewer-owned floors (round 1
ruling 5 — tightened).** Score = `exposure(0–3) + impact(0–3)`. Exposure remains fully
mechanical (unchanged from the first draft, hardened per finding 1 below):

- **Exposure** — the *weakest* caller class the route's own gate code accepts, derived from real
  AST `CallExpression`/identifier nodes, never text/regex over the raw source (finding 1: a
  regex-on-`getText()` check let a **comment** containing `authorizeToolRequest(` misclassify an
  unguarded handler):
  - `0` — `requireLocalDaemonRequest` is a literal identifier among the route's own middleware
    arguments.
  - `1` — the handler's body contains a real `CallExpression` to `authorizeToolRequest`.
  - `2` — the handler's body contains real `CallExpression`s to both `bearerToken` and
    `validateLibraryToken` (self-service proof-of-possession, no loopback requirement).
  - `3` — none of the above.
- **Impact — now a FROZEN, reviewer-owned FLOOR per route, not implementer-declared (round 1
  ruling 5).** The first draft let impact go unvalidated entirely (finding 1) and be freely
  implementer-declared (author-flagged §5, which round 1 rejected as too loose). Every one of the
  23 frozen routes gets a literal floor in this document and in the verifier's
  `FROZEN_IMPACT_FLOORS` (the two must and do match — checked by C9-1's self-consistency step). A
  row may claim `impact >= floor` (raising it if an implementer finds the route does something
  *worse* than this floor assumed) but never below. **Changing a floor requires a reviewed gate
  amendment to this document, not an implementation-branch edit.** Floor definitions:
  - `0` — returns metadata only / no persisted mutation (a pairing code held only in transient
    in-memory state before confirmation counts as 0, not a mutation).
  - `1` — returns previously-stored bytes/derived content back to the caller.
  - `2` — mutates a row, or moves/copies bytes already inside daemon-owned storage, under caller
    direction.
  - `3` — accepts caller-supplied bytes, or fetches a caller-supplied URL, into daemon-owned
    storage.

  Tiers: `score 5–6 = P0`, `score 4 = P1`, `score 0–3 = P2`, mechanically enforced (`tier ===
  tierFor(exposure+impact)` exactly, criterion C9-8 — no arithmetic slack).

  **The full frozen table** (exposure shown is today's baseCommit/HEAD value for reference; it is
  the *mechanism*, not this literal, that the verifier trusts — genuine hardening that lowers a
  route's real exposure legitimately lowers its live tier):

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
  | `GET /api/library/assets` | 3 | 0 | 3 | P2 |
  | `POST /api/library/sync` | 0 | 2 (bulk reconcile-driven inserts) | 2 | P2 |
  | `GET /api/library/assets/:id` | 3 | 0 | 3 | P2 |
  | `DELETE /api/library/assets/:id` | 0 | 2 (deletes row + unlinks bytes) | 2 | P2 |
  | `GET /api/library/assets/:id/raw` | 3 | 1 (serves stored bytes back) | 4 | P1 |
  | `GET /api/library/assets/:id/figma` | 3 | 1 (serves stored sidecar bytes back) | 4 | P1 |
  | `GET /api/library/assets/:id/element` | 3 | 1 (serves stored sidecar bytes back) | 4 | P1 |
  | `POST /api/library/assets/:id/apply` | 0 | 2 (copies stored bytes into a project) | 2 | P2 |
  | `POST /api/library/assets/:id/edit-as-page` | 0 | 2 (creates project/conversation rows, writes a file) | 2 | P2 |
  | `POST /api/tools/library/search` | 1 | 0 (read-only) | 1 | P2 |
  | `POST /api/tools/library/apply` | 1 | 2 (copies stored bytes into a project) | 3 | P2 |
  | `GET /api/library/events` | 3 | 0 (SSE subscribe, no mutation) | 3 | P2 |

  **Guaranteed P0 today: `POST /api/library/pair/confirm` and `POST /api/library/ingest`.**
  Guaranteed P1: `pair/revoke`, `pair/rotate`, `.../raw`, `.../figma`, `.../element`. This table
  — not free-text judgment at implementation time — is what C9-6's per-P0-row rate/volume-control
  requirement and C9-7's per-P0-route threat-model-bullet requirement key off, closing round 1
  finding 3's "the known P0 pairing-code gap can remain unresolved despite being identified in
  the PRD."

**S9-3 — Mechanically-generated attribution matrix (tightened — round 1 findings 1, 2).** A
companion machine-readable file, `docs/security/library-ingest-attribution.json`, one row per
frozen route (exactly 23, no orphans, no gaps, no duplicates), each row carrying the six required
fields from `VERIFICATION-CONTRACT.md` §6: `owner`, `authn`, `authz`, `inputValidation`,
`sizeRateLimit`, `testRef` — plus the `riskScore` object (`{exposure, impact, score, tier}`,
formula-enforced per S9-2) and, **for every route whose mechanically-derived `exposure === 3`**
(never a text parse of the `authn`/`inputValidation` strings — finding 2 showed `"none (global
middleware)"` evades any string-equality check, however normalized), exactly one of:

- `control: { mechanism: string, testRef: string }` — a real, currently-passing test, bound by
  **exact `fullName` equality**, never substring (finding 3: a first-draft check let
  `testRef: "e"` match anything). A `control` whose cited test's containing file **did not exist
  at baseCommit** must additionally have a companion red-transcript artifact at
  `docs/security/library-ingest-red/<slug(testRef)>.txt` (non-trivial content, a `RED`/`FAIL`
  marker — R1: both the red and green transcript are recorded, the green one already captured by
  the suite's own JSON report) and the containing file must show **≥2 passing assertions** this
  run — a mechanical proxy for R4's negative-control pairing (a lone "it's rejected" assertion
  with nothing proving the *positive* path still works is not evidence of the stated reason).
  Coverage that already existed at baseCommit (SSRF, token-binding, etc.) is exempt from the red-
  artifact/pairing requirement per this section's original "may cite directly" allowance — the
  red-before-green evidence for those already lives in their own git history.
- `acceptedRisk: { decisionRef: string }` — **not implementer-authored JSON** (finding 2: a
  first-draft `{founder,date,rationale}` object authored entirely on the implementation branch is
  not founder-signed evidence of anything). `decisionRef` must be found as a literal substring in
  `docs/plans/waves/DECISIONS.md` **as of baseCommit** (`git show`, never the working tree) — an
  implementation-branch edit to `DECISIONS.md` cannot authorize its own risk acceptance (ruling
  2). `docs/plans/waves/DECISIONS.md` is now in this wave's lease (see header) for the
  *implementation* branch to reference an existing entry or extend the document with a new
  founder/orchestrator-authorized one whose baseCommit-visible predecessor entries already
  establish the pattern — but a NEW entry added on the implementation branch itself cannot be the
  entry a same-branch `decisionRef` points at, by construction (it wouldn't exist at baseCommit).

A row with all six fields populated but no `control`/`acceptedRisk` on an `exposure===3` row does
**not** count as attributed — the exact failure mode `W5-W11-gated.md` calls out ("a matrix full
of `auth:none, validation:none` rows is not a completed tranche"). The verifier's evidence for
C9-4 reports three explicit counts every run: **attributed** (resolved, whether by real gate or
verified control), **unattributed** (`exposure===3`, neither control nor accepted risk — a true,
uncontrolled gap), and **known-vulnerable** (`exposure===3`, accepted risk on file — a
consciously-accepted, still-open item, distinct from a silent gap per `VERIFICATION-CONTRACT.md`
§6's own framing).

`docs/security/daemon-threat-model.md` is extended with a "Wave 9" section, in the same style as
its existing `[C0-N]` bullets: every claim tagged `[C9-N]`, quoting a test `fullName` by **exact**
match (not substring) against a real passing test this run, and the section must name every
P0-tier route at least once (criterion C9-7) — not merely contain *a* bullet somewhere.

**S9-4 — Resolve the size/rate-limit gap explicitly, for every P0 row, not just ingest
(generalized — round 1 findings 3 and the "known P0 gap" complaint).** The first draft scoped
C9-6 to `POST /api/library/ingest` alone; round 1 correctly noted `POST /api/library/pair/confirm`
is *also* P0 (S9-2's frozen table) with its own confirmed, unresolved gap — the pairing-code
attempt throttle — and nothing forced it to be addressed. C9-6 now applies to **every row whose
mechanically-verified `riskScore.tier === 'P0'`**: its `sizeRateLimit` field must resolve with
either (a) a `control` whose `mechanism` text reads as a rate/volume/throttle/cap control (regex-
checked) and whose `testRef` passes the full S9-3 binding bar (exact match, red artifact + paired
negative control if new), or (b) a `DECISIONS.md`-verified `acceptedRisk`. Given no rate-limiting
dependency exists in this repo today, an in-process control (a bounded per-token-hash, per-origin,
or per-pairing-attempt counter, entirely inside `routes/library.ts`, no new file, no new
dependency) is achievable inside this tranche's lease for both `ingest` and `pair/confirm`; a
`library-tokens.ts`-level or `server.ts`-level control is not (ruling 1, below).

**S9-5 — Endpoint tests per tranche.** Every attributed row's `testRef` must name a real,
currently-passing test, bound by exact `fullName` equality. Existing coverage (SSRF,
token-binding, concurrent-hash-race, revoke/rotate) may be cited directly per this section's
allowance. Rows with no existing coverage need a new test with a captured red transcript (S9-3) —
`POST /api/library/pair/confirm`'s attempt-throttle absence and `POST /api/library/ingest`'s
volume-cap absence are the two P0 rows S9-4 forces this for.

**S9-6 — Adversarial verification of the implementation, not just this expansion (new — round 1
finding 6).** `W5-W11-gated.md`:155 requires "adversarial verification per tranche," and
`VERIFICATION-CONTRACT.md` G-14 requires commit-bound review records with reviewer ≠ author. The
first draft's adversarial-review section only posed questions for reviewing *this expansion*
before freeze — it had no criterion gating the *implementation's* completion on a second,
independent review. Fixed: criterion C9-10 requires
`docs/security/library-ingest-implementation-review.json` — `{reviewer, model, commit, verdict}`
— with `commit` exactly equal to `HEAD` (never stale), `verdict === "APPROVE"`, and `reviewer`
mechanically distinct from the `HEAD` commit's own author name/email (`git log -1 --format=%an/
%ae`). This does not by itself prove a *good* review happened — it proves a *distinct,
commit-bound, machine-readable* one did, which is what G-14 asks for; review quality is the
orchestrator's/founder's judgment call, not something this verifier can grade.

## Explicitly out of scope

- The other five W9 tranches (agent spawn, filesystem, deploy/BYOK, external fetch, imports/long
  tail) — they stay in rolling W9 per `W5-W11-gated.md`; this document expands `mishmash-w9-
  ingest-tranche` only.
- `apps/daemon/src/library.ts`, `library-tokens.ts`, `library-sync.ts`,
  `brands/safe-fetch.ts`, `security/library-token-lifecycle.ts` — load-bearing for ingest
  security but outside this tranche's write lease. **Ruling 1 (round 1): existing behavior in
  these files may be attributed without modification; no lease amendment.** See AUTHOR-FLAGGED
  disposition 1.
- AI enrichment, embeddings, semantic search, bookmark import (W5) — no scope creep into
  enrichment; this tranche only hardens what already exists.
- Anything the flag `LIBRARY_UI_VISIBLE` gates for end users (W3's problem) — this tranche's
  output is a **precondition** W3 consumes, not a UI change.

## Definition of "green" (for W3's C3-4 to consume mechanically — fully specified, round 1
finding 5)

The first draft's definition ("exists, `treeDirty===false`, every present criterion passes") was
**vacuous**: an empty `criteria` array satisfied it. W3's own verifier must implement every one
of the following predicates against `~/.claude/goal-state/mishmash-w9-ingest-tranche/proof/
manifest.json` before treating this tranche as a satisfied precondition — every predicate is
required, none is advisory:

1. The file exists and parses as JSON.
2. `manifest.wave === "W9-ingest"`.
3. `manifest.wroteOk === true` — the two-phase write (a `wroteOk:false` placeholder is written
   before any criterion runs, overwriting whatever a prior run left; only a fully completed run
   ends with `wroteOk:true`) means a crash/interruption can never leave a stale, complete-looking
   prior green manifest on disk. `wroteOk:false` (or a missing manifest) must read as **not
   green**, not as "advisory."
4. `manifest.treeDirty === false`.
5. The **set** of `manifest.criteria[].id` equals **exactly**: `{C9-1, C9-2, C9-3, C9-4, C9-5,
   C9-6, C9-7, C9-8, C9-9, C9-10, GATE-INTEGRITY, LEASE, HEAD-DRIFT}` — 13 IDs, no fewer, no more,
   no duplicates. A short or empty `criteria` array fails this predicate outright; it is never a
   vacuous pass.
6. Every one of those 13 entries has `status === "pass"`. No criterion in this tranche is
   `human:`-marked (§3 R7), so `status: "blocked-on-founder"` should never legitimately appear;
   if it does, that fails this predicate too.
7. For every entry, `artifact` is non-null and re-hashing the file at that path with SHA-256
   equals the recorded `artifactSha256` — an artifact edited after the run does not count.
8. `manifest.commit` is an ancestor of (or equal to) the commit W3's own verifier is currently
   checking (`git merge-base --is-ancestor <manifest.commit> <candidate>`).
9. `git diff --name-only <manifest.commit>...<candidate> -- apps/daemon/src/routes/library.ts
   apps/daemon/src/library-store.ts` is empty. Any diff in this tranche's owned source since the
   manifest's commit means the manifest is stale evidence for the *current* tree — W3 must
   require a fresh W9 verifier run before treating the precondition as met.
10. `GATE-INTEGRITY`'s own recorded evidence shows either an approved-gate hash match, or — before
    one has been pinned — the orchestrator's own external record of approval for this PRD/verifier
    pair. (This tranche's `GATE-INTEGRITY` criterion is advisory-when-unpinned by design, matching
    every other wave verifier; W3 additionally needs the orchestrator-level approval receipt for
    the pin's *absence* to be legitimate rather than merely unremarked.)

This is a specification W3's own expansion must implement — it is not itself proof that W3's
verifier does so correctly, only that "green" is no longer ambiguous enough to implement
incorrectly by accident.

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w9-ingest.ts`.

| ID | Criterion | Verification |
|---|---|---|
| C9-1 | Route snapshot frozen **at baseCommit**, drift-checked, duplicate-checked | `git show <baseCommit>:...library.ts` AST-scanned (scoped to `registerLibraryRoutes`), self-consistent with `FROZEN_IMPACT_FLOORS`' key set, compared to a real daemon boot's live `routeInventory`; any duplicate `{method,path}` at either point is a hard fail |
| C9-2 | Existing ingest-security suite is green | Real vitest JSON-reporter run of **glob-discovered** `apps/daemon/tests/library-*.test.ts` files (never a fixed list); zero failed, zero pending/skipped, zero `skip`/`only`/`todo` markers (spaced and bracket-alias forms included) |
| C9-3 | Attribution matrix exists and covers exactly the frozen route set | `docs/security/library-ingest-attribution.json` parses as JSON; exactly one row per frozen `{method,path}`, no orphans, no gaps, no duplicates |
| C9-4 | Every row is fully attributed per §6's definition, mechanically triggered | All six required fields non-empty per row; the control/acceptedRisk requirement is driven by the row's **mechanically re-derived `exposure===3`** (never a text parse of `authn`/`inputValidation`); `acceptedRisk.decisionRef` verified against `DECISIONS.md` **at baseCommit**; evidence reports attributed/unattributed/known-vulnerable counts |
| C9-5 | Every `testRef` names a real, currently-passing test, exactly | Exact `fullName` equality (never substring) against the C9-2 run; new-file `testRef`s require a red-transcript artifact under `docs/security/library-ingest-red/` plus ≥2 passing assertions in-file (R1/R4 proxy) |
| C9-6 | Every P0-tier row's size/rate-limit dimension is explicitly resolved | For every row with `riskScore.tier === 'P0'` (S9-2's frozen table guarantees `pair/confirm` and `ingest` today): a `control` whose `mechanism` reads as rate/volume/throttle and whose `testRef` passes C9-5's bar, or a `DECISIONS.md`-verified `acceptedRisk` — never bare object presence |
| C9-7 | Threat-model doc extended, mechanically cited, P0-complete | `docs/security/daemon-threat-model.md` carries a "Wave 9" section bounded to the next `## ` heading; every `[C9-N]` bullet's cited test matches an exact passing `fullName`; every P0-tier route named at least once |
| C9-8 | Full risk-score formula enforced per row | AST-derived `exposure` (scoped, comment-blind, duplicate-checked) matches exactly; `impact >= FROZEN_IMPACT_FLOORS[route]`; `score === exposure+impact` exactly; `tier === tierFor(score)` exactly |
| C9-9 | Gates | `pnpm guard` and `pnpm typecheck` exit 0 on the current tree |
| C9-10 | Adversarial review of the **implementation** is on record | `docs/security/library-ingest-implementation-review.json`: `commit === HEAD` exactly, `verdict === "APPROVE"`, `reviewer` mechanically distinct from `HEAD`'s own commit author identity |

Plus the three named infra checks every wave verifier carries: **GATE-INTEGRITY** (advisory
self-hash pin, once an orchestrator-approved hash exists — the F4 route-snapshot collusion this
advisory posture used to leave open is independently closed by C9-1/C9-8 now anchoring to
baseCommit, not a HEAD literal), **LEASE** (`git diff --name-only <baseCommit>...HEAD` ⊆
`leases.json@baseCommit`'s `W9-ingest.allow`, read via `git show`, never the working tree),
**HEAD-DRIFT** (HEAD must not move mid-run).

## Verified baseline (this run, pre-implementation, post round-1 fix)

Recorded here so the reviewer can see what "honest partial red" looks like before assuming every
red criterion reflects a real gap in the plan rather than simply unstarted work. Filled in after
the fixed verifier's two post-commit steady-state runs — see the fix-round summary for exact
pass/fail counts and both runs' independently preserved manifests under `proof/runs/`.

- Glob-discovered `library-*.test.ts` suite: **45/45 passing** across the same 9 files (glob
  produces the identical set today; it is the discovery *mechanism*, not the count, that changed).
- Route count: confirmed **23** via both the baseCommit AST scan and real daemon introspection —
  independently agreeing, not merely asserted once.
- `docs/security/library-ingest-attribution.json`,
  `docs/security/library-ingest-implementation-review.json`: do not exist yet (C9-3 through C9-8
  and C9-10 fail honestly).
- Rate/volume control on `POST /api/library/ingest` or `POST /api/library/pair/confirm`:
  confirmed absent (C9-6 fails honestly).
- `docs/plans/waves/DECISIONS.md` confirmed present in `leases.json`'s `W9-ingest.allow` on
  `origin/main` (landed as part of round-1 disposition, ruling 2) — verified by reading
  `origin/main` directly, not assumed from the ruling text alone. This branch's own `baseCommit`
  predates that landing (this branch forked before the amendment), so `LEASE`'s baseCommit-read
  will not itself see it yet; that is expected or the whole point of anchoring `LEASE` to
  baseCommit rather than a possibly-newer ref (ruling 3).

## Adversarial review

GPT-5.6 Sol. Round 1's 9 findings and 5 rulings are fully disposed below. Round 2 focus
questions:

- Does the frozen impact-floor table (S9-2) hold up row-by-row, or does any floor look
  mis-assigned against the route's actual current behavior?
- Is the `>=2 passing assertions in-file` proxy for R4's negative-control pairing (S9-3) strong
  enough, or does it need to check *which* assertions (i.e., that at least one is a positive
  control that succeeds), not just a raw count?
- Does C9-10's `reviewer !== HEAD-commit-author` check meaningfully establish "reviewer ≠ author"
  per G-14, or is a stronger identity binding needed (e.g., a reviewer allowlist, a signature)?
- Is the "founder-controlled external receipt" alternate path ruling 2 mentions, beyond the
  `DECISIONS.md`-at-baseCommit reference this draft mechanically implements, something this
  verifier should also support, or was the `DECISIONS.md` path meant to be the *only* mechanism?
  (Flagged as a live round-2 question — see AUTHOR-FLAGGED disposition 2.)
- Does excluding `/api/backup`/`/api/restore` from the frozen snapshot (confirmed intentional,
  ruling 4) need any doc cross-reference from `docs/security/daemon-threat-model.md`'s Wave 9
  section, so a reader doesn't independently rediscover the exclusion and mistake it for a gap?

---

## AUTHOR-FLAGGED / ROUND 1 DISPOSITIONS

Round 1 returned REJECT with 9 findings (verbatim: `~/.claude/goal-state/
mishmash-w9-ingest-tranche/reviews/sol-r1-findings.md`) and 5 explicit ambiguity rulings. Every
one is disposed here; nothing from the first draft's AUTHOR-FLAGGED section survives un-ruled.

**Finding 1 (BLOCKING) — risk ranking gameable.** RESOLVED. Impact is now a frozen, reviewer-owned
floor table (S9-2) enforced with `impact >= floor` (C9-8); exposure is derived from real AST
`CallExpression`/identifier nodes scoped to `registerLibraryRoutes`'s body, never text/regex over
raw source (comments cannot match); any duplicate `{method,path}` registration is a hard fail,
never a silent last-write-wins pick.

**Finding 2 (BLOCKING) — matrix is self-attested free text.** RESOLVED. The control/acceptedRisk
trigger is now mechanical (`exposure===3`, the same AST classification C9-8 independently
recomputes), not a parse of `authn`/`inputValidation` strings — "none (global middleware)" no
longer evades anything, because nothing about that string is being parsed at all.
`acceptedRisk.decisionRef` must resolve inside `docs/plans/waves/DECISIONS.md` **as read at
baseCommit**, never the implementation branch's own working tree — an implementation-branch edit
cannot author its own accepted risk (ruling 2, disposed below).

**Finding 3 (BLOCKING) — test/report coverage gameable by unrelated tests and prose.** RESOLVED.
`testRef` binding is exact `fullName` equality (S9-3/C9-5); new tests require a red-transcript
artifact plus a ≥2-passing-assertion in-file proxy for R4; C9-6 now applies to every P0 row (not
just ingest) and requires the `control.mechanism` text to read as rate/volume/throttle, not mere
object presence — closing the specific complaint that the known pairing-code P0 gap could survive
unaddressed.

**Finding 4 (BLOCKING) — frozen route set and gate integrity implementer-mutable.** RESOLVED for
the concrete collusion path Sol demonstrated: the frozen route set is now derived from
`baseCommit` via `git show` + AST scan (S9-1/C9-1), not a HEAD literal compared to HEAD behavior,
so co-editing routes + the frozen set + this verifier in one implementation-branch commit cannot
fabricate "no drift" — baseCommit is fixed history once this PRD lands. `GATE-INTEGRITY` keeps its
advisory-when-unpinned shape (unchanged from every other wave verifier's design; the orchestrator
pins `approved-gate.sha256` only after approval, which by definition hasn't happened before the
approval this fix round is part of) — its role in the ORIGINAL exploit is superseded by C9-1's
fix, not by strengthening the pin's advisory posture itself.

**Finding 5 (BLOCKING) — W3 cannot safely consume "green"; empty-array vacuous pass; stale
manifest survives a crash.** RESOLVED. "Definition of green" (above) is now a fully enumerated
10-predicate list including the exact 13-ID criterion set, artifact-hash re-verification, commit
ancestry, and no-later-drift-in-owned-paths. The manifest now carries `wroteOk`, written `false`
as a placeholder BEFORE any criterion runs (overwriting any prior manifest immediately) and only
`true` on full completion — a crash mid-run can never leave a stale, complete-looking green
manifest on disk.

**Finding 6 (BLOCKING) — no adversarial-verification-of-implementation criterion.** RESOLVED. New
S9-6/C9-10: a commit-bound (`commit===HEAD` exactly), reviewer-distinct-from-author,
machine-readable-`APPROVE` review record is now required for completion, per
`W5-W11-gated.md`:155 and `VERIFICATION-CONTRACT.md` G-14.

**Finding 7 (NON-BLOCKING) — baseline reproducibility; two post-commit runs can't be
independently verified.** RESOLVED. Every run now writes an independently preserved, timestamped
copy under `proof/runs/<commit>-<timestamp>-<pid>/` (manifest + per-criterion artifacts, copied
never moved) in addition to the canonical `proof/manifest.json` W3 reads. See the fix-round
summary for both runs' archive paths.

**Finding 8 (NON-BLOCKING) — two false ground facts.** RESOLVED. "Ground facts" above now states
the connector run-limiter (`connectors/service.ts:472-476,864-892`) and the transitive
`express-rate-limit@8.4.1` dependency (via `@modelcontextprotocol/sdk`, unimported by daemon code)
accurately, narrows the rate-limit claim to "no control on `/api/library/*`," and corrects the
gate-shape counts to the AST-verified 6 `requireLocalDaemonRequest` / 2 self-service-bearer (not
9/4).

**Finding 9 (BLOCKING per coordinator relay) — canonical artifacts overwritten run-to-run.**
RESOLVED. Same fix as finding 7 — the per-run archive under `proof/runs/` is independent of the
canonical manifest's own overwrite-on-each-run behavior.

**Ruling 1 — no source-file lease amendment; attribution without modification.** ENCODED. No
change to the lease beyond `DECISIONS.md` (ruling 2). `library.ts`, `library-tokens.ts`,
`security/library-token-lifecycle.ts`, `library-sync.ts`, `brands/safe-fetch.ts` stay
out-of-lease and are attributed, never modified; every control this tranche needs (S9-4's
rate/volume counters for both P0 rows) is scoped to be buildable entirely inside
`routes/library.ts` and, if persistence is needed, `library-store.ts` — the exact precedent
`security/library-token-lifecycle.ts`'s own header comment already set for W0.

**Ruling 2 — accepted risk redirects to `DECISIONS.md`; exact file added to the lease.** ENCODED.
`docs/plans/waves/DECISIONS.md` is now in `leases.json`'s `W9-ingest.allow` (verified directly on
`origin/main`, see "Verified baseline"). `acceptedRisk` is now `{decisionRef}`, verified against
`DECISIONS.md` **as read at baseCommit** (S9-3/C9-4) — never an implementer-authored
`{founder,date,rationale}` object. **Open sub-question carried to round 2** (see Adversarial
review): ruling 2 also mentions "a founder-controlled external receipt" as an alternate path;
this draft implements only the `DECISIONS.md`-at-baseCommit mechanism and does not build a second,
independently-verifiable external-receipt path, since no receipt format/location was specified.
Flagging rather than inventing one.

**Ruling 3 — land-then-baseCommit semantics suffice; do not lease this document.** ENCODED. No
change: `docs/plans/waves/W9-ingest-tranche.md` stays outside `leases.json`'s `W9-ingest.allow`.
`LEASE` will still read red on this branch's own pre-land run for exactly the reason recorded in
the prior draft and unchanged here — self-resolving once this PRD lands on `main`.

**Ruling 4 — `/api/backup`/`/api/restore` exclusion confirmed intentional.** ENCODED. S9-1 now
states this as a confirmed ruling, not an open flag; their implementation and threat boundary stay
W0-owned regardless of where they're registered from.

**Ruling 5 — tighten risk ranking: frozen floor, full formula enforcement, comment-blind scoped
AST.** ENCODED. This is S9-2/C9-8 as rewritten above: `impact >= floor` per the frozen table,
`exposure`/`impact`/`score`/`tier` all range- and arithmetic-validated, exposure derivation scoped
to `registerLibraryRoutes` via real AST nodes with duplicate rejection.
