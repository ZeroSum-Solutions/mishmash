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

- **Route-file universe:** parsing `server.ts` for `import { register\w*Routes } from '<relative>'`
  finds **33 route files**, contributing **40 distinct `register*Routes`-named function bodies**
  (several files export more than one — `import-export-routes.ts` exports three,
  `routes/project/index.ts` four, `routes/plugins/index.ts` three, `routes/deploy.ts` two). This is
  close to, but not identical to, the parent wave's "35 route files" figure — per `GLOBAL-GOAL.md`
  rule 6 ("numbers in planning documents are hypotheses"), this document's own mechanically
  re-derived count is authoritative for *this tranche's* scope; the discrepancy is flagged as an
  open founder question below rather than silently reconciled.
- **`apps/daemon/src/routes/library.ts` is excluded in full** (23 registrations) — owned by the
  concurrently-landing sibling tranche. Any registration physically inside that file is out of
  scope here regardless of what it does.
- **Backup routes are excluded** — `POST /api/backup`/`POST /api/restore` are registered from
  inside `library.ts` via `registerBackupRoutes(...)` (owned by `apps/daemon/src/backup/routes.ts`,
  W0's surface) and are therefore already excluded by the `library.ts`-file exclusion above; no
  separate carve-out is needed.
- **Candidate universe for this tranche: 311 registrations** from the 32 remaining route files,
  **plus 6 bootstrap `app.<method>()` calls registered directly in `server.ts`** outside any
  `register*Routes` function (`GET /api/health`, `GET /api/ready`, `GET /api/version`,
  `GET /api/preview/isolation`, `GET <DIAGNOSTICS_EXPORT_PATH>`, `POST
  /api/projects/:id/figma/import`) — **317 total candidate registrations**.
- **Inclusion classification of the 311 (this run):**
  - **125 CONFIRMED IN-SCOPE** (`fs-hit` — a caller-reachable filesystem primitive, `express.static`,
    `res.sendFile`/`res.download`, or a `multer` upload surface is reachable from the handler).
  - **184 UNRESOLVED** (the classifier's bounded call-graph walk terminates in something it cannot
    inspect — a third-party/`node_modules` call, a class-instance dispatch through `this`, or any
    other declaration with no in-repo function body — see "Known limitation" below).
  - **2 CONFIRMED CLEAN** (`terminal.ts`'s `POST /api/projects/:id/terminals/:tid/kill` and `DELETE
    /api/projects/:id/terminals/:tid` — process-management only, no reachable fs primitive and
    nothing unresolved anywhere in their call graph).
- Of the 6 bootstrap routes, a first-pass read shows `GET <DIAGNOSTICS_EXPORT_PATH>` (reads daemon
  logs/host metadata/crash reports, `requireLocalDaemonRequest`-gated) and `POST
  /api/projects/:id/figma/import` (accepts a `multer` upload, resolves the project directory via
  `resolveProjectDir`, writes into it) as unambiguous `fs-hit`s; `/api/health`, `/api/ready`, and
  `/api/version` all call `readCurrentAppVersionInfo()`, which the verifier classifies mechanically
  rather than this document asserting it by eye; `/api/preview/isolation` returns only in-memory
  host info. **The verifier's own run is the source of truth for the final split, not this
  paragraph.**
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

**UNRESOLVED is not automatically in-scope for this tranche's matrix.** Folding all 184 unresolved
registrations into this one tranche would erase the wave's own threat-boundary partition (agent
spawn / filesystem / deploy / external-fetch / imports / long tail would stop being distinct). Instead:
UNRESOLVED is reported every run as an explicit, visible, counted third bucket (`C9F-1`'s own
evidence file lists every one of the 184 by `{method, path, file}`), separate from both the
attribution matrix (scoped to the 125 confirmed) and from "excluded" — it is a standing, mechanically
re-derived punch list. See "Open founder questions" for the resulting decision this document does
not make unilaterally.

## Inclusion rule (mechanical, re-runnable)

Stated precisely so a future run reproduces the same set without human judgment at classification
time (judgment is still needed to decide policy on the UNRESOLVED bucket — that is a founder
question, not a classifier defect):

1. **Universe.** Parse `apps/daemon/src/server.ts` (at the commit under test). Collect every
   `import { X } from '<relative path>'` where `X` matches `/^register\w*Routes$/`. Resolve each
   relative specifier to its `.ts` file (`.js`-suffixed specifiers, `NodeNext`-style, resolve to the
   sibling `.ts`; a bare directory specifier resolves to that directory's `index.ts`). This is the
   **route-file universe**.
2. **Registrations.** In each route file, AST-walk (via `ts.forEachChild`, comment-blind — a
   matching identifier inside a `//` or `/* */` comment can never leak in) every top-level function
   whose name matches `/^register\w*Routes$/` (function declaration or `const X = (...) => {...}`
   form), and collect every `app.<get|post|put|delete|patch|options>(pathLiteral, ...middleware,
   handler)` call inside it. Do the same for `server.ts` itself, restricted to `app.<method>(...)`
   calls that are **not** inside any `register*Routes` function body (the 6 bootstrap routes).
3. **Hard exclusions.** Drop every registration whose containing file is
   `apps/daemon/src/routes/library.ts` (owned by `mishmash-w9-ingest-tranche`; this tranche's
   proposed lease denies that path explicitly, so the exclusion is enforced twice — once by this
   rule, once by the lease boundary). No other file is hard-excluded; a route otherwise reachable
   through a different file is in-scope even if it delegates to library-owned code (it does not — no
   in-scope route imports from `library.ts` today, checked directly).
4. **Duplicate check.** Any `{method, path}` key appearing more than once — at `baseCommit`, at
   `HEAD`, or in a live daemon's own runtime `routeInventory` — is a hard fail on its own, never a
   silent last-registration-wins pick (mirrors the ingest tranche's S9-1).
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

**Self-probes.** `C9F-1` additionally requires 10 fixture probes (run through the *exact same*
`classifyRegistration` function the real routes use, never a separate mock) to classify correctly:
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
bypassing an AST literal projection); and a handler with zero calls at all (expect `clean`). A
failed probe fails `C9F-1` outright — the classifier is not trusted for a real verdict in a run
where it cannot classify its own known fixtures correctly.

## Risk-ranking rule (mechanical, re-runnable)

Mirrors the ingest tranche's `exposure(0–3) + impact(0–3)` shape, adapted to this tranche's actual
gate vocabulary and to its scale (125 rows, too many to hand-review individually the way the
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
tractable at that scale. This tranche's confirmed in-scope set is 125 rows; hand-reviewing each one
for this pre-implementation PRD would either (a) not happen at the fidelity the ingest ceremony
achieved, producing floors that look authoritative but are not, or (b) consume the entire expansion
budget on floor-authoring instead of criteria/verifier machinery. Given that choice, this document
uses a **mechanically-derived** impact class instead, with an explicit, checked escalation path for
the cases where mechanical classification genuinely understates the real risk. This is a deliberate
design change from the sibling tranche, not an oversight, and is called out as its own open founder
question below (should a follow-up pass hand-review and freeze floors for the P0/P1 tier specifically,
the way ingest did for its full set, before this tranche is treated as complete?).

## Frozen route snapshot + drift detection

Mirrors the ingest tranche's S9-1 mechanism exactly:

- The snapshot is derived by parsing `git show <baseCommit>:apps/daemon/src/server.ts` and
  `git show <baseCommit>:<each route file>` — never the working tree — through the same AST scan
  described above.
- That baseCommit-derived set is compared against a **live daemon boot's own `routeInventory`**
  (`startServer({ port: 0, returnServer: true, ... })`, imported from `apps/daemon/src/server.ts`,
  in an isolated `mkdtemp`-created `OD_DATA_DIR`, torn down via the returned `shutdown()` and the
  exact child PID — **never** binding port 7456 or 51012), filtered to the same route-file universe
  plus the 6 bootstrap routes. A registration present in one but not the other is drift and fails
  `C9F-1`.
- Any duplicate `{method, path}` — at `baseCommit`, at `HEAD`, or in the live inventory — is a hard
  fail in its own right (see "Inclusion rule" step 4).
- **HEAD-DRIFT** (a named infra check, not `C9F-1` itself): `git rev-parse HEAD` is captured once at
  verifier start and re-checked at verifier end; if it moved mid-run, the run is invalid regardless
  of what individual criteria reported (mirrors the ingest tranche's `HEAD-DRIFT` check).

## Ownership matrix

Companion machine-readable file (produced by the future implementation, not by this PRD):
`docs/security/filesystem-tranche-attribution.json`. One row per **confirmed in-scope (`fs-hit`)**
route — currently 125 (see "Ground facts"; the verifier re-derives the exact expected count every
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
  "testRef": "exact vitest fullName",
  "riskScore": { "exposure": 3, "impact": 3, "score": 6, "tier": "P0" },
  "control": { "mechanism": "…", "testRef": "…" },      // present when exposure === 3, OR
  "acceptedRisk": { "decisionRef": "W9F-ACCEPT-…" },     // present when exposure === 3, mutually exclusive with control
  "impactOverrideReason": "…"                              // present only if declaredImpact > mechanicalImpact
}
```

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

### T1 — Path traversal (encoded / absolute / `..` forms)

Every attributed row whose handler resolves a caller-supplied path segment (a project id, file
name, folder path, plugin id, skill id, or similar) into a filesystem path must have a red-then-green
spec proving each of: a literal `../` segment is rejected; a URL-encoded traversal (`%2e%2e%2f`,
double-encoded `%252e%252e%252f`) is rejected; an absolute path (`/etc/passwd`,
`C:\Windows\...`-shaped on the platforms this repo supports) is rejected; a null-byte-embedded
segment is rejected. `apps/daemon/src/projects.ts`'s `isSafeId` (allowlist `/^[A-Za-z0-9._-]+$/`,
explicit `.`/`..`/`...` rejection) is the existing choke point for project ids and is directly
citable for any row that funnels through it; a row that resolves a path a *different* way needs its
own equivalent proof, not a borrowed citation (per the global testRef-uniqueness rule below).

**Satisfiability:** a legitimate implementation either funnels through `isSafeId`/`resolveProjectDir`
(cite the existing coverage) or adds an equivalent allowlist check with its own red-then-green spec;
either way the four forms above are provably rejected and a same-file positive control (a normal,
legitimate id) still succeeds.
**Decoy:** a shaped fake that only tests the literal string `"../"` and never the encoded or
absolute forms passes a naive grep-based check but fails this criterion, because the verifier
requires all four forms to appear as distinct, named assertions (not one parametrized test whose
name only mentions one form — see C9F-6's exact assertion-count requirement below).

### T2 — Symlink escape out of allowed roots

Every attributed row that reads, writes, or serves bytes at a caller-influenced path must have a
red-then-green spec proving a symlink planted *inside* the allowed root but pointing *outside* it
(e.g. a project folder containing a symlink to `/etc`) is rejected before the target bytes are
read/written/served — `realpath`-based resolution (already used in
`apps/daemon/src/projects.ts`, `routes/static-resource.ts`, `import-export-routes.ts`, and others)
is the citable existing mechanism; a row using a different resolution path needs its own proof.

**Satisfiability:** the implementation resolves the final path via `realpath` (or equivalent) before
any fs operation and compares the resolved path's prefix against the resolved allowed root; a
red spec creates a real symlink escaping the root and asserts rejection, with a positive control
(a symlink that stays inside the root, or no symlink at all) still succeeding.
**Decoy:** a shaped fake that checks the *unresolved* path string only (`path.includes('..')`)
without ever calling `realpath` passes a naive string-based reviewer read but fails the red spec,
because the symlink target never appears in the unresolved string at all.

### T3 — Containment in `RUNTIME_DATA_DIR`-derived roots (the `baseDir` exception, precisely)

Every attributed row must have its resolved-path prefix checked against exactly one of: (a)
`PROJECTS_DIR` (or another `RUNTIME_DATA_DIR`-derived constant) for a managed project/artifact, or
(b) `metadata.baseDir` for an imported-folder project, **and never silently either one** — the two
must be distinguishable in the row's own evidence. A red spec proves a managed-project request
cannot escape `PROJECTS_DIR` via a crafted `baseDir`-shaped metadata payload it does not actually
own (i.e., a managed project cannot spoof the imported-folder branch to redirect writes elsewhere);
a **paired positive control** proves a genuine imported-folder project's legitimate `baseDir` access
still succeeds (this is the "handle the exception precisely" requirement from the task brief — a
containment check that also breaks the sanctioned exception is not a passing check, it is a
different bug).

**Satisfiability:** the implementation's containment check branches explicitly on whether the
project metadata legitimately carries an absolute `baseDir` (mirroring
`hasExternalProjectRoot`/`resolveProjectDir`'s existing branch), and both the negative (spoofed
`baseDir` on a managed project) and positive (real imported-folder access) specs pass.
**Decoy:** a shaped fake that hard-codes "always require the resolved path to start with
`PROJECTS_DIR`" breaks every legitimate imported-folder project and fails the required positive
control outright — over-containment is caught exactly as reliably as under-containment.

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
| C9F-1 | Route snapshot + three-bucket inclusion classification frozen at `baseCommit`, drift-checked against a live daemon boot, duplicate-checked, partition-checked, classifier self-probed | AST scan of `git show <baseCommit>:...` scoped to `register*Routes` bodies + `server.ts` bootstrap calls; live `routeInventory` comparison via an isolated `startServer({port:0})`; 10/10 self-probes pass; `fs-hit ∪ unresolved ∪ clean` exactly equals the candidate universe with no overlap |
| C9F-2 | Risk-ranking formula (exposure 0/1/3 + mechanical impact 0–3) enforced exactly per confirmed-in-scope row; exposure-classifier self-probed | AST-derived `exposure` matches the middleware-array + straight-line-guard grammar exactly; `impact` matches the reachable-primitive-class rule (or a declared override with a ≥20-char reason and `declaredImpact > mechanicalImpact`); `score`/`tier` formula-exact; 6+ self-probes (one per exposure tier shape, incl. the reserved-tier-2 no-op case) pass |
| C9F-3 | Attribution matrix exists, covers exactly the confirmed in-scope (`fs-hit`) set, structurally well-formed | `docs/security/filesystem-tranche-attribution.json` parses; exactly one row per `fs-hit` route (mechanically re-derived count, never hardcoded), no orphans/gaps/duplicates; attributed/unattributed/known-vulnerable/unresolved-out-of-tranche counts reported |
| C9F-4 | Every matrix row fully, structurally attributed | All six required fields clear the floor/denylist/repetition checks; `authn` names the row's own exposure class; `acceptedRisk.decisionRef` resolves to a unique, fully-structured, route-bound, non-self-accepted `### W9F-ACCEPT-*` entry in `DECISIONS.md@baseCommit`; `control`/`acceptedRisk` mutually exclusive and required exactly when `exposure === 3` |
| C9F-5 | Every `testRef`/`control.testRef` real, currently-passing, globally-unique-per-route, route-associated; new citations independently replayed | Exact `fullName` equality against a live Vitest run of the cited file; one global citation map spans every row's `testRef` AND `control.testRef` (reuse across two routes fails both); a path-derived association term must appear; "new" decided by AST-derived historical-title match at `baseCommit`; a genuinely new citation requires an isolated detached-worktree replay (frozen offline install, HEAD-file overlay, Vitest's own Node API through a verifier-generated runner script + CSPRNG marker — never the JSON reporter, matching the ingest tranche's own fix for the reporter's nested-suite blind spot) showing exactly one failed leaf matching the target and a named control test passing |
| C9F-6 | Containment threat class (T1 path traversal + T2 symlink escape + T3 `RUNTIME_DATA_DIR`/`baseDir` containment) | For every attributed row touching a caller-influenced path: named assertions for `../`, encoded-`../`, absolute-path, and null-byte forms (T1); a real-symlink-escape red spec with a same-root positive control (T2); a spoofed-`baseDir`-on-managed-project red spec paired with a genuine-imported-folder positive control (T3) — all as exact, named, currently-passing assertions in the row's cited test file(s) |
| C9F-7 | Size-limit threat class (T4) | For every `P0`-tier row with mechanical `impact === 3`: `control.mechanism` matches the anchored `ENFORCED` grammar exactly; paired at-limit-accepted / over-limit-rejected assertions, digit-bounded to the declared `limit` and `overflow` status, in the same cited file — or a verified `acceptedRisk` |
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
start a real daemon process. Both:

- Bind to `port: 0` (OS-assigned) and pass a fresh `mkdtemp`-created directory as `OD_DATA_DIR` —
  **never** the default namespace, **never** ports 7456 or 51012 (pids 16481/16729 — untouched by
  this verifier, always).
- Tear down via the daemon's own returned `shutdown()` **and** an exact-PID kill check (never a
  broad process-name match).
- Any probe `fetch()` uses `redirect: 'manual'` and fail-closed URL validation: parse the target,
  resolve it, and refuse anything that is not a loopback address, and separately refuse ports 7456
  and 51012 even if they were somehow loopback-resolved (defect-catalog #10, verbatim).
- A probe that cannot start the daemon (port bind failure, install/build issue) is an **evidence
  failure** for that criterion, distinguished from a genuine rejected-request result — never
  conflated with a real 4xx (defect-catalog #4's spirit, applied to probe infrastructure itself, not
  only to the HTTP assertions).

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
- The **184 UNRESOLVED registrations** from this run's classification. They are visible, counted,
  and re-derived every run, but this document does not fold them into this tranche's matrix (see
  "Open founder questions").
- AI enrichment, embeddings, semantic search, bookmark import (W5) — untouched, no route in this
  tranche's confirmed-in-scope set overlaps that surface.
- Anything `LIBRARY_UI_VISIBLE` gates for end users (W3's problem).

## Open founder questions (enumerated; none block landing this PRD)

1. **The 184-route UNRESOLVED bucket.** Should a follow-up pass (either inside this tranche, before
   it is treated as "complete," or as its own micro-tranche) manually triage the UNRESOLVED bucket
   into confirmed-in-scope / confirmed-clean, or is a standing, re-derived, visible "not yet
   classified" list an acceptable permanent state for this wave program? The mechanical classifier's
   own bound (same-file + relative-import + one hop of type-based property descent through the
   `server.ts` deps object literal, depth ≤ 10) is real but not complete — a founder call on whether
   deeper resolution (e.g. full `this`-dispatch tracing) is worth commissioning before this tranche
   freezes as done.
2. **The 33-vs-35 route-file-count discrepancy** against `W5-W11-gated.md`'s stated total. This
   document's own mechanical re-derivation (33 files via `register*Routes` imports from `server.ts`)
   is authoritative for *this tranche's* scope per `GLOBAL-GOAL.md` rule 6, but the parent wave's
   aggregate total should be spot-checked against the *union* of all six W9 tranches' own
   re-derivations once they all exist, rather than trusted as originally stated.
3. **Mechanical-vs-reviewer-frozen impact model.** This tranche uses a mechanically-derived impact
   class (read/write/upload primitive tier) instead of the ingest tranche's reviewer-hand-frozen
   floor table, because of scale (125 rows vs. 23). Should the P0/P1 tier specifically (the rows that
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
