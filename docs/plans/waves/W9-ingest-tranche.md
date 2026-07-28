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
`apps/daemon/tests/library-*.test.ts`, `docs/security/**`, `scripts/waves/verify-w9-ingest.ts`.
No other file may change. See **AUTHOR-FLAGGED AMBIGUITIES** for two places this lease is
narrower than what the wave's own criteria spine implies.

This document is an **expansion**, not an implementation. Per the NM-41C gate
(`W5-W11-gated.md` lines 8–24), it is written and frozen *before* any implementation work
starts, and it will be reviewed by GPT-5.6 Sol — a reviewer who did not write it and will not
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
instead of silently assumed safe.

## Ground facts (verified directly in this tree, not asserted from the skeleton)

- **The route count is 23, not "the ingest route."** `registerLibraryRoutes` in
  `apps/daemon/src/routes/library.ts` registers exactly 23 `GET`/`POST`/`DELETE`/`OPTIONS`
  handlers under `/api/library/*` and `/api/tools/library/*` (verified by booting the real
  daemon and reading its own `routeInventory` — see "Route snapshot" below). `POST
  /api/library/ingest` is one row among 23, not the whole surface — the pairing/token lifecycle
  (`/pair`, `/pair/confirm`, `/pair/revoke`, `/pair/rotate`), the asset reads (`/assets`,
  `/assets/:id`, `/assets/:id/raw`, `/assets/:id/figma`, `/assets/:id/element`), `/sync`,
  `/clipper-probe`, `/events` (SSE), and the agent tool-token track
  (`/api/tools/library/search`, `/api/tools/library/apply`) all sit in the same file and all
  need a row.
- **There is no rate limiting anywhere in the daemon.** `grep -rn "rate.limit\|rateLimit\|express-rate-limit" apps/daemon/src` turns up zero middleware, zero dependency, zero token-bucket
  logic — only unrelated string matches (provider-API 429 classification). `POST
  /api/library/ingest` specifically gets a **128 MB** body-size allowance
  (`server.ts:2083`, `app.use('/api/library/ingest', express.json({ limit: '128mb' }))`,
  registered ahead of the global 4 MB default specifically so a full-page clipper capture
  doesn't 413) with **no accompanying request-volume or byte-volume cap for the clipper/token
  caller class**. The 3 MB `LIBRARY_UPLOAD_MAX_BYTES` + MIME allowlist
  (`packages/contracts/src/api/library.ts`) applies **only** to `sourceKind === 'manual-upload'`
  — the route's own comment says clipper captures are "exempt: the extension curates its own
  payloads." A URL-based ingest (`body.url`) is capped at 25 MB by `fetchRemoteBytes`
  (`MAX_REMOTE_BYTES`), but that cap does not apply to `dataUrl`/`text` bodies. This asymmetry —
  generous body limit, no volume cap, size/MIME check that only fires for one of three caller
  branches — is exactly what the size/rate-limit attribution field must force a decision on, not
  silently pass over.
- **Most routes have no explicit route-level gate at all.** Of the 23, 9 carry
  `requireLocalDaemonRequest` (loopback-only), 2 carry `authorizeToolRequest` (scoped tool
  token), 4 carry a self-service bearer check (revoke/rotate — proof of possession of the same
  token, not a loopback check), 2 carry the pairing-code + zero-config extension-origin bypass
  (`pair/confirm`), 2 carry the ingest route's own three-way branch, and **the remaining 6**
  (`GET /assets`, `GET /assets/:id`, `GET /assets/:id/raw`, `GET /assets/:id/figma`, `GET
  /assets/:id/element`, `GET /events`, plus `GET /clipper-probe` — 7 total) have **no
  route-level authorization code at all**, relying entirely on `server.ts`'s global `/api`
  origin middleware. That middleware's own logic (`server.ts:2209-2287`) allows any request
  presenting **no `Origin` header** straight through, regardless of route — which is every
  non-browser local caller (`od` CLI, an agent's `fetch`, or any other local process). This is
  documented today as an accepted, product-wide limitation for `requireLocalDaemonRequest`-gated
  routes in `docs/security/daemon-threat-model.md` ("Malicious local process, HTTP-layer" —
  "true of all 24 pre-existing `requireLocalDaemonRequest`-guarded routes... not a regression").
  It is **not yet documented** for the 7 routes in this file that don't even have that guard —
  `GET /api/library/assets/:id/raw` is the read-back/exfiltration half of the SSRF story the
  ingest test file's own header comment describes, and it has no route-level check at all today.
- **The pairing code has no attempt throttle.** `startPairing()` (`library-tokens.ts`) mints a
  6-digit code with a 5-minute TTL and no attempt counter. `POST /api/library/pair/confirm` is
  reachable pre-pairing from any extension-shaped origin (the zero-config bypass). This is a
  genuine, narrow brute-force window this tranche's risk-ranking rule (below) surfaces as a
  higher-exposure row than its plain "creates a token" description would suggest in isolation.
- **The SSRF and token-binding fixes are already landed, with red-before-green specs.**
  `apps/daemon/tests/library-ingest-ssrf.test.ts`,
  `apps/daemon/tests/library-ingest-token-binding.test.ts`,
  `apps/daemon/tests/library-ingest-concurrent-hash-race.test.ts`, and
  `apps/daemon/tests/library-token-revoke-rotate.test.ts` all exist, boot a real daemon, and
  exercise real HTTP against real SQLite-backed state — no mocked transport (satisfies
  `VERIFICATION-CONTRACT.md` §3 R2). Per this PRD's brief: **this tranche formalizes these into
  attributed rows; it does not require re-deriving new controls where a real test already
  proves one.** Full 9-file `library-*.test.ts` run today: 45/45 passing (verified directly;
  see "Verified baseline" below).

## Scope

**S9-1 — Freeze the route snapshot, with drift detection.** The 23 `{method, path}` pairs
registered by `registerLibraryRoutes`, read from the daemon's own `getRouteRegistrationInventory`
(real introspection — `apps/daemon/src/route-registration-guard.ts` — not a text grep), filtered
to `/api/library/*` and `/api/tools/library/*`. This is the frozen set the verifier checks on
every run: any route added or removed drifts the tranche and must be resolved before "green,"
never silently absorbed. `POST /api/backup` / `POST /api/restore` are registered from inside this
same file (`registerBackupRoutes(...)`, line 365) but implemented in and owned by W0's
`apps/daemon/src/backup/routes.ts` — they use a different path prefix (`/api/backup`,
`/api/restore`) and are explicitly **excluded** from this snapshot by the path filter. See
AUTHOR-FLAGGED §4.

**S9-2 — State the risk-ranking rule.** Order is not "obviously the scary one first." Score
= `exposure(0–3) + impact(0–3)`, both derived from properties of the route's own registration and
handler body, not from a person's read of "feels risky":

- **Exposure** — the *weakest* caller class the route's own gate code accepts, in ascending
  order of how little the caller must prove:
  - `0` — wrapped in `requireLocalDaemonRequest` (loopback peer + loopback `Host` + loopback-or-
    absent `Origin`, all three enforced in code).
  - `1` — wrapped in `authorizeToolRequest(...)` (a scoped tool-grant token, external-agent-mid-
    run only).
  - `2` — a self-service bearer check: proof of possession of the caller's *own* token, with no
    loopback requirement (`/pair/revoke`, `/pair/rotate`).
  - `3` — no loopback/token gate stronger than the global `/api` origin middleware, OR reachable
    via the zero-config extension-origin bypass, OR gated only by a short-lived pairing code.
- **Impact** — what the handler does with caller-influenced input:
  - `0` — returns metadata only, no bytes, no state change (`GET /assets`, `GET /connection`).
  - `1` — returns previously-stored bytes/derived content back to the caller (`.../raw`,
    `.../figma`, `.../element`) — the read half of an exfiltration chain if anything upstream
    ever writes attacker-influenced bytes.
  - `2` — mutates a row or moves/copies bytes already inside the daemon's own storage under
    caller direction (`DELETE`, `/apply`, `/edit-as-page`, `/pair/revoke`, `/pair/rotate`,
    `/pair/confirm` minting a token row).
  - `3` — accepts caller-supplied bytes, or fetches a caller-supplied URL, into daemon-owned
    storage (`POST /api/library/ingest` only).

  Tiers: `5–6 = P0` (red specs land first), `4 = P1`, `0–3 = P2`. **Exposure is mechanically
  re-derivable** by the verifier from the AST (which named guard function, if any, wraps each
  `app.<method>(...)` call) and cross-checked against the matrix's own claim per row (criterion
  C9-8) — an implementer cannot claim a lower exposure than the code actually has. Impact is
  implementer-declared and internally consistency-checked (integer range, tier arithmetic
  matches the stated score) but not independently re-derived; see AUTHOR-FLAGGED §5 for why.

  **Worked examples**, to pin the rule before implementation touches it (not an exhaustive
  pre-fill of the matrix — that is the tranche's own hardening work):
  | Route | Exposure | Impact | Score | Tier |
  |---|---|---|---|---|
  | `POST /api/library/ingest` | 3 (accepted branch: any extension-shaped origin + its own token, no loopback proof) | 3 (fetches caller URL / accepts caller bytes into storage) | 6 | **P0** |
  | `POST /api/library/pair/confirm` | 3 (zero-config bypass, pre-pairing, no-attempt-throttle code) | 2 (mints a token row) | 5 | **P0** |
  | `GET /api/library/assets/:id/raw` | 3 (no route-level gate) | 1 (serves stored bytes back) | 4 | P1 |
  | `GET /api/library/assets` | 3 (no route-level gate) | 0 (metadata only) | 3 | P2 |
  | `GET /api/library/clipper-probe` | 3 (zero-config, no gate) | 0 (`{ok:true}`, no data) | 3 | P2 |
  | `DELETE /api/library/assets/:id` | 0 (`requireLocalDaemonRequest`) | 2 (deletes a row + unlinks bytes) | 2 | P2 |
  | `POST /api/tools/library/search` | 1 (tool-token) | 0 (read-only) | 1 | P2 |

**S9-3 — Mechanically-generated attribution matrix.** A companion machine-readable file,
`docs/security/library-ingest-attribution.json`, one row per frozen route (exactly 23, no orphans,
no gaps), each row carrying the six required fields from `VERIFICATION-CONTRACT.md` §6:
`owner`, `authn`, `authz`, `inputValidation`, `sizeRateLimit`, `testRef` — plus the `riskScore`
from S9-2 and exactly one of `control` (a real mechanism + the test that proves it) or
`acceptedRisk` (`{ founder, date, rationale }`) whenever `authn`/`inputValidation` resolves to
"none." A row with all six fields populated but no `control`/`acceptedRisk` on a "none" row does
**not** count as attributed — that is the exact failure mode `W5-W11-gated.md` calls out ("a
matrix full of `auth:none, validation:none` rows is not a completed tranche"). `testRef` values
are validated against a **real** vitest JSON-reporter run of `apps/daemon/tests/library-*.test.ts`
in the same verifier invocation — a name that merely exists in source but didn't pass this run
does not count (criterion C9-5).

`docs/security/daemon-threat-model.md` is extended with a "Wave 9 — Library ingest tranche"
section, in the same style as its existing `[C0-N]` bullets: every claim tagged `[C9-N]` and
cross-checked against a real passing test `fullName`, never asserted from memory (criterion
C9-7). This keeps the one human-readable threat-model document as the single narrative source,
with the JSON file as its machine-checked backing.

**S9-4 — Resolve the size/rate-limit gap explicitly, not by omission.** `POST
/api/library/ingest`'s `sizeRateLimit` field must name either (a) a real control — a red-then-
green test demonstrating a request-volume or byte-volume limit enforced for at least the
clipper/token-bound caller class (the one branch currently exempt from the manual-upload 3 MB /
MIME check) — or (b) an `acceptedRisk` entry. Given no rate-limiting dependency exists in this
repo today, an in-process control (e.g., a bounded per-token-hash or per-origin counter, entirely
inside `routes/library.ts`, no new file, no new dependency) is achievable inside this tranche's
lease; a `library-tokens.ts`-level or `server.ts`-level control is not (see AUTHOR-FLAGGED §1).
This criterion exists specifically so this decision cannot be silently skipped by only filling in
`inputValidation` and leaving `sizeRateLimit` as a copy-pasted "n/a."

**S9-5 — Endpoint tests per tranche.** Every attributed row's `testRef` must name a real,
currently-passing test. Existing coverage (SSRF, token-binding, concurrent-hash-race,
revoke/rotate) may be cited directly per the brief — this tranche is not required to duplicate
tests that already prove the claimed control. Rows with no existing coverage need a new test
(red on `POST /api/library/pair/confirm`'s current attempt-throttle absence would be the highest-
value new red spec, given S9-2's worked example).

## Explicitly out of scope

- The other five W9 tranches (agent spawn, filesystem, deploy/BYOK, external fetch, imports/long
  tail) — they stay in rolling W9 per `W5-W11-gated.md`; this document expands `mishmash-w9-
  ingest-tranche` only.
- `apps/daemon/src/library.ts`, `library-tokens.ts`, `library-sync.ts`,
  `brands/safe-fetch.ts`, `security/library-token-lifecycle.ts` — load-bearing for ingest
  security but outside this tranche's write lease. See AUTHOR-FLAGGED §1.
- AI enrichment, embeddings, semantic search, bookmark import (W5) — no scope creep into
  enrichment; this tranche only hardens what already exists.
- Anything the flag `LIBRARY_UI_VISIBLE` gates for end users (W3's problem) — this tranche's
  output is a **precondition** W3 consumes, not a UI change.

## Definition of "green" (for W3's C3-4 to consume mechanically)

W3's own criterion C3-4 reads: "W9 ingest tranche green as a precondition, recorded in the
manifest." Green, precisely, is: `~/.claude/goal-state/mishmash-w9-ingest-tranche/proof/
manifest.json` exists, `treeDirty === false`, and every entry in `criteria[]` has
`status === "pass"` — including the three named infra checks (`GATE-INTEGRITY`, `LEASE`,
`HEAD-DRIFT`). No criterion in this tranche is `human:`-marked (§3 R7), so
`status: "blocked-on-founder"` should never legitimately appear here; if it does, that is itself
a fail condition for W3's read, not a pass. W3's verifier reads this file directly — it must not
re-run this tranche's checks itself.

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w9-ingest.ts`.

| ID | Criterion | Verification |
|---|---|---|
| C9-1 | Route snapshot frozen, drift-checked | Real daemon boot (`startServer({port:0, returnServer:true})`), live `routeInventory` filtered to `/api/library/*` + `/api/tools/library/*`, `GET`/`POST`/`DELETE`/`OPTIONS` only, compared to the 23-route frozen list embedded in the verifier |
| C9-2 | Existing ingest-security suite is green | Real vitest JSON-reporter run of all 9 `apps/daemon/tests/library-*.test.ts` files; zero failures, zero `skip`/`only`/`todo` markers |
| C9-3 | Attribution matrix exists and covers exactly the frozen route set | `docs/security/library-ingest-attribution.json` parses as JSON; exactly one row per frozen `{method,path}`, no orphans, no gaps |
| C9-4 | Every row is fully attributed per §6's definition | All six required fields non-empty per row; any row whose `authn` or `inputValidation` resolves to "none" carries exactly one of `control`/`acceptedRisk` (not both, not neither) |
| C9-5 | Every `testRef` names a real, currently-passing test | Cross-checked against the same run's vitest JSON reporter `fullName` + `status === "passed"` |
| C9-6 | Ingest's size/rate-limit dimension is explicitly resolved | `POST /api/library/ingest`'s row carries a `control` naming a red-then-green volume/byte-cap test for the clipper/token caller class, or an `acceptedRisk` entry — never a bare descriptive string |
| C9-7 | Threat-model doc extended, mechanically cited | `docs/security/daemon-threat-model.md` carries a "Wave 9" section; every `[C9-N]` bullet's cited test `fullName` passed in this run |
| C9-8 | Matrix's exposure score matches independently-derived exposure | Verifier's own AST scan of each route's guard wrapper (`requireLocalDaemonRequest` / `authorizeToolRequest` / self-service-bearer pattern / none) reproduces the same `riskScore.exposure` integer the matrix claims, for every row |
| C9-9 | Gates | `pnpm guard` and `pnpm typecheck` exit 0 on the current tree |

Plus the three named infra checks every wave verifier carries: **GATE-INTEGRITY** (advisory
self-hash pin, once an orchestrator-approved hash exists), **LEASE** (`git diff --name-only
<baseCommit>...HEAD` ⊆ `leases.json@baseCommit`'s `W9-ingest.allow`, read via `git show`, never
the working tree), **HEAD-DRIFT** (HEAD must not move mid-run).

## Verified baseline (this run, pre-implementation)

Recorded here so the reviewer can see what "honest partial red" looks like before assuming every
red criterion reflects a real gap in the plan rather than simply unstarted work:

- Full 9-file `library-*.test.ts` suite: **45/45 passing** (one transient `--reporter=json`
  flake was observed once during authoring, traced to a `beforeEach` module-eval race unrelated
  to library code — see the verifier's bounded-retry note — and did not reproduce on a clean
  rerun of the same 9 files).
- `POST /api/library/ingest` route registration: confirmed at `library.ts:373` (`OPTIONS`) /
  `:377` (`POST`), handler body ends `:529`.
- Route count: confirmed **23** via real daemon introspection (not a grep count).
- `docs/security/library-ingest-attribution.json`: does not exist yet (C9-3/C9-4/C9-5/C9-6/C9-8
  fail honestly).
- Rate-limiting dependency/logic: confirmed absent repo-wide (C9-6 fails honestly).

## Adversarial review

GPT-5.6 Sol. Focus questions for the reviewer:

- Is the exposure/impact formula (S9-2) actually mechanical, or does it still leave room for an
  implementer to argue a P0 row down to P2 by picking a favorable reading of "accepted branch"?
- Does citing an *existing* test (SSRF, token-binding) as a row's `testRef` under S9-3's "may cite
  directly" allowance let an implementer skip writing the one clearly-missing test this PRD
  itself identifies — the pairing-code attempt-throttle red spec?
- Is excluding `POST /api/backup` / `POST /api/restore` from the frozen snapshot (S9-1) correct,
  or does registering them from inside this file make them this tranche's problem regardless of
  which lease owns their implementation?
- Are the two AUTHOR-FLAGGED lease gaps (§1, §2) real blockers, or is there an in-lease way to
  satisfy the wave's own criteria spine that this draft missed?
- Does the C9-6 in-process rate-limit control (AUTHOR-FLAGGED §1's "achievable in-lease" claim)
  actually hold once someone tries to write it — is a per-token/per-origin counter inside
  `routes/library.ts` alone sufficient, or does it need persisted state that only
  `library-store.ts` (in-lease) can hold, in which case say so explicitly rather than leaving it
  implicit?

---

## AUTHOR-FLAGGED AMBIGUITIES

These are not implementation decisions — they are gaps or tensions in the *scaffolding* (the
lease, the program's own conventions) that this PRD cannot resolve by itself without either
widening scope (forbidden — "if you believe a needed file is missing from it, put that in an
AUTHOR-FLAGGED section, do not widen it yourself") or silently working around a program
convention. Each needs an explicit reviewer ruling before implementation starts.

1. **The lease excludes files the ingest path's actual security behavior lives in.**
   `apps/daemon/src/library.ts` (MIME/size checks, `registerLibraryAsset`, dedup),
   `apps/daemon/src/library-tokens.ts` (pairing/token mint/validate, the pairing-code attempt
   surface), `apps/daemon/src/security/library-token-lifecycle.ts` (revoke/rotate), `apps/daemon/
   src/library-sync.ts` (reconcile), and `apps/daemon/src/brands/safe-fetch.ts` (the SSRF guard
   `fetchRemoteBytes` depends on) are all load-bearing but sit outside `apps/daemon/src/
   routes/library.ts` + `apps/daemon/src/library-store.ts` — the only two source files this
   lease grants. This PRD's S9-4 control is scoped to be buildable entirely inside
   `routes/library.ts` for exactly this reason. `apps/daemon/src/security/library-token-
   lifecycle.ts`'s own header comment already documents this exact constraint being hit once
   before, by W0: "these files sit outside this wave's write lease... this module operates on
   the existing `library_tokens` schema directly via raw SQL rather than adding exports to those
   files." **Recommend the reviewer either (a)** explicitly confirm every control this tranche
   needs fits inside `routes/library.ts` + `library-store.ts` (mirroring that precedent), **or
   (b)** widen the lease. Do not let an implementer discover this mid-tranche and quietly widen
   it themselves.
2. **`docs/plans/waves/DECISIONS.md` — the program's one canonical founder-decision-record
   location — is not in this lease**, unlike every Burst-1 wave (W-C, W0, and W7 all carry
   `docs/plans/waves/**`). Since a legitimate outcome of this tranche's own criteria spine is a
   founder-signed accepted-risk entry (`W5-W11-gated.md`: "each such row needs either a control
   or a founder-signed accepted-risk entry naming who accepted it"), and this PRD has nowhere
   in-lease to put one except `docs/security/library-ingest-attribution.json`'s own
   `acceptedRisk` field, that is where this PRD directs it. Flagging for explicit reviewer
   sign-off on that substitution — or a lease amendment adding `docs/plans/waves/DECISIONS.md`
   as a single-file grant (the program already has precedent for exactly this shape of narrow
   amendment: W0's 2026-07-28 grant of the single file `apps/web/tests/sidecar-proxy.test.ts`).
3. **This very document sits outside the lease it is written under.** `leases.json`'s
   `W9-ingest.allow` does not include `docs/plans/waves/**`, so `docs/plans/waves/W9-ingest-
   tranche.md` — this file — is not itself a leased path. The verifier's own `LEASE` check,
   run today from this branch (before this PRD lands on `main`), will therefore report this file
   as a violation, **honestly, not suppressed** — see "Verified baseline" and the verifier's run
   output. This is expected and self-resolving: once this PRD merges to `main`, it becomes part
   of the base commit for the later implementation-phase diff and drops out of what `LEASE`
   measures. Recommend `leases.json` gain the same single-file amendment pattern noted in §2 so
   the pre-land run reads clean too; either way, this is a known, explained artifact of the
   expansion workflow, not a defect in the tranche's actual scope.
4. **`registerBackupRoutes(...)` is called from inside `routes/library.ts` (line 365)** but its
   route implementations live in `apps/daemon/src/backup/routes.ts`, owned by W0. This PRD's
   frozen snapshot (S9-1) excludes those routes by path prefix (`/api/backup`, `/api/restore` vs.
   this tranche's `/api/library/*` + `/api/tools/library/*`). Flagging so the reviewer can
   confirm this exclusion is intentional scope, not a gap — the routes are real HTTP surface
   reachable through a file this tranche owns, just not attributed by it.
5. **The risk-ranking rule's `impact` axis is implementer-declared, not independently
   re-derived**, unlike `exposure` (mechanically cross-checked, C9-8). Reliably distinguishing
   "returns raw bytes" from "mutates a row" from "fetches a caller URL" via static analysis
   across arbitrary future handler bodies was judged not worth the false-positive risk for a
   23-row, one-file surface — the verifier instead checks that `impact` is a 0–3 integer and that
   the row's own `riskScore.tier` matches the stated formula given both axes, catching arithmetic
   gaming without catching a mis-declared impact value. Flagging so the reviewer can decide if
   this is an acceptable relaxation of "mechanically generated" (`W5-W11-gated.md` line 156) or
   needs a tighter mechanical check before this PRD freezes.
