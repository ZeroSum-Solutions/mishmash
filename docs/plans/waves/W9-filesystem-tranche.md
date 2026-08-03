# Wave 9 — Filesystem read/write tranche (route hardening)

**Slug:** `mishmash-w9-filesystem-tranche`
**Gates on:** W0 (landed)
**Runs beside:** `mishmash-w9-ingest-tranche` (`docs/plans/waves/W9-ingest-tranche.md`) — disjoint file
sets by construction (this tranche's proposed lease explicitly denies `apps/daemon/src/routes/library.ts`,
the ingest tranche's own leased file).
**Loop:** `loop:tranche` (`VERIFICATION-CONTRACT.md` §6)
**Verifier:** `scripts/waves/verify-w9-filesystem.ts`
**Write lease (proposed, not yet granted):** see "Proposed lease" below. **Not yet in
`leases.json`** — landing this PRD does not amend that file; a maintainer amends
`leases.json` separately once this PRD and verifier are frozen and reviewed.

**Status: EXPANSION, PRE-IMPLEMENTATION.** This document and its verifier are authored and frozen
*before* any implementation work starts, per the NM-41C expansion gate
(`W5-W11-gated.md`, "The expansion gate"). Per that gate: **an agent may not begin implementation
from this page.** This PRD is reviewed by an adversarial reviewer who did not write it and will not
implement it, before it unfreezes for a `/goal` run. Implementing the tranche from this document
without that review cycle is a hard reject.

---

## Why this tranche exists

`W5-W11-gated.md` (Wave 9 section) records the real daemon HTTP surface: 340 method registrations
(334 excluding `OPTIONS`) across 35 route files plus 6 bootstrap routes in `server.ts` — ordered by
threat boundary, highest risk first: **agent spawn → filesystem read/write → deploy (BYOK tokens) →
external fetch (SSRF) → Library ingest → imports → long tail.** This document expands the
**filesystem read/write** tranche: the boundary formed by daemon HTTP routes whose handlers read,
write, list, or serve bytes on disk from caller-influenced paths or caller-supplied content — the
same boundary `AGENTS.md`'s "Daemon data directory contract" exists to defend (containment in
`RUNTIME_DATA_DIR`-derived roots, with imported-folder projects' `metadata.baseDir` as the one
sanctioned, precisely-scoped exception).

The sibling `mishmash-w9-ingest-tranche` (frozen, mid-implementation) already hardened one
self-contained file, `routes/library.ts` (23 registrations). This tranche is the much larger,
cross-cutting remainder: project file read/write, uploads, artifacts, static/design-template
serving, generated exports, plugin install/uninstall, brand/design-system asset handling, and
diagnostics export — spread across roughly twenty route files rather than one.

## Ground facts (verified directly in this tree, this run)

These numbers come from running the exact algorithm in `scripts/waves/verify-w9-filesystem.ts`
against `baseCommit` (currently `8e788d123557d2369c9aa43401da3412cd43a391`, this branch's
merge-base with `origin/main` — this branch was freshly cut, so `HEAD === baseCommit` as of this
writing). **Re-run the verifier to reproduce; do not trust these as a checked-in constant** — C9F-1
re-derives them every run (`VERIFICATION-CONTRACT.md` §3 R3 / defect-catalog #8).

- **Route-file universe:** discovered by a **transitive worklist walk** (not a single pass over
  `server.ts`'s own imports), seeded from `server.ts`'s `import { register\w*Routes } from
  '<relative>'` statements, then recursively following any further `register*Routes`-named identifier
  called from inside an already-discovered file's own body and resolved via *that* file's own
  relative imports — repeated until no new file appears (`discoverRouteFileUniverse` /
  `scanUniverse` in `scripts/waves/verify-w9-filesystem.ts`; see "Inclusion rule" below for the full,
  current, normative algorithm). This finds **35 route files**, contributing **43 distinct
  `register*Routes`-named function bodies**. This matches the parent wave's own "35 route files"
  figure exactly — the discrepancy the original ground facts flagged as an open founder question
  was itself an artifact of the single-hop (non-transitive) discovery bug fixed in the round recorded
  under "Update (authorized verifier-fix round, discovery gap closed)" below; there is no remaining
  reconciliation to make.
- **`apps/daemon/src/routes/library.ts` is excluded in full** (23 registrations) — owned by the
  concurrently-landing sibling tranche. Any registration physically inside that file is out of
  scope here regardless of what it does. `library.ts` is a **terminal node** in the transitive walk
  above: visited (so the exclusion still applies to it), but its own body is never expanded further,
  so its internal `registerBackupRoutes(...)` call does not re-introduce `apps/daemon/src/backup/routes.ts`
  as an independently-discovered route file.
- **Backup routes are excluded** — `POST /api/backup`/`POST /api/restore` are registered from
  inside `library.ts` via `registerBackupRoutes(...)` (owned by `apps/daemon/src/backup/routes.ts`,
  W0's surface) and are therefore already excluded by both the `library.ts`-file exclusion and its
  terminal-node treatment above; no separate carve-out is needed.
- **Candidate universe for this tranche: 333 total candidate registrations**, discovered across the
  35 route files via **five mechanisms**, none of them a single flat pass (see "Inclusion rule"
  below for the full normative statement of each): (1) the literal `app.<method>(pathLiteral, ...)`
  call shape inside every discovered `register*Routes` function body, including `server.ts`'s own
  bootstrap-scope calls outside any such function; (2) the declarative
  `defineJsonRoute`/`mountJsonRoute` registration abstraction (`apps/daemon/src/http/`), resolved
  back to its own `path`/`method`/`handle` spec; (3) a path argument that is an `Identifier` bound to
  a named `const` string — resolved via the TypeChecker's inferred type at the identifier's use site,
  uniformly across same-file, cross-file, and cross-package bindings; (4) a path argument that is an
  `Identifier` bound to a *parameter* of the immediately-enclosing function, resolved by finding that
  function's own call sites in the same scanned scope and substituting the literal argument at the
  matching parameter position; (5) a structurally-recognized (not name-matched) bootstrap-scope
  registration helper — a relative-imported function called from `server.ts`'s own bootstrap sequence
  with the literal identifier `app` as one of its own arguments, whose own body (in a different file)
  performs further literal `app.<method>()` registrations.
- **Inclusion classification of the 333 (this run):**
  - **136 CONFIRMED IN-SCOPE** (`fs-hit` — a caller-reachable filesystem primitive, `express.static`,
    `res.sendFile`/`res.download`, or a `multer` upload surface is reachable from the handler).
  - **189 UNRESOLVED** (the classifier's bounded call-graph walk terminates in something it cannot
    inspect — a third-party/`node_modules` call, a class-instance dispatch through `this`, or any
    other declaration with no in-repo function body — see "Known limitation" below).
  - **8 CONFIRMED CLEAN** (process-management-only or otherwise fs-free handlers, including
    `terminal.ts`'s `POST /api/projects/:id/terminals/:tid/kill` and `DELETE
    /api/projects/:id/terminals/:tid` — no reachable fs primitive and nothing unresolved anywhere in
    their call graph).
- These three buckets (136 + 189 + 8 = 333) partition the full candidate set exactly, including every
  route the discovery-gap closure recorded below added (the `/api/projects/:id/conversations...`
  family, `/api/active`, `GET <DIAGNOSTICS_EXPORT_PATH>`, `POST /api/attribution/claim`, the two
  `senseaudio`/`aihubmix` proxy routes, and `GET /*splat`). **The verifier's own run is the source of
  truth for the exact split and every row's file/mechanism attribution, not this paragraph** — C9F-1
  re-derives all of this every run, per the note at the top of this section.
- Existing, pre-existing, currently-passing tests already cover parts of this tranche's threat
  model and may be cited directly per this document's "may cite pre-existing coverage" allowance
  (mirroring the ingest tranche's S9-3 pattern): `apps/daemon/tests/plugins-uninstall-traversal.test.ts`
  (a genuine paired positive/negative control — `'rejects a traversal id and never deletes outside
  the plugin registry root'` / `'control: a safe id still removes only its own folder inside the
  registry root'`), `apps/daemon/tests/project-preview-containment.test.ts`,
  `apps/daemon/tests/project-upload-subdir-path.test.ts`, `apps/daemon/tests/server-paths.test.ts`,
  `apps/daemon/tests/server-image-paths.test.ts`.
- The containment primitive this tranche must attribute against is real and already partially
  implemented: `apps/daemon/src/projects.ts`'s `resolveProjectDir(projectsRoot, projectId,
  metadata)` returns `path.join(projectsRoot, projectId)` for managed projects (after `isSafeId`
  validates `projectId` against `/^[A-Za-z0-9._-]+$/`, rejecting `.`/`..`), but returns
  `path.normalize(metadata.baseDir)` directly — bypassing `PROJECTS_DIR` — for imported-folder
  projects, with a separate `assertVisibleForImportedProject` guard that rejects hidden
  (dot-prefixed) path segments specifically in that branch. **This is the "imported-folder
  `metadata.baseDir` exception" the task brief requires this document to handle precisely**: it is
  not a bug to close, it is a *documented, intentional* second root, and this tranche's containment
  criterion (C9F-6) must distinguish "escapes `PROJECTS_DIR`" (a real containment failure for a
  managed project) from "legitimately resolves to the user's own `baseDir`" (correct behavior for
  an imported-folder project) rather than flagging the latter as a false positive.
- `realpath` (symlink resolution) is already used in several fs-adjacent modules
  (`apps/daemon/src/projects.ts`, `routes/static-resource.ts`, `import-export-routes.ts`,
  `library-install.ts`, `library-sync.ts`, `linked-dirs.ts`, `mcp-config.ts`,
  `project-locations.ts`, `sandbox-mode.ts`, `tool-loop-guard.ts`) — real symlink-aware
  infrastructure this tranche's rows can cite, not a control that has to be invented from scratch
  everywhere.
- `requireLocalDaemonRequest` (the same loopback-gating middleware the ingest tranche's exposure-0
  tier keys on) is already used in several files inside this tranche's candidate set:
  `connectors/routes.ts`, `routes/daemon.ts`, `routes/live-artifact.ts`, `routes/media.ts`,
  `routes/memory.ts`, `routes/plugins/index.ts`. `authorizeToolRequest` (the ingest tranche's
  exposure-1 tier) is also present in-scope: `routes/design-system-tool.ts`, `routes/live-artifact.ts`,
  `routes/media.ts`. Both patterns generalize cleanly to this tranche; library.ts's bearer/self-service
  tier (exposure 2) does not — no route outside `library.ts` uses `bearerToken`/`validateLibraryToken`
  as its own gate — so this tranche's exposure scale is **0 / 1 / 3** (tier 2 reserved, unused,
  documented as such rather than faked).

### Known limitation of the mechanical classifier (honestly flagged, not hidden)

The inclusion classifier is a **bounded, TypeScript-`TypeChecker`-based call-graph walk** (depth
≤ 10, memoized), not a whole-program, alias-complete analysis. It resolves: direct `fs`/`fs/promises`
primitive calls; `express.static`/`res.sendFile`/`res.download`; `multer`; same-file and
relative-imported function bodies; and — because nearly every `register*Routes` function destructures
its own injected `ctx`/`deps` parameter (`const { helpers, plugins, ... } = deps;`) rather than calling
`ctx.foo()` directly — it also resolves calls through that destructuring pattern back to the actual
object literal bound at the route file's own `register*Routes(app, {...})` call site in `server.ts`,
including one additional hop of TypeChecker-based type-property descent when the call site only
spells out a single bound identifier (e.g. `helpers: pluginRouteHelpers`) rather than the full nested
shape. It does **not** resolve: calls dispatched through a class instance's `this`, values returned
from an unannotated third-party call, or any declaration whose implementation lives outside this
git repository. Every call the walk cannot resolve counts as **UNRESOLVED**, never silently
**CLEAN** — this is a deliberate fail-open design so that "the classifier gave up" and "the route is
provably safe" are never conflated (this mirrors `VERIFICATION-CONTRACT.md` §6's own rule that
`auth:none` must never be silently read as "safe").

**UNRESOLVED is not automatically in-scope for this tranche's matrix.** Folding all unresolved
registrations into this one tranche would erase the wave's own threat-boundary partition (agent
spawn / filesystem / deploy / external-fetch / imports / long tail would stop being distinct). Instead:
UNRESOLVED is reported every run as an explicit, visible, counted third bucket (`C9F-1`'s own
evidence file lists every one by `{method, path, file}`), separate from both the
attribution matrix (scoped to the confirmed `fs-hit` set) and from "excluded" — it is a standing,
mechanically re-derived punch list. See "Open founder questions" for the resulting decision this
document does not make unilaterally.

### Known limitation of the mechanical UNIVERSE DISCOVERY (HISTORICAL — closed, see "Update" below;
kept verbatim as the record of what was found and why, not as the current algorithm)

**Superseded.** The gap this subsection diagnoses was closed in the verifier-fix round recorded
immediately below ("Update (authorized verifier-fix round, discovery gap closed)"), and the
resulting current algorithm is stated normatively in "Inclusion rule" further down this document —
that section, not this one, is what a future run should treat as authoritative. This subsection
stays only as the diagnostic record of the original 17-route gap.

`C9F-1`'s drift check (baseCommit-derived candidate set vs. a live daemon boot's own runtime
`routeInventory`) currently reports **17 real, confirmed drift entries** that are genuine daemon
routes the live inventory sees and the static classifier does not, after excluding the sibling
tranche's `/api/library/*`, W0's `/api/backup`/`/api/restore`, and `USE`/`ALL`-method middleware
mounts (all three exclusions are correct and confirmed; the residual is not explained by any of
them). Two distinct, confirmed root causes, found by reading the actual source, not guessed:

1. **A `register*Routes`-named function called from *inside* another `register*Routes` function in
   a *different* file, never imported by `server.ts` directly.**
   `routes/project/index.ts`'s `registerProjectRoutes` imports and calls
   `registerProjectConversationRoutes` from `./conversations.ts` — a file `server.ts` never imports
   and this tranche's universe-discovery (Inclusion rule step 1, scoped to `server.ts`'s own
   top-level imports) therefore never visits. This accounts for 8 of the 17 drift entries (the
   `/api/projects/:id/conversations...` family) — confirmed by reading
   `apps/daemon/src/routes/project/index.ts`'s own import list directly.
2. **A declarative route-registration abstraction this tranche's AST scan does not recognize at
   all.** `routes/active-context.ts` (and likely others among the 4 remaining drift entries —
   `POST /api/attribution/claim`, `POST /api/proxy/senseaudio/stream`, `POST
   /api/proxy/aihubmix/stream`, `GET /*splat` — not individually confirmed by source, unlike item 1
   above) registers `/api/active` through `defineJsonRoute`/`mountJsonRoute` helpers
   (`apps/daemon/src/http/index.ts`) that take a route-definition object (carrying its own `path`
   field) rather than calling `app.get(...)`/`app.post(...)` directly — confirmed by reading
   `apps/daemon/src/routes/active-context.ts:103,111` directly. This inclusion rule's AST scan
   (Inclusion rule step 2) matches only the literal `app.<method>(stringLiteral, ...)` call shape and
   does not yet resolve this second registration abstraction, nor a path argument that is an
   `Identifier` bound to a top-level `const` (confirmed separately for
   `GET /api/diagnostics/export`, registered via `app.get(DIAGNOSTICS_EXPORT_PATH, ...)` in
   `server.ts` itself, where `DIAGNOSTICS_EXPORT_PATH` is a named constant, not an inline string
   literal).

**This is a real, load-bearing satisfiability gap, not a cosmetic one: `C9F-1` cannot pass cleanly
today, and will not pass cleanly after implementation either, until this is fixed** — the drift
check compares against the *live* daemon, so these 17 routes remain visible drift regardless of
what the implementer does to the *attributed* route set. Fixing it requires: (a) recursive universe
discovery — after finding a `register*Routes` function, also scan its own body for calls to further
`register*Routes`-named identifiers resolved via relative imports in *that* file, not only
`server.ts`, transitively; (b) recognizing the `defineJsonRoute`/`mountJsonRoute` registration shape
as a second, alternative route-registration form; (c) resolving a path argument that is an
`Identifier` bound to a same-file top-level `const string literal`. None of these are hypothetical
future risks — all three are confirmed necessary by this run's own drift evidence against the real
tree. See "Open founder questions" — this is the single most important one.

### Update (authorized verifier-fix round, discovery gap closed)

The diagnosis above is preserved verbatim as history; this note records what an authorized,
strictly-scoped verifier-fix round (touching only `scanUniverse`'s universe-DISCOVERY code in
`scripts/waves/verify-w9-filesystem.ts` — never the drift comparison itself, no allowlist, no
tolerance threshold) found and closed. Re-running `C9F-1` against the real tree confirmed the exact
17 drift entries the diagnosis above estimated, with one correction: the `register*Routes`-recursion
family is **10** routes, not 8 — `registerProjectConversationRoutes` (`routes/project/index.ts` →
`routes/project/conversations.ts`) itself calls a second, further-nested
`registerProjectCommentRoutes` (`routes/project/conversations.ts` → `routes/project/comments.ts`),
a two-hop chain, not one. The fix therefore made universe discovery a proper transitive worklist
walk, not a single extra hop.

Reading the remaining routes' actual source (as the original diagnosis explicitly invited, since it
called the 4 non-conversation, non-active-context routes "not individually confirmed by source")
showed the `defineJsonRoute`/`mountJsonRoute` guess was right only for `/api/active`
(`routes/active-context.ts`, exactly as diagnosed) and for nothing else. The other four needed three
further, distinct discovery expansions, each confirmed by reading the real file before writing any
recognizer for it:

- **`GET /api/diagnostics/export` and `POST /api/attribution/claim`** both resolve through a
  named-const path argument, but neither is a *same-file* top-level const as originally guessed —
  `DIAGNOSTICS_EXPORT_PATH` comes from `@open-design/diagnostics` and `ATTRIBUTION_CLAIM_PATH` from
  `@open-design/contracts`, both cross-package imports. The fix reads the TypeChecker's inferred
  type at the identifier's use site instead of re-deriving it from a same-file AST initializer —
  TypeScript never widens a `const` binding's own inferred type, so this resolves same-file,
  cross-file, and cross-package named consts uniformly, a strict generalization of the
  originally-scoped rule rather than a narrower one. **Caveat added by the round-1 adversarial
  review (F1, HIGH — see the dedicated update below):** *how* the cross-package declaration was
  reached at that time — through `node_modules`, landing on each package's built `dist/*.d.ts` — was
  not actually commit-bound for a `baseCommit` scan, and was fixed in the very next round. The
  literal-type-preservation mechanism described above is still accurate and unchanged; only the
  module-resolution path that reaches the declaration changed. "Inclusion rule" below states the
  corrected, current mechanism normatively.
- **`POST /api/proxy/senseaudio/stream` and `POST /api/proxy/aihubmix/stream`** are not
  `defineJsonRoute`-shaped at all. `routes/chat.ts`'s `registerChatRoutes` defines a local closure,
  `const registerByokToolChatProxy = (routePath, opts) => { app.post(routePath, ...) }`, and invokes
  it twice with literal path arguments. The literal path lives at the closure's OWN call sites, not
  at the `app.post(...)` call itself (whose path argument is a plain `string`-typed parameter, not a
  literal-typed const, so the named-const resolution above does not apply). The fix added one
  narrowly-scoped resolution: when a path argument is an `Identifier` bound to a parameter of the
  immediately-enclosing function, find that function's own call sites within the same scanned scope
  and substitute the literal argument at the matching parameter position.
- **`GET /*splat`** is registered by `apps/daemon/src/static-spa.ts`'s `registerStaticSpaFallback`,
  called directly from `server.ts`'s own bootstrap sequence (`registerStaticSpaFallback(app,
  STATIC_DIR)`) with a literal `app.get('/*splat', ...)` inside it — a completely ordinary
  registration whose only problem is that `registerStaticSpaFallback` does not match the
  `register\w*Routes` naming convention, so neither the original nor the recursive discovery walk
  ever visited its file at all. The fix added a structural (not name-based) recognizer for the same
  underlying pattern items (a)–(c) all target: a route-registration helper called from `server.ts`'s
  bootstrap scope, identified by being relative-imported and invoked with the literal identifier
  `app` as one of its own arguments — the same signal every register*Routes function in this
  codebase already relies on for its own `app` parameter.

One regression surfaced and was fixed during this round: the transitive recursion, left unbounded,
also walks INTO `library.ts`'s own `register*Routes` body and rediscovers
`apps/daemon/src/backup/routes.ts` (called via `registerBackupRoutes(...)` from inside `library.ts`)
as an independently-scanned route file — reintroducing `POST /api/backup`/`POST /api/restore` to the
static candidate set even though the live-side drift comparison deliberately excludes both as
sibling-tranche-owned. `library.ts` is now a terminal node in the recursive walk (visited, so the
existing hard exclusion in the per-file loop still applies to it, but never expanded further),
preserving the original exclusion's intent instead of accidentally undoing it.

Result, reproduced across repeated runs: **0 drift entries** — the live daemon's actual route
inventory and the static candidate set now agree exactly on all discovered registrations, with no
allowlist, exemption, or tolerance threshold added anywhere in the drift comparison itself. One
separate, pre-existing, unrelated condition remained and was deliberately left untouched as out of
this round's scope: `C9F-1`'s own isolated daemon boot intermittently reported a non-empty
process-group teardown (the same three survivor process *types* — a `hermes-agent` Python process, a
`node` process, and `cursor-agent` — recurring across independent runs with fresh PIDs each time).
This reproduced identically in a baseline run captured *before* any discovery-code change, so it
predated and was independent of this round's fix; it was a daemon-boot/process-lifecycle question,
not a universe-discovery one, and was out of scope for a round authorized to touch only discovery
code. **The round-1 adversarial review routed this item and ruled it a genuine, blocking leak — see
"Update (round-1 review fixes)" immediately below for the diagnosis and the fix applied.**

### Update (round-1 adversarial review fixes: F1 commit-binding closed, teardown group-emptiness
closed)

An adversarial reviewer who did not write the verifier or this document reviewed the discovery-gap
closure recorded above and rejected it (round 1) on two findings plus one routed item, all fixed in
this authorized fix round — again touching only the verifier and this document, never product code
(this wave's implementation has not started):

- **F1 (HIGH) — commit-binding gap in cross-package literal resolution, closed.** The mechanism (b)
  cross-package `const` resolution described above and normatively in "Inclusion rule" originally
  reached each package's declaration through `node_modules`. `withDetachedWorktree` symlinks
  `node_modules` from the CURRENT checkout into the detached `baseCommit` worktree (there is no
  install step in a detached worktree), and every `packages/<pkg>` workspace member inside that
  `node_modules` tree is itself a *relative* symlink
  (`apps/daemon/node_modules/@open-design/contracts -> ../../../../packages/contracts`). A relative
  symlink resolves relative to its own on-disk location — always the CURRENT checkout's
  `apps/daemon/node_modules/@open-design/`, regardless of which worktree walked through the outer
  symlink to reach it — so cross-package resolution always landed on the CURRENT checkout's
  `packages/<pkg>/dist/<file>.d.ts`, which is gitignored, mutable build output. Someone could mutate
  a gitignored `.d.ts` (and the matching runtime path constant) after `baseCommit` and both the base
  scan and the live daemon would report the same post-base path with `git status` clean — a false
  `drift=0`. **Fix:** `buildDaemonProgram` now builds a `paths` compiler-option override, computed
  fresh from `root`'s own `packages/<pkg>/package.json` files, that redirects every first-party
  `@open-design/<pkg>` module specifier straight to that package's own git-tracked `src/*.ts` *inside
  the worktree under scan* — before module resolution ever reaches `node_modules`. A base-commit scan
  therefore only ever reads commit-bound source at that exact commit; no full package rebuild is
  needed (this stays a single, fast `ts.createProgram` call). This does not change the classifier's
  own const-literal-type mechanism (TypeScript never widens a `const` binding's inferred type,
  whether the declaration is a `.ts` source file or a `.d.ts`) — it changes only *which* declaration
  is read. Third-party dependencies (`express`, `zod`, `node:*`) are unaffected and still resolve
  through `node_modules` as before — they are lockfile-pinned, not a mutable build artifact of this
  repo, so they were never the F1 risk. Verified directly against this tree post-fix: `C9F-1` still
  passes with drift 0, and both previously-affected constants (`ATTRIBUTION_CLAIM_PATH`,
  `DIAGNOSTICS_EXPORT_PATH`) resolve to their correct literal values now sourced from
  `packages/contracts/src/api/attribution.ts` and `packages/diagnostics/src/contract.ts`
  respectively. Full mechanism detail lives on `buildDaemonProgram`'s own doc comment in the
  verifier.
- **F2 (MED) — stale PRD normative rule, closed.** This document's "Ground facts" and "Inclusion
  rule" sections still stated the pre-discovery-gap-closure counts (33 files / 317 registrations)
  and the single-hop, literal-only algorithm, even after the discovery-gap closure above had already
  shipped the transitive walk and four additional discovery mechanisms. Both sections are now
  rewritten to state the current algorithm and current counts (35 files / 43 register bodies / 333
  registrations via five mechanisms) directly, rather than requiring a reader to reconstruct the
  current behavior from this historical narrative.
- **Routed item (a) — `library.ts` terminal-node exclusion — ruled PRINCIPLED, no change.** The
  reviewer confirmed: `library.ts`'s own routes are all within the live-side excluded library
  prefixes, and its only nested registrar is `registerBackupRoutes`. A future non-library-prefixed
  route registered from inside `library.ts` would still appear live-only and correctly trigger drift
  — the terminal boundary does not silently hide unrelated future drift. Left untouched.
- **Routed item (b) — teardown survivor leak — ruled a GENUINE LEAK, closed on the verifier side.**
  The reviewer confirmed the survivor detector was finding a real lifecycle leak, not unrelated
  machine noise: daemon startup fires a fire-and-forget agent-detection probe (`void
  readAppConfig(...).then(... detectAgents ...)` in `apps/daemon/src/server.ts`, never awaited by
  `startServer`) that can spawn a `hermes-agent`/`node`/`cursor-agent` child concurrently with, or
  just after, the verifier's own teardown SIGTERM lands. That child inherits the boot process
  group but was never itself signaled, and the OLD `killGroupFailClosed` escalated to SIGKILL only
  while the LEADER pid remained alive, then did exactly one final group scan — a straggler that
  appeared mid-teardown could be caught by that one scan and reported as an unconfirmed teardown
  without ever being escalated against. **Fix (verifier side, as required):**
  `killGroupFailClosed` now escalates on **process-group emptiness** (the same real `ps`-table scan
  the final verdict uses) rather than leader liveness alone — it keeps polling and, if the group is
  still non-empty after the SIGTERM window, re-signals the whole group with SIGKILL and keeps polling
  again, before giving up. The group can never read as empty while the leader itself is still
  running (the leader's own pgid is its own pid), so this is a strict superset of the old check, not
  a narrowing: still signals the whole group by its one exact known pid, still kills by exact PID
  only, still fails closed on any unconfirmed or partial result. Verified across repeated runs
  post-fix: **zero teardown survivors**, `C9F-8`'s teardown check passing every time.
  **Daemon-side requirement, NOT implemented in this round (this round touches only the verifier and
  this document — this wave's product implementation has not started):** the reviewer additionally
  required that a daemon-side change track, cancel, and await the startup `detectAgents` probe during
  shutdown, so a probe-spawned child is never left racing an in-flight teardown at all, rather than
  relying solely on the verifier's post-hoc escalation to catch it after the fact. **This is recorded
  here as a concrete implementation criterion for this wave**: `apps/daemon/src/server.ts`'s
  `startServer` currently kicks off agent-capability warm probes as a fire-and-forget `void
  readAppConfig(RUNTIME_DATA_DIR).then((config) => { ...; return detectAgents(config.agentCliEnv ??
  {}); }).catch(() => detectAgents().catch(() => {}))`, never awaited by anything — `shutdownDaemonRuns`
  (the function `startServer` returns as `shutdown`, which today awaits `design.runs.shutdownActive`,
  `terminalService.shutdownActive`, and `design.analytics.shutdown`) has no knowledge of it at all.
  This wave's implementation must give that kickoff a handle `shutdownDaemonRuns` can track, and
  either await its settlement or explicitly cancel/kill whatever it spawned, before `shutdown()`
  resolves. This is required before the wave can be considered frozen for
  production readiness, independent of whether the verifier's own group-emptiness polling continues
  to catch the race in practice.

### Update (round-2 adversarial review fixes: F3 live-runtime pinning closed, F4 self-visibility
control closed, F2 sweep completed)

A CONFIRM-round reviewer independently reconstructed the round-1 F1 fix and found it clean (138
workspace source files, zero first-party `dist` files, in a 1,296-file program) but REJECTed on two
new findings plus a residual sweep, all fixed in this second authorized round:

- **F3 (HIGH) — live-daemon side still executed mutable dist, closed.** F1 made the BASE
  (static-scan) side of the drift comparison commit-bound, but the LIVE side — `bootIsolatedDaemon`
  booting `apps/daemon/src/server.ts` for real via `tsx` — still resolved its runtime `import`s of
  first-party `@open-design/*` packages through ordinary Node module resolution into each package's
  own gitignored `dist` bundle, unpinned. **Fix (rebuild, not hash-pin):** before the live daemon
  boots, the verifier now force-rebuilds every first-party workspace package `apps/daemon` depends on
  via `pnpm --filter "@open-design/daemon^..." run build` — the exact house idiom
  `apps/daemon`'s own `typecheck` script already uses for two of these same packages, generalized to
  pnpm's own computed dependency closure (10 packages today) rather than a hardcoded list, memoized
  once per verifier process. Rebuild was chosen over hash-pin-and-fail because it measured ~3.5s wall
  clock for all 10 packages against this tree — fast enough that the F1 fix note's own "too slow"
  escape hatch for a weaker check does not apply — and because forcing a fresh build makes the live
  boot unconditionally commit-bound every run (self-healing against any prior dist state) rather than
  merely detecting staleness and refusing to proceed, which would fail the verifier on ordinary
  un-rebuilt dev staleness that carries no security meaning. See `ensureWorkspaceDepsRebuiltFromHead`
  in the verifier for the full mechanism and rationale.
- **F4 (MED) — process-table scan accepted exit-zero-empty/malformed `ps` output as a genuinely
  empty group, closed.** `processGroupSurvivors` parsed `ps -Ao pid=,pgid=,comm=` output and returned
  zero matching rows as "no survivors" without checking whether the SCAN ITSELF was trustworthy —
  `ps` exiting 0 with nothing (or garbage) was indistinguishable from `ps` exiting 0 having genuinely
  found no member of the target group. **Fix: a self-visibility control.** The scan now also checks,
  in the SAME enumeration, whether this verifier's own process (`process.pid` — definitely alive, it
  is running the check) appears anywhere in the output; if not, or if any row fails to parse, the scan
  is classified `ok: false` and `killGroupFailClosed` treats that as a RUN FAILURE, never as an empty
  group. This logic (`classifyProcessTableScan`) is pure and separated from the actual `ps` call so it
  can be exercised with synthetic input — `PROCESS_TABLE_SELF_PROBES` covers six cases (two normal
  well-formed scans, exit-zero-empty, exit-zero-well-formed-but-self-missing, exit-zero-malformed-rows,
  and nonzero-exit) and gates every `killGroupFailClosed` call via `runProcessTableSelfProbes()`,
  mirroring the classifier's own `SELF_PROBES`/`runSelfProbes` discipline. **Validated end-to-end
  before being wired in**, not just unit-level: a real spawned sentinel process plus a PATH-shimmed
  fake `ps` returning exit-0-empty and exit-0-malformed output were both correctly rejected as
  untrustworthy (`ok: false`, "SCAN UNTRUSTWORTHY... never treated as an empty group") while the same
  harness against the real `ps` correctly confirmed teardown (`ok: true`) — real cleanup was
  independently reconfirmed via `isPidAlive` in every case regardless of what the simulated scan
  claimed. Every teardown detail line now leads with the self-probe evidence (`process-table
  self-probes N/M pass; ...`), visible directly in `C9F-1`/`C9F-8`'s recorded evidence on every run.
- **F2 residuals — full sweep completed, not spot-fixed.** The CONFIRM round found two remaining
  stale references the round-1 fix missed (a leftover "184 unresolved" count in "Explicitly out of
  scope," and open founder question 2 still calling the superseded 33-file derivation authoritative).
  This round grepped the whole document for every count/derivation reference tied to the discovery
  algorithm and reconciled each: "Risk-ranking rule" and "Deviation from the ingest tranche's impact
  model" both said "125 rows" (now 136); "Ownership matrix" said "currently 125" (now 136); open
  founder question 2's 33-vs-35 framing is marked resolved rather than merely renumbered (the parent
  wave's count and this tranche's own re-derivation now agree exactly, so there is no remaining
  discrepancy to spot-check); open founder question 3 said "125 rows vs. 23" (now 136 vs. 23); and
  "Frozen route snapshot + drift detection" — which described the base-side derivation as `git show`
  text parsing and the live-side filter as "route-file universe plus the 6 bootstrap routes," both
  stale relative to the actual detached-worktree/TypeChecker mechanism and the five-mechanism
  discovery algorithm — is rewritten to match the real mechanism, including the F1/F3 commit-binding
  properties. `library.ts`'s own "23 registrations" figure (unaffected by any discovery-algorithm
  change, since it is a terminal/excluded node) and the ingest tranche's own "23 routes" are left as
  written — neither is a candidate for reconciliation.

### Update (founder ruling W9FS-R2, round-3 — final scoped round before park: INVARIANT 1
target-visibility closed, INVARIANT 2 / F5 workspace-wide pinning closed, INVARIANT 3 / F6
forensic-retention closed, INVARIANT 4 / C9F-1 criteria-row truth closed)

After a third consecutive non-APPROVE (the round-2 CONFIRM reviewer independently reconstructed the
verifier's module graph — 437 modules from `server.ts` — and confirmed the round-2 F3 fix's rebuild
closure was airtight; F3 itself is CLOSED, not reopened), the stop rule escalated to the founder.
Founder ruling W9FS-R2 authorized exactly one further scoped round, bounded to four invariants, as
this wave's final round before park:

- **INVARIANT 1 — target-visibility, upgrades the round-2 self-visibility control.** The round-2
  fix (F4) proved a survivor scan sees the CALLER (this verifier's own pid) but said nothing about
  whether it can see the TARGET's session — `bootIsolatedDaemon` spawns the daemon `detached: true`,
  its own session, distinct from the caller's. A session-scoped `ps` (real or shimmed) could
  enumerate only the caller's session, passing self-visibility every time while never showing the
  daemon's session at all — reading as "self visible, zero target rows" on every scan regardless of
  whether the daemon actually has survivors, which round-2's own first self-probe fixture accepted
  as trustworthy in isolation (correctly, for a single scan taken alone — the gap is architectural,
  not a parsing bug). **Fix:** a positive control, `evaluateTargetVisibility`, evaluated once per
  teardown call BEFORE any kill signal: while the target is independently (kernel-level,
  `process.kill(pid, 0)`, session/`ps`-agnostic) confirmed alive, the SAME `ps`-based scan mechanism
  must ALSO show a row for that exact pgid (trivially true for a healthy target, since
  `detached: true` makes the leader its own pgid). A later "zero target rows" result is trusted as
  "confirmed empty" ONLY when this same-run, same-mechanism check passed. Gated by its own synthetic
  self-probes (`TARGET_VISIBILITY_SELF_PROBES`/`runTargetVisibilitySelfProbes`, four cases: healthy,
  the session-scoped-blind exploit, an untrustworthy pre-kill scan, and target-already-dead-at-start),
  alongside the existing process-table self-probes, both gating `killGroupFailClosed`. **Validated
  end-to-end before being wired in**, not just unit-level: against a real spawned sentinel plus a
  PATH-shimmed `ps` that filters out a specific pgid (simulating session-scoped blindness), the OLD
  round-2 self-visibility-only logic was demonstrably FOOLED (`ok: true` even though the target's
  entire session was invisible); the SAME exploit against the new target-visibility-gated logic was
  correctly REJECTED (`ok: false`); a real healthy teardown against real `ps` still confirmed
  normally either way.
- **INVARIANT 2 — commit-binding for ALL evidence paths, closes F5 (HIGH).** The round-2 F3 fix
  rebuilt only `apps/daemon`'s own dependency closure (`@open-design/daemon^...`, 10 packages) before
  booting the live daemon — correct for that ONE evidence path, but `checkC9F9` runs `pnpm
  typecheck`, itself a SECOND evidence-bearing path that typechecks every workspace package,
  including `apps/web` (outside `apps/daemon`'s dependency graph), which depends on
  `@open-design/components` and `@open-design/host` — neither covered by the daemon-scoped filter.
  **Fix: widen to the union rather than track two closures.** The rebuild now covers every
  `packages/*` workspace member with a `build` script (`pnpm --filter "./packages/*" run build`,
  all 14 today), a strict superset of the daemon-only closure, called from both
  `bootIsolatedDaemon` and `checkC9F9` (before `pnpm guard`/`pnpm typecheck`), still memoized to run
  once per verifier process (~13s wall clock for all 14, measured directly against this tree). A
  hand-tracked union of "every evidence path's own dependency graph" would have the same blind-spot
  shape the original F3 finding rejected — a future third evidence path consuming a fifteenth
  package would silently reopen the gap; a full workspace-wide rebuild has no such blind spot by
  construction.
- **INVARIANT 3 — shutdown consumes the teardown result, closes F6 (MED).** `LiveDaemon.shutdown()`
  called `killGroupFailClosed` then unconditionally deleted `bootDir`/`dataDir` regardless of the
  result — an UNCONFIRMED teardown destroyed the only forensic evidence of what actually happened,
  on exactly the runs that most needed it kept. **Fix:** delete only when `result.ok === true`; on
  any unconfirmed/partial result, retain both directories and surface their paths in the returned
  failure detail (`forensic evidence RETAINED (not deleted): bootDir=... dataDir=...`).
- **INVARIANT 4 — PRD truth, closes the F2 residual.** The normative C9F-1 row in "Success criteria"
  still described the superseded `git show <baseCommit>:...` text-parsing mechanism scoped only to
  `register*Routes` bodies + bootstrap calls — the same staleness already fixed in "Frozen route
  snapshot + drift detection" during round 2, but this SEPARATE table row was missed. Rewritten to
  describe the real mechanism: the detached-worktree TypeChecker scan across all five discovery
  mechanisms (including the F1 commit-bound cross-package resolution), the pre-boot workspace-wide
  rebuild (INVARIANT 2), and the self-visibility-plus-target-visibility-gated teardown confirmation
  (INVARIANT 1). A bounded grep for any other C9F-1-mechanism description elsewhere in the document
  found no further contradictions — the only other `git show` reference (in "Proposed lease"'s LEASE
  description) is accurate as written, since the LEASE check genuinely does read `leases.json` via
  `git show`, unrelated to C9F-1's own mechanism.

### Update (founder ruling W9FS-R3, terminal micro-round after formal park — literal-fidelity gaps
only)

The round-3 fidelity confirmation REJECTed on two literal-fidelity gaps in an otherwise-ruled-correct
implementation (commit-binding and shutdown-teardown were both ruled implemented EXACTLY; the
round-3 exploit probe and the zero-row fail-closed gate were both independently confirmed still
correct) — the wave formally parked per the standing stop rule (three consecutive non-APPROVE), and
founder ruling W9FS-R3 authorized one further terminal micro-round, bounded to exactly these two
literal-fidelity items:

- **DEVIATION 1 — `evaluateTargetVisibility` accepted a process-group match alone, not the daemon's
  own leader pid specifically.** INVARIANT 1's own stated invariant was that the daemon's OWN pid row
  must appear in the pre-kill scan; the shipped implementation instead accepted ANY non-empty
  pgid-matching survivors array, which is weaker — a scan that sees some OTHER member of the group
  (a stale/rotated pid coincidentally sharing the pgid, or a scan that enumerates children but is
  blind to the leader's own row specifically) would pass the control without ever having proven it
  can see the ONE row the control is actually about. **Fix:** `evaluateTargetVisibility` now takes
  the daemon's own leader pid as an explicit parameter and requires BOTH conditions — at least one
  row for the process group (kept, not replaced) AND, among those rows specifically, one whose `pid`
  equals the leader pid — extracted from each survivor's own `pid=<N> pgid=<N> comm=<...>` string via
  an anchored regex (this file's own generated format, never external/untrusted text). Trivially
  satisfiable for a healthy target, since `detached: true` makes the leader its own pgid (its row is
  always `pid === pgid === leaderPid`) — a strict tightening, not a narrowing of what a healthy run
  can pass. `TARGET_VISIBILITY_SELF_PROBES` gained a leader-pid field on every case and a new fifth
  case: pgid rows present via a fabricated non-leader row, but the leader's own pid absent — must
  fail. Validated with two controlled probes against a real spawned sentinel process: (1) a
  regression re-run of the round-3 session-scoped-blind exploit (a shim that omits the target's whole
  pgid) — still correctly rejected; (2) the new leader-pid-absent exploit (a shim that shows a
  fabricated non-leader row sharing the pgid but filters out the leader's own row) — correctly
  rejected, citing the exact new failure reason (`NONE has pid=<N> (the leader's own pid)`); a real
  healthy teardown against real `ps` still confirmed normally in both probes' control case.
- **DEVIATION 2 — PRD truth, two remaining fidelity gaps.** (a) "Frozen route snapshot + drift
  detection" still described the pre-INVARIANT-2 daemon-only rebuild filter
  (`@open-design/daemon^...`) and named the removed helper `ensureWorkspaceDepsRebuiltFromHead` —
  rewritten to the actual workspace-wide `./packages/*` filter and the current helper name
  `ensureFirstPartyPackagesRebuiltFromHead`. (b) The C9F-1 success-criteria row's target-visibility
  clause said the scan must show "the daemon's own pid among its rows," which — before DEVIATION 1's
  fix — overstated what the code actually checked (a pgid match alone); now that the code enforces
  both conditions, that clause is literally true, but was reworded regardless for precision: the row
  now states both the process-group-match AND leader-pid-match conditions explicitly, rather than a
  single ambiguous phrase that happened to become accurate only after the code caught up to it. The
  round-2/round-3 addenda's OWN historical references to the daemon-only filter and the pre-rename
  helper name are left untouched deliberately — they are dated narrative describing what a PRIOR
  round did at the time, not normative "how it works today" claims, and the surrounding addenda
  already tell the reader the mechanism was later widened/renamed.

**Nothing else was touched this round**, per the founder ruling's explicit scope: the commit-binding
(F1/INVARIANT 2) and shutdown-teardown (INVARIANT 3) mechanisms were ruled implemented exactly and
are unchanged.

## Inclusion rule (mechanical, re-runnable)

Stated precisely so a future run reproduces the same set without human judgment at classification
time (judgment is still needed to decide policy on the UNRESOLVED bucket — that is a founder
question, not a classifier defect):

1. **Universe.** Parse `apps/daemon/src/server.ts` (at the commit under test). Collect every
   `import { X } from '<relative path>'` where `X` matches `/^register\w*Routes$/`, resolving each
   relative specifier to its `.ts` file (`.js`-suffixed specifiers, `NodeNext`-style, resolve to the
   sibling `.ts`; a bare directory specifier resolves to that directory's `index.ts`) — the seed set.
   Then, **transitively**: for every file already in the universe, AST-walk its own
   `register*Routes`-named function bodies for further calls to a `register*Routes`-named identifier
   resolved via *that file's own* relative imports, and add any newly-found file to a worklist,
   repeating until the worklist is empty (a visited set makes this safe against any future cycle).
   `apps/daemon/src/routes/library.ts` is a **terminal node**: if reached, it is marked visited (so
   the hard exclusion in step 3 still applies to it) but its own body is never expanded further,
   deliberately preventing its internal `registerBackupRoutes(...)` call from re-discovering
   `apps/daemon/src/backup/routes.ts` as an independent route file. This is the **route-file
   universe** — currently 35 files.
2. **Registrations.** In each route file, AST-walk (via `ts.forEachChild`, comment-blind — a
   matching identifier inside a `//` or `/* */` comment can never leak in) every top-level function
   whose name matches `/^register\w*Routes$/` (function declaration or `const X = (...) => {...}`
   form) — currently 43 bodies across the 35 files — and collect registrations inside each body
   through **all** of the following mechanisms, plus the same set applied to `server.ts` itself
   restricted to calls **not** inside any `register*Routes` function body (the bootstrap scope):
   - **(a) Literal calls.** `app.<get|post|put|delete|patch|options>(pathLiteral, ...middleware,
     handler)` where the path argument is a plain string literal.
   - **(b) Named-const path arguments.** A path argument that is an `Identifier` bound to a `const`
     string, resolved by reading the TypeChecker's inferred type at the identifier's use site rather
     than re-deriving it from a same-file AST initializer. This resolves same-file, cross-file, *and*
     cross-package bindings uniformly (e.g. `DIAGNOSTICS_EXPORT_PATH` from `@open-design/diagnostics`,
     `ATTRIBUTION_CLAIM_PATH` from `@open-design/contracts`) — TypeScript never widens a `const`
     binding's own inferred type, so the literal survives the import boundary regardless of whether
     the declaration is same-file or cross-package. For a base-commit scan specifically, cross-package
     resolution reads that package's own git-tracked `src/*.ts`, never a `node_modules`-resolved
     `dist/*.d.ts` build artifact — see the F1 commit-binding note below and the corresponding comment
     on `buildDaemonProgram` in the verifier.
   - **(c) The `defineJsonRoute`/`mountJsonRoute` declarative shape** (`apps/daemon/src/http/`): a
     `mountJsonRoute(app, SPEC, ...)` call whose `SPEC` argument resolves (directly, or through a
     module-level `const` binding, following re-exports transparently via the checker) to a
     `defineJsonRoute({ method, path, handle, ... })` call. The registration's `method`/`path`/handler
     are read from that spec object, not from an `app.<method>()` call site (`mountJsonRoute`'s own
     body performs the actual Express call with a *computed*, non-literal method/path, so it is never
     visible to mechanism (a)).
   - **(d) Call-site parameter substitution.** A path argument that is an `Identifier` bound to a
     *parameter* of the immediately-enclosing function (not a module-level const) — resolved by
     finding that enclosing function's own const-bound name, then every call to that name within the
     same scanned scope, substituting the literal argument at the matching parameter position. This
     covers a local closure defined once and invoked multiple times with different literal paths
     (`registerByokToolChatProxy` in `routes/chat.ts`).
   - **(e) Structural bootstrap-helper recognition.** A route-registration helper called directly from
     `server.ts`'s own bootstrap sequence that does not match the `register*Routes` naming convention
     (so mechanism (1)'s transitive walk never visits its file), recognized structurally rather than
     by name: a relative-imported function invoked from `server.ts`'s bootstrap scope with the literal
     identifier `app` as one of its own arguments — the same signal every `register*Routes` function
     already relies on for its own `app` parameter — whose own body (in a different file) performs
     further literal `app.<method>()` registrations (`registerStaticSpaFallback` →
     `apps/daemon/src/static-spa.ts`'s `app.get('/*splat', ...)`).

   These five mechanisms together produce **333 total candidate registrations** across the 35 files —
   see "Ground facts" above for the current classification split, and the "Update" note below for the
   discovery-gap history that motivated adding mechanisms (b)–(e).
3. **Hard exclusions.** Drop every registration whose containing file is
   `apps/daemon/src/routes/library.ts` (owned by `mishmash-w9-ingest-tranche`; this tranche's
   proposed lease denies that path explicitly, so the exclusion is enforced twice — once by this
   rule, once by the lease boundary). No other file is hard-excluded; a route otherwise reachable
   through a different file is in-scope even if it delegates to library-owned code (it does not — no
   in-scope route imports from `library.ts` today, checked directly).
4. **Duplicate check, with one confirmed real exception.** A `{method, path}` key appearing more
   than once is checked, never silently last-registration-wins-picked — but this tranche's own
   candidate set contains a **verified, deliberate** exception the ingest tranche's narrower
   single-file scope never had to handle: `DELETE /api/design-systems/:id` is registered twice —
   once in `routes/static-resource.ts` (whose handler declares a third `next` parameter and calls
   it for `user:`-prefixed ids), and once in `routes/design-systems.ts` (the terminal handler, no
   `next` parameter, handles everything else). This is a real, working Express chaining pattern,
   confirmed by reading both handler bodies directly — not a hypothetical. Treating every duplicate
   as an unconditional hard fail would make `C9F-1` permanently unsatisfiable against code this
   tranche has no reason or lease to change. The rule is therefore: a duplicate group is a **hard
   fail** only when **two or more** of its handlers never fall through via `next()` (meaning at
   least one is unconditionally unreachable dead code); a group with **at most one** non-chaining
   (terminal) handler is a **legitimate chain** — allowed, but still reported in evidence as a
   "chained duplicate," visible and counted, never silently invisible. The attribution matrix
   (`C9F-3`) still requires exactly **one** row for such a key, not one per handler — the matrix
   attributes a route, not an individual registration.
5. **Classification.** For each remaining registration, walk its final handler's reachable call
   graph (see "Known limitation" above for the exact resolution rules and their bound) and assign
   exactly one of: **`fs-hit`** (a filesystem primitive, static-serving call, or upload-middleware
   surface is reachable), **`clean`** (every reachable call resolves to an inspectable, non-matching
   function body, and nothing anywhere in the graph is unresolved), or **`unresolved`** (anything
   else). These three buckets partition the candidate universe exactly — every registration is in
   precisely one (`C9F-1` asserts this as a hard multiset-equality check, never a subset check).
6. **This tranche's ownership matrix (`C9F-3`/`C9F-4`) covers `fs-hit` only.** `clean` is reported
   with its evidence and excluded. `unresolved` is reported with its evidence and left **pending** —
   visible and counted, per `VERIFICATION-CONTRACT.md`'s own philosophy applied to scope
   determination rather than only to attribution.

**Self-probes.** `C9F-1` additionally requires 12 fixture probes (run through the *exact same*
`scanUniverse`/`classifyExposure` code path the real routes use, never a separate mock, against
route files that properly type `app: Express` the way every real `register*Routes` function does
— an untyped fixture parameter would make `req`/`res` resolve to `any` and silently exercise a
different, unrepresentative code path) to classify correctly:
a direct `fs.readFile` call (expect `fs-hit`); a call to a same-file helper that calls
`writeFile` (expect `fs-hit`, proving the same-file hop); a call to a relative-imported helper two
hops deep that bottoms out in `unlink` (expect `fs-hit`, proving the cross-file hop); `ctx.foo()`
where the `server.ts` call site spells out a nested object literal reaching a real `readdir` call
(expect `fs-hit`); the destructured-alias form `const { helpers } = deps; helpers.foo()` where
`server.ts`'s call site binds `helpers` to a single identifier whose *own* type has a method that
calls `mkdir` (expect `fs-hit`, proving the type-descent hop); `express.static(...)` (expect
`fs-hit`); `res.sendFile(...)` (expect `fs-hit`); a bare call to an unresolvable third-party
function (expect `unresolved`, never `clean`); a `SpreadAssignment` inside the `server.ts` deps
object literal (expect `unresolved` for every property the classifier cannot otherwise prove,
never silently `clean` — this directly guards against defect-catalog item #2, object spreads
bypassing an AST literal projection); a handler with zero fs-relevant calls at all, only known-safe
builtins like `res.json` (expect `clean` — proving `res.json`/`res.send`/other TS-lib and
Express-typed calls are recognized as inspectable-and-safe rather than falling into the generic
"any node_modules declaration is unresolved" rule, which would otherwise misclassify nearly every
handler in the codebase, since nearly every handler calls `res.json` or similar); `requireLocalDaemonRequest`
present as a middleware-array argument (expect `exposure=0`); and the straight-line
`const grant = authorizeToolRequest(...); if (!grant) return;` in-body guard shape (expect
`exposure=1`). A failed probe fails `C9F-1` outright — the classifier is not trusted for a real
verdict in a run where it cannot classify its own known fixtures correctly.

## Risk-ranking rule (mechanical, re-runnable)

Mirrors the ingest tranche's `exposure(0–3) + impact(0–3)` shape, adapted to this tranche's actual
gate vocabulary and to its scale (136 rows, too many to hand-review individually the way the
23-route ingest tranche's reviewer-frozen floor table did — so impact here is **mechanically
derived from the reachable primitive class**, not a hand-authored table; see "Deviation from the
ingest tranche's impact model" below).

**Exposure** — the weakest caller class the route's own middleware/guard accepts, AST-derived,
comment-blind:

- **`0`** — `requireLocalDaemonRequest` appears as a literal argument in the route's own middleware
  list, either as a bare identifier (`app.post(path, requireLocalDaemonRequest, handler)`) or as the
  final member of a property-access chain (`app.post(path, helpers.requireLocalDaemonRequest,
  handler)` — covers the destructured-alias call sites this tranche actually uses). Middleware-array
  membership is unambiguous (Express always invokes every array entry before the handler runs), so
  — unlike a guard called *inside* a handler body — no dominance/reachability grammar is needed here.
- **`1`** — either the same middleware-array check finds `authorizeToolRequest`, **or** the handler's
  own direct body statements begin (after at most one `applyExtensionCors(req, res)`-shaped prelude)
  with the exact straight-line sequence `const grant = authorizeToolRequest(...)` immediately
  followed by a top-level `if (!grant) { <unconditional return/throw> }` — reusing the ingest
  tranche's own straight-line dominance grammar verbatim (a guard inside a branch, loop, callback, or
  after a response write does not count; a discarded result does not count).
- **`3`** — neither of the above. The route relies solely on `server.ts`'s global `/api` origin
  middleware, which — per the ingest tranche's own documented finding — lets any request presenting
  **no `Origin` header** straight through (every non-browser local caller).
- **`2` is reserved and unused in this tranche.** The ingest tranche's exposure-2 tier
  (`bearerToken`/`validateLibraryToken` self-service proof-of-possession, no loopback alternative) is
  a `library.ts`-specific pairing-token pattern that does not generalize to any route in this
  tranche's candidate set (checked directly: no in-scope route imports `bearerToken` or
  `validateLibraryToken`). Documenting the gap explicitly, rather than inventing a fake tier-2 shape
  to fill it, keeps the scale meaningful — a future tranche that *does* find a comparable
  intermediate gate should define its own tier-2 grammar rather than this tranche's classifier
  silently reinterpreting one that was never exercised.

**Impact — mechanically derived from the primitive class reachable in the route's own `fs-hit`
evidence**, not a per-row reviewer floor (see deviation note below):

- **`3`** — a `multer` upload surface (or equivalent caller-supplied-bytes intake) is reachable —
  accepts caller-supplied bytes into daemon-owned or user-owned storage.
- **`2`** — no upload surface, but a WRITE-class primitive is reachable
  (`writeFile`/`appendFile`/`unlink`/`rm`/`rmdir`/`mkdir`/`mkdtemp`/`rename`/`copyFile`/`symlink`/
  `link`/`chmod`/`chown`/`truncate`/`cp`/`createWriteStream`) — mutates or moves daemon-owned bytes
  under caller direction.
- **`1`** — only READ-class primitives are reachable
  (`readFile`/`readdir`/`stat`/`lstat`/`realpath`/`createReadStream`/`existsSync`/`readFileSync`/
  `open`/`opendir`/`watch`/`watchFile`, `res.sendFile`, `res.download`, `express.static`) — returns
  previously-stored bytes back to the caller.
- **`0`** — the `fs-hit` classification came from neither a clear read nor a clear write primitive
  (a narrow fallback; expected to be rare).

`score = exposure + impact` (0–6). `tier`: `5–6 = P0`, `4 = P1`, `0–3 = P2` — identical thresholds to
the ingest tranche, mechanically enforced (`C9F-2`).

**Escalation, never de-escalation.** An implementer who finds a route's real impact worse than the
mechanical class suggests (e.g. a `2`-scored delete route that also fans out to delete files in
*other* projects) may declare a higher `impact` in the matrix row, but only paired with a non-empty
`impactOverrideReason` (≥ 20 characters) explaining why; the verifier asserts `declaredImpact >=
mechanicalImpact` always, and requires the reason field whenever `declaredImpact >
mechanicalImpact`. Declaring a *lower* impact than the mechanical class is never accepted — this is
the same "may raise, never lower" rule the ingest tranche's frozen floors use, adapted to a
mechanically-computed floor instead of a reviewer-frozen one.

### Deviation from the ingest tranche's impact model (stated, not hidden)

The ingest tranche hand-reviewed all 23 routes and froze a reviewer-owned impact floor per row —
tractable at that scale. This tranche's confirmed in-scope set is 136 rows; hand-reviewing each one
for this pre-implementation PRD would either (a) not happen at the fidelity the ingest ceremony
achieved, producing floors that look authoritative but are not, or (b) consume the entire expansion
budget on floor-authoring instead of criteria/verifier machinery. Given that choice, this document
uses a **mechanically-derived** impact class instead, with an explicit, checked escalation path for
the cases where mechanical classification genuinely understates the real risk. This is a deliberate
design change from the sibling tranche, not an oversight, and is called out as its own open founder
question below (should a follow-up pass hand-review and freeze floors for the P0/P1 tier specifically,
the way ingest did for its full set, before this tranche is treated as complete?).

## Frozen route snapshot + drift detection

Mirrors the ingest tranche's S9-1 mechanism, adapted to how this tranche's verifier actually derives
each side of the comparison (not `git show`-based text parsing — that description was itself a stale
holdover from an earlier design and is corrected here as part of the same sweep that fixed "Ground
facts" and "Inclusion rule"):

- The BASE side is derived from a real, detached `git worktree add --detach <worktreeDir> <baseCommit>`
  checkout (never the working tree, never `git show` text parsing), scanned via the TypeScript
  compiler API through the exact same AST walk described in "Inclusion rule" above — all five
  discovery mechanisms, not just literal `app.<method>()` calls. Cross-package named-const path
  literals (mechanism (b)) resolve from that package's own git-tracked `src/*.ts` **inside the
  worktree under scan**, via a `paths` compiler-option override, never through `node_modules`'
  gitignored `dist/*.d.ts` — this is what makes the base side commit-bound (F1 fix, round-1 review;
  see `buildDaemonProgram`'s doc comment in the verifier for the full mechanism).
- That baseCommit-derived set is compared against a **live daemon boot's own `routeInventory`**
  (`startServer({ port: 0, returnServer: true, ... })`, imported from `apps/daemon/src/server.ts` in
  the CURRENT checkout — not the detached worktree, since this side represents live runtime behavior
  — in an isolated `mkdtemp`-created `OD_DATA_DIR`, torn down via the returned `shutdown()` and the
  exact child PID — **never** binding port 7456 or 51012), filtered to the same route-file universe
  (all five discovery mechanisms; there is no separate "6 bootstrap routes" carve-out — bootstrap-scope
  registrations are just one of the five mechanisms' outputs, folded into the same set). A registration
  present in one but not the other is drift and fails `C9F-1`. Before this boot, the verifier forces a
  fresh, workspace-wide rebuild of every first-party `packages/*` member that has its own `build`
  script (`pnpm --filter "./packages/*" run build`, currently all 14 — a strict superset of
  `apps/daemon`'s own dependency closure, widened from the daemon-scoped filter the round-2 fix
  originally shipped, per the round-3 founder ruling's INVARIANT 2/F5) so the live daemon's own
  runtime `import`s of first-party packages — which resolve through ordinary Node module resolution
  to each package's `dist` bundle — are guaranteed freshly derived from tracked source rather than
  possibly-stale or mutated build output (F3 fix, round-2 review, widened round-3; see
  `ensureFirstPartyPackagesRebuiltFromHead`'s doc comment in the verifier). Together, F1 and this
  rebuild mean neither side of this comparison depends on an unpinned mutable artifact.
- Any duplicate `{method, path}` — at `baseCommit`, at `HEAD`, or in the live inventory — is a hard
  fail in its own right (see "Inclusion rule" step 4).
- **HEAD-DRIFT** (a named infra check, not `C9F-1` itself): `git rev-parse HEAD` is captured once at
  verifier start and re-checked at verifier end; if it moved mid-run, the run is invalid regardless
  of what individual criteria reported (mirrors the ingest tranche's `HEAD-DRIFT` check).

## Ownership matrix

Companion machine-readable file (produced by the future implementation, not by this PRD):
`docs/security/filesystem-tranche-attribution.json`. One row per **confirmed in-scope (`fs-hit`)**
route — currently 136 (see "Ground facts"; the verifier re-derives the exact expected count every
run, never a hardcoded literal) — no orphans, no gaps, no duplicates. Each row carries the six
required fields from `VERIFICATION-CONTRACT.md` §6:

```jsonc
{
  "method": "POST",
  "path": "/api/plugins/upload-zip",
  "owner": "…",              // ≥ 12 chars, not stock filler, not a repeated-character string
  "authn": "…",               // must name this row's mechanically-derived exposure class
  "authz": "…",
  "inputValidation": "…",
  "sizeRateLimit": "…",
  "testRef": "apps/daemon/tests/plugins-upload-zip.test.ts :: exact vitest fullName",
  "riskScore": { "exposure": 3, "impact": 3, "score": 6, "tier": "P0" },
  "control": { "mechanism": "…", "testRef": "apps/daemon/tests/plugins-upload-zip.test.ts :: exact vitest fullName" },      // present when exposure === 3, OR
  "acceptedRisk": { "decisionRef": "W9F-ACCEPT-…" },     // present when exposure === 3, mutually exclusive with control
  "impactOverrideReason": "…"                              // present only if declaredImpact > mechanicalImpact
}
```

**`testRef`/`control.testRef` shape, mechanically enforced:** exactly `"<repo-relative test file
path> :: <exact vitest fullName>"` — a literal `` :: `` separator between the file the assertion
lives in and that assertion's own `fullName` as Vitest's own JSON reporter reports it (the
concatenation of every enclosing `describe` title and the assertion's own `it`/`test` title, in
Vitest's own separator convention). The verifier parses on the FIRST `::` occurrence; a citation
with no `::` fails `C9F-5` outright as malformed, not as an implicit "bare name in some
unspecified file." The verifier does not merely check this string is well-formed — per `C9F-5`, it
**executes** the named file with Vitest and requires the exact `fullName` to appear among that
run's own passing assertions; a citation naming a real file and a real-sounding name that Vitest's
own run does not report as `passed` still fails.

**None of the six required fields may be a bare placeholder** — reused verbatim from the ingest
tranche's S9-3 mechanism: a 12-character floor, a denylist of stock filler (`x`, `n/a`, `tbd`,
`none`, `unknown`, …), and a repeated-character check. `authn` must additionally contain a keyword
naming its own row's mechanically-derived exposure class (`requireLocalDaemonRequest`/`loopback`
for exposure 0, `authorizeToolRequest`/"tool token" for 1, `none`/"no gate"/"zero-config" for 3 —
tier 2's keyword set is defined but expected to be unused, per the risk-ranking rule above).

A row with all six fields populated but, for an `exposure === 3` row, neither `control` nor
`acceptedRisk` present, **does not count as attributed** — it is reported as **unattributed**
(a real, visible gap), distinct from **known-vulnerable** (an `exposure === 3` row *with* a verified
`acceptedRisk` on file — a consciously accepted, still-open item) and from **attributed** (fully
resolved). `C9F-3`'s evidence reports all three counts every run, plus the separate **unresolved**
count from the inclusion rule (routes not yet in the matrix at all). Four numbers, never conflated:
*attributed*, *unattributed*, *known-vulnerable*, *unresolved-out-of-tranche*.

`acceptedRisk.decisionRef` must exactly equal a unique `### W9F-ACCEPT-<slug>` heading in
`docs/plans/waves/DECISIONS.md` **as read at `baseCommit`** (never the working tree), whose block
carries `Route`, `Accepted risk`, `Accepter` (distinct from every commit author in
`baseCommit..HEAD`), `Date`, and `Rationale` — identical shape and identical non-self-signing rule
to the ingest tranche's mechanism. **This document proposes zero `acceptedRisk` rows itself** — see
"Open founder questions"; any such row is a matter for the implementer to raise, and for a founder
to sign, during implementation, never for this expansion PRD to pre-decide.

## Threat model

**Mechanical scope for T1–T3 (`C9F-6`), stated as a rule, not left implicit:** the traversal,
symlink, and `baseDir` requirements below apply only to attributed **P0/P1** rows whose own route
`path` contains at least one `:param` segment — a cheap, re-derivable proxy for "this route
resolves a caller-supplied identifier into a filesystem path" (a project id, file name, plugin id,
skill id, or similar). A P0/P1 row reachable at a fully static path has no caller-controlled path
component for a traversal/symlink/`baseDir` spec to exercise, and requiring one anyway would make
that row's criterion **unsatisfiable**, not stronger — the scoping rule exists specifically to keep
every criterion in this document satisfiable by a legitimate implementation, per this tranche's own
self-check obligation.

**How `C9F-6` actually checks all three (stated plainly, not implied):** whether a named assertion
*exists and, when actually executed moments earlier via a real Vitest run, reports `passed`* is a
genuine runtime fact, and that is exactly what `C9F-6` checks — it runs the cited file for real and
requires each attack form's pattern to match a PASSING assertion's own `fullName`. What it does
**not** do is inspect the assertion's *body* to confirm it truly constructs each attack form and
observes a real rejection — that is a name-pattern proxy over a real pass/fail result, the same
class of mechanically-feasible-signal limitation the sibling ingest tranche's own paired-control
check accepts and documents rather than hides. A reviewer reading a matrix row's cited assertions
is still expected to spot-check that the name matches the body, the same way ingest's own residual
notes assume for its paired-control check.

### T1 — Path traversal (encoded / absolute / `..` / null-byte forms)

Every in-scope row (per the scoping rule above) must have a red-then-green spec proving each of:
a literal `../` segment is rejected; a URL-encoded traversal (`%2e%2e%2f`, double-encoded
`%252e%252e%252f`) is rejected; an absolute path (`/etc/passwd`, `C:\Windows\...`-shaped on the
platforms this repo supports) is rejected; a null-byte-embedded segment is rejected.
`apps/daemon/src/projects.ts`'s `isSafeId` (allowlist `/^[A-Za-z0-9._-]+$/`, explicit `.`/`..`/`...`
rejection) is the existing choke point for project ids and is directly citable for any row that
funnels through it; a row that resolves a path a *different* way needs its own equivalent proof,
not a borrowed citation (per the global testRef-uniqueness rule below).

**Satisfiability:** a legitimate implementation either funnels through `isSafeId`/`resolveProjectDir`
(cite the existing coverage) or adds an equivalent allowlist check with its own red-then-green spec;
either way the four forms (`../`, encoded, absolute, null-byte) are provably rejected by distinct,
currently-passing, exactly-named assertions in the cited file, and a same-file positive control (a
normal, legitimate id) still succeeds.
**Decoy:** a shaped fake that only tests the literal string `"../"` and never the encoded, absolute,
or null-byte forms fails this criterion, because the verifier requires each of the four forms to
match a distinct PASSING assertion title from a live run (not merely text present anywhere in the
file, and not a `.skip`/`.todo` assertion, which never reports `passed`).

### T2 — Symlink escape out of allowed roots

Every in-scope row (per the scoping rule above) must have a red-then-green spec proving a symlink
planted *inside* the allowed root but pointing *outside* it (e.g. a project folder containing a
symlink to `/etc`) is rejected before the target bytes are read/written/served — `realpath`-based
resolution (already used in `apps/daemon/src/projects.ts`, `routes/static-resource.ts`,
`import-export-routes.ts`, and others) is the citable existing mechanism; a row using a different
resolution path needs its own proof.

**Satisfiability:** the implementation resolves the final path via `realpath` (or equivalent) before
any fs operation and compares the resolved path's prefix against the resolved allowed root; a
red spec creates a real symlink escaping the root and asserts rejection, with a positive control
(a symlink that stays inside the root, or no symlink at all) still succeeding.
**Decoy:** a shaped fake that checks the *unresolved* path string only (`path.includes('..')`)
without ever calling `realpath` passes a naive string-based reviewer read but fails the red spec,
because the symlink target never appears in the unresolved string at all.

### T3 — Containment in `RUNTIME_DATA_DIR`-derived roots (the `baseDir` exception, precisely)

Every in-scope row (per the scoping rule above) must have its resolved-path prefix checked against
exactly one of: (a) `PROJECTS_DIR` (or another `RUNTIME_DATA_DIR`-derived constant) for a managed
project/artifact, or (b) `metadata.baseDir` for an imported-folder project, **and never silently
either one** — the two must be distinguishable in the row's own evidence. `C9F-6` requires TWO
distinct PASSING assertion titles in the cited file: one whose title contains `baseDir` together
with a word from `{spoof, escape, managed, reject, denied}` (a managed-project request cannot spoof
the imported-folder branch to redirect writes elsewhere), and a **different** one whose title
contains `baseDir` or `imported-folder`/`imported folder` together with a word from `{legitimate,
allow, succeed, control, accept}` (a genuine imported-folder project's legitimate `baseDir` access
still succeeds). This is the "handle the exception precisely" requirement from the task brief — a
containment check that also breaks the sanctioned exception is not a passing check, it is a
different bug, and is caught exactly as reliably as under-containment because both sides are
required as distinct titles, never one title satisfying both patterns at once.

**Satisfiability:** the implementation's containment check branches explicitly on whether the
project metadata legitimately carries an absolute `baseDir` (mirroring
`hasExternalProjectRoot`/`resolveProjectDir`'s existing branch); name one passing assertion
something like `"rejects a spoofed baseDir on a managed project"` and a different one something like
`"control: a genuine imported-folder project's baseDir access still succeeds"`, and both patterns
above are satisfied by construction.
**Decoy:** a shaped fake that hard-codes "always require the resolved path to start with
`PROJECTS_DIR`" breaks every legitimate imported-folder project; its positive-control assertion
would have to report a real rejection to stay passing, so it cannot simultaneously claim success —
over-containment is caught exactly as reliably as under-containment.

### T4 — Size limits on writes

For **every `P0`-tier row that accepts caller-supplied bytes** (impact `3`, i.e. an upload surface
is reachable): `sizeRateLimit` must resolve via the identical anchored grammar the ingest tranche's
C9-6 uses —

```
ENFORCED kind=<request-rate|byte-volume|pair-attempt> scope=<token-hash|origin|pairing-attempt>
  limit=<positive-integer> windowMs=<positive-integer|none> overflow=<reject-429|reject-413>
```

— with `byte-volume` requiring `windowMs=none`, paired with a **same-file, route-associated,
exact-numeric-token-bound** at-limit-accepted / over-limit-rejected control (over-limit asserting the
declared status code exactly — `413` for `overflow=reject-413`), reusing the ingest tranche's
digit-bounded matching rule so `limit=10` cannot be satisfied by a `"...100 request limit"` substring.

**Satisfiability:** a real byte-volume cap (e.g. `express.json({ limit: '…mb' })` scoped to the
route, or a manual `Content-Length`/buffered-size check before the write) paired with an at-limit
positive control and an over-limit `413` negative control, both asserting the exact byte boundary by
name.
**Decoy:** a comment or doc string claiming "uploads are capped" with no enforcing code fails outright
— `VERIFICATION-CONTRACT.md` §3 R5 forbids documentation from closing a live behavioral gap, and this
criterion's grammar match is on the `control.mechanism` field, never on prose describing intent.

### T5 — Loopback / local-request gating (mirrors `requireLocalDaemonRequest`)

For **every row whose mechanically-derived `exposure === 0`**: a real HTTP probe against an isolated
daemon boot (see "Runtime probe discipline" below) must show a request with **no** loopback-qualifying
signal receiving an **exact** `401`/`403` (never merely "non-2xx" — defect-catalog #4), and a
loopback-equivalent request succeeding. This directly re-exercises `requireLocalDaemonRequest`'s own
real behavior rather than trusting its presence in the middleware array as sufficient proof on its
own — the ingest tranche's own exposure-0 tier trusts static presence; this tranche adds the
behavioral confirmation as an explicit criterion (C9F-8) because loopback gating is this tranche's own
named threat class per the task brief, not an incidental byproduct.

**Satisfiability:** `requireLocalDaemonRequest` genuinely rejects the crafted non-loopback request
with the exact expected status and code, and a loopback-origin (or header-absent, matching the
daemon's own documented same-origin/no-`Origin`-header allowance) request succeeds.
**Decoy:** a shaped fake that returns `200` for every request but happens to also satisfy a naive
"non-2xx sometimes" check fails, because the criterion asserts the *exact* status/error code for the
rejection case, not merely "some request got rejected somewhere" (defect-catalog #4 directly).

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w9-filesystem.ts`.

| ID | Criterion | Verification |
|---|---|---|
| C9F-1 | Route snapshot + three-bucket inclusion classification frozen at `baseCommit`, drift-checked against a live daemon boot, duplicate-checked, partition-checked, classifier self-probed | TypeChecker-based AST scan of a real detached `git worktree` checkout at `baseCommit` (never `git show` text parsing, never the working tree) across all five discovery mechanisms in "Inclusion rule" (literal calls, `defineJsonRoute`/`mountJsonRoute`, named-const resolution — cross-package literals resolved from that package's own tracked `src/*.ts` via a `paths` override, never gitignored `dist`, F1 fix — call-site parameter substitution, structural bootstrap-helper recognition); live `routeInventory` comparison via an isolated, real-child-process daemon boot, preceded by a fresh workspace-wide rebuild of every first-party `packages/*` member so the live side also never resolves unpinned mutable `dist` (F3/INVARIANT 2 fix); process-group teardown confirmed empty via a self-visibility control (the scan must see this verifier's own pid) AND a target-visibility positive control (while the daemon is independently confirmed alive via `process.kill(pid,0)`, the scan must show at least one row for the daemon's own process group AND, among those rows specifically, one whose `pid` equals the daemon's own leader pid — a process-group match alone is not sufficient, this is an AND of both conditions — before a later zero-rows result from the same scan mechanism is trusted, INVARIANT 1 fix, tightened for leader-pid fidelity in the round-4 fidelity confirmation); 12/12 inclusion/exposure classifier self-probes pass, plus the process-table-scan and target-visibility self-probes gating teardown confirmation; `fs-hit ∪ unresolved ∪ clean` exactly equals the candidate universe with no overlap |
| C9F-2 | Risk-ranking formula (exposure 0/1/3 + mechanical impact 0–3) enforced exactly per confirmed-in-scope row; exposure-classifier self-probed | AST-derived `exposure` matches the middleware-array + straight-line-guard grammar exactly; `impact` matches the reachable-primitive-class rule (or a declared override with a ≥20-char reason and `declaredImpact > mechanicalImpact`); `score`/`tier` formula-exact; the same 12/12 `C9F-1` self-probes (which cover both classifiers) pass |
| C9F-3 | Attribution matrix exists, covers exactly the confirmed in-scope (`fs-hit`) set, structurally well-formed | `docs/security/filesystem-tranche-attribution.json` parses; exactly one row per `fs-hit` route (mechanically re-derived count, never hardcoded), no orphans/gaps/duplicates; attributed/unattributed/known-vulnerable/unresolved-out-of-tranche counts reported |
| C9F-4 | Every matrix row fully, structurally attributed | All six required fields clear the floor/denylist/repetition checks; `authn` names the row's own exposure class; `acceptedRisk.decisionRef` resolves to a unique, fully-structured, route-bound, non-self-accepted `### W9F-ACCEPT-*` entry in `DECISIONS.md@baseCommit`; `control`/`acceptedRisk` mutually exclusive and required exactly when `exposure === 3` |
| C9F-5 | Every `testRef`/`control.testRef` real, currently-passing, globally-unique-per-route, route-associated; new citations independently replayed | Exact `fullName` equality against a live Vitest run of the cited file; one global citation map spans every row's `testRef` AND `control.testRef` (reuse across two routes fails both); a path-derived association term must appear; "new" decided by AST-derived historical-title match at `baseCommit`; a genuinely new citation requires an isolated detached-worktree replay (frozen offline install, HEAD-file overlay, Vitest's own Node API through a verifier-generated runner script + CSPRNG marker — never the JSON reporter, matching the ingest tranche's own fix for the reporter's nested-suite blind spot) showing exactly one failed leaf matching the target and a named control test passing |
| C9F-6 | Containment threat class (T1 path traversal + T2 symlink escape + T3 `RUNTIME_DATA_DIR`/`baseDir` containment) | For every P0/P1 row whose `path` carries a `:param` segment: the cited file is EXECUTED via a live Vitest run, and its own REAL PASSING assertion titles (never raw file text) must include distinct matches for `../`, encoded-`../`, absolute-path, and null-byte forms (T1); a symlink-escape match (T2); and a distinct baseDir-spoof-rejected / baseDir-legitimate-accepted pair (T3) — a name-pattern proxy over a real, currently-passing run, not semantic body verification (stated explicitly, not implied) |
| C9F-7 | Size-limit threat class (T4) | For every `P0`-tier row with mechanical `impact === 3`: `control.mechanism` matches the anchored `ENFORCED` grammar exactly; the cited file is EXECUTED via a live Vitest run, and its REAL PASSING assertion titles must include a distinct at-limit-accepted title and a distinct over-limit-rejected title, each digit-bounded to the declared `limit` and `overflow` status — or a verified `acceptedRisk` |
| C9F-8 | Loopback-gating threat class (T5) | For every mechanically `exposure === 0` row: a real HTTP probe against an isolated daemon (redirect `manual`, fail-closed URL validation, refuses non-loopback targets and ports 7456/51012) shows an exact 401/403 for a non-loopback-shaped request and success for a loopback-equivalent request |
| C9F-9 | Gates | `pnpm guard` and `pnpm typecheck` exit 0 on the current tree |
| C9F-10 | Adversarial review of the **implementation** on record, non-spoofable | `docs/security/filesystem-tranche-implementation-review.json`: `reviewedCommit` resolves and is a STRICT ancestor of `HEAD`; the owned-path diff between `reviewedCommit` and `HEAD` is empty; `reviewer` distinct from every commit author in `baseCommit..reviewedCommit`; `verdict === "APPROVE"` |

Plus the three named infra checks, identical in spirit to the ingest tranche's: **GATE-INTEGRITY**
(advisory self-hash pin against `~/.claude/goal-state/mishmash-w9-filesystem-tranche/approved-gate.sha256`,
binding to the orchestrator-held approved copy of this PRD + verifier; its absence is reported as a
top-level `manifest.gateIntegrityPinned` field, never buried in prose), **LEASE** (`git diff
--name-only <baseCommit>...HEAD` ⊆ this tranche's `leases.json@baseCommit` allow-globs, once a
maintainer has amended `leases.json` to add them — read via `git show`, never the working tree —
and always excluding the deny list below), **HEAD-DRIFT** (`HEAD` must not move mid-run).

Every criterion ID above (10 numbered + 3 named = 13) must appear in the proof manifest with a
`pass`/`fail` status; a missing ID is `fail`, never an implicit pass (`VERIFICATION-CONTRACT.md` §2
rule 1).

## Runtime probe discipline

C9F-1's live-daemon comparison and C9F-8's loopback-gating probes are the only two criteria that
start a real daemon process. Both boot it as a genuine **child process**, never in-process inside
the verifier itself — an in-process `import()` + same-process function-call "shutdown" would be
bounding the risk from outside (remember to reset state, trust a resolved promise) rather than
making it structurally impossible, and gives no real process to confirm dead. Concretely:

- The daemon boots as a `spawn(..., { detached: true })` child with its own process group (pgid
  equals its own pid on POSIX). It receives `OD_DATA_DIR` (a fresh `mkdtemp` directory) and
  `OD_BIND_HOST=127.0.0.1` only through that child's own `env` object — a fresh shallow copy of
  `process.env`, never an assignment to the verifier's own `process.env` — so nothing spawned later
  in the same verifier run (`pnpm guard`, `git`, worktree installs, further daemon boots) can ever
  inherit a stray value from an isolated daemon boot.
- Binds to `port: 0` (OS-assigned) — **never** the default namespace, **never** ports 7456 or 51012
  (pids 16481/16729 — untouched by this verifier, always); a resolved port of `0` or a forbidden
  port is a hard failure that still runs the teardown routine below before throwing.
- **Teardown fails closed and is independently confirmed, not merely awaited.** Shutdown signals
  the whole process **group** (`process.kill(-pid, 'SIGTERM')`), polls for real exit, escalates to
  `SIGKILL` if the group has not exited within a bounded timeout, and then — because a leader's own
  `exit` event is not proof the whole group exited — **re-scans the live system process table**
  (`ps -Ao pid=,pgid=,comm=`) for any surviving member of that process group. Only when that
  independent scan confirms zero survivors does teardown report `ok: true`. A failed or partial
  teardown returns `ok: false`, and every call site treats that as a **criterion failure**, folded
  into the criterion's own recorded verdict before `record()` runs — never logged after the fact
  where it can no longer change the outcome, and never silently swallowed via a bare
  `.catch(() => {})`.
- Any probe `fetch()` uses `redirect: 'manual'` and fail-closed URL validation: parse the target,
  resolve it, and refuse anything that is not a loopback address, and separately refuse ports 7456
  and 51012 even if they were somehow loopback-resolved (defect-catalog #10, verbatim).
- A probe that cannot start the daemon (port bind failure, install/build issue, ready-marker
  timeout) is an **evidence failure** for that criterion, distinguished from a genuine
  rejected-request result — never conflated with a real 4xx (defect-catalog #4's spirit, applied to
  probe infrastructure itself, not only to the HTTP assertions). Because the daemon under probe is
  itself fully isolated (its own process, its own `OD_DATA_DIR`, its own ephemeral port), even a
  request that unexpectedly succeeds against it cannot reach production data — the safety property
  holds by construction, not merely because the probes are written to expect rejection.

## Proposed lease

**Not yet written to `leases.json`.** This section is PRD text describing what a maintainer should
add once this document and its verifier are frozen and reviewed. Route files listed under `allow`
are the files containing at least one `fs-hit`-classified registration in this run (`C9F-1`'s own
evidence file is the re-derivable source of truth if this list drifts from a future baseline — this
document's list is a snapshot, not the mechanism).

```jsonc
"W9-filesystem": {
  "slug": "mishmash-w9-filesystem-tranche",
  "allow": [
    "apps/daemon/src/brand-routes.ts",
    "apps/daemon/src/connectors/routes.ts",
    "apps/daemon/src/import-export-routes.ts",
    "apps/daemon/src/mcp-routes.ts",
    "apps/daemon/src/routes/automation.ts",
    "apps/daemon/src/routes/daemon.ts",
    "apps/daemon/src/routes/design-system-tool.ts",
    "apps/daemon/src/routes/design-systems.ts",
    "apps/daemon/src/routes/genui.ts",
    "apps/daemon/src/routes/media.ts",
    "apps/daemon/src/routes/memory.ts",
    "apps/daemon/src/routes/plugins/assets.ts",
    "apps/daemon/src/routes/plugins/index.ts",
    "apps/daemon/src/routes/project/index.ts",
    "apps/daemon/src/routes/routine.ts",
    "apps/daemon/src/routes/runs.ts",
    "apps/daemon/src/routes/static-resource.ts",
    "apps/daemon/src/routes/vela.ts",
    "apps/daemon/src/routes/whats-new.ts",
    "apps/daemon/src/routes/xai.ts",
    "apps/daemon/src/server.ts",
    "apps/daemon/tests/**",
    "docs/security/**",
    "docs/plans/waves/DECISIONS.md"
  ],
  "deny": [
    "apps/daemon/src/routes/library.ts",
    "apps/daemon/src/library-store.ts",
    "apps/daemon/src/backup/**",
    "docs/plans/waves/W9-filesystem-tranche.md",
    "scripts/waves/verify-w9-filesystem.ts"
  ],
  "note": "Route-file allow-list is the snapshot of fs-hit-containing files from this PRD's own verified baseline run; re-verify against a fresh C9F-1 run before implementation starts, since drift in the underlying route files could change which files actually need edits. apps/daemon/src/server.ts is shared with W1 (server.ts, Burst 2) and W4 (server.ts, Burst 3) per leases.json's existing notes -- this tranche must serialize behind whichever of those lands first, exactly as W4 already serializes behind W1. HOUSE RULE: this tranche's own PRD and verifier are in the deny list -- the implementation may not edit the frozen brief or the gate that checks it."
}
```

**House rule, restated:** this PRD (`docs/plans/waves/W9-filesystem-tranche.md`) and its verifier
(`scripts/waves/verify-w9-filesystem.ts`) are in the **deny** list of their own proposed lease. An
implementation branch that edits either file — even to "fix a bug in the gate" — fails LEASE by
construction. A genuine defect in this document or its verifier is a founder-escalated PRD
amendment, not an implementation-branch patch.

**GATE-INTEGRITY**, restated for this tranche: once an orchestrator holds an approved copy of this
PRD and verifier and records `~/.claude/goal-state/mishmash-w9-filesystem-tranche/approved-gate.sha256`,
`manifest.gateIntegrityPinned` reports whether that pin exists. Its absence does not by itself fail
the run (route-snapshot integrity is independently anchored to `baseCommit` regardless of pin
timing, exactly as the ingest tranche's own GATE-INTEGRITY note explains), but a consumer of this
tranche's manifest (a future `W3`-style dependent, if one is ever gated on this tranche) must treat
an unpinned run as needing the orchestrator's own external approval receipt before trusting it.

## Red specs + positive controls

Every threat-class criterion (C9F-6, C9F-7, C9F-8) requires a **red-then-green** pair on the parent
SHA (`VERIFICATION-CONTRACT.md` §3 R1) for any *newly written* test, and a **paired positive
control** for every rejection (§3 R4) — reusing the ingest tranche's own citation-uniqueness,
historical-title, and replay machinery (C9F-5) rather than inventing a second one. Pre-existing
coverage (`plugins-uninstall-traversal.test.ts` and the other files named in "Ground facts") may be
cited directly without a fresh replay, exactly as the ingest tranche's S9-3 allows — but the paired
positive/negative-control requirement still applies to every citation, new or old, per C9F-5.

No criterion in this document is shaped as "we hardened everything." Every criterion here asserts
what is attributed, what the mechanical rule proves, and that the remainder (`unresolved` routes,
`unattributed` P0/P1 rows, any `known-vulnerable` accepted-risk row) stays visible and counted.

## Explicitly out of scope

- `apps/daemon/src/routes/library.ts` and everything under `mishmash-w9-ingest-tranche`'s own
  lease — a fully disjoint, already-frozen sibling.
- `apps/daemon/src/backup/**` — W0's surface, referenced only for the exclusion rule above, never
  edited here.
- The other four rolling W9 tranches (agent spawn, deploy/BYOK, external fetch, imports/long tail) —
  they stay in rolling W9 per `W5-W11-gated.md`.
- The **189 UNRESOLVED registrations** from this run's classification. They are visible, counted,
  and re-derived every run, but this document does not fold them into this tranche's matrix (see
  "Open founder questions").
- AI enrichment, embeddings, semantic search, bookmark import (W5) — untouched, no route in this
  tranche's confirmed-in-scope set overlaps that surface.
- Anything `LIBRARY_UI_VISIBLE` gates for end users (W3's problem).

## Open founder questions (enumerated)

**Item 0 was a blocking verifier defect, not a policy question — RESOLVED in a subsequent authorized
verifier-fix round; the paragraph below is preserved as history, unedited.** `C9F-1`'s live-daemon
drift check used to fail against `main` with 17 confirmed real drift entries, closed by the
universe-discovery expansion recorded in "Known limitation of the mechanical UNIVERSE DISCOVERY" →
"Update (authorized verifier-fix round, discovery gap closed)" above — re-running `C9F-1` now shows
0 drift entries, reproduced across repeated runs, with the drift comparison itself untouched (no
allowlist, exemption, or tolerance threshold). Original paragraph, as first recorded:

> `C9F-1`'s live-daemon drift check currently
fails against `main` with 17 confirmed real drift entries (see "Known limitation of the mechanical
UNIVERSE DISCOVERY" above) — a `register*Routes` function reachable only through another
`register*Routes` function in a different file (`registerProjectConversationRoutes`, 8 routes), a
declarative `defineJsonRoute`/`mountJsonRoute` registration abstraction this AST scan does not yet
recognize, and a `const`-bound path-argument identifier the scan does not yet resolve. This is not
a hypothetical edge case awaiting a founder ruling — it is a concrete engineering gap in the
inclusion rule's universe discovery, found by running this verifier against the real tree, and it
needs a fix round (recursive `register*Routes` discovery, `defineJsonRoute`/`mountJsonRoute`
recognition, same-file `const`-path resolution) before `C9F-1` — and therefore this whole
tranche — can ever reach clean, regardless of what the implementation itself does. Recorded here
because it was found late in this expansion's own self-check and time did not allow fixing it in
this round; an adversarial reviewer should treat it as a required revision, not an optional
follow-up.

1. **The UNRESOLVED bucket.** Should a follow-up pass (either inside this tranche, before
   it is treated as "complete," or as its own micro-tranche) manually triage the UNRESOLVED bucket
   into confirmed-in-scope / confirmed-clean, or is a standing, re-derived, visible "not yet
   classified" list an acceptable permanent state for this wave program? The mechanical classifier's
   own bound (same-file + relative-import + one hop of type-based property descent through the
   `server.ts` deps object literal, depth ≤ 10) is real but not complete — a founder call on whether
   deeper resolution (e.g. full `this`-dispatch tracing) is worth commissioning before this tranche
   freezes as done.
2. **The 33-vs-35 route-file-count discrepancy — RESOLVED, no longer an open question.** As
   originally posed this asked whether the parent wave's aggregate total should be trusted over this
   tranche's own re-derivation. That framing was itself an artifact of the single-hop
   (non-transitive) discovery bug fixed in "Update (authorized verifier-fix round, discovery gap
   closed)": this tranche's own mechanical re-derivation now finds **35 route files**, matching
   `W5-W11-gated.md`'s stated total exactly (see "Ground facts" and "Inclusion rule"). There is no
   remaining discrepancy to spot-check once the other five rolling W9 tranches land — this document's
   own count was undercounting due to a bug, not measuring a genuinely different scope, and both
   figures already agree.
3. **Mechanical-vs-reviewer-frozen impact model.** This tranche uses a mechanically-derived impact
   class (read/write/upload primitive tier) instead of the ingest tranche's reviewer-hand-frozen
   floor table, because of scale (136 rows vs. 23). Should the P0/P1 tier specifically (the rows that
   matter most) get a follow-up hand review pass, freezing floors the way ingest did, before this
   tranche is declared complete — or is the mechanical class plus the checked escalation path
   sufficient for this tranche's own risk appetite?
4. **`server.ts` lease contention.** `server.ts` carries at least two `fs-hit` bootstrap routes
   (`DIAGNOSTICS_EXPORT_PATH`, `figma/import`) that belong in this tranche's matrix, but
   `leases.json` already grants `server.ts` to W1 (Burst 2, owns it outright) and to W4 (Burst 3, via
   an amend-on-proof clause). A founder/maintainer ruling is needed on ordering: does this tranche's
   `server.ts` edit (adding guard/size-limit code to exactly those two routes, not touching W1's or
   W4's surfaces) execute *inside* W1's lease the way W2's one-line `EntryShell.tsx` fix does
   (tagged, landed under the other wave's lease, graded by this tranche's own verifier reading the
   landed tree), or does it wait until both W1 and W4 have released the file?
5. **`acceptedRisk` rows.** This document proposes **zero** `acceptedRisk` rows — every P0/P1 row
   this run's baseline can see is either genuinely fixable within this tranche's lease or is not yet
   classified (`unresolved`, not yet a matrix row at all). If implementation surfaces a P0/P1 row
   that cannot be closed within this tranche's lease (e.g. it requires a change to a file this
   tranche does not own), that is a **founder decision to make during implementation**, recorded in
   `DECISIONS.md` under a `### W9F-ACCEPT-<slug>` heading with a named accepter distinct from the
   implementing agent — never a row this expansion PRD self-signs in advance.
6. **Exposure tier 2, reserved-and-unused.** Confirmed empty in this run (no in-scope route uses a
   `bearerToken`/`validateLibraryToken`-shaped self-service gate). If a future route in this
   tranche's file set adds one, should it reuse library.ts's exact grammar, or does this tranche need
   its own tier-2 definition? Left open rather than guessed.
