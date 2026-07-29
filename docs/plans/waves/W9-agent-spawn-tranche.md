# Wave 9 — Agent-spawn tranche (route hardening, highest-risk tranche)

**Slug:** `mishmash-w9-agent-spawn-tranche`
**Gates on:** W0 (landed)
**Runs within:** the rolling `mishmash-w9-route-hardening` wave (`W5-W11-gated.md`, Wave 9
section) — first by the wave's own risk order: "agent spawn → filesystem read/write → deploy
(BYOK tokens) → external fetch (SSRF) → Library ingest → imports → long tail."
**Blocks:** nothing by name today. Unlike `mishmash-w9-ingest-tranche` (pulled out of the rolling
order because W3 cannot safely expose `/library` before it lands), no other wave PRD in this tree
declares a hard gate on agent-spawn hardening. Its priority is risk-ordering, not a downstream
dependency — stated plainly rather than invented, per this document's own evidence standard.
**Loop:** `loop:tranche` (`VERIFICATION-CONTRACT.md` §6)
**Verifier:** `scripts/waves/verify-w9-agent-spawn.ts`
**Write lease:** not yet applied to `docs/plans/waves/leases.json` (that file is out of this
author's authority — see "PROPOSED write lease" below for the exact row to add).

**Status: DRAFT — awaiting first adversarial review under the NM-41C gate
(`W5-W11-gated.md` lines 8–24).** This document and its verifier are frozen together before any
implementation begins; a reviewer who did not write either must return `APPROVE` before a `/goal`
run may start against them. No implementation work has occurred. Unlike
`W9-ingest-tranche.md`, this document carries no round history — it is genuinely round 0.

---

## Why this tranche exists

`W5-W11-gated.md`'s Wave 9 section records Sol's finding: the real daemon HTTP surface is 340
method registrations (334 excluding `OPTIONS`) across 35 route files plus 6 bootstrap routes in
`server.ts`, ordered by threat boundary, agent spawn ranked highest-risk. That ranking is easy to
justify directly from the code, not merely asserted: every other tranche's routes read, list, or
mutate *data*; the agent-spawn surface's `POST /api/runs` and `POST /api/chat` **launch a real OS
child process** — one of the daemon's own registered coding-agent CLIs — with a caller-chosen
prompt, model, working directory, and tool bundle, inheriting an environment the daemon itself
constructs (`spawnEnvForAgent`, `applyAgentLaunchEnv`). A coding agent that can read/write files,
shell out (via its own tool-use loop), and call configured connectors on the operator's behalf is
a strictly larger blast radius than anything the ingest tranche's 128 MB upload cap or the
filesystem tranche's read/write routes expose on their own — this is the primitive the *other*
tranches' worst-case outcomes (arbitrary file write, SSRF, token theft) would most easily be
*achieved through*, if reachable without authorization.

`mishmash-w9-ingest-tranche` already exists and landed its own expansion+verifier pair, surviving
six adversarial review rounds. It is the house precedent this document matches for structure and
rigor: mechanically-checkable criteria, fail-closed evidence chains, an out-of-band attribution
file, spoof-resistant markers, isolated runtime namespaces for any daemon boot a verifier performs.

## Ground facts (verified directly in this tree, at `HEAD` on `feat/w9-agent-spawn-tranche`,
`4fe0f677b`)

- **The route count is 8, not "the runs route."** `registerRunRoutes` in
  `apps/daemon/src/routes/runs.ts` (imported at `server.ts:619`, invoked at `server.ts:8330`)
  registers exactly 8 handlers: `POST /api/runs`, `GET /api/runs`, `GET /api/runs/:id`,
  `GET /api/runs/:id/events`, `GET /api/runs/:id/agui`, `GET /api/runs/:id/result-package`,
  `POST /api/runs/:id/cancel`, `POST /api/chat`. Verified two ways: a scoped AST scan of
  `registerRunRoutes`'s own function body, and a real isolated daemon boot's own `routeInventory`
  (`getRouteRegistrationInventory(app)`, `server.ts:8872`, returned when `startServer` is called
  with `returnServer: true`).
- **None of the 8 routes carry any route-level authorization code.** Grepped directly:
  `requireLocalDaemonRequest`, `authorizeToolRequest`, `isLocalSameOrigin`, and `bearerToken` do
  not appear anywhere in `apps/daemon/src/routes/runs.ts`. Every one of the 8 routes relies
  entirely on `server.ts`'s global `/api` origin middleware (`server.ts:2209–2287`) — the same
  gate the ingest tranche found lets 11 of `library.ts`'s 23 routes through: **any request
  presenting no `Origin` header passes**, which is every non-browser local caller (curl, another
  process on the machine, an MCP client, a CLI script) plus any already-`isAllowedBrowserOrigin`
  browser tab. Under this program's own S9-2-style grammar (reused here, see Scope), that is
  **exposure 3** for all 8 routes today.
- **The daemon's own bind-host guard is a real, existing mitigating control, stated accurately
  rather than ignored.** `startServer` (`server.ts:2037`) refuses to bind to a non-loopback host
  unless `OD_API_TOKEN` is set (`server.ts:2059–2068`). In the default local deployment the
  daemon is loopback-bound, so "any non-browser caller" means "any local process on the machine,"
  not "the open internet." This narrows but does not eliminate the finding: a local dev machine
  routinely runs other processes (build tools, other agents, malware, a compromised VS Code
  extension) that can freely spawn a coding agent with a crafted prompt if this is left unfixed.
- **`agentId` is constrained to a registry, not an arbitrary path.** `getAgentDef(id): RuntimeAgentDef
  | null` (`apps/daemon/src/runtimes/registry.ts:78`) returns `null` for an unrecognized id, and
  `routes/runs.ts`'s fallback-selection logic only ever assigns an id `detectAgents` already
  reports as `available`. An attacker cannot spawn an arbitrary host binary through `agentId` —
  they can pick among the daemon's own registered coding-agent CLI definitions in
  `apps/daemon/src/runtimes/defs/` (claude, codex, gemini, deepseek, qwen, aider, opencode,
  antigravity, copilot, grok-build, pi, codebuddy, amr, and others). That is still a large,
  security-relevant choice: a caller picks the agent, the prompt, the model, and (via
  `toolBundle`/`mediaExecution`) some of what it's allowed to do once running.
- **The actual `spawn()` calls are one hop away, in `server.ts`, not in `routes/runs.ts`
  itself.** `POST /api/runs`'s handler (`routes/runs.ts:538`) never calls `spawn` directly; it
  calls `design.runs.start(run, () => startChatRun(meta, run))` (`routes/runs.ts:792`), passing
  the **entire parsed request body** (`meta = { ...requestBody, mediaExecution, toolBundle }`)
  through. `startChatRun` is a closure defined inside `startServer` (`server.ts:4256`) and injected
  into `registerRunRoutes` as `ctx.chat.startChatRun` (`server.ts:8330–8348`). It resolves the
  agent binary (`resolveAgentLaunch`, `apps/daemon/src/runtimes/launch.ts`), builds the child's
  env (`spawnEnvForAgent`, `applyAgentLaunchEnv`), resolves `cwd`, and calls
  `child = spawn(invocation.command, invocation.args, { env, cwd: effectiveCwd, stdio: [stdinMode,
  'pipe', 'pipe'], shell: false, detached: process.platform !== 'win32', ... })` at
  `server.ts:6474`. **`server.ts` is W1's owned file for its Burst** (`VERIFICATION-CONTRACT.md`
  §4 lease table) — this tranche's fix surface must not require editing it (see Implementation
  surface).
- **The hardening primitive the fix needs is already an injected dependency, unused.**
  `registerRunRoutes(app, ctx)` receives the full `HttpDeps` object as `ctx.http`
  (`server-context.ts`), which includes `requireLocalDaemonRequest` and `isLocalSameOrigin` — the
  exact functions 6 of `library.ts`'s routes already use for loopback gating. `routes/runs.ts`
  today destructures only `{ createSseResponse, sendApiError } = ctx.http` (`routes/runs.ts:499`),
  leaving the other two unused. No `server.ts` wiring change is needed to reach them.
- **There is no request-rate or body-size control specific to this surface.** The only
  route-specific `express.json` overrides in `server.ts` are `/api/library/ingest` (128 MB) and
  `/api/brands/:id/extract-from-html` (32 MB); every other route, including `/api/runs` and
  `/api/chat`, gets the global `express.json({ limit: '4mb' })` (`server.ts:2089`) and nothing
  else. `express-rate-limit@8.4.1` is present in `pnpm-lock.yaml` only as a transitive dependency
  of `@modelcontextprotocol/sdk`, never imported by `apps/daemon/src`, `apps/web/src`, or
  `scripts/` (grep-confirmed, same fact the ingest tranche recorded for its own surface). A caller
  that clears the origin middleware can fire unlimited concurrent `POST /api/runs` requests, each
  a real OS process with real CPU/memory/model-spend cost.
- **No route checks run ownership on `:id`.** `GET /api/runs/:id`, `GET /api/runs/:id/events`,
  `GET /api/runs/:id/agui`, `GET /api/runs/:id/result-package`, and `POST /api/runs/:id/cancel`
  all resolve the run by `design.runs.get(runId)` and 404 only if it doesn't exist — there is no
  concept of "this run belongs to caller X" anywhere in `routes/runs.ts`. `GET /api/runs` lists
  every run system-wide, filterable only by `projectId`/`conversationId`/`status`, never by
  caller identity. This may be intentional for a single-user local daemon (no multi-tenancy
  concept exists in this product today) — but that must be an explicit, reviewed statement, not a
  silent assumption, because `GET /api/runs/:id/events` streams the live agent's stdout/stderr/
  tool-result content, which can carry file contents or other output a second local caller should
  not automatically see.
- **`cwd` is sandbox-bounded for managed projects, with a sanctioned escape hatch for imported
  folders.** `resolveProjectDir` + `assertSandboxProjectRootAvailable` /
  `SandboxImportedProjectError` (`apps/daemon/src/projects.ts`) reject a run against an
  unavailable sandboxed root. Imported-folder projects are the product's own documented exception
  (`AGENTS.md` → "Daemon data directory contract": "Imported-folder projects are the explicit
  exception: they use `metadata.baseDir` for the user-selected external workspace") — a caller
  cannot inject an arbitrary `cwd` in one HTTP call, but *can* trigger a spawn into whatever
  directory an already-existing project record points at, managed or imported.
- **No dedicated security/hardening test coverage exists for this surface today**, unlike the
  ingest tranche, which could cite already-landed SSRF and token-binding regression specs. Glob of
  `apps/daemon/tests/` for `run-*.test.ts` / `chat-*.test.ts` finds only functional/behavioral
  coverage (retry policy, analytics, resume-on-failure, artifact diffing) — none of it asserts
  authorization, rate limiting, or cross-caller isolation. This tranche's S9S-5/C9S-5 requirement
  cannot use the ingest tranche's "may cite directly" allowance for *any* row; every attributed
  `exposure===3` row needs genuinely new coverage or a genuinely new accepted-risk record.

## Scope

**S9S-1 — Freeze the route snapshot at `baseCommit`, with drift detection.** The frozen set is
derived by parsing `git show <baseCommit>:apps/daemon/src/routes/runs.ts` through a real
TypeScript AST scan scoped to `registerRunRoutes`'s own function body (`ts.forEachChild`, never a
whole-file text scan — a matching identifier inside a comment must not leak in). Checked for
self-consistency against `FROZEN_IMPACT_FLOORS`' key set (S9S-2 — the one literal table this
expansion freezes, and the canonical frozen-route list) and then checked for drift against a
**live daemon boot's** own `routeInventory`, filtered to `/api/runs` and `/api/chat`. Any
duplicate `{method,path}` registration at `baseCommit`, at `HEAD`, or in the live inventory is a
hard fail, never a silent last-write-wins pick.

**S9S-2 — State the risk-ranking rule and the frozen impact-floor table.**
`score = exposure(0/1/3) + impact(0–3)`.

Exposure uses a **3-valued** scale, deliberately narrower than the ingest tranche's 4-valued one:
this codebase has exactly two existing hardening primitives that plausibly apply to inbound
run-creation auth (`requireLocalDaemonRequest`, `authorizeToolRequest`); there is no existing
self-service-bearer shape for this surface to bind an intermediate "2" value to. Inventing one
without a real primitive to check against would be decoration, not a mechanical check. A reviewer
may add an intermediate value in a later round if an implementer introduces a genuinely new
self-service-bearer shape — flagged as an open question below, not pre-decided here.

- `0` — `requireLocalDaemonRequest` is a literal identifier among the route's own middleware
  arguments (a real Express middleware, always invoked before the handler — no reachability
  ambiguity).
- `1` — the handler's own final callback is block-bodied, and its `body.statements` begin (after
  at most one direct CORS-prelude statement, if this codebase's extension-CORS helper is ever
  applied to this surface) with the exact sequence `const grant = authorizeToolRequest(...)`
  immediately followed by a top-level `if (!grant)` whose consequent unconditionally returns or
  throws. Positive detection inspects only these direct siblings — never a call inside an
  `if`/loop/`switch`/`try`/nested block/callback/nested function/class, and never a call whose
  result is discarded.
- `3` — none of the above (including: the guard sequence exists but is inside a branch/loop/
  callback, its result is ignored, it runs after a response operation, or it sits inside a
  statically-dead branch such as `if (false) {...}`).

**Eight verifier self-probe fixtures** (run through the exact `collectRunRouteRegistrations`/
`classifyExposure` pipeline the real criterion uses, never a separate mock) prove the grammar: the
real `requireLocalDaemonRequest`-as-middleware shape (expect `0`); the real
`authorizeToolRequest` direct-guard shape (expect `1`); a guard wrapped in `if (false) {...}`
(expect `3`); a guard whose result is never checked (expect `3`); a guard placed after a response
write (expect `3`); no guard at all — today's real shape (expect `3`); `requireLocalDaemonRequest`
mentioned only in a comment, never as a middleware arg (expect `3`, proving the classifier isn't
fooled by a textual mention); an `authorizeToolRequest` call present but nested inside an `if`
branch, not a direct top-level sibling (expect `3`). A failed self-probe fails C9S-1 outright.

**Impact — a FROZEN, reviewer-owned floor per route**, using the same four-value scale the ingest
tranche defined (0 = metadata only; 1 = returns previously-stored/derived content; 2 = mutates a
row or triggers a real action under caller direction; 3 = accepts caller-supplied input into a
new privileged action) **extended with one clause specific to this tranche: spawning a new OS
child process under caller-supplied parameters is impact 3**, on the same footing as "accepts
caller-supplied bytes into daemon-owned storage" — arguably worse, since the spawned process can
itself read, write, and call out on the operator's behalf.

**The full frozen table:**

| Route | Exposure (today) | Impact floor | Score | Tier |
|---|---|---|---|---|
| `POST /api/runs` | 3 | 3 (spawns a new OS child process running a caller-selected registered agent CLI, with caller-supplied prompt/model/tool-bundle, inheriting daemon-constructed env) | 6 | **P0** |
| `POST /api/chat` | 3 | 3 (same spawn path, via `startChatRun`) | 6 | **P0** |
| `POST /api/runs/:id/cancel` | 3 | 2 (terminates another caller's in-flight child process by id; no ownership check) | 5 | **P0** |
| `GET /api/runs/:id/events` | 3 | 1 (streams the live run's stdout/stderr/tool-result content back to the caller; no ownership check) | 4 | P1 |
| `GET /api/runs/:id/agui` | 3 | 1 (same content, AGUI-mapped envelope; no ownership check) | 4 | P1 |
| `GET /api/runs/:id/result-package` | 3 | 1 (returns workspace file listing + artifact manifests for the run's project; no ownership check) | 4 | P1 |
| `GET /api/runs` | 3 | 1 (lists status/metadata for every run system-wide; no per-caller scoping) | 4 | P1 |
| `GET /api/runs/:id` | 3 | 0 (status/timestamps/ids only, best-effort read of `design.runs.statusBody`'s current field set — **the implementer must verify this directly and raise the floor to 1 if `statusBody` carries prompt or transcript text**; this floor is a documented assumption, not a confirmed absence) | 3 | P2 |

Tiers: `score 5–6 = P0`, `score 4 = P1`, `score 0–3 = P2`, mechanically enforced (`tier ===
tierFor(exposure+impact)` exactly, checked as part of C9S-2). **Guaranteed P0 today: `POST
/api/runs`, `POST /api/chat`, `POST /api/runs/:id/cancel`** — three P0 rows, the same count the
ingest tranche froze for its own surface. As with that tranche, this set narrows automatically as
real hardening lowers a row's live-derived exposure; the floors only ever set a minimum.

**S9S-3 — Mechanically-generated attribution matrix.** A companion machine-readable file,
`docs/security/agent-spawn-attribution.json`, one row per frozen route (exactly 8, no orphans, no
gaps, no duplicates), each row carrying the same six required fields
`VERIFICATION-CONTRACT.md` §6 and the ingest tranche's own schema use: `owner`, `authn`, `authz`,
`inputValidation`, `sizeRateLimit`, `testRef`. None of the six may be a bare placeholder (a floor
of 12 characters, a denylist of stock filler, a repeated-character check). `authn` must contain
the keyword naming its own row's mechanically-derived exposure class
(`requireLocalDaemonRequest`/"loopback" for exposure 0, `authorizeToolRequest`/"tool token" for 1,
`none`/"no gate"/"zero-config" for 3). Every row carries `riskScore` (`{exposure, impact, score,
tier}`, formula-enforced) and, **for every route whose mechanically-derived `exposure === 3`**,
exactly one of:

- `control: { mechanism: string, testRef: string }` — a real, currently-passing test, bound by
  exact `fullName` equality, related to its own row by a path-derived association term computed
  mechanically from the route's own path segments (`runs`, `chat`, `cancel`, `events`, `agui`,
  `result-package`). Global citation uniqueness: one map from exact test `fullName` to route key
  spans every row's primary `testRef` **and** every row's `control.testRef` together. The same
  file as the cited test must also contain a genuine paired positive+negative control: two
  distinct passing assertions, one reading as an accepted-path signal, a different one reading as
  a rejected-path signal — an omnibus assertion satisfying both regexes at once does not count as
  the pair.

  Whether a cited test counts as "new" (needing red evidence) is decided by a real TypeScript-AST
  parse of the file at `baseCommit`, matching only the static first argument of a syntactic
  `it`/`test` declaration (including `it.each(...)(...)`'s outer title call), compared against the
  test runner's own reported leaf title — never a substring scan. A genuinely new test's
  `control`/`testRef` requires the same red-evidence discipline `W9-ingest-tranche.md` established
  (structured transcript artifact, descriptive only; real proof from the verifier's own replay of
  the test at its introduction commit's first parent, gated on a per-invocation CSPRNG marker,
  fails closed on ambiguity). This tranche's verifier implements the introduction-commit lookup
  and title-parsing check; whether it implements the full replay machinery on day one, or defers
  it to a reviewed follow-up amendment once a genuinely new test exists to replay, is an open
  question for the adversarial reviewer (see "Open design questions").
- `acceptedRisk: { decisionRef: string }` — must exactly equal a unique `### W9AS-ACCEPT-<slug>`
  heading in `docs/plans/waves/DECISIONS.md` **as read at `baseCommit`**, whose block carries
  `Route`, `Accepted risk`, `Accepter`, `Date`, `Rationale`. **`W9AS-` is a distinct prefix from
  the ingest tranche's `W9-ACCEPT-`**, chosen specifically to avoid heading collisions in a file
  both tranches may write to across different time windows. The entry's `Route:` field must
  exactly equal the row's own `{method} {path}`, and its `Accepter` must not equal any commit
  author's name/email across `baseCommit..HEAD`.

A row with all six fields populated but no `control`/`acceptedRisk` on an `exposure===3` row does
not count as attributed. The verifier reports three explicit counts every run: **attributed**,
**unattributed** (a true, uncontrolled gap), and **known-vulnerable** (a verified accepted risk on
file). C9S-3 passes only when `unattributed === 0`.

**S9S-4 — Resolve the size/rate-limit gap explicitly, for every P0 row.** Applies to the three
guaranteed-P0 rows (`POST /api/runs`, `POST /api/chat`, `POST /api/runs/:id/cancel`). Each row's
`sizeRateLimit` must resolve via the exact same anchored declaration grammar the ingest tranche
defined (chosen deliberately identical — no reason to invent a second grammar for the same
program):

```
ENFORCED kind=<request-rate|byte-volume|pair-attempt> scope=<token-hash|origin|pairing-attempt>
  limit=<positive-integer> windowMs=<positive-integer|none> overflow=<reject-429|reject-413>
```

The declaration is descriptive evidence only; it closes C9S-4 only when the row's `control.testRef`
passes the full C9S-3 bar **and** the same file's real-transport coverage shows two distinct
passing assertions — one under-limit-accepted, one over-limit-rejected — bound to the same route,
the same parsed `limit` value as an exact numeric token, and (for the over-limit side) the same
declared overflow HTTP status as an exact numeric token. An in-process control entirely inside
`routes/runs.ts` (a bounded per-caller-identity or per-origin in-memory counter) is achievable
inside this tranche's proposed lease; a `server.ts`-level control is not, because `server.ts` is
W1's owned file for its Burst (`VERIFICATION-CONTRACT.md` §4) — mirroring the ingest tranche's own
ruling 1 for the identical reason (avoid a cross-wave file-ownership conflict, not a technical
limitation).

**S9S-5 — Dedicated endpoint tests, red-team corpus.** Every attributed row's `testRef` must name
a real, currently-passing, route-associated, unique-per-row test in a **new** file matching
`apps/daemon/tests/agent-spawn-*.test.ts` (a fresh glob prefix — confirmed unused in this tree
today — deliberately distinct from the pre-existing `run-*.test.ts`/`chat-*.test.ts` functional
suites, so the tranche's own new security coverage cannot be diluted by unrelated pre-existing
files matching a looser glob). Because no dedicated coverage pre-exists for this surface (unlike
ingest's SSRF/token-binding tests), S9S-5's "may cite existing coverage directly" allowance does
not apply to any row here — every `exposure===3` row needs genuinely new evidence.

The test file must implement, at minimum, the following **red-team corpus** — each case is a
request against a real booted daemon (no mocked transport, per `VERIFICATION-CONTRACT.md` §3 R2),
paired with a same-file control that should succeed and does (§3 R4):

1. **Unknown `agentId` is rejected without spawning a process.** `POST /api/runs` with
   `agentId: 'not-a-real-agent-xyz'` → expect a 4xx and zero child processes started. Paired
   control: the same request with a real, available `agentId` succeeds (whatever "succeeds" means
   post-hardening — a 2xx acceptance, not necessarily a completed run).
2. **Oversized body is rejected.** `POST /api/runs` with a `message` field pushing the request
   past the global 4 MB `express.json` limit → expect 413. Paired control: a request just under
   the limit is accepted.
3. **Run-creation rate limiting is enforced.** `N+1` rapid `POST /api/runs` requests from one
   caller identity → the `(N+1)`th is rejected 429 once C9S-4's control lands. Paired control:
   exactly `N` requests all succeed. (Pre-implementation, this case is expected to fail — there is
   no rate limiter yet; that is the correct, fail-closed state for this document's first draft.)
4. **Cross-caller run-id read/cancel behavior is asserted, not assumed.** A second, unrelated
   caller identity attempts `GET /api/runs/:id` and `POST /api/runs/:id/cancel` against a run the
   first caller created. The test asserts whatever the implementer's chosen resolution is —
   either the request is rejected post-hardening, or the current no-ownership-check behavior is
   kept and recorded as an explicit `acceptedRisk` in `DECISIONS.md` — but it must assert one of
   the two, not silently pass either way. Paired control: the *owning* caller's own subsequent
   read/cancel succeeds.
5. **Sandbox-escape attempt on the run's `cwd` is rejected.** `POST /api/runs` against a
   crafted `projectId`/metadata aimed at the sandbox boundary `assertSandboxProjectRootAvailable`
   already enforces → expect rejection via that existing control, with a test that actually
   exercises the run-creation path (not merely a pre-existing `projects.ts`-level unit test cited
   by a different route). Paired control: a real managed project succeeds.

**S9S-6 — Adversarial verification of the implementation, not just this expansion.**
`W5-W11-gated.md`:157 requires "adversarial verification per tranche," and
`VERIFICATION-CONTRACT.md` G-14 requires commit-bound review records with reviewer ≠ author.
C9S-7 requires `docs/security/agent-spawn-implementation-review.json` — `{reviewer, model,
reviewedCommit, verdict}`, `reviewedCommit` a real, strict ancestor of `HEAD` whose owned-path
diff to `HEAD` is empty, `reviewer` distinct from every `baseCommit..reviewedCommit` commit
author, `verdict === 'APPROVE'`. Same non-`commit-equals-HEAD` design rationale as the ingest
tranche (a commit cannot contain its own SHA at authoring time).

## Threat model (per route)

| Route | What an attacker with local reach gains today | Current mitigation |
|---|---|---|
| `POST /api/runs` | Spawns a real OS child process running any registered, available coding-agent CLI, with an attacker-chosen prompt, model, tool bundle, and (indirectly, via an existing project record) working directory. The spawned process inherits daemon-constructed env, including whatever BYOK/MCP/connector credentials that env layer injects for the chosen agent. No rate or size limit beyond the generic 4 MB body cap. | Global `/api` origin middleware only (blocks browser-origin cross-site requests; does not gate non-browser local callers). Loopback-only bind by default (`OD_API_TOKEN` required to bind publicly). `agentId` constrained to the registry (`getAgentDef`). `cwd` sandbox-bounded for managed projects via `assertSandboxProjectRootAvailable`. |
| `POST /api/chat` | Same spawn path as `POST /api/runs`, reached through the chat-turn shape instead of the run-creation shape. | Same as above. |
| `POST /api/runs/:id/cancel` | Terminates any run system-wide by id, including one another caller started — a targeted denial-of-service against another local process's in-flight agent work, with no ownership check. | Global origin middleware only; run must exist (404 otherwise) — no capability check beyond existence. |
| `GET /api/runs/:id/events` | Attaches to the live SSE stream of any run's stdout/stderr/tool-result content by id, including runs other callers started — a live side-channel onto another process's agent transcript, which may contain file contents or other sensitive output. | Global origin middleware only; run must exist. |
| `GET /api/runs/:id/agui` | Same exposure as `/events`, AGUI-mapped envelope. | Same as above. |
| `GET /api/runs/:id/result-package` | Reads the workspace file listing and artifact manifests for any run's project by id — reveals project structure and artifact metadata to a caller uninvolved in that run. | Global origin middleware only; run and project must exist. |
| `GET /api/runs` | Enumerates status/metadata for every run system-wide (id, agentId, projectId, conversationId, timestamps, status) with no per-caller scoping, filterable only by project/conversation/status. | Global origin middleware only. |
| `GET /api/runs/:id` | Reads a single run's status/metadata by id, same no-ownership-check shape as the list route, narrower blast radius (best-effort floor 0 — see the S9S-2 table's explicit caveat). | Global origin middleware only; run must exist. |

## Success criteria

- **C9S-1** — Route snapshot frozen at `baseCommit` (`registerRunRoutes`'s 8 routes), self-probe-
  gated exposure classifier, drift-checked against a live isolated daemon boot's own
  `routeInventory` filtered to `/api/runs` + `/api/chat`. Zero duplicate registrations at
  `baseCommit`, at `HEAD`, or live. A failed self-probe fails this criterion outright regardless
  of the rest of the check.
- **C9S-2** — Attribution matrix rows' declared `riskScore` exactly matches the frozen
  impact-floor table combined with the classifier's own **live** re-derivation of each route's
  exposure from `HEAD` (`tier === tierFor(exposure+impact)` exactly; `impact >= floor`, never
  below).
- **C9S-3** — `docs/security/agent-spawn-attribution.json` exists, has exactly 8 rows (no
  orphans/gaps/duplicates), all six required fields non-placeholder on every row, `authn` names
  its row's own exposure-class keyword, and every `exposure===3` row is attributed (`control` or
  verified `acceptedRisk`, never merely present-but-empty). Reports attributed/unattributed/
  known-vulnerable counts; passes only at `unattributed === 0`.
- **C9S-4** — Every P0-tier row's `sizeRateLimit` resolves via the anchored `ENFORCED` grammar,
  backed by a real, currently-passing control test showing both an under-limit-accepted and
  over-limit-rejected assertion in the same file, bound to the row's own route/limit/overflow by
  exact numeric token (never a substring match).
- **C9S-5** — The dedicated `apps/daemon/tests/agent-spawn-*.test.ts` file set exists, boots a
  real daemon for every case (no mocked transport), passes in full, contains zero `skip`/`only`/
  `todo` markers, and implements all five named red-team corpus cases with their paired
  accept/reject assertions.
- **C9S-6** — `docs/security/daemon-threat-model.md` is extended with a `[C9S-N]`-tagged
  "Wave 9 — agent spawn" section, in the same style as its existing `[C0-N]`/`[C9-N]` bullets.
  Each of the three P0 routes has exactly one bullet naming exactly that route and citing exactly
  that row's required reference (`control.testRef` for a controlled row, primary `testRef` for an
  accepted-risk row), quoting a real test `fullName`.
- **C9S-7** — `docs/security/agent-spawn-implementation-review.json` exists:
  `{reviewer, model, reviewedCommit, verdict}`; `reviewedCommit` resolves, is a strict ancestor of
  `HEAD`, and its owned-path diff to `HEAD` is empty; `reviewer` is distinct from every commit
  author between `baseCommit` and `reviewedCommit`; `verdict === 'APPROVE'`.
- **LEASE** (infra, unnumbered) — `git diff --name-only baseCommit...HEAD` is a subset of
  `leases.json`'s `waves["W9-agent-spawn"].allow` glob set, read at `baseCommit` (never `HEAD`,
  so the wave cannot widen its own lease mid-branch).
- **HEAD-DRIFT** (infra) — `HEAD` does not move during the verifier's own run.
- **GATE-INTEGRITY** (infra, informational until an orchestrator pins an approval hash) —
  defense-in-depth self-hash of the verifier script; reports `true` (pass) while unpinned,
  becomes a real tamper check once `~/.claude/goal-state/mishmash-w9-agent-spawn-tranche/
  approved-gate.sha256` exists.

## Implementation surface (files a future implementation agent will touch)

- `apps/daemon/src/routes/runs.ts` — add `requireLocalDaemonRequest`/`authorizeToolRequest` (both
  already available via the injected `ctx.http`, currently unused) to the appropriate routes per
  the attribution matrix's chosen resolution for each row; add an in-process rate/size control for
  the three P0 rows.
- `apps/daemon/tests/agent-spawn-*.test.ts` (new files) — the red-team corpus and any additional
  route-associated coverage the attribution matrix cites.
- `docs/security/agent-spawn-attribution.json` (new file) — S9S-3.
- `docs/security/daemon-threat-model.md` (extend, do not restructure existing `[C0-N]`/`[C9-N]`
  content) — S9S-6/C9S-6.
- `docs/security/agent-spawn-implementation-review.json` (new file) — S9S-6/C9S-7.
- `docs/security/agent-spawn-red/<slug>.txt` (new files, only if a genuinely new cited test needs
  the red-evidence transcript convention) — mirrors the ingest tranche's artifact shape.
- `docs/plans/waves/DECISIONS.md` (extend only, `### W9AS-ACCEPT-<slug>` blocks) — only if any
  `exposure===3` row resolves via `acceptedRisk` rather than a `control`.
- `scripts/waves/verify-w9-agent-spawn.ts` (this tranche's own verifier — may be amended by the
  implementer only to add machinery a genuinely new cited test requires, e.g. the red-evidence
  replay path if S9S-3's "open question" below is ruled toward full day-one replay).

**Deliberately excluded: `apps/daemon/src/server.ts`.** The fix is achievable entirely inside
`routes/runs.ts` because the needed primitives are already injected via `ctx.http`; `server.ts` is
W1's owned file for its Burst (`VERIFICATION-CONTRACT.md` §4). If implementation proves a
`server.ts` change genuinely necessary, that is a lease amendment on `main` requiring W1
coordination, not a default assumption.

## PROPOSED write lease (text only — `docs/plans/waves/leases.json` is not edited by this
document; an orchestrator applies this row when the expansion is approved)

```jsonc
"W9-agent-spawn": {
  "slug": "mishmash-w9-agent-spawn-tranche",
  "allow": [
    "apps/daemon/src/routes/runs.ts",
    "apps/daemon/tests/agent-spawn-*.test.ts",
    "docs/security/**",
    "scripts/waves/verify-w9-agent-spawn.ts",
    "docs/plans/waves/DECISIONS.md"
  ],
  "note": "First tranche by threat-boundary risk order (W5-W11-gated.md Wave 9 section). Runs
    independently of mishmash-w9-ingest-tranche — disjoint file sets (routes/runs.ts vs
    routes/library.ts), no shared write target. `docs/security/**` and
    `docs/plans/waves/DECISIONS.md` are also claimed by W9-ingest; both tranches only ever add
    new files/sections there (agent-spawn-*.json vs library-ingest-*.json,
    W9AS-ACCEPT-* vs W9-ACCEPT-* headings) — never edit each other's — but true concurrent
    execution should still serialize through the integrating writer per
    VERIFICATION-CONTRACT.md §5 to avoid a DECISIONS.md merge race. Deliberately excludes
    apps/daemon/src/server.ts (W1-owned for its Burst) and apps/daemon/src/routes/chat.ts (owns
    unrelated BYOK-proxy routes, W2/deploy-tranche territory) even though POST /api/chat is in
    scope — that route is registered from routes/runs.ts, not chat.ts, so no chat.ts edit is
    needed."
}
```

## Out of scope

**The other five named tranches**, per `W5-W11-gated.md`'s own ordering — none of their routes
are touched here:

1. **Filesystem read/write** — the daemon's direct file-read/write routes (project file
   read/write/upload endpoints under `apps/daemon/src/routes/project/**` and related), distinct
   from the spawn surface even though a *spawned agent* can itself read/write files through its
   own tool-use loop once running. That downstream capability is a consequence of this tranche's
   findings, not a route this tranche hardens.
2. **Deploy (BYOK tokens)** — `apps/daemon/src/routes/deploy.ts` and the BYOK proxy/stream routes
   registered in `apps/daemon/src/routes/chat.ts` (`/api/proxy/{anthropic,openai,azure,google,
   ollama,:provider}/stream`, `/api/provider/models`, `/api/test/connection`). These live in a
   *different* route file from the one this tranche leases, confirmed directly — no overlap.
3. **External fetch (SSRF)** — outbound-fetch-initiating routes (brand/reference capture, etc.).
4. **Library ingest** — already its own landed, separately-verified tranche
   (`W9-ingest-tranche.md`, `verify-w9-ingest.ts`), `apps/daemon/src/routes/library.ts`. Disjoint
   file set from this tranche.
5. **Imports** — `apps/daemon/src/routes/import-export-routes.ts` and related import-flow routes.

**"Long tail"** — the wave doc's own catch-all for every route not claimed by one of the six named
tranches; not itself a tranche with a slug.

**Adjacent surfaces this tranche does NOT cover, named explicitly rather than silently
dropped** (per this program's own rule against emitting "we hardened everything" — `W5-W11-
gated.md`:146):

- **`apps/daemon/src/routes/host-tools.ts`** (`registerHostToolsRoutes`) — `GET /api/editors`,
  `POST /api/projects/:id/open-in`. This *also* calls `spawn()` directly
  (`host-tools.ts:247`, launching a local editor/IDE/file-manager app pointed at a project
  directory) and has **zero route-level authorization code**, same shape as this tranche's
  findings — but it spawns a GUI host application, not an AI agent, and doesn't fit "agent spawn,"
  "filesystem read/write," or any of the other five named tranches cleanly. Flagged as an open
  question below rather than silently folded into or excluded from this tranche's criteria.
- **`apps/daemon/src/routes/terminal.ts` + `apps/daemon/src/terminals.ts`**
  (`registerTerminalRoutes`) — `POST /api/projects/:id/terminals` and its stream/stdin/resize/kill
  siblings spawn an **interactive PTY shell** (`terminals.ts:258`, `pty.spawn(shell, [], {...})`)
  rooted at the project directory, gated only by `getProject(db, ...)` existence — no
  `requireLocalDaemonRequest`, no capability check of any kind visible in the route registration
  itself. This is arguably a *higher*-risk surface than agent spawn (a raw shell, not a
  coding-agent CLI with at least a registry constraint on the binary), and is likewise unclaimed
  by any of the six named tranches. Flagged as an open question below.
- **The critique-orchestrator spawn path** (`apps/daemon/src/critique/*`, HTTP surface registered
  in `apps/daemon/src/routes/chat.ts` as `POST /api/projects/:projectId/critique/:runId/interrupt`
  and `GET .../artifact`). Code comments in `apps/daemon/src/critique/rollout.ts` and
  `spawn-inputs.ts` describe "the spawn-time gate" that "spawns the critique CLI adapter for a
  generation," but that spawn is reached through an internal autonomous pipeline
  (`firePipelineForRun`, fired after a run completes, gated on `critiqueCfg.enabled`) rather than
  directly through either of its two HTTP routes (`interrupt` cancels; `artifact` reads a file).
  Investigating and hardening that internal trigger shape is materially different work from
  hardening the 8 directly-HTTP-triggered routes this tranche scopes to, and was not investigated
  deeply enough here to write mechanical criteria against honestly. Flagged as an open question.

## Red-team corpus plan

Covered inline as S9S-5's five named cases above (unknown-`agentId` rejection, oversized-body
rejection, run-creation rate-limit enforcement, cross-caller run-id read/cancel assertion,
sandbox-escape rejection), each requiring a same-file paired positive control per
`VERIFICATION-CONTRACT.md` §3 R4. No separate corpus file/format is proposed beyond the test file
itself — five named cases is small enough that a dedicated fixture-corpus directory (the way the
ingest tranche used `scripts/waves/fixtures/`) would be over-engineering for this tranche's size;
revisit if a review round finds the five cases insufficient.

## Open design questions (for the adversarial reviewer)

1. **Should `host-tools.ts` and/or `terminal.ts` be folded into this tranche, made their own
   tranche, or explicitly deferred to "long tail"?** Both have the identical "zero route-level
   auth" shape this tranche documents for agent spawn, and terminal access is arguably
   higher-severity. Folding either in would break this tranche's clean single-file lease
   (`registerRunRoutes` only) and its tight AST-scoped route-freeze pattern would need a second
   scope. Recommendation from this author: leave both out of this tranche (as written) and rule
   explicitly whether they get their own tranche slug or ride in "long tail" — but do not let the
   ambiguity cause them to be silently forgotten.
2. **Does the critique-orchestrator's internal spawn trigger need its own threat model before any
   wave closes the "agent spawn" risk category as addressed?** This tranche's criteria do not
   reach it. A ruling on whether that's acceptable (because its HTTP surface itself doesn't spawn)
   or whether it needs a follow-up investigation is requested.
3. **Is the 3-valued exposure scale (0/1/3, no "2") the right call, or should this tranche invent
   an intermediate self-service-bearer primitive now rather than waiting for an implementer to
   introduce one?** This author chose not to invent an unused primitive; a reviewer may disagree.
4. **For `GET /api/runs/:id` and `GET /api/runs`'s impact floors (0 and 1 respectively):** this
   document could not fully confirm `design.runs.statusBody`'s exact field set from a single read
   of `routes/runs.ts` (the function is defined elsewhere, not located during this expansion's
   research pass). If it includes full prompt/transcript text, both floors are wrong and should
   rise. Recommend the reviewer or implementer confirm `statusBody`'s fields directly before
   treating these floors as settled.
5. **S9S-3's red-evidence replay machinery**: should `verify-w9-agent-spawn.ts` implement the full
   detached-worktree replay path (mirroring `verify-w9-ingest.ts`'s ceremony-hardened version) on
   day one, before any test exists to replay, or is it acceptable to land a simpler
   introduction-commit/title-parsing check now and add replay in a scoped follow-up once
   implementation produces a genuinely new test to replay against? This document's verifier takes
   the second path (see verifier header comment); flagged for explicit reviewer sign-off rather
   than assumed.
6. **Cross-caller run-id isolation (`GET /api/runs/:id`, `/events`, `/agui`,
   `/result-package`, `POST .../cancel`)**: is "no ownership check" acceptable as a documented,
   accepted risk for a single-user local daemon, or does this tranche need to force real
   caller-identity scoping? This document does not pre-decide it — S9S-5 case 4 requires the
   implementation to assert *one* answer, but which answer is right is a product/threat-model
   call this author is not positioned to make unilaterally.

## Definition of green

`~/.claude/goal-state/mishmash-w9-agent-spawn-tranche/proof/manifest.json` shows every `C9S-1`
through `C9S-7` criterion at `status: "pass"`, `LEASE` and `HEAD-DRIFT` at `status: "pass"`,
`treeDirty: false`, `wroteOk: true`, `archiveOk: true`, `commit` bound to the implementation
branch's `HEAD`. Per `VERIFICATION-CONTRACT.md` §7, this tranche's criteria are the evidence for
`GLOBAL-GOAL.md`'s `G-13` alongside the other W9 tranches' rows.
