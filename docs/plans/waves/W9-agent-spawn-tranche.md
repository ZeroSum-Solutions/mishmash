# Wave 9 — Agent-spawn tranche (route hardening, highest-risk tranche)

**Slug:** `mishmash-w9-agent-spawn-tranche`
**Gates on:** W0 (landed)
**Runs within:** the rolling `mishmash-w9-route-hardening` wave (`W5-W11-gated.md`, Wave 9
section) — first by the wave's own risk order: "agent spawn → filesystem read/write → deploy
(BYOK tokens) → external fetch (SSRF) → Library ingest → imports → long tail."
**Blocks:** nothing by name today (unlike `mishmash-w9-ingest-tranche`'s hard W3 gate). Priority
here is risk-ordering, not a downstream dependency.
**Loop:** `loop:tranche` (`VERIFICATION-CONTRACT.md` §6)
**Verifier:** `scripts/waves/verify-w9-agent-spawn.ts`
**Write lease:** not yet applied to `docs/plans/waves/leases.json` — see "PROPOSED write lease."

**Status: FIX ROUND 1 OF 2, post round-1 REJECT (8 blockers).** Round 1 (frozen at `1370e1139`)
returned REJECT: incomplete process-spawn scope, a false auth-wiring premise, incorrect risk
floors, and multiple verifier bypasses. This round applies all eight rulings verbatim, disposed
in **AUTHOR-FLAGGED / DISPOSITIONS** at the end of this document. Per the program's round cap
(`VERIFICATION-CONTRACT.md` §6), one more round remains before escalation to the founder.

---

## Why this tranche exists

Unchanged from round 1: agent-spawn routes launch a real OS child process with caller-influenced
parameters — a strictly larger blast radius than any other tranche's worst case, because a running
agent (or shell) can itself read/write files, call connectors, and act on the operator's behalf.

**Round-1 correction (blocker 1 + ruling):** the tranche boundary was incomplete. `routes/runs.ts`
is not the only file that launches a process or triggers the shared agent runner. Verified
directly in this tree:

- **Terminal** (`apps/daemon/src/routes/terminal.ts`, `apps/daemon/src/terminals.ts:258`) spawns
  an interactive PTY shell (`pty.spawn(shell, [], {...})`) rooted at the project cwd, with **zero
  route-level auth** — `registerTerminalRoutes` gates nothing beyond `getProject(db, ...)`
  existence. **Ruling: folded into this tranche** as the highest-risk process-execution surface —
  deferring a raw shell to "long tail" would contradict the wave's own fixed risk-first order.
- **Routines** (`apps/daemon/src/routes/routine.ts:275-290`) — `POST /api/routines/:id/run` calls
  `routineService.runNow(...)`, which (`server.ts`, `routineService.setRunHandler(...)` registered
  immediately after `registerRunRoutes`) resolves an agent and calls
  `design.runs.start(run, () => startChatRun({...}, run))` — **the exact same spawn primitive**
  `POST /api/runs` uses. `registerRoutineRoutes(app, { db, paths: {RUNTIME_DATA_DIR}, routines:
  {routineService} })` (`server.ts:8764`) passes **no `http`/auth dependency of any kind** — this
  route has no possible guard today, not even a loopback check. **Ruling: a real, uncovered agent
  trigger — must be included.**
- **Orbit** (`apps/daemon/src/routes/media.ts`, `app.post('/api/orbit/run', ...)`) also reaches
  `startChatRun` (via `orbitService.start('manual', ...)` → a responder registered in `server.ts`
  that calls `design.runs.start(run, () => startChatRun({..., systemPrompt: 'You are Orbit, an
  autonomous activity-summary agent...'}, run))`). Unlike routines, this route **is already
  gated**: `if (!isLocalSameOrigin(req, getResolvedPort())) return res.status(403)...`. **Ruling: a
  real, uncovered agent trigger — must be included** (its existing gate is credited in the
  exposure classification below, not treated as absent).
- **Host-tools** (`apps/daemon/src/routes/host-tools.ts`) also spawns a process
  (`launchHostTool`, `host-tools.ts:247`) with zero route-level auth, but launches a **local GUI
  editor/IDE/file-manager app**, not an agent or a shell — a materially different risk shape
  (bounded to a fixed catalogue of desktop applications, no arbitrary command/prompt input).
  **Ruling: does NOT fold into this tranche — gets its own explicitly scheduled tranche**, named
  here so it is not silently forgotten as an anonymous "long tail" item: **`mishmash-w9-host-
  launch-tranche`**, scope `apps/daemon/src/routes/host-tools.ts` (`registerHostToolsRoutes`, 2
  routes: `GET /api/editors`, `POST /api/projects/:id/open-in`), recommended to run immediately
  after this tranche closes, before "long tail" absorbs it.
- **Critique Theater — round-1 disclosure was INACCURATE, corrected here per ruling.** Round 1
  flagged the critique-orchestrator's "spawn-time gate" comments as a possible additional agent
  trigger. Verified directly: `plugins/atoms/built-ins.ts:29-68`'s `critiqueTheaterWorker` **reads
  `run_devloop_iterations.critique_summary` from SQLite and regex-extracts a score — it spawns
  nothing.** The orchestrator invoked from `server.ts:6685-6816` (`runOrchestrator({..., child,
  childExitPromise, stdout: stdoutIterable, ...})`) is passed the **already-spawned coding-agent
  child** (the same `child` created earlier in the identical `startChatRun`-equivalent flow, for
  the run `POST /api/runs`/`POST /api/chat` already created) — it attaches to that child's stdout
  and orchestrates a ship/no-ship decision; it does not spawn an independent process. **No new
  route coverage is required for Critique Theater** — it is fully covered by whichever route
  already spawned the agent child it consumes.

**Revised tranche scope: 17 route registrations across 4 files, 4 `register*Routes` functions:**

| # | Method + Path | File | Registrar function | In-scope reason |
|---|---|---|---|---|
| 1 | `POST /api/runs` | `routes/runs.ts` | `registerRunRoutes` | spawns coding-agent child |
| 2 | `GET /api/runs` | `routes/runs.ts` | `registerRunRoutes` | run lifecycle |
| 3 | `GET /api/runs/:id` | `routes/runs.ts` | `registerRunRoutes` | run lifecycle |
| 4 | `GET /api/runs/:id/events` | `routes/runs.ts` | `registerRunRoutes` | run lifecycle |
| 5 | `GET /api/runs/:id/agui` | `routes/runs.ts` | `registerRunRoutes` | run lifecycle |
| 6 | `GET /api/runs/:id/result-package` | `routes/runs.ts` | `registerRunRoutes` | run lifecycle |
| 7 | `POST /api/runs/:id/cancel` | `routes/runs.ts` | `registerRunRoutes` | run lifecycle |
| 8 | `POST /api/chat` | `routes/runs.ts` | `registerRunRoutes` | spawns coding-agent child |
| 9 | `POST /api/projects/:id/terminals` | `routes/terminal.ts` | `registerTerminalRoutes` | spawns PTY shell |
| 10 | `GET /api/projects/:id/terminals` | `routes/terminal.ts` | `registerTerminalRoutes` | session lifecycle |
| 11 | `GET /api/projects/:id/terminals/:tid/stream` | `routes/terminal.ts` | `registerTerminalRoutes` | session lifecycle |
| 12 | `POST /api/projects/:id/terminals/:tid/stdin` | `routes/terminal.ts` | `registerTerminalRoutes` | **arbitrary command injection into a live shell** |
| 13 | `POST /api/projects/:id/terminals/:tid/resize` | `routes/terminal.ts` | `registerTerminalRoutes` | session lifecycle |
| 14 | `POST /api/projects/:id/terminals/:tid/kill` | `routes/terminal.ts` | `registerTerminalRoutes` | session lifecycle |
| 15 | `DELETE /api/projects/:id/terminals/:tid` | `routes/terminal.ts` | `registerTerminalRoutes` | session lifecycle (kill alias) |
| 16 | `POST /api/routines/:id/run` | `routes/routine.ts` | `registerRoutineRoutes` | triggers shared agent runner |
| 17 | `POST /api/orbit/run` | `routes/media.ts` | `registerMediaRoutes` | triggers shared agent runner |

**Scoping note on rows 16-17:** unlike `registerRunRoutes`/`registerTerminalRoutes` (frozen in
full — every route those functions register is in scope), `registerRoutineRoutes` registers ~9
other CRUD routes for routine *configuration* (create/update/delete/list/schedule) and
`registerMediaRoutes` registers dozens of unrelated media-generation/upload routes. Only the one
named spawn-triggering route in each is frozen and in scope; the surrounding routes belong to
other, unnamed tranches (routine/automation management; media generation) and are explicitly
**not** covered here. Drift detection for rows 16-17 is narrower accordingly: it confirms the
named registration's continued existence and non-duplication, not the absence of unrelated
sibling routes in those files (see C9S-1).

## Ground facts (verified directly in this tree, at `HEAD` on `feat/w9-agent-spawn-tranche`)

- **None of the 17 routes carry any capability-token auth.** One (`POST /api/orbit/run`) carries a
  **loopback-only** check (`isLocalSameOrigin`). All others rely solely on `server.ts`'s global
  `/api` origin middleware.
- **Round-1 correction (blocker 2 — false dependency ground fact).** Round 1 claimed
  `requireLocalDaemonRequest` AND `authorizeToolRequest` were both reachable through
  `registerRunRoutes`'s `ctx.http` with zero server wiring change. **Half of that was wrong.**
  Verified precisely:
  - `RegisterRunRoutesDeps.http` (`routes/runs.ts`, hand-rolled inline type, **not** the shared
    `RouteDeps<K>`/`ServerContext` pattern the rest of the codebase uses) is typed as exactly
    `{ createSseResponse, sendApiError }` — narrower than what's actually passed at runtime.
  - The **runtime** `httpDeps` object (`server.ts:2644-2653`) already includes
    `requireLocalDaemonRequest` and `isLocalSameOrigin`, and `registerRunRoutes(app, { ...,
    http: httpDeps, ... })` (`server.ts:8330`) **already passes the full object**. So
    `requireLocalDaemonRequest`/`isLocalSameOrigin` need **only a TypeScript interface widening
    inside `routes/runs.ts`** (two more fields on the existing inline type) — **zero `server.ts`
    edit** for these two.
  - `authorizeToolRequest` is a **different, separate** dependency (`authDeps`, `server.ts:2912-
    2921`, built from `createToolRequestAuth`) that is **not passed to `registerRunRoutes` at
    all** (confirmed against the exact call site, `server.ts:8330-8348` — no `auth` key). Using it
    inside `routes/runs.ts` needs **both** an interface addition (`auth: { authorizeToolRequest
    }`) **and** a one-line `server.ts` wiring change (`auth: authDeps` added to the
    `registerRunRoutes(app, {...})` call, mirroring `registerLibraryRoutes`'s existing `auth:
    authDeps`). **Ruling: this is an acceptable lease shape** — `server.ts` is added to this
    tranche's proposed lease for this one wiring line, with a temporal-serialization note (W1 owns
    `server.ts` for its Burst; this tranche's implementation lands later, serialized, never
    concurrent).
  - `registerTerminalRoutes` (`terminal.ts`) properly extends the shared
    `RouteDeps<'db'|'http'|'paths'|'projectStore'|'projectFiles'>` = `Pick<ServerContext,...>`,
    so its `http` field is the **full** `HttpDeps` type — `requireLocalDaemonRequest` and
    `isLocalSameOrigin` are **already both type- and runtime-available with zero wiring change**.
  - `registerRoutineRoutes` (`routine.ts`) extends `RouteDeps<'db'|'routines'>` — **`http` is not
    in its deps at all**, type or runtime. Hardening it needs an interface addition (`http:
    Pick<HttpDeps, 'requireLocalDaemonRequest'>` at minimum) **and** a `server.ts` wiring change
    (`http: httpDeps` added to the `registerRoutineRoutes(app, {...})` call, `server.ts:8764`).
  - `registerMediaRoutes` (`media.ts`) extends `RouteDeps<...|'http'|'auth'|...>` — **both**
    `requireLocalDaemonRequest`/`isLocalSameOrigin` **and** `authorizeToolRequest` are already
    type- and runtime-available there with **zero wiring change**; Orbit's route could be raised
    from its current loopback-only gate to a real capability gate with a route-body-only edit.
- **`server.ts` is added to this tranche's proposed lease for exactly two lines** (the
  `registerRunRoutes`/`registerRoutineRoutes` call-site `auth`/`http` additions) — not for
  spawn-logic changes. `server.ts` remains W1's owned file for its Burst; this tranche's
  implementation is later and serialized, never a concurrent writer.
- **`GET /api/runs/:id`'s floor was wrong in round 1 (blocker 8) — corrected 0 → 1.**
  `design.runs.statusBody` (`apps/daemon/src/runtimes/runs.ts:292-328`) returns far more than
  "status/timestamps/ids": `childPid`, `processGroupId`, `childExited`, `exitCode`, `signal`,
  `error`, `errorCode`, `failureCategory`, `failureDetail`, an absolute `eventsLogPath`,
  `workspace` (storage/provenance), `mediaExecution`, `toolBundle`, and conditionally
  `promptCache`, `nativeSessionRecovery`, `browserUse` diagnostics. This is derived/stored content
  returned to the caller — floor 1, per this document's own floor definitions. **`GET /api/runs`
  stays floor 1** (already correct in round 1).
- **No dedicated security/hardening test coverage exists for any of the 17 routes today.**

## Exposure scale — corrected (blocker 3c/round-1 ruling)

**Round-1's 3-valued scale (0/1/3) was wrong under this tranche's own local-process attacker
model.** `requireLocalDaemonRequest` (`apps/daemon/src/http/local-daemon-request.ts:70-113`)
validates the request's **peer socket address**, **`Host` header**, and **`Origin` header** are
all loopback — but any local process (the exact attacker this tranche's threat model is built
around) trivially satisfies all three by connecting to `127.0.0.1` with an unset or loopback
`Origin`. Calling that "exposure 0" (safest) is a category error: it confers **zero** real defense
against the attacker this tranche cares about. `authorizeToolRequest`, by contrast, requires
possession of a bearer token/capability grant the attacker does not have — genuine authentication.

**Corrected 4-valued scale** (deliberately still not fully populated — see below):

- **`0`** — genuinely authenticated/authorized closure: the handler's direct top-level
  `body.statements` begin with `const grant = authorizeToolRequest(...)` immediately followed by
  an unconditional-exit `if (!grant)`, where `authorizeToolRequest` is a **bare identifier**,
  bound at the top of the registrar function by a real destructure from `ctx.auth` (or equivalent
  injected dependency), and **not locally shadowed** between that binding and the guard's call
  site (closes blocker 3c — see "Anti-gaming fixes" below).
- **`1`** — **reserved, deliberately unused.** No primitive in this codebase today sits strictly
  between "genuinely authenticated" and "loopback-only" for inbound spawn-trigger auth. Round 1
  avoided inventing a decorative intermediate value for its 3-valued scale; this round keeps that
  principle, just renumbered to make room for the corrected ordering below. A future round may
  populate it if an implementer introduces a real intermediate primitive.
- **`2`** — **loopback-only, zero real credential**: either (a) `requireLocalDaemonRequest` is a
  literal identifier among the route's own middleware arguments, or (b) the handler's first direct
  top-level statement is `if (!isLocalSameOrigin(req, ...)) { <unconditional exit> }`. Both are
  network-topology checks a local-process attacker satisfies for free; classified above "no gate"
  only because they do block a genuinely remote/cross-origin browser attacker, which is real,
  narrower value.
- **`3`** — none of the above.

**Consequence the ruling intends and this document makes explicit:** adding *only* loopback
gating to a spawn-impact route (impact floor 3) no longer exits P0 tier — `2 + 3 = 5`, still P0.
Only genuine authorization (`0 + 3 = 3`, P2) does. This is a deliberately stricter, more accurate
risk signal than round 1's scale produced.

**Attribution threshold widened accordingly:** attribution (`control`/`acceptedRisk`) is now
required for every row with **`exposure >= 2`**, not `exposure === 3` — a loopback-only row is
still meaningfully exposed under this tranche's own attacker model and must not silently skip
attribution the way round 1's scale allowed.

## The full frozen table (17 routes, floors integer 0-3, `score = exposure(live) + impact(floor)`)

| # | Route | Impact floor | Impact rationale |
|---|---|---|---|
| 1 | `POST /api/runs` | 3 | spawns a new OS child process; caller-selected agent/prompt/model/tool-bundle |
| 2 | `GET /api/runs` | 1 | lists status/metadata (incl. `childPid`, error detail, workspace provenance) for every run system-wide |
| 3 | `GET /api/runs/:id` | 1 | corrected (blocker 8) — `statusBody` returns process/error/workspace/tool detail, not bare ids |
| 4 | `GET /api/runs/:id/events` | 1 | streams live stdout/stderr/tool-result content; no ownership check |
| 5 | `GET /api/runs/:id/agui` | 1 | same content, AGUI envelope; no ownership check |
| 6 | `GET /api/runs/:id/result-package` | 1 | workspace file listing + artifact manifests; no ownership check |
| 7 | `POST /api/runs/:id/cancel` | 2 | terminates another caller's in-flight child by id; no ownership check |
| 8 | `POST /api/chat` | 3 | same spawn path as row 1, via `startChatRun` |
| 9 | `POST /api/projects/:id/terminals` | 3 | spawns a new interactive PTY shell rooted at the project cwd |
| 10 | `GET /api/projects/:id/terminals` | 1 | lists live terminal sessions for a project |
| 11 | `GET /api/projects/:id/terminals/:tid/stream` | 1 | streams live shell output |
| 12 | `POST /api/projects/:id/terminals/:tid/stdin` | 3 | injects arbitrary keystrokes into a live shell — equivalent to remote command execution once a session exists |
| 13 | `POST /api/projects/:id/terminals/:tid/resize` | 0 | UI geometry only, no data exposure or state mutation of substance |
| 14 | `POST /api/projects/:id/terminals/:tid/kill` | 2 | terminates another caller's shell session; no ownership check |
| 15 | `DELETE /api/projects/:id/terminals/:tid` | 2 | kill alias, same as row 14 |
| 16 | `POST /api/routines/:id/run` | 3 | triggers the shared agent runner on demand; caller does not control prompt content, only trigger timing — narrower than row 1 but still a genuine unauthenticated spawn trigger, launching a real child process with real resource/action cost |
| 17 | `POST /api/orbit/run` | 3 | triggers the shared agent runner (Orbit); exposure is 2 (loopback-gated) today, not 3 — still P0 at score 5 |

`tierFor`: `score 5-6 = P0`, `score 4 = P1`, `score 0-3 = P2`. **Guaranteed P0 today (live-derived
exposure — all 17 rows currently classify at exposure 2 or 3, none at 0 or 1):** every impact-3 row
(1, 8, 9, 12, 16, 17) and every impact-2 row (7, 14, 15) score 5 or 6 — **9 P0 rows today**. This
table states current reality for the reader; the attribution matrix computes P0 status live from
the classifier at verification time and is the actual source of truth (C9S-2/C9S-4/C9S-6 all key
off the matrix's own live-checked values, never this static prose table).

## Scope

**S9S-1 — Freeze the route snapshot across all 4 files, with drift detection, HEAD-state
integrity, and a fail-closed computed-path guard.** AST-scoped to each named registrar's own
function body (rows 1-15: the whole function; rows 16-17: the one named route only, per the
scoping note above). **Round-1 fixes applied (blocker 3):**

- **Computed/dynamic route paths are a hard fail, not a silent skip.** The collector separately
  counts *every* `app.<method>(...)` call inside scope (any first argument) and the subset with a
  **static** string/no-substitution-template first argument. Any difference is an immediate
  criterion failure — an unparseable route can no longer hide a 9th registration from the frozen
  count.
- **Live-boot drift detection is a real allowlist check, not silent presence-counting.** For each
  owned file's route-path prefix, the live daemon's route table is compared against **exactly**
  the frozen keys **plus an explicitly named sibling-exclusion list** (today: `apps/daemon/src/
  routes/genui.ts`'s 5 `/api/runs/:runId/*` routes, and `routes/chat.ts`'s `POST /api/runs/:id/
  feedback` — both empirically discovered false-positives from round-1's own testing, named here
  so the exclusion is auditable, not silently baked into a regex). Anything at an owned prefix that
  is neither a frozen key nor a named sibling is a hard fail.
- **HEAD-state integrity: every HEAD-dependent read in this verifier is sourced from a single
  detached temporary git worktree pinned to `headSha`**, created once near the start of the run
  (`git worktree add --detach <tmp> <headSha>`, `mise trust`, `pnpm install --offline --frozen-
  lockfile` against the shared pnpm store), never from the live/mutable primary worktree. This
  structurally closes the round-1 gap (blocker 3e) where a HEAD file could be mutated, read
  favorably, and restored before the end-of-run `treeDirty` check ever saw it — the detached
  worktree is a separate checkout nothing else can write to mid-run. Route collection, the
  isolated daemon boot's imported source, the attribution matrix, the threat-model doc, and the
  dedicated test suite are all read/run from this worktree. `HEAD-DRIFT` (git rev-parse HEAD
  before/after) remains as a secondary, cheap check; it is no longer the primary defense.
- **Auth-classifier identifier binding (blocker 3c).** Both `authorizeToolRequest` (exposure 0)
  and `requireLocalDaemonRequest`/`isLocalSameOrigin` (exposure 2) must be **bare identifiers**
  (never `x.authorizeToolRequest(...)` — a property access on an arbitrary object no longer
  counts), and the classifier verifies the identifier is **not locally shadowed**: it walks the
  enclosing registrar function's own parameter list and every top-level `const`/`let`/`var`
  declaration between the real ctx-destructure binding (if any) and the guard's call site, failing
  the positive classification if a conflicting local redeclaration exists anywhere in that range.
  A route using a same-named local fake (`const authorizeToolRequest = () => true`) now classifies
  as exposure 3, not a false 0/2.

**Fourteen verifier self-probe fixtures** (up from 8; run through the identical collector/
classifier pipeline the real criteria use): the four round-1 fixtures for the shapes that still
apply, plus new fixtures for: the real `isLocalSameOrigin`-inline shape (expect 2); a
property-access alias `fake.authorizeToolRequest(...)` (expect 3, not 0 — closes the exact
round-1 gaming vector the reviewer demonstrated); a locally-shadowed `authorizeToolRequest` const
overriding the real ctx-bound one before the guard call (expect 3); a locally-shadowed
`requireLocalDaemonRequest` const passed as the middleware argument (expect 3, since the
"identifier" the classifier sees is the shadow, not the real middleware); a computed route path
(`app.post(SOME_CONST, handler)`) — the collector must raise the computed-vs-static count
mismatch rather than silently omitting the row; a template literal **with** substitution used as
a route path (same computed-path fail); and the real `authorizeToolRequest` shape bound via a
top-level `const { authorizeToolRequest } = ctx.auth;` destructure with no shadowing (expect 0,
proving the classifier isn't merely permissive by omission). A failed self-probe fails C9S-1
outright.

**S9S-2 — Risk-score formula, integer-bounded impact, matrix-derived P0 set.** `riskScore.impact`
must be an **integer in `[0, 3]`** (round 1 only checked `>= floor`, never bounds — blocker 4).
`riskScore.exposure` must exactly equal the classifier's **live** re-derivation from the detached
HEAD worktree. `riskScore.score = exposure + impact` exactly. `riskScore.tier = tierFor(score)`
exactly. **P0-tier row identification for C9S-4/C9S-6 is computed from the matrix's own
(now-validated) live values, never from a hardcoded table** (blocker 4's "frozen exposure-3 P0 set
instead of verified matrix rows" finding) — this makes the P0 set responsive to real hardening
(a row that gains real auth legitimately leaves P0) without an implementer being able to
under-declare a P0 row's tier and skip C9S-4/C9S-6 coverage, since the tier is recomputed by the
verifier from the same live exposure value C9S-1/C9S-2 already independently verified.

**S9S-3 — Attribution matrix.** `docs/security/agent-spawn-attribution.json`, exactly 17 rows (no
orphans/gaps/duplicates), the same six required fields as the ingest tranche's schema
(`owner`, `authn`, `authz`, `inputValidation`, `sizeRateLimit`, `testRef`), non-placeholder,
`authn` naming its row's live exposure class. **Attribution required for every row with `exposure
>= 2`** (widened from round 1's `=== 3`, see "Exposure scale" above). **Round-1 fixes (blocker
4):**

- **Exactly one of `control`/`acceptedRisk`, enforced as a real XOR.** Round 1's `if (control) {}
  else if (acceptedRisk) {}` silently accepted a row carrying *both* — now a hard fail if both are
  present, and a hard fail if neither is.
- **The primary `row.testRef` is no longer placeholder-checked only** — it must resolve to a real,
  currently-passing, uniquely-route-associated test, entering the **same global citation-
  uniqueness map** as `control.testRef` (round 1 only put `control.testRef` in that map).
- **`acceptedRisk.decisionRef` must carry the exact `W9AS-ACCEPT-` prefix** (`/^W9AS-ACCEPT-
  [a-z0-9-]+$/`), not a strip-then-match that would accept an unprefixed slug.
- The `control` path keeps round 1's global-uniqueness + route-association + same-file
  paired-positive/negative-control requirements, and now **additionally requires the cited test's
  own body (not just its name) to contain a real, AST-located transport assertion** — see S9S-4's
  body-text requirement, which applies uniformly to every citation, not only rate-limit controls.
- New-test red evidence now runs the **full detached-worktree replay** (S9S-5).

**S9S-4 — P0-row size/rate-limit resolution, transport-proven, not name-decoded.** Applies to
every row the **matrix's own live-derived** tier computes as P0 (S9S-2), not a static set.
**Round-1 fixes (blocker 5):**

- Grammar corrected to drop the unused `pair-attempt` kind (round 1's PRD prose still listed it
  while the verifier's parser only ever accepted `request-rate|byte-volume` — a real prose/code
  mismatch, now aligned): `ENFORCED kind=<request-rate|byte-volume> scope=<token-hash|origin>
  limit=<positive-integer> windowMs=<positive-integer|none> overflow=<reject-429|reject-413>`.
  `request-rate` requires a positive `windowMs`; `byte-volume` requires `windowMs=none`.
- **The over-limit assertion-name matcher must bind the declared `limit` value too, not only the
  overflow status** — round 1's `matchesOverLimitAssertion` accepted its `limit` parameter but
  never checked it, a real bug the review caught directly. Fixed: both the under-limit and
  over-limit assertions must contain the declared `limit` as an exact numeric token; the over-limit
  assertion must **additionally** contain the declared overflow HTTP status as an exact numeric
  token.
- **Name-matching alone is no longer sufficient evidence of transport behavior.** Every cited
  under/over-limit assertion's **own body source** (captured verbatim during AST extraction, not
  just its title) must contain a status-code assertion shaped like `expect(<...>.status).toBe(
  <code>)` (or an equivalent `.status ===`/`.toBe(` pairing within a short token window of the
  word `status`) naming the exact expected code — the under-limit assertion's code and the
  over-limit assertion's declared `overflow` code respectively. This does not replace the
  name-binding checks; it adds a body-level check that the test actually exercises and asserts on
  a real HTTP response, closing the "decoy name, no real transport proof" gap without requiring
  the verifier itself to fire live rate-limit-triggering requests against not-yet-built code (which
  would risk spawning real, expensive agent/shell processes during verification — an unacceptable
  safety trade against the ports/process isolation rule).

**S9S-5 — Dedicated endpoint tests, 8-case red-team corpus, full replay for new tests.** Every
attributed row's `testRef`/`control.testRef` must name a real, currently-passing, route-associated
test in `apps/daemon/tests/agent-spawn-*.test.ts`. **Round-1 fixes (blocker 5):**

- **Corpus-coverage checking is AST-scoped to test titles/bodies, never combined raw source
  text including comments.** Round 1's five regex checks ran over the whole file's text, so one
  comment mentioning all five topics would satisfy every check; now each required case must match
  against at least one **distinct extracted test's title or body** (AST traversal naturally
  excludes comment trivia).
- **Skip-marker scanning extended**: in addition to `.skip`/`.only`/`.todo`, also flags
  `.concurrent.skip`, `.skipIf(`, and any `todo.skip`-shaped chain; additionally requires the
  vitest JSON reporter's `numPendingTests` (when present) to be exactly `0`.
- **Corpus grows from 5 to 8 named cases** (blocker 5's explicit ask):
  1. Unknown `agentId` rejected without spawning (paired: real available `agentId` succeeds).
  2. Oversized body rejected at the global 4 MB limit (paired: just-under-limit succeeds).
  3. Run-creation rate limiting enforced, transport-proven per S9S-4 (paired: `N` requests succeed,
     `N+1`th is `429`/`413` per the declared grammar).
  4. Cross-caller run-id read/cancel behavior asserted one way or the other (paired: owning
     caller's own read/cancel succeeds) — **now explicitly includes the terminal surface**: a
     second caller's `GET .../terminals/:tid/stream` and `POST .../stdin` against a terminal
     session it did not create.
  5. Sandbox-escape attempt on a run's `cwd` rejected via `assertSandboxProjectRootAvailable`
     (paired: a real managed project succeeds).
  6. **New — a denied (unauthenticated/unauthorized) caller's spawn attempt is rejected before any
     child process is observed to start**, distinct from case 4 (which is about reading/canceling
     an *existing* run, not about the spawn request itself).
  7. **New — actual child/concurrency-budget evidence**: a test asserting a real, bounded number of
     concurrently-running children under a burst of spawn requests (e.g. via `childPid`/process
     count in `statusBody`, or a concurrency-limit rejection), not merely that individual requests
     return a status code.
  8. **New — capability/operation binding**: a test proving that whatever authorization is added
     scopes *which* `agentId`/prompt/model/tool-bundle a caller may select, not only a binary
     allow/deny on the route itself (e.g., a capability grant scoped to one `agentId` is rejected
     when the request selects a different one).

**S9S-6 — Threat-model doc, bounded section, fence-aware, exact citation.** `docs/security/
daemon-threat-model.md` gets a `[C9S-N]`-tagged "Wave 9" section. **Round-1 fix (blocker 6):**
round 1's "loose heading to EOF" scan, "any `[C9S-N]` line counts," and "route-string-occurrence
only" checks are replaced **verbatim** with the ingest tranche's own hardened machinery
(`verify-w9-ingest.ts` lines ~2383-2523): the section is bounded to the next `## ` heading; a
CommonMark-aware fence tracker (separate single-character alternates, at-most-3-space indent,
backtick-info-string restriction) excludes fenced and indented code from bullet scanning; only
real Markdown list-item lines count; each P0 route's bullet must name **exactly** that route and
cite **exactly** its expected reference (`control.testRef` for a controlled row, primary `testRef`
for accepted-risk), already globally associated with only that route — no substring/occurrence
matching anywhere in this check.

**S9S-7 — Adversarial implementation review, orchestrator-owned, out-of-repo.** **Round-1 fix
(blocker 7, structural, not cosmetic):** round 1's `docs/security/agent-spawn-implementation-
review.json` was implementer-authored, in-repo, under this tranche's own proposed lease glob — an
implementer could self-approve, and worse, the record's own existence (added *after* its
`reviewedCommit`) structurally violated the "owned-path diff to HEAD is empty" condition it was
supposed to satisfy. **Fixed by relocating to the W7 pattern verbatim**: the load-bearing record
lives at `~/.claude/goal-state/mishmash-w9-agent-spawn-tranche/reviews/implementation-review.json`
— **outside the repository entirely**, in a directory this tranche's lease never grants write
access to (it is not a repo path at all), the identical trust model `verify-w7.ts` uses for
`GATE-INTEGRITY`/`approved-gate.sha256` and its own dispositions directory. The verifier performs
**structure-only** checks (per `VERIFICATION-CONTRACT.md` R7 — judgment stays with the reviewer,
the verifier stays mechanical): `reviewer`/`model` non-empty, `reviewedCommit` a real strict
ancestor of `HEAD` whose owned-path diff to `HEAD` is empty (now satisfiable, since the record is
never itself a diffed path), `reviewer` distinct from every `baseCommit..reviewedCommit` author,
`verdict === 'APPROVE'`. `docs/security/agent-spawn-implementation-review.json` is **removed**
from this tranche's implementation surface and proposed lease entirely.

**S9S-8 — Run-id/session ownership: founder-level, explicitly parked, not silently decided.**
**Ruling, applied verbatim:** whether run-id-scoped reads/cancels and terminal-session access need
real per-caller ownership scoping, or an explicit accepted single-user shared-local namespace, is
a product decision this document is not positioned to make unilaterally (round 1 already said as
much in its open questions; the ruling now requires it be *encoded*, not merely asked). Mirrors the
`C7-16` precedent: a criterion (`C9S-8`) that resolves to exactly one of three states:
  - **pass, variant (a):** a real, tested, route-associated authorization control exists scoping
    run-id/terminal-session access to the creating caller (same evidentiary bar as any other
    `control` — S9S-3).
  - **pass, variant (b):** a founder-signed `### W9AS-ACCEPT-shared-local-namespace` block exists
    in `DECISIONS.md@baseCommit` with all five standard accepted-risk fields, explicitly accepting
    a single-user shared-local namespace for run-id/session access (Accepter distinct from any
    `baseCommit..HEAD` commit author, same as every other accepted-risk entry).
  - **`blocked-on-founder`** (a legal terminal state per `VERIFICATION-CONTRACT.md` §2 rule 3, not
    a failure) when **neither** (a) nor (b) exists yet — the freeze proceeds with the decision
    visibly parked rather than silently assumed either way, and this state does not block the
    autonomous implementation loop, only landing.

## Success criteria

- **C9S-1** — 17-route snapshot frozen across 4 files/registrars, self-probe-gated (14 fixtures)
  exposure classifier with shadow/alias/computed-path anti-gaming, drift-checked against baseCommit
  AST, HEAD AST (sourced from the detached HEAD worktree), and a live isolated daemon boot's
  routeInventory (allowlist-checked against named siblings, not silently presence-counted).
- **C9S-2** — every row's `riskScore` is integer-bounded, formula-consistent, and exactly matches
  the live-derived exposure from the detached HEAD worktree.
- **C9S-3** — matrix structurally complete (17 rows), six fields non-placeholder, `authn` correct,
  every `exposure >= 2` row attributed via exactly one of `control`/`acceptedRisk` (true XOR),
  primary `testRef` also uniquely validated, `acceptedRisk.decisionRef` exact-prefix-checked;
  unattributed = 0.
- **C9S-4** — every matrix-derived P0 row's size/rate-limit resolves via the corrected grammar,
  bound by both `limit` and `overflow` numeric tokens on both sides, **and** body-text
  status-code assertions on the cited tests, not name-matching alone.
- **C9S-5** — the dedicated suite exists, boots a real daemon, passes, zero skip/only/todo/pending,
  implements all 8 named corpus cases (title/body-scoped, comment-immune), and every genuinely-new
  cited test independently passes the full detached-worktree Vitest-Node-API replay (ported from
  `verify-w9-ingest.ts`, required now, not deferred).
- **C9S-6** — threat-model doc extended with the ingest tranche's own bounded/fence-aware/
  exact-citation machinery, one bullet per (matrix-derived) P0 route.
- **C9S-7** — out-of-repo, orchestrator-owned implementation-review record at
  `~/.claude/goal-state/mishmash-w9-agent-spawn-tranche/reviews/implementation-review.json`,
  structure-only checked, reviewer ≠ author, verdict APPROVE.
- **C9S-8** — run-id/session ownership resolves to pass (variant a or b) or `blocked-on-founder`
  (never silently assumed, never a hard fail on its own).
- **LEASE / HEAD-DRIFT / GATE-INTEGRITY** — infra, unchanged in spirit from round 1; `LEASE` now
  checks against the widened `W9-agent-spawn` allow-list including the `server.ts` wiring lines.

## Implementation surface (files a future implementation agent will touch)

- `apps/daemon/src/routes/runs.ts` — widen the inline `http` type (+2 fields, no `server.ts`
  change), add an `auth` field, wire the P0 rows' rate/size controls.
- `apps/daemon/src/routes/terminal.ts` — apply `requireLocalDaemonRequest`/`isLocalSameOrigin`
  (already type/runtime-available, zero interface change) and/or a real per-caller control to the
  create/stdin/kill routes; add a rate/concurrency control for session creation.
- `apps/daemon/src/routes/routine.ts` — add an `http` field to `RegisterRoutineRoutesDeps` and
  wire a guard on `POST /api/routines/:id/run`.
- `apps/daemon/src/routes/media.ts` — optionally raise `POST /api/orbit/run` from loopback-only to
  a real capability gate (`authorizeToolRequest` already available there); not required, but the
  cheapest possible upgrade given zero wiring cost.
- `apps/daemon/src/server.ts` — **exactly two call-site edits**: add `auth: authDeps` to the
  `registerRunRoutes(app, {...})` call (`server.ts:8330-8348`), and add `http: httpDeps` to the
  `registerRoutineRoutes(app, {...})` call (`server.ts:8764`). No other `server.ts` change.
- `apps/daemon/tests/agent-spawn-*.test.ts` (new) — the 8-case red-team corpus + cited coverage.
- `docs/security/agent-spawn-attribution.json` (new) — S9S-3.
- `docs/security/daemon-threat-model.md` (extend) — S9S-6.
- `docs/security/agent-spawn-red/<slug>.txt` (new, only for genuinely new cited tests) — S9S-5.
- `docs/plans/waves/DECISIONS.md` (extend only, `### W9AS-ACCEPT-<slug>` blocks) — for any
  `acceptedRisk` row, including a possible `W9AS-ACCEPT-shared-local-namespace` for C9S-8 variant
  (b).
- `scripts/waves/verify-w9-agent-spawn.ts` (this tranche's own verifier).
- **Removed from the implementation surface (round-1 correction):**
  `docs/security/agent-spawn-implementation-review.json` — relocated out-of-repo (S9S-7); no
  longer a file the implementer writes inside the lease.

## PROPOSED write lease (text only)

```jsonc
"W9-agent-spawn": {
  "slug": "mishmash-w9-agent-spawn-tranche",
  "allow": [
    "apps/daemon/src/routes/runs.ts",
    "apps/daemon/src/routes/terminal.ts",
    "apps/daemon/src/routes/routine.ts",
    "apps/daemon/src/routes/media.ts",
    "apps/daemon/src/server.ts",
    "apps/daemon/tests/agent-spawn-*.test.ts",
    "docs/security/**",
    "scripts/waves/verify-w9-agent-spawn.ts",
    "docs/plans/waves/DECISIONS.md"
  ],
  "note": "Round-2 revision: routes/terminal.ts, routes/routine.ts, routes/media.ts, and
    server.ts added per the round-1 adversarial ruling (blockers 1-2). server.ts is included for
    EXACTLY two call-site wiring lines (registerRunRoutes gains an `auth` dep, registerRoutineRoutes
    gains an `http` dep) -- not for spawn-logic edits. server.ts is also W1-owned for its Burst;
    this tranche's implementation lands later and is temporally serialized, never a concurrent
    writer. docs/security/** and DECISIONS.md are also claimed by W9-ingest; both tranches only
    ever add new, distinctly-prefixed files/sections there (agent-spawn-*.json vs
    library-ingest-*.json; W9AS-ACCEPT-* vs W9-ACCEPT-* headings) -- never edit each other's --
    but concurrent execution should still serialize through the integrating writer per
    VERIFICATION-CONTRACT.md §5. The implementation-review record does NOT live under this lease
    (S9S-7) -- it is orchestrator-owned and out-of-repo."
}
```

## Out of scope

**The other five named tranches** (unchanged from round 1): filesystem read/write, deploy (BYOK
tokens), external fetch (SSRF), Library ingest (already landed separately), imports. **"Long
tail"** — the wave doc's catch-all, not itself a tranche.

**Explicitly named, explicitly NOT silently dropped (round-1 + round-2 corrections):**

- **`apps/daemon/src/routes/host-tools.ts`** — **now formally out of scope with its own named,
  scheduled tranche** (`mishmash-w9-host-launch-tranche`, see "Why this tranche exists" above),
  not an anonymous long-tail item.
- **Critique Theater** — round-1's "flagged as unknown" status is **resolved**: verified to consume
  an already-spawned child, not to spawn independently. No further coverage needed; not an open
  question anymore.

## Open design questions (for the adversarial reviewer)

Round-1's questions 1 and 2 (host-tools/terminal scope, critique-orchestrator) are **resolved** by
this round's rulings and are not repeated. Remaining:

1. **Is the corrected 4-valued exposure scale (0 = auth, 1 = reserved, 2 = loopback-only, 3 =
   none) the right final shape**, or should "1" be actively populated with a defined-but-unbuilt
   intermediate primitive rather than left reserved?
2. **S9S-4's body-text status-code assertion check is a static/AST strengthening, not a live
   transport probe.** This document deliberately declined to have the verifier itself fire
   live rate-limit-triggering HTTP requests against not-yet-built code, given the safety risk of
   accidentally spawning real agent/shell processes during verification. Is the body-text check
   sufficient, or does the reviewer want a bounded, safety-gated live-transport probe added in a
   further round (e.g., only against routes proven by S9S-5 case 6 to reject before spawning)?
3. **C9S-8's `blocked-on-founder` resolution**: is the two-variant framing (real scoping vs.
   accepted single-user namespace) complete, or does the reviewer want a third option considered
   (e.g., a middle-ground "warn but allow" behavior)?

## Definition of green

`~/.claude/goal-state/mishmash-w9-agent-spawn-tranche/proof/manifest.json` shows every `C9S-1`
through `C9S-7` at `status: "pass"`, `C9S-8` at `status: "pass"` or `status: "blocked-on-founder"`
(never `"fail"` on its own unless a mechanical sub-check inside it errors), `LEASE`/`HEAD-DRIFT`
at `"pass"`, `treeDirty: false`, `wroteOk: true`, `archiveOk: true`, `commit` bound to the
implementation branch's `HEAD`.

---

## AUTHOR-FLAGGED / DISPOSITIONS (round 1 → round 2)

Every round-1 finding disposed here; this section is the authoritative change record for round 2.

1. **Blocker 1 (incomplete scope)** — FIXED. Scope widened from 8 to 17 routes across 4 files;
   host-tools carved into its own named tranche; critique-orchestrator disclosure corrected.
2. **Blocker 2 (false dependency ground fact)** — FIXED. Ground facts rewritten with the precise,
   per-file, per-primitive wiring truth; `server.ts` added to the lease for exactly two lines with
   a temporal-serialization note.
3. **Blocker 3 (C9S-1 false greens)** — FIXED. Computed-path hard-fail, allowlist-based live drift
   check, bare-identifier + anti-shadowing classifier, 14 self-probes (up from 8), detached-HEAD-
   worktree sourcing for every HEAD-dependent read.
4. **Blocker 4 (matrix semantics)** — FIXED. Integer-bounded impact, true XOR control/acceptedRisk,
   primary `testRef` fully validated and globally unique, exact `W9AS-ACCEPT-` prefix check,
   matrix-derived (not static) P0 set.
5. **Blocker 5 (C9S-4/5 decoys)** — FIXED. Grammar/prose aligned (drops `pair-attempt`), over-limit
   matcher bug fixed (now binds `limit` too), body-text status-code assertions added, corpus
   coverage AST-scoped (comment-immune), extended skip/pending scan, full detached-worktree replay
   ported and required now, corpus grown from 5 to 8 cases.
6. **Blocker 6 (C9S-6 loose)** — FIXED. Bounded-section/fence-aware/exact-citation machinery ported
   verbatim from `verify-w9-ingest.ts`.
7. **Blocker 7 (C9S-7 spoofable/unsatisfiable)** — FIXED. Relocated out-of-repo to the W7 pattern;
   removed from the implementer's lease entirely.
8. **Blocker 8 (floor wrong)** — FIXED. `GET /api/runs/:id` floor 0 → 1, grounded in
   `runtimes/runs.ts:292-328`'s actual `statusBody` fields.

**Confirmed-good items preserved, not regressed:** one-commit/two-file discipline maintained;
port-0 + fresh-mkdtemp + exact-child-PID boot isolation maintained and now also used for the
detached-worktree daemon boot; `GATE-INTEGRITY` unpinned-informational/pinned-enforcement
distinction unchanged; `LEASE` still reads `baseCommit`, never `HEAD`; fail-closed archival/exit
logic unchanged; no template-escape defects reintroduced; `scripts/tsconfig.json` typecheck clean
(re-verified after this round's rewrite — see fix-round report).
