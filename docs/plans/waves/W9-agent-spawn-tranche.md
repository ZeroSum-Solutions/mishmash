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

**Status: ROUND 3 — FOUNDER-AUTHORIZED FINAL ROUND (2026-07-28).** Round 1 (frozen at
`1370e1139`) returned REJECT (8 blockers). Round 2 (frozen at `236ea1b79`) applied all eight
rulings and returned REJECT again with 9 named residuals (route-triggered launches still
omitted; classifier binding gaps; a mutable detached worktree; C9S-4/5 decoys; a C9S-6 substring
collision; C9S-7 fragility; a founder ruling un-parking C9S-8; prose-only protected-port safety;
a non-mechanical `server.ts` bound). The program's 2-round cap fired; the founder authorized this
scoped final round, closing exactly those 9 residuals — one confirmation review follows this
delivery, then freeze or park. Every residual is disposed in **AUTHOR-FLAGGED / DISPOSITIONS**.

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
