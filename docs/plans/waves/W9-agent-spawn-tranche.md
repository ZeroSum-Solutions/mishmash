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

**Status: ROUND 4 APPLIED — FOUNDER-AUTHORIZED FINAL ROUND (2026-07-28), pending re-review.**
Round 1 (frozen at `1370e1139`) returned REJECT (8 blockers). Round 2 (frozen at `236ea1b79`)
applied all eight rulings and returned REJECT again with 9 named residuals (route-triggered
launches still omitted; classifier binding gaps; a mutable detached worktree; C9S-4/5 decoys; a
C9S-6 substring collision; C9S-7 fragility; a founder ruling un-parking C9S-8; prose-only
protected-port safety; a non-mechanical `server.ts` bound). Round 3 (frozen at `4f9ea7863`)
applied all nine round-2 residuals and was itself REJECTED by adversarial review with 5 new
probe-demonstrated bypasses (see **ROUND 3 ADVERSARIAL VERDICT** below) — round 3's fixes for
those exact defect *classes* were each real but each left a live gap the reviewer's own probes
walked through. The program's round cap had already fired once (after round 2); the founder
authorized exactly one further scoped round (round 4), closing precisely those 5 findings plus a
binding design ruling on C9S-8 (below). Round 4's dispositions are in **AUTHOR-FLAGGED /
ROUND-4 DISPOSITIONS**; round 1-3's original dispositions are preserved unchanged under
**AUTHOR-FLAGGED / DISPOSITIONS (round 2 → round 3)**. One confirmation review follows this
delivery, then freeze or park.

---

## Why this tranche exists

Unchanged: agent-spawn routes launch a real OS child process with caller-influenced parameters —
a strictly larger blast radius than any other tranche's worst case.

**Round-2 corrections (recap):** scope widened from `routes/runs.ts` alone to also cover
`routes/terminal.ts` (raw shell, folded in as highest-risk process execution),
`routes/routine.ts` (`POST /api/routines/:id/run`, reaches the shared `startChatRun` primitive),
and `routes/media.ts`'s `POST /api/orbit/run` (also reaches `startChatRun`, already
loopback-gated). `apps/daemon/src/routes/host-tools.ts` was carved into its own named, scheduled
tranche (`mishmash-w9-host-launch-tranche`) rather than left an anonymous long-tail item. The
critique-orchestrator disclosure was corrected: it consumes an already-spawned child, it does not
spawn independently.

**Round-3 correction (residual 1 — coverage was still incomplete).** Two more route-triggered
process-launch sites exist, verified directly:

- **`POST /api/agents/:agentId/oauth-launch`** (`apps/daemon/src/routes/daemon.ts`,
  `registerDaemonRoutes`). Only `agentId === 'antigravity'` is accepted (400 otherwise); the
  handler dynamically imports `runtimes/terminal-launch.ts` and calls
  `launchAgentInSystemTerminal('agy')`, which spawns a **system terminal window** running the
  hard-coded binary `agy` (via `osascript`/`gnome-terminal`+siblings/`cmd.exe`, platform-
  dependent — `terminal-launch.ts:29-110`). The command string is a compile-time literal, never
  caller-influenced (the file's own header comment states this explicitly: "the `command`
  argument is always a hard-coded binary name like `agy`... Adding caller-supplied flags or env
  vars to this helper would invalidate that guarantee"). This route **already carries
  `requireLocalDaemonRequest`** as literal middleware (`routes/daemon.ts:68`) — exposure 2 today,
  not 3, with zero wiring gap.
- **`POST /api/projects/:id/media/generate`** and **`POST /api/tools/media/generate`**
  (`apps/daemon/src/routes/media.ts`, `registerMediaRoutes` — the same file/function `POST
  /api/orbit/run` already lives in). Both call `handleGenerate` → `generateMedia(...)`
  (`routes/media.ts:148-224,618-666`), which — when the caller's `model` selects the Codex image
  provider — reaches `runCodexImagegen` → `spawn(codexBin, codexImagegenArgs(...), {cwd:
  ctx.projectRoot, env, ...})` (`media/index.ts:1096-1106`; `codexBin` defaults to `'codex'` but
  is overridable via `env.CODEX_BIN`). Unlike oauth-launch, the caller **does** influence this
  spawn's trigger condition (which `model` is requested) and its working directory
  (`ctx.projectRoot`), even though the binary name itself is not directly caller-supplied.
  `POST /api/projects/:id/media/generate` carries `isLocalSameOrigin` (exposure 2, same pattern as
  Orbit — `registerMediaRoutes` already destructures `isLocalSameOrigin` from `ctx.http`,
  `media.ts:75`); `POST /api/tools/media/generate` carries `authorizeToolRequest`
  (`registerMediaRoutes` already destructures it from `ctx.auth`, `media.ts:77`) — exposure 0
  today, genuinely bound.

Neither of these needs a new owned file: `oauth-launch` adds one path-filtered route to a new
`routes/daemon.ts`/`registerDaemonRoutes` entry (that registrar has many unrelated routes — daemon
status/db-inspection — out of scope, same pattern as `routine.ts`/`media.ts`'s existing narrow
filters); the two media-generate routes widen the **existing** `routes/media.ts` entry's path
filter (it was already in scope for `POST /api/orbit/run`).

**Revised tranche scope: 20 route registrations across 5 files, 5 `register*Routes` functions:**

| # | Method + Path | File | Registrar | In-scope reason |
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
| 12 | `POST /api/projects/:id/terminals/:tid/stdin` | `routes/terminal.ts` | `registerTerminalRoutes` | arbitrary command injection into a live shell |
| 13 | `POST /api/projects/:id/terminals/:tid/resize` | `routes/terminal.ts` | `registerTerminalRoutes` | session lifecycle |
| 14 | `POST /api/projects/:id/terminals/:tid/kill` | `routes/terminal.ts` | `registerTerminalRoutes` | session lifecycle |
| 15 | `DELETE /api/projects/:id/terminals/:tid` | `routes/terminal.ts` | `registerTerminalRoutes` | session lifecycle (kill alias) |
| 16 | `POST /api/routines/:id/run` | `routes/routine.ts` | `registerRoutineRoutes` | triggers shared agent runner |
| 17 | `POST /api/orbit/run` | `routes/media.ts` | `registerMediaRoutes` | triggers shared agent runner |
| 18 | `POST /api/projects/:id/media/generate` | `routes/media.ts` | `registerMediaRoutes` | can reach `spawn(codexBin,...)` |
| 19 | `POST /api/tools/media/generate` | `routes/media.ts` | `registerMediaRoutes` | can reach `spawn(codexBin,...)` |
| 20 | `POST /api/agents/:agentId/oauth-launch` | `routes/daemon.ts` | `registerDaemonRoutes` | spawns a system terminal running a hard-coded `agy` |

**Scoping note (unchanged principle, now covering 3 files):** `registerRoutineRoutes`,
`registerMediaRoutes`, and `registerDaemonRoutes` each register many other routes outside this
tranche's concern (routine CRUD, media generation surfaces unrelated to process spawn, daemon
status/db-inspection). Only the named routes above are frozen and in scope from those three
files; `registerRunRoutes` and `registerTerminalRoutes` remain fully frozen (every route those two
functions register is in scope, verified by a computed-path hard-fail — see S9S-1).

## Ground facts (verified directly in this tree)

Round-1/round-2 facts (dependency wiring precision, `GET /api/runs/:id` floor correction) carry
forward unchanged — see prior-round text preserved in git history at `236ea1b79`. Round-3 facts:

- **`POST /api/agents/:agentId/oauth-launch` is already exposure 2 today** (`requireLocalDaemonRequest`
  literal middleware, `routes/daemon.ts:68`) — zero wiring gap for this route specifically.
- **`registerMediaRoutes` already destructures all three relevant guard primitives** from `ctx`:
  `requireLocalDaemonRequest`/`isLocalSameOrigin` from `ctx.http` (`media.ts:75`),
  `authorizeToolRequest` from `ctx.auth` (`media.ts:77`) — this is the real, positive
  ctx-destructure binding pattern the round-3 classifier fix (residual 2) now requires proof of,
  not merely infers from absence of a shadow.
- **The `codexBin` spawn is conditional**, reached only when the Codex image provider is selected
  (`media/index.ts:562-568` `useCodexSubscription`/`def.provider === 'codex'` branches) — the
  route is in scope regardless, because the *route* is what a caller reaches and *can* trigger
  the spawn depending on `model`; this tranche threat-models the route's worst case, not its
  average case, matching the same principle applied to `POST /api/runs`'s conditional
  spawn-vs-validation-failure paths.

## Exposure scale (unchanged from round 2, verifier machinery corrected — residual 2)

4-valued: `0` = genuinely authenticated/authorized (`authorizeToolRequest`, now requiring **proof
of a real `ctx.auth` destructure binding**, not absence-of-shadow alone); `1` = reserved, unused;
`2` = loopback-only zero-credential (`requireLocalDaemonRequest` middleware OR an inline
`isLocalSameOrigin` guard, each now requiring **proof of a real `ctx.http` destructure binding**);
`3` = none of the above. See "Round-3 classifier fixes" below for the mechanical detail.

## The full frozen table (20 routes)

Rows 1-17 are unchanged from round 2 (see prior-round text in git history for the full floor
rationale per row). New rows:

| # | Route | Impact floor | Impact rationale |
|---|---|---|---|
| 18 | `POST /api/projects/:id/media/generate` | 3 | can reach `spawn(codexBin,...)`; caller controls `model` (spawn trigger) and, transitively, the working directory |
| 19 | `POST /api/tools/media/generate` | 3 | same spawn path as row 18, tool-token-gated entry point |
| 20 | `POST /api/agents/:agentId/oauth-launch` | 3 | spawns a system terminal window running a hard-coded `agy` binary; caller controls only the trigger (agentId is checked against a fixed literal, not otherwise influential), not the spawned command itself |

`tierFor`: `score 5-6 = P0`, `score 4 = P1`, `score 0-3 = P2`. With live-derived exposure today
(rows 18/20 at exposure 2, row 19 at exposure 0, everything else per round 2's table), rows 18 and
20 join the P0 set (`2+3=5`); row 19 (`0+3=3`) is P2. As with every prior round, this table states
current reality for the reader — the attribution matrix computes P0 status live from the
classifier at verification time and is the actual source of truth.

## Scope

Round-1/round-2 scope clauses S9S-1 through S9S-8 carry forward with the following round-3
amendments. Where this section is silent, the round-2 text (git history at `236ea1b79`) still
governs.

**S9S-1 amendments (residuals 2, 3, 9):**

- **Positive ctx-binding proof, not absence-of-shadow (residual 2a/2b).** The classifier no
  longer treats "no detected shadow" as sufficient for exposure 0/2. It now requires **positive
  proof**: a direct, single-step object-destructure of the guard identifier from the *specific*
  expected `ctx` sub-object (`ctx.auth` for `authorizeToolRequest`; `ctx.http` for
  `requireLocalDaemonRequest`/`isLocalSameOrigin`), appearing before the guard's use, with **no**
  later plain-identifier redeclaration, later assignment, or later function-declaration of the
  same name intervening before that use. An unbound bare identifier — even one that happens to be
  named `authorizeToolRequest` with nothing shadowing it — no longer classifies as exposure 0;
  absence of evidence is not evidence of absence.
- **Decoy-registrar hard fail (residual 2c).** `findFunctionBody`'s replacement only matches
  function declarations that are **direct top-level statements of the source file** (never
  nested inside another function, class, or block) and requires **exactly one** such match —
  zero or multiple top-level declarations of the same registrar name is a hard fail, closing the
  "first nested same-named function wins" decoy vector.
- **Element-access route registrations are no longer invisible (residual 2d).** The collector now
  also recognizes `app['post'](...)`/`app["get"](...)`-shaped calls (element access with a
  string-literal argument naming an HTTP method) on equal footing with the property-access
  (`app.post(...)`) shape — both contribute to `totalCallCount`, and a route registered this way
  is either counted as a real static registration (if the path argument is also static) or trips
  the computed-path hard fail (if not). A route can no longer be added invisibly by switching
  syntax.
- **Detached-worktree blob-level verification (residual 3).** Every file this verifier reads from
  the detached HEAD worktree for a declarative decision (route source, attribution matrix,
  threat-model doc, each discovered test file) is now verified, **immediately before that read is
  trusted**, against its known-good blob hash: `git hash-object <worktree-file>` must equal `git
  rev-parse <headSha>:<relPath>` — the actual git object ID for that path at the commit being
  verified, independent of anything that may have happened to the worktree's working copy since
  checkout (a `pnpm install`, a daemon boot, or a test run cannot silently rewrite a tracked file
  without that mismatch being caught). A mismatch is a hard fail for whichever criterion was about
  to trust that content. The replay mechanism's HEAD-test overlay is fixed the same way: it now
  writes the git **blob content** (`git show <headSha>:apps/daemon/<relPath>`) into the replay
  worktree directly, never a `fs.copyFileSync` from the (checkable-but-still-worktree-sourced)
  detached checkout.
- **`server.ts`'s two-line bound is now mechanical (residual 9).** In addition to the existing
  path-membership check, `LEASE` now runs `git diff --numstat baseCommit...HEAD --
  apps/daemon/src/server.ts` (when that file appears in the diff at all) and hard-fails unless
  added lines `<= 2` **and** removed lines `== 0` — matching this document's own "exactly two
  call-site wiring lines, additive only" claim mechanically, not by trusting prose.

**S9S-1 amendment, round 4 (finding 1 — classifier still both false-red and false-green).**
Round 3's positive-proof rewrite closed the round-2 vectors but was itself demonstrably wrong on
two axes, both closed this round:

- **The ctx identifier is resolved from the registrar's own second parameter name, never a
  hardcoded `'ctx'` literal.** `registerDaemonRoutes` (the new round-3 file) names its second
  parameter `deps`, not `ctx`, and reaches its guard through a genuine **two-hop** destructure
  (`const { http } = deps; const { requireLocalDaemonRequest } = http;`), never a single-step
  `ctx.http` access. The round-3 classifier's hardcoded `'ctx'` and single-hop-only check
  misclassified this already-guarded, literal `oauth-launch` middleware as exposure 3, not the 2
  this document claims. The classifier now resolves the ctx identifier dynamically per file and
  recognizes a genuine two-hop alias (`resolveSubObjectAlias`), with the same anti-rename
  discipline (below) applied at both hops.
- **A binding element's own SOURCE property, not merely its local binding name, must equal the
  guard identifier.** Round 3's binding check accepted `{ optionalToolGrantFromRequest:
  authorizeToolRequest } = ctx.auth` as a genuine binding of `authorizeToolRequest` — it compared
  only the local (post-rename) name, never the actual property being pulled off `ctx.auth`. A
  renamed destructure aliasing an unrelated ctx property to the guard's local name is no longer
  accepted.
- **Shadowing is detected across the WHOLE function body, not only top-level statements.** A
  genuine `ctx.auth`-bound identifier reassigned inside a nested block (an `if`, a callback, a
  sibling handler) before the guard's use — a real, exploitable vector, since JS closures capture
  by reference — went undetected because round 3's shadow scan only walked
  `fnBody.statements` at the top level. A separate full-tree scan now additionally un-sets
  "genuinely bound" if anything, anywhere in the function body, reassigns the guard identifier
  before its use.

Three new self-probe fixtures encode exactly these three vectors (see `runExposureSelfProbes`);
all three failed against the round-3 classifier and pass against the round-4 one.

**S9S-4/S9S-5 amendments (residual 4):**

- **`bodyAssertsStatusCode` is now a real AST check, not a text window (residual 4a).** It walks
  the test body's own AST for a `CallExpression` matching the `expect(<expr>.status).toBe(<code>)`
  / `.toEqual(<code>)` shape (a chain rooted at a call whose argument resolves through a `.status`
  property access, with the terminal assertion's own argument a `NumericLiteral` equal to the
  expected code) — comments and string literals containing the code as text no longer satisfy it.
- **C9S-4 checks both bodies, not only the over-limit one (residual 4b).** The under-limit
  assertion's body must also carry a real status-code assertion (for whatever 2xx status the
  route returns on acceptance), matching this document's own S9S-4 text, which always required
  both.
- **Corpus coverage requires more than one test declaration (residual 4c).** The eight named
  corpus-case patterns are still matched against extracted test titles/bodies (never combined raw
  source, per round 2's fix) — round 3 additionally requires the **set of distinct test
  declarations** that satisfy at least one corpus-case pattern to have size `> 1`. A single test
  body engineered to trip all eight regexes at once no longer satisfies the corpus requirement.
- **The skip-marker scanner is AST-based (residual 4d).** It now walks each test file's AST for a
  real `CallExpression` chain matching `it.skip(...)`/`test.skip(...)`/`.only(...)`/`.todo(...)`/
  `.concurrent.skip(...)`/`.skipIf(...)`, rather than a regex over raw source text — a template
  literal or string constant containing skip-marker-shaped text no longer trips a false positive.

**S9S-4/S9S-5 amendment, round 4 (findings 2, 3 — the "real AST assertion" still had a
tautology, and the corpus check still had a comments-only false green).**

- **The asserted expression must itself BE a `.status` access, not merely contain one anywhere
  in its subtree (finding 2, tautology).** Round 3's "real AST check" walked the entire
  `expect(...)` argument's subtree for ANY `.status` property access and treated a hit anywhere
  in that subtree as sufficient — so `expect((response.status, 429)).toBe(429)` (the comma
  operator) satisfied it, because `response.status` appears somewhere inside the parenthesized
  expression, even though the value the comma operator actually hands to `expect()` is the
  literal `429`, trivially equal to itself regardless of the real response status. The check now
  requires the `expect()` argument to, after unwrapping trivial parens/`await`, literally BE a
  `.status` member or `['status']` element access.
- **The under-limit body now accepts any 2xx status, not hardcoded to literally 200 or 202
  (finding 2, contradicted the PRD's own text).** This document's own S9S-4 text has always said
  "whatever 2xx status the route returns on acceptance"; round 3's implementation silently
  narrowed that to exactly `200`/`202`, rejecting a legitimately-passing `201`/`204` acceptance
  body.
- **Body lookup is now scoped to the SAME test file that produced the passing assertion, never a
  global cross-file title search (finding 2, duplicate-title decoys).** Round 3 resolved a
  matched assertion's title to a `TestDeclaration` via `allTestDeclarations.find(...)` — a search
  across every discovered test file's declarations by leaf title alone. A decoy declaration in a
  DIFFERENT file sharing the real, passing test's exact title (with a fabricated status
  assertion in its own body) could be returned instead of the real one. The lookup is now scoped
  to the file that actually produced the passing assertion, and more than one same-title
  declaration within that file is itself an ambiguous hard fail rather than `.find()` silently
  taking the first.
- **Corpus-hint matching scans comment-stripped code, never raw body text (finding 3).** Round
  3's fix required more than one distinct declaration to satisfy the eight corpus-case regexes,
  but still matched those regexes against each declaration's RAW captured source — including its
  comments. Two trivial, passing no-op tests whose COMMENTS between them named all eight
  keywords satisfied both the "hit found" and the ">1 distinct declaration" requirements without
  either test exercising any real corpus behavior. Matching is now against a comment-stripped
  token reconstruction (the TypeScript scanner in `skipTrivia` mode, which drops comments and
  whitespace but preserves real code including string-literal content) — a comment can no longer
  contribute a corpus-case hit.

**S9S-6 amendment (residual 5):** the threat-model-doc bullet checker's route-identity match is
now **exact-token**, not substring `includes()`. A bullet is scanned for backtick-quoted `METHOD
/path` tokens (the format this document and the ingest precedent both use for route citations)
and each candidate token is compared to a P0 key by **exact string equality**, never containment
— `` `POST /api/runs/:id/cancel` `` no longer also satisfies `` `POST /api/runs` ``, and terminal
`stdin`'s route no longer satisfies terminal-create's.

**S9S-7 amendment (residual 6):** four fixes, closing the named fragility:

- `reviewedCommit` must match `/^[0-9a-f]{40}$/i` **before** any git resolution is attempted —
  `HEAD~1` and other revision expressions are rejected outright as malformed, not resolved.
- `jobId` is now a **required**, non-placeholder field (round 2 left it optional and unused,
  closing exactly nothing) — the record must carry a real receipt, mirroring W7's own job-id
  requirement even though this tranche does not adopt W7's dual-lane (Sol+Grok) structure, which
  has no analog defined anywhere in this program for a single-tranche implementation review.
- **`reviewedCommit === headSha` is now accepted**, not rejected. The "strict ancestor" rule in
  rounds 1-2 existed to avoid a commit self-referencing its own not-yet-known SHA — a real
  constraint for an **in-repo** record, which this one no longer is (S9S-7 moved the record
  out-of-repo in round 2). Once out-of-repo, a review can legitimately cover the exact final
  commit, and requiring strict ancestry forced an awkward post-review empty commit purely to
  satisfy a now-vestigial rule. The owned-path-diff-empty requirement is unchanged and is
  trivially satisfied when `reviewedCommit === headSha`.
- "Orchestrator-owned" remains a procedural trust boundary, not a filesystem permission boundary —
  this is the **identical** trust model `verify-w7.ts`'s own `GATE-INTEGRITY`/dispositions
  machinery accepts as its baseline (a lease that never grants write access there is what makes it
  trustworthy, not OS-level ACLs); it is not a novel weakness introduced by this tranche and is
  not something this round's mandate asks be re-architected beyond matching W7's own posture.

**S9S-8 — REPLACED, per founder ruling 2026-07-28 (residual 7).** Round 2's two-variant
"blocked-on-founder-capable" design is retired. **Founder decision 2026-07-28: run-ID
single-user shared-local namespace accepted (accepted-risk).** MishMash explicitly accepts that
any local process reaching the loopback daemon may act on any run ID or terminal session — no
per-caller ownership scoping is required. This is now **ground truth this document states**, not
an open question:

- The threat model (per-route table above and the existing per-route rationale text) already
  names "no ownership check" for the relevant rows; this document now makes the attacker model
  explicit rather than implicit: **the accepted attacker/actor for every run-id- and
  session-scoped route in this tranche is any arbitrary local process reaching the loopback
  daemon**, not a scoped, authenticated caller identity. There is no product concept of
  "caller identity" for this surface today, and this tranche does not introduce one.
- `C9S-8` is redesigned to check **only** for the resulting accepted-risk record: a
  `### W9AS-ACCEPT-shared-local-namespace` block in `DECISIONS.md@baseCommit` with the standard
  five fields (`Route`, `Accepted risk`, `Accepter`, `Date`, `Rationale`) — the "real per-caller
  control" alternative (round 2's "variant A") is **removed entirely**, since building one would
  contradict the founder's explicit ruling rather than resolve an open question. The `Accepter`
  field must be non-placeholder, distinct from every `baseCommit..HEAD` commit author (unchanged
  anti-self-accept check), and additionally must not equal a short denylist of obviously
  non-founder identities (`orchestrator`, `implementer`, `verifier`, model/agent names) — closing
  round 2's "does not verify the accepter is the founder" finding as far as this document can
  mechanically ground it without inventing an unverifiable canonical founder-identity string this
  program does not otherwise define.
- **The `blocked-on-founder` status and its recording machinery are removed entirely** from the
  verifier — S9S-8 was their only consumer, and the founder has now resolved the question this
  status existed to park. This also closes round 2's "null-artifact defect" (a `blocked-on-
  founder` recording path that could record success with no backing artifact) by deleting the
  code path that had it, rather than patching it. `C9S-8` is now an ordinary pass/fail criterion.
- **This document never edits `DECISIONS.md`** — per the standing hard-deny and the coordinator's
  own instruction, the orchestrator lands the founder-signed `### W9AS-ACCEPT-shared-local-
  namespace` entry at freeze-landing. Until that lands, `C9S-8` correctly reports `fail` (not
  `blocked-on-founder` — the decision is made; only the paperwork is pending, which is a
  mechanical landing step, not a judgment call), consistent with every other criterion's
  fail-closed posture pre-implementation.

**S9S-8 amendment, round 4 (finding 4 — C9S-8 did not verify a founder-signed or correctly
framed accepted-risk record; binding founder ruling on the design question this raised).**
Round 3's own text (above) already specified the block's "standard five fields (`Route`,
`Accepted risk`, `Accepter`, `Date`, `Rationale`)" — but round 3's *implementation* parsed
`Route` and never checked it in `C9S-8`, and never parsed `Accepted risk` at all; `C9S-8` bound
only `Accepter`/`Date`/`Rationale`. Separately, the round-3 accepter check (non-placeholder +
denylist + anti-self-accept) is real defense-in-depth but cannot, by itself or in combination,
prove a human founder signed anything — an implementing identity could write `Accepter: Devin
Wiggins` and pass every one of those checks.

**Founder ruling, round 4 (binding, verbatim in `docs/plans/waves/DECISIONS.md`'s "W9 agent-spawn
tranche — ROUND 4 AUTHORIZED, scoped to five" entry): no purely-local verifier can
cryptographically prove a founder signature, and pretending otherwise would be theater.** The
redesign therefore proves what IS mechanically provable, and states plainly what it does NOT
prove:

- **Provable: the record landed on main through the orchestrator's docs-PR review lane.**
  `C9S-8` reads `DECISIONS.md` at `baseCommit` (the merge-base with `origin/main`), never `HEAD` —
  a wave-branch implementer cannot make a commit that is already an ancestor of `baseCommit`
  before their branch starts. A commit on the implementation branch adding the block does
  **not** satisfy the check; only a block already on `main` at the time the branch was cut does.
  This proves provenance (the record went through review and squash-merge on `main`), not a
  cryptographic signature.
- **Now mechanically bound: `Route` and `Accepted risk`, not merely their headings.** `Route`
  must be non-placeholder and must equal one of this tranche's 20 frozen route keys exactly (the
  parser's own capture group already strips the surrounding backticks, so the comparison is
  direct). `Accepted risk` must be non-placeholder and must name the shared-local-namespace risk
  this record actually accepts (bound to the same `shared`+`namespace` vocabulary the block's own
  slug uses), not a generic "we accept this" filler. Both are parsed by
  `parseAcceptedRiskBlocks` alongside the pre-existing `Accepter`/`Date`/`Rationale` capture.
- **Unchanged: the accepter denylist and the anti-self-accept comparison** against
  `commitAuthorsBetween(baseCommit, HEAD)` — narrower claims that stand independently of the
  provenance argument above.
- **No overclaiming, stated in the criterion's own assertion text:** `C9S-8` passing means "the
  accepted-risk record landed on main through the docs-PR review lane (baseCommit-pinned) and is
  structurally + referentially sound" — it explicitly does **not** claim a founder signature was
  cryptographically verified, and the verifier's own assertion string says so in those words.

**S9S-9 (new) — Protected-port safety, mechanically enforced (residual 8).** Every isolated daemon
boot this verifier performs now validates the boot's own reported bind address before trusting
anything else about that boot:

- The boot script additionally reports the actual bound `{address, port}` (read from the started
  server's own `.address()`, when exposed by `startServer`'s `returnServer: true` return value) —
  absence of this field is itself a hard fail (fail-closed: an inability to independently confirm
  the bind address is never treated as "probably fine").
- The reported port is checked against a literal denylist (`7456`, `51012`) and the reported host
  against a loopback allowlist (`127.0.0.1`, `::1`, `localhost`) — any other value is a hard fail
  before `routeInventory` is trusted at all.
- An active confirmation probe follows: the verifier constructs a URL from the **validated**
  `{host, port}` only (never a value it hasn't already checked) and issues a real HTTP request to
  one of the tranche's own known-live routes with `redirect: 'manual'` — a 3xx/opaque-redirect
  response, a connection failure, or a thrown error is a hard fail. This proves the validated
  address is genuinely reachable and does not silently redirect elsewhere, rather than trusting
  the self-reported address alone.

**S9S-9 amendment, round 4 (finding 5 — the boot's teardown fallback could still orphan the
actual daemon process).** The isolated boot spawns `pnpm exec tsx <script>`; the tracked child is
the `pnpm` wrapper, but the process that actually owns the daemon's listening socket is the
`tsx` descendant `pnpm exec` spawns underneath it. Round 3's teardown SIGTERM'd the tracked PID,
and — if the process hadn't exited within 5s — SIGKILLed that SAME tracked PID and resolved
**immediately**, without waiting for or checking that the descendant had actually exited. If
`started.shutdown()` inside the boot script hangs, SIGTERM to the wrapper alone does not
guarantee it reaches the descendant, and SIGKILL to the wrapper does not kill the descendant
either (POSIX: killing a parent does not kill its children; an orphan is reparented, not
terminated) — the daemon-owning process, and its live listener, could survive the run. Round 4:

- The boot child is now spawned `detached: true` (POSIX), making it the leader of its own new
  process group (`child.pid` is that group's PGID); `pnpm exec`'s `tsx` descendant inherits this
  same group by default.
- Teardown now signals the **whole process group** (`process.kill(-child.pid, signal)`) for both
  the SIGTERM and the SIGKILL step, falling back to the tracked PID alone only if group signaling
  itself fails (group already gone, or a non-POSIX platform) — reaching the daemon-owning
  descendant even if the `pnpm` wrapper itself is unresponsive.
- Teardown now **waits for the group's real `exit` event after SIGKILL** instead of resolving on
  the timeout firing. If the group still has not exited 3s after SIGKILL, teardown throws rather
  than silently declaring cleanup successful — fail-closed, matching this section's own posture on
  the bind-address check above, and propagating as a hard `C9S-1` failure rather than a quiet
  pass with a potentially-orphaned listener left behind.

## Success criteria

Unchanged from round 2 in name and intent (`C9S-1` through `C9S-7`, `LEASE`/`HEAD-DRIFT`/
`GATE-INTEGRITY`), now closing the round-3 residuals per the Scope amendments above.
**`C9S-8`** is redefined per S9S-8 above: pass only on a verified `### W9AS-ACCEPT-shared-local-
namespace` record; fail otherwise (no third state). A new infra-level check is folded into
**`LEASE`** for the `server.ts` line bound (S9S-1 amendment).

## Implementation surface

Unchanged from round 2, plus: `apps/daemon/src/routes/daemon.ts` (the `oauth-launch` route
already carries `requireLocalDaemonRequest`; no code change forced by this tranche unless the
attribution matrix's chosen resolution calls for one) is added to the files a future
implementation agent may touch, and to the proposed lease below.

## PROPOSED write lease (text only)

```jsonc
"W9-agent-spawn": {
  "slug": "mishmash-w9-agent-spawn-tranche",
  "allow": [
    "apps/daemon/src/routes/runs.ts",
    "apps/daemon/src/routes/terminal.ts",
    "apps/daemon/src/routes/routine.ts",
    "apps/daemon/src/routes/media.ts",
    "apps/daemon/src/routes/daemon.ts",
    "apps/daemon/src/server.ts",
    "apps/daemon/tests/agent-spawn-*.test.ts",
    "docs/security/**",
    "scripts/waves/verify-w9-agent-spawn.ts",
    "docs/plans/waves/DECISIONS.md"
  ],
  "note": "Round-3 revision: routes/daemon.ts added (oauth-launch, residual 1). server.ts's
    allowance is bound mechanically by LEASE itself now (<=2 added lines, 0 removed, when
    server.ts appears in the diff at all) -- not by this note's prose alone. docs/security/** and
    DECISIONS.md are also claimed by W9-ingest; both tranches only ever add new, distinctly-
    prefixed files/sections there -- never edit each other's. The implementation-review record
    does NOT live under this lease (S9S-7) -- it is orchestrator-owned and out-of-repo. This
    tranche never edits DECISIONS.md itself; the founder-signed
    ### W9AS-ACCEPT-shared-local-namespace entry (S9S-8) is landed by the orchestrator at
    freeze-landing, not by this tranche's implementation branch."
}
```

## Out of scope

Unchanged from round 2: the other five named tranches, "long tail", `mishmash-w9-host-launch-
tranche` (host-tools.ts), Critique Theater (resolved, not a spawn surface).

## Open design questions

Round-1/round-2 open questions 1-3 (host-tools/terminal scope, critique-orchestrator,
blocked-on-founder framing) are **resolved** — round 3 removes the `blocked-on-founder` mechanism
per the founder ruling, so question 3 no longer applies. No new open questions are raised by this
round; it is scoped to closing named residuals, not raising new ones.

## Definition of green

`~/.claude/goal-state/mishmash-w9-agent-spawn-tranche/proof/manifest.json` shows every `C9S-1`
through `C9S-8` at `status: "pass"`, `LEASE`/`HEAD-DRIFT` at `"pass"`, `treeDirty: false`,
`wroteOk: true`, `archiveOk: true`, `commit` bound to the implementation branch's `HEAD`.

---

## AUTHOR-FLAGGED / DISPOSITIONS (round 2 → round 3)

Every round-2 residual, verbatim from the adversarial verdict, disposed here.

1. **Coverage — oauth-launch/media-generate omitted.** FIXED. Three routes added (18-20); table
   above; `routes/daemon.ts` added as a fifth owned file.
2. **Classifier binding gaps.** FIXED — four sub-fixes: (a) positive `ctx.auth`/`ctx.http`
   destructure-binding proof replaces absence-of-shadow; (b) shadow detection now also covers
   later assignments and later function declarations of the guard name, not only `const`
   redeclarations; (c) `findFunctionBody` requires exactly one top-level (never nested) match; (d)
   the route collector recognizes `app['post'](...)`-shaped element-access registrations.
3. **Detached worktree mutable post-suite.** FIXED. Blob-hash verification (`git hash-object` vs.
   `git rev-parse headSha:path`) gates every trusted read from the detached worktree; the replay
   overlay now writes git blob content directly instead of copying from the worktree checkout.
4. **C9S-4/5 decoys.** FIXED — four sub-fixes: real AST status-code assertions (not text windows);
   both under- and over-limit bodies checked; corpus coverage requires >1 distinct satisfying test
   declaration; skip-marker scanning is AST-based, not raw-source regex.
5. **C9S-6 substring collision.** FIXED. Exact backtick-token equality replaces substring
   `includes()` for route-identity matching in threat-model-doc bullets.
6. **C9S-7 fragility.** FIXED — four sub-fixes: 40-hex-only `reviewedCommit` validated before any
   git call; `jobId` now required and non-placeholder; `reviewedCommit === headSha` now accepted
   (closes the empty-commit awkwardness, since the record is out-of-repo and no longer risks
   self-reference); the orchestrator-owned trust boundary is explicitly matched to W7's own
   identical posture, not re-architected.
7. **C9S-8 unparked by founder ruling.** FIXED. Redesigned to check only the founder-signed
   `### W9AS-ACCEPT-shared-local-namespace` record; the real-control alternative is removed
   (would contradict the ruling); `blocked-on-founder` machinery deleted entirely, closing the
   null-artifact defect by removing its only code path; the threat model now names "any arbitrary
   local process" as the accepted actor explicitly.
8. **Protected ports prose-only.** FIXED. The boot script reports its actual bound address; the
   verifier validates it against a port denylist and host allowlist before trusting anything else,
   then actively confirms reachability with a `redirect: 'manual'` probe against the validated
   address only.
9. **`server.ts` bound not mechanical.** FIXED. `LEASE` now runs `git diff --numstat` on
   `server.ts` specifically and hard-fails past 2 added / 0 removed lines, whenever that file
   appears in the diff.

**Confirmed-good items from round 2, preserved, not regressed:** commit/file discipline; the
dependency ground-fact rewrite; matrix integer bounds, true XOR, exact `W9AS-ACCEPT-` prefix; the
GATE-INTEGRITY unpinned/pinned split; LEASE's `baseCommit` (never `HEAD`) read; fail-closed
archival/exit logic; the ported replay core's per-invocation markers, exact-one-marker extraction,
natural `process.exitCode`, and node-counted failed-leaf logic.

---

## ROUND 3 ADVERSARIAL VERDICT (verbatim summary) — REJECT

Round 3 (frozen at `4f9ea7863`) was reviewed and **REJECTED**, with the reviewer demonstrating a
live, executable probe against each of 5 findings — every round-3 defect-CLASS fix (positive
ctx-binding proof, real AST assertions, corpus-declaration counting, C9S-8 field parsing,
protected-port validation) was genuine, but each left a gap the reviewer's own probe walked
through. Findings, verbatim in substance:

1. **C9S-1 classifier remained both false-red and false-green.** `isCtxSubObjectAccess`
   recognized only literal `ctx.auth`/`ctx.http`, but `registerDaemonRoutes` uses `deps` and
   destructures the guard from a local `http` — the legitimate `oauth-launch` middleware was
   classified as exposure 3, not the document's claimed exposure 2 (pure probe-confirmed).
   Conversely, binding validation ignored a binding element's SOURCE property and only scanned
   direct top-level assignments for shadowing — exact-path probes showed both a renamed
   destructure (`{ optionalToolGrantFromRequest: authorizeToolRequest } = ctx.auth`) and a
   nested-block reassignment were accepted as genuine authorization bindings.
2. **C9S-4's "real AST assertion" still accepted a tautology and rejected legitimate 2xx
   statuses.** The helper recursively searched for any `.status` occurrence ANYWHERE in the
   `expect` argument, rather than requiring the asserted expression itself to BE the status
   member access — the probe `expect((response.status, 429)).toBe(429)` (comma operator)
   returned `true` even with `response.status === 500`. Body association also used only the
   leaf title across ALL files, allowing duplicate-title decoys. Under-limit bodies accepted
   only literally `200`/`202`, contradicting this document's own "whatever 2xx status" text.
3. **C9S-5 retained the comments-only corpus false green from round 2.** Corpus patterns still
   matched raw `bodyText`, including comments; the only added constraint (>1 distinct
   declaration contributing) was satisfiable by two passing no-op tests whose COMMENTS split the
   eight keywords between them, without either test exercising any corpus behavior.
4. **C9S-8 did not verify a founder-signed or correctly framed accepted-risk record.** The
   parser never captured an `Accepted risk` field at all, and `C9S-8` checked neither that field
   nor `Route`. The accepter check was exact-string comparison against a short denylist and
   commit-author strings — an implementing identity could write `Accepter: Devin Wiggins` and
   pass. Reading from `baseCommit` prevented an ordinary branch diff from supplying the block,
   but did not authenticate who signed landing paperwork or prevent signing on the founder's
   behalf.
5. **The protected-port boot's fallback could still orphan the actual daemon process.** The
   tracked child was the `pnpm exec tsx` wrapper. After 5 seconds, teardown SIGKILLed only that
   wrapper and resolved immediately without waiting for or checking the descendant that owns the
   listener. If `started.shutdown()` hangs, SIGKILL cannot be forwarded and the daemon
   descendant can remain orphaned.

The reviewer also confirmed, unchanged and not regressed: the immutable range (only the PRD and
verifier changed; `leases.json`, `DECISIONS.md`, `docs/security/**` retained identical git
objects), both newly-identified spawn chains (real), the detached-blob/replay changes, exact
C9S-6 matching, C9S-7 SHA/job rules, and the `server.ts` numstat bound.

The founder authorized exactly one further round (round 4), scoped to these 5 findings plus a
binding design ruling on the C9S-8 question finding 4 raised (recorded verbatim in
`docs/plans/waves/DECISIONS.md`'s "W9 agent-spawn tranche — ROUND 4 AUTHORIZED, scoped to five"
entry, and reproduced in the S9S-8 amendment above).

## AUTHOR-FLAGGED / ROUND-4 DISPOSITIONS

Every round-3 finding, disposed here. Each fix is designed against the reviewer's OWN
demonstrated probe, not merely against the named defect class in the abstract.

1. **C9S-1 classifier false-red + false-green.** FIXED — three sub-fixes, all covered by new
   self-probe fixtures in `runExposureSelfProbes` (`real-daemon-ts-shape-deps-param-two-hop-http-
   destructure`, `renamed-destructure-source-property-mismatch-not-genuine`,
   `genuine-binding-reassigned-inside-nested-block`): (a) the ctx identifier is resolved from the
   registrar's own second parameter name (`findFunctionBody` now also returns `ctxParamName`),
   with a genuine two-hop alias resolver (`resolveSubObjectAlias`) for shapes like
   `registerDaemonRoutes`'s `const { http } = deps; const { requireLocalDaemonRequest } = http;`;
   (b) a binding element's SOURCE property (not merely its local binding name) must equal the
   guard identifier, closing the rename bypass; (c) a full-tree scan
   (`hasReassignmentAnywhere`) additionally un-sets "genuinely bound" if the guard identifier is
   reassigned anywhere in the function body — any nesting depth — before its use, closing the
   nested-block reassignment bypass. Live evidence: a real verifier run against this branch's own
   `apps/daemon/src/routes/daemon.ts` now reports `POST /api/agents/:agentId/oauth-launch =>
   exposure 2` (previously misclassified 3), and `C9S-1` passes end-to-end with all 22
   self-probes green.
2. **C9S-4 tautology + duplicate-title decoys + hardcoded 200/202.** FIXED — three sub-fixes:
   (a) `isStatusAccessExpression` requires the `expect()` argument itself to, after unwrapping
   trivial parens/`await`, BE a `.status`/`['status']` access — a comma expression like
   `expect((response.status, 429)).toBe(429)` no longer satisfies it, since the top-level
   expression is a comma operator, not a status access; (b) body lookup for the under/over-limit
   assertions is now scoped to the file that produced the passing assertion
   (`findOwningRelPath`), with >1 same-title declaration in that file treated as an ambiguous
   hard fail rather than `.find()` silently taking the first; (c) the under-limit body now
   accepts any 2xx status (`bodyAssertsAny2xxStatusCodeAst`), matching this document's own
   "whatever 2xx status the route returns on acceptance" text instead of a hardcoded
   `200`/`202`.
3. **C9S-5 comments-only corpus false green.** FIXED. `TestDeclaration` now also carries
   `codeText` — a comment-stripped token reconstruction via `ts.createScanner` in `skipTrivia`
   mode (comments and whitespace dropped as trivia, real tokens including string-literal content
   preserved). Corpus-hint regexes match against `codeText`, never raw `bodyText` — a comment can
   no longer contribute a corpus-case hit, closing the two-no-op-tests-split-across-comments
   bypass.
4. **C9S-8 founder-signature overclaim / missing Route+Accepted-risk binding.** FIXED per the
   binding founder ruling (S9S-8 amendment above): `AcceptedRiskBlock` now also parses
   `acceptedRisk` (`- Accepted risk:` / `- Accepted-risk:`, both spellings); `C9S-8` now binds
   `Route` (must equal one of the 20 frozen route keys — the parser's own capture group already
   strips backticks) and `Accepted risk` (must name the shared-local-namespace risk, not generic
   filler) alongside the pre-existing Accepter/Date/Rationale checks. The criterion's own
   assertion text and this document both now state plainly that passing proves **"the record
   landed on main through the docs-PR review lane (baseCommit-pinned)"**, explicitly NOT that a
   founder signature was cryptographically verified — no overclaiming. Verified against 9
   isolated positive/negative control fixtures (complete block passes; missing/malformed/
   fabricated-route/generic-risk/self-accepted/absent blocks all fail; both `Accepted risk:` and
   `Accepted-risk:` spellings parse) and against the REAL landed block on `main`
   (`f7b7d26d1`, `docs/plans/waves/DECISIONS.md`): it correctly reports `fail` with `Route
   missing or placeholder-shaped; Accepted risk missing or placeholder-shaped`, because that
   landed block has Accepter/Date/Rationale only. **Two new bullets are needed on that block
   before `C9S-8` can pass** (composed for the orchestrator to land via the docs lane; this
   tranche does not edit `DECISIONS.md`):
   ```
   - Route: `POST /api/runs/:id/cancel` (representative; this acceptance covers every run-id-
     and session-scoped route in this tranche: POST /api/runs/:id/cancel, GET
     /api/runs/:id/events, GET /api/runs/:id/agui, GET /api/runs/:id/result-package, POST
     /api/projects/:id/terminals/:tid/kill, DELETE /api/projects/:id/terminals/:tid)
   - Accepted risk: any local process reaching the loopback daemon can act on any run ID or
     terminal session in this shared local namespace, with no per-caller ownership scoping
   ```
   inserted after the heading and before the existing `- Accepter:` line (or anywhere among the
   block's bullets — field order is not checked).
5. **Protected-port teardown could orphan the daemon descendant.** FIXED. The boot child is now
   spawned `detached: true` (its own POSIX process group); teardown signals the whole group
   (`process.kill(-child.pid, signal)`, falling back to the tracked PID alone only if group
   signaling fails) for both SIGTERM and SIGKILL, and now WAITS for the group's real `exit` event
   after SIGKILL instead of resolving on the timeout firing — if the group has not exited 3s
   after SIGKILL, teardown throws (fail-closed) instead of silently declaring cleanup successful.
   Verified live: two full end-to-end verifier runs against this branch each booted an isolated
   daemon on an OS-assigned port, passed the protected-port validation + active reachability
   probe, and tore down cleanly with no orphaned process or leftover mkdtemp directory (confirmed
   by process-table and filesystem inspection after each run); the operator's protected daemons
   (ports 7456/51012) were never contacted.

**Merge note.** Before round 4, `f7b7d26d1` (`docs(decisions): record founder-delegated gate
rulings for W1/W9as/W10a/W10b/W10c/W10e/W10f (#24)`) was merged from `origin/main` into this
branch — a docs-only advance (also touching `docs/decisions/*.md` and `leases.json`, neither
owned by this tranche) that carries the very `DECISIONS.md` rulings this round's C9S-8 redesign
depends on. The merge was clean (no conflicts); `baseCommit` (merge-base with `origin/main`) is
now `f7b7d26d1`, and the branch's own diff against it remains scoped to exactly the two owned
deliverables (`docs/plans/waves/W9-agent-spawn-tranche.md`,
`scripts/waves/verify-w9-agent-spawn.ts`).
