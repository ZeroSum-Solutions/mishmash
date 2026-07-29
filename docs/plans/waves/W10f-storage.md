# Wave 10f — Storage retention & GC (NM-36C)

**Slug:** `mishmash-w10f-storage`
**Gates on:** W0 (landed)
**Loop:** `loop:red-green-review` (`VERIFICATION-CONTRACT.md` §6)
**Verifier:** `scripts/waves/verify-w10f.ts`
**Write lease (proposed, not yet in `leases.json`):** see **Proposed lease** below. This wave has
**no** `leases.json` entry today — that is expected and mechanically checked (see the **LEASE**
criterion): the orchestrator adds the entry only after this PRD and its verifier are frozen and
independently approved.

**Status: EXPANSION DRAFT, pre-review, pre-freeze.** This document is an **expansion of the
`W5-W11-gated.md` Wave 10 skeleton (`w10f-storage` row, NM-36C paragraph)**, produced under the
"expansion gate" (`W5-W11-gated.md` lines 8–24): written and frozen *before* any implementation
work starts, reviewed by an adversarial reviewer who did not write it and will not implement it,
and unfrozen for a `/goal` run only after that review returns APPROVE. **No implementation exists
yet.** Any agent that begins implementing storage GC from this document, from the skeleton it
expands, or from its own reading of the codebase before this PRD and its verifier are frozen and
reviewed is committing the exact self-certification failure the expansion gate exists to prevent
(`W5-W11-gated.md` lines 10–13) — a hard reject.

---

## Why this wave exists

The `W5-W11-gated.md` Wave 10 skeleton states the problem in one line: **".tmp at 30 GB, e2e
artifacts, and .od growth need a retention policy and GC. This item had no home in the first draft
and would have been silently dropped."** That 30 GB figure is the skeleton's own claim, not
independently measured in this session — per `GLOBAL-GOAL.md` operating rule 6 ("numbers in
planning documents are hypotheses"), the implementer must re-measure actual `.tmp`/`.od` disk usage
on a representative dev machine before finalizing default retention-window numbers, and must not
treat 30 GB as verified.

**This PRD inverts the skeleton's framing on purpose.** The skeleton is written as a disk-space
problem. It is not one. A garbage collector that runs against a live daemon's data directory is
code whose failure mode is **irreversible deletion of a user's design work**. Disk space recovered
is a nice-to-have; a user's project silently vanishing is the kind of defect this program's own
non-negotiable operating rule 1 exists to prevent for backup/restore ("nothing is exposed, migrated,
or enriched before it can be restored") — the same principle applies in reverse here: **nothing is
deleted that cannot be proven, mechanically, to be disposable.** Every criterion in this document is
written from that threat model, not from "does it free disk space."

## Ground facts (verified directly in this tree)

- **`RUNTIME_DATA_DIR` is the one daemon data-root truth source**, per root `AGENTS.md` → "Daemon
  data directory contract" (binding on this wave). `apps/daemon/src/server.ts:842` resolves it via
  `resolveDataDir(process.env.OD_DATA_DIR, PROJECT_ROOT, …)` (`apps/daemon/src/daemon-paths.ts`),
  which defaults to `<project-root>/.od` when `OD_DATA_DIR` is unset
  (`apps/daemon/src/daemon-paths.ts:139`). Every daemon-owned subdirectory the GC may ever touch is
  derived from this constant: `ARTIFACTS_DIR`, `CRITIQUE_ARTIFACTS_DIR`, `PROJECTS_DIR`,
  `USER_SKILLS_DIR`, `USER_DESIGN_SYSTEMS_DIR`, `BRANDS_DIR`, `LIBRARY_DIR`, the plugin
  asset-cache dir, `USER_DESIGN_TEMPLATES_DIR` (`server.ts:868-908`).
- **`.tmp/<source>/<namespace>/...` is the other allowed root family**, per root `AGENTS.md` →
  "Boundary constraints" ("Default runtime files live under
  `<project-root>/.tmp/<source>/<namespace>/...`"). `packages/sidecar/src/paths.ts` implements the
  resolution: `resolveProjectTmpRoot` → `<projectRoot>/<contract.defaults.projectTmpDirName>`
  (`projectTmpDirName: '.tmp'` in `packages/sidecar-proto/src/index.ts:67`), then
  `resolveSourceRuntimeRoot` → `<tmpRoot>/<source>`. `SIDECAR_SOURCES` (`sidecar-proto/src/index.ts:19`)
  enumerates `packaged | tools-dev | tools-pack`; `tools-serve` is a fourth control plane
  (`tools/serve`) that follows the same convention in practice. Namespace is validated/normalized
  through the same contract. Root `AGENTS.md` → "Validation strategy" independently confirms this
  for logs specifically: `pnpm tools-dev logs --namespace <name> --json` paths must resolve under
  `.tmp/tools-dev/<namespace>/...`.
- **Sidecar liveness is a real, checkable OS-process fact, not a namespace-string heuristic.**
  `packages/sidecar-proto/src/index.ts:62` fixes the stamp shape at exactly five fields — `app,
  mode, namespace, ipc, source` — encoded as `--od-stamp-*` CLI flags
  (`SIDECAR_STAMP_FLAGS`/`STAMP_*_FLAG`). `packages/platform/src/process.ts` supplies the
  production primitives: `readProcessStampFromCommand`/`matchesStampedProcess` decode a process
  command line's stamp and test it against criteria (e.g. `{ namespace: 'foo' }`); `isProcessAlive`
  probes a PID with signal 0; `listProcessSnapshots()` (`packages/platform/src/process.ts:366`)
  lists live OS processes for matching (`collectProcessTreePids` combines the two to also cover a
  namespace's child-process tree, the same helper `tools/dev/src/index.ts` already calls in
  production). Root `AGENTS.md` → "Boundary constraints" ("Sidecar
  process stamps must have exactly five fields… Orchestration layers must call package primitives;
  do not hand-build `--od-stamp-*` args or process-scan regexes") makes reuse of these exact
  primitives, not a bespoke reimplementation, the binding contract.
- **Imported-folder projects have a real, already-defended external-root mechanism.**
  `apps/daemon/src/projects.ts`: `hasExternalProjectRoot(metadata)` tests
  `path.isAbsolute(path.normalize(metadata.baseDir))`; `resolveProjectDir` returns
  `path.normalize(metadata.baseDir)` directly for such projects instead of a path under
  `PROJECTS_DIR`. The same file already treats this boundary as security-sensitive:
  `assertVisibleForImportedProject` rejects hidden path segments specifically because an imported
  folder is "the user's OWN directory" reachable from daemon file operations. Root `AGENTS.md` →
  "Daemon data directory contract" states the same rule as policy: "Imported-folder projects are
  the explicit exception: they use `metadata.baseDir` for the user-selected external workspace."
  **`PROJECTS_DIR` itself (all managed project content) is excluded from this wave's GC scope
  entirely** — see Scope below; the `baseDir` criterion exists as defense-in-depth against a
  registry/metadata scan that discovers an imported project's external root incidentally while
  enumerating `PROJECTS_DIR` siblings, not because `PROJECTS_DIR` walking is otherwise in scope.
- **A path-containment helper already exists in this codebase and is worth citing, not
  reinventing.** `apps/daemon/src/daemon-paths.ts:isPathWithin(base, target)` uses
  `path.relative(path.resolve(base), path.resolve(target))` and rejects a result starting with
  `..` or absolute — the correct primitive shape (not a `string.startsWith(base)` check, which
  wrongly admits a sibling directory whose name has the base as a prefix, e.g. `/data/x` under base
  `/data`). It does **not**, as written, resolve symlinks (`fs.realpathSync`) before comparing —
  the GC's own containment check must do so (see Threat model, T2).
- **This codebase already ships two GC-shaped precedents worth learning from, not copying
  wholesale:**
  - `apps/daemon/src/plugins/snapshots.ts` + `gc.ts`: an unreferenced-snapshot TTL sweep
    (`pruneExpiredSnapshots`), a periodic timer disableable via `OD_SNAPSHOT_GC_INTERVAL_MS=0`, an
    `OD_SNAPSHOT_RETENTION_DAYS` env knob (`apps/daemon/src/app-config.ts:72-73`,
    `readPluginEnvKnobs`), and a synchronous CLI escape hatch (`od plugin snapshots prune --before
    <ts>`). This wave's env-knob naming should follow the same `OD_*` convention.
  - `apps/daemon/src/memory-cleanup.ts`: a one-time, marker-file-gated migration cleanup — **not**
    a standing GC, explicitly documented as such in its own header. Cited here only to show the
    codebase's existing bar for "never take the daemon down on a single bad entry" error handling,
    which this wave's GC must match.
  - Neither precedent deletes anything outside `RUNTIME_DATA_DIR`, and neither has a dry-run mode
    — this wave is stricter than both, deliberately, because its blast radius (arbitrary
    `.tmp`/`.od` growth across three named categories) is larger than either precedent's.
- **An unconditional, already-shipped artifact wipe exists for e2e, and it is out of this wave's
  scope.** `e2e/scripts/playwright.ts`'s `clean` command (`pnpm exec tsx e2e/scripts/playwright.ts
  clean`) unconditionally `rm -rf`s `e2e/ui/{.od-data,test-results,reports/*,.DS_Store}` with no
  retention window, no dry-run, and no root-confinement machinery — it is a CI/dev hygiene reset
  tool, always run before/between suites, not a retention policy. See Scope for why this wave does
  not extend or wrap it.
- **`SIDECAR_SOURCES` (`packages/sidecar-proto/src/index.ts:19`) is exactly `{ packaged, tools-dev,
  tools-pack }` — there is no `'e2e'` source.** e2e's own isolated per-Playwright-worker runtime
  root is provisioned by setting `OD_DATA_DIR` directly (`e2e/lib/tools-dev/cli.ts:33`,
  `OD_DATA_DIR: suite.dataDir`) for a `tools-dev`-sourced daemon it boots itself — confirmed
  `tools/dev/src/config.ts`/`index.ts` never set `OD_DATA_DIR` themselves for an ordinary (non-e2e)
  `tools-dev` run, so a developer's real project data stays under the default `RUNTIME_DATA_DIR`
  (`.od/`), never under `.tmp/tools-dev/<namespace>/`, which is what makes Tier 1's "no
  user-authored content by construction" claim (Scope) hold for the ordinary case. The assessment
  doc's literal `.tmp/e2e` 27 GB figure was **not** independently re-confirmed as a real directory
  name in this tree (this fresh worktree has no `.tmp/` at all to inspect) — it most plausibly names
  accumulated `.tmp/tools-dev/<namespace>/...` roots across many past e2e runs (Tier 1, in scope),
  not a separate, uncontracted `.tmp/e2e/` path, but this PRD does not assert that as settled fact;
  the implementer must confirm the real accumulation path on a populated checkout before finalizing
  the Tier 1 scanner (open question 1).
- **`apps/daemon/src/storage/` already exists and is unrelated to this wave.** It holds
  `aws-sigv4.ts` / `project-storage.ts` / `daemon-db.ts` / `db-inspect.ts` — a Phase-5 `ProjectStorage`
  adapter interface for S3-compatible blob backends (spec §15.6), nothing to do with retention or
  GC. This wave's proposed module lives at `apps/daemon/src/storage-gc/` specifically to avoid
  colliding with, or being confused with, that existing directory — see "Proposed lease".

## Threat model

**The central threat is the GC itself.** Every entry below is a way the GC could destroy something
it must not, ranked by how directly it causes irreversible user-data loss. This table is the spine
the success criteria are built from — every criterion below cites which threat(s) it closes.

| ID | Threat | Why it's catastrophic, not just buggy |
|---|---|---|
| T1 | **Root escape.** A candidate path is computed (config value, joined segments, decoded from a stored record) that resolves outside every allowed root, and the GC deletes it anyway. | Nothing bounds the blast radius — could reach the user's home directory, another app's data, or the repo itself. |
| T2 | **Symlink escape.** A path *inside* an allowed root is actually a symlink whose target is outside it (or inside `PROJECTS_DIR`/`baseDir`), and the GC follows the link before deleting. | `isPathWithin`-shaped string/relative-path checks operate on the symlink's own path, not its resolved target — a check that looks correct on the literal path is silently wrong once a symlink is in play. |
| T3 | **Active-namespace deletion.** A `.tmp/<source>/<namespace>` runtime root is deleted while a live process (dev daemon, tools-dev session, e2e worker) is still using it — sockets, lock files, or in-flight writes. | Not "old scratch," but a running session's working state; deletion mid-use can corrupt that session's data or crash it destructively rather than gracefully. |
| T4 | **Imported-folder deletion.** Any enumeration or deletion reaches into a `metadata.baseDir` external workspace. | This is not daemon-owned data — it is the user's own filesystem, outside the entire `RUNTIME_DATA_DIR`/`.tmp` boundary this wave is chartered to operate in. Deleting inside it is deleting a user's actual files, full stop. |
| T5 | **Generic-walker misclassification.** The GC is implemented as "walk `RUNTIME_DATA_DIR` recursively, delete anything older than N days," rather than an explicit, named, per-category allowlist. | A generic walker cannot distinguish disposable scratch from `PROJECTS_DIR` content that simply hasn't been opened recently — staleness and disposability are unrelated properties for user content. This is the single most likely path to catastrophic loss and the reason C10F-1 exists. |
| T6 | **TOCTOU between plan and apply.** A dry-run plan is computed, time passes (a session becomes active, a symlink is swapped, a file is opened), and apply blindly executes the stale plan. | Dry-run-by-default is worthless as a safety property if apply doesn't re-validate; the report becomes a false promise. |
| T7 | **Partial-failure inconsistency.** Apply fails partway through and the report doesn't accurately reflect what was actually removed vs. what merely failed. | An operator (human or automation) making a "do I need to run this again / is my disk actually reclaimed" decision from a report that lies about partial state is a data-integrity failure one layer up from deletion itself. |
| T8 | **Retention-window misconfiguration treated as "delete everything now."** A `0`, negative, missing, or malformed retention-window value is silently coerced into "everything is eligible" instead of being rejected. | The single knob users/operators are expected to tune becomes the single easiest way to accidentally nuke everything in a category. |
| T9 | **Report/reality drift.** The before/after size report is computed once and cached, or derived from the plan rather than the filesystem, so it can diverge from what's actually on disk. | Silent drift here defeats the entire audit value of "size/inventory report before and after" — an operator trusts a number that isn't real. |

## Scope

**In scope:**

1. A **finite, explicitly named target registry** (never a generic recursive walk of
   `RUNTIME_DATA_DIR` — see C10F-1) covering:
   - **Tier 1 — ephemeral tooling runtime roots**, pre-approved as safe by this PRD because they
     hold no user-authored content by construction: `.tmp/tools-dev/<namespace>`,
     `.tmp/tools-serve/<namespace>`, `.tmp/tools-pack/<namespace>` (dormant in this fork per root
     `AGENTS.md`, but its `.tmp` convention still applies if anything lands there). Eligibility:
     age past the category's retention window **and** namespace inactive (T3, C10F-3).
   - **Tier 2 — `RUNTIME_DATA_DIR`-derived generated/cache content.** Each candidate category
     requires, as part of the registry entry itself (not a separate doc), a written justification
     that is one of: **(a)** provably orphaned — no live SQLite row references it, checked at GC
     run time, not assumed from age alone, or **(b)** a pure regenerable cache with no
     user-authored content (e.g. the plugin asset cache: derived, safe to lose, rebuilt on next
     access). A category without one of these two justifications **must not** be added to the
     registry in v1 — defer it and name it explicitly in the report's "deferred categories"
     section (open question 4 lists the categories this PRD is not resolving).
2. Dry-run planning, apply-with-re-validation, and a before/after size+inventory report, per the
   design in "Proposed capability surface" below.
3. Configurable, named, independently-effective retention windows, one per registry category.
4. UI + CLI surfaces over one shared `/api/storage/*` contract, per root `AGENTS.md` → "Capability
   exposure."

**Explicitly out of scope:**

- **`PROJECTS_DIR` content, wholesale — managed or imported, any age.** No project's files are a
  GC target in this wave, regardless of staleness. If a future wave wants project-level archival or
  deletion, that is a different, explicitly product-facing feature (the user deciding to delete
  *their* project), not background GC, and needs its own PRD.
- **`e2e/ui/{reports,test-results,.od-data}`.** These sit outside both allowed-root families
  (neither `RUNTIME_DATA_DIR`-derived nor `.tmp/<source>/<namespace>`) and already have an
  unconditional owner (`e2e/scripts/playwright.ts clean`) with a different, CI-hygiene-shaped
  threat profile (ephemeral test output, wiped before every run, never user data). Folding it into
  this wave's retention-window/dry-run machinery would be scope creep across two genuinely
  different tools with different safety requirements. **This is a real reading of the skeleton's
  "e2e artifacts" phrase, not a silent narrowing — flagged explicitly as open question 2** because
  the skeleton did name e2e artifacts as one of the three growth vectors and a founder may want
  unification.
- **Scheduled/automatic background sweeps.** v1 ships plan+apply as an operator/automation-invoked
  action (CLI or UI-triggered), not a timer running inside the daemon process (unlike the existing
  snapshot GC's `setInterval`). Open question 3.
- **AI/semantic classification of "important" vs "disposable" files.** Eligibility is purely
  mechanical: registry category + age + (namespace liveness | SQLite reference check).
- Anything already covered by W0's backup/restore, W9's route-hardening tranches, or W4's cover
  storage — this wave does not re-litigate those threat models.

## Proposed capability surface

Descriptive target for the implementer — this PRD does not implement it, and the exact internal
module layout is the implementer's call as long as every criterion below is met.

- **CLI:** `od storage gc plan [--json]` (always dry-run; the *only* way to see what's eligible),
  `od storage gc apply --plan <planId> --confirm [--json]` (executes exactly the named plan's
  candidate set, re-validating each candidate's eligibility, root-containment, and
  non-active-namespace status immediately before deleting it — closing T6), and `od storage report
  [--json]` (standalone size/inventory read, a sibling of `gc`, not nested under it — no plan side
  effects). There is no single flag that flips a plan call into a delete call; `apply` is a
  structurally distinct subcommand requiring a plan reference, per C10F-6/C10F-7.
- **HTTP:** `GET /api/storage/gc-plan` (mirrors `od storage gc plan`), `POST
  /api/storage/gc-apply` (body `{ planId: string, confirm: true }`, mirrors `od storage gc apply`),
  and `GET /api/storage/report` (mirrors `od storage report`) — all three under the same handler
  code the CLI drives, per root `AGENTS.md` → "Capability exposure" ("Both surfaces must call the
  same `/api/*` endpoints").
- **Contracts:** DTOs for `GcPlanReport` (per-category candidate list + counts/bytes),
  `GcApplyReport` (removed/failed lists + before/after totals), and `RetentionConfig` land in
  `packages/contracts/src/api/storage-gc.ts`, consumed by both the daemon routes and the web UI —
  never a divergent ad hoc shape on either side (root `AGENTS.md` → "Boundary constraints").
- **Config:** one `OD_STORAGE_RETENTION_<CATEGORY>_DAYS`-shaped env knob per registry category
  (naming mirrors `OD_SNAPSHOT_RETENTION_DAYS`), plus a settings-surface UI control mirroring
  whatever pattern the existing plugin/snapshot config editor uses. Defaults are an **open
  question** (open question 1) — this PRD does not pick numbers.
- **UI:** a Settings-area panel (implementer-named, e.g. `apps/web/src/components/StorageRetention*`)
  showing the current report, per-category retention windows, a "Plan" action, and an "Apply"
  action gated behind the returned plan.

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3 (red-before-green, no mocked transport for the
real filesystem/process boundary, no counting criteria, negative checks paired with positive
controls, no severity downgrades, human-judgment items declared not disguised). Verified by
`scripts/waves/verify-w10f.ts`. Every criterion is a **mechanical** check — none is `human:`.

---

### C10F-1 — Target registry is a finite, named allowlist, never a generic walk

**Statement.** The GC's set of deletable candidates is produced by iterating a small, explicit,
in-repo enumeration of `{category, rootBuilder, retentionConfigKey, eligibilityRule,
justification}` entries. There is no code path that recursively enumerates an entire allowed root
(e.g. `RUNTIME_DATA_DIR`) and treats "found + old" as sufficient for eligibility. Every Tier 2
entry's `justification` is one of the two forms Scope requires; an entry with neither is rejected
at the registry-definition level, not silently included. Closes **T5, T8**.

**Satisfiability.** A legitimate implementation defines the registry as literal, statically
readable data (an array/object literal, not a value computed from a runtime directory listing),
each entry independently unit-testable, with Tier 1 entries never requiring a justification field
(pre-approved by this PRD) and every Tier 2 entry carrying one. The verifier's AST scan (see
Verification) finds this shape directly in the production module's source.

**Decoy.** An implementation that walks `RUNTIME_DATA_DIR` with `fs.readdir`/`fs.stat` and applies
an age filter to whatever it finds — even if it also has root-confinement and symlink checks
layered on top — fails this criterion, because a positive control seeds a fresh, unlisted directory
under `RUNTIME_DATA_DIR` with an old mtime (simulating a future daemon feature this wave's author
never enumerated) and the walker-shaped implementation reports it as an eligible candidate; the
registry-shaped implementation correctly excludes it (not in the allowlist = not a candidate,
regardless of age).

**Verification.** TypeScript-compiler-API scan of the production module (`ts.createSourceFile` +
`ts.forEachChild`, never regex) for (a) the registry's declaration shape and (b) the absence of any
`fs.readdir`/`fs.readdirSync`/`fs.opendir` call whose result feeds the eligibility/deletion path
without first being filtered through a registry-derived root. Cross-checked at runtime: seed a
fixture `RUNTIME_DATA_DIR` with one file in an unlisted subdirectory, aged past every configured
window, and confirm `gc plan` does not list it.

---

### C10F-2 — Root confinement: real containment, not string prefix

**Statement.** Before any path is treated as a delete candidate, it is checked against the union of
allowed roots using resolved (not merely joined) paths — `path.relative`-based containment at
minimum, extended per C10F-3 with `fs.realpathSync` resolution. A candidate that resolves outside
every allowed root is refused, not merely deprioritized. Closes **T1**.

**Satisfiability.** A legitimate implementation reuses (or matches the semantics of)
`apps/daemon/src/daemon-paths.ts`'s `isPathWithin` — `path.relative(base, target)` not starting
with `..` and not absolute — evaluated against **every** allowed root, refusing when none matches.

**Decoy.** An implementation using `candidatePath.startsWith(allowedRoot)` passes every "obviously
inside" test case but fails the red spec: a fixture allowed root `<tmp>/.tmp/tools-dev/foo` and a
sibling `<tmp>/.tmp/tools-dev/foo-not-really` (a real, unrelated directory whose name happens to
share the prefix) — the decoy's `startsWith` check wrongly admits the sibling as "inside," and the
red spec proves the production path either wrongly includes it (fail) or correctly excludes it
(pass, if using real relative-path containment).

**Verification.** Red spec constructs the prefix-collision fixture above and a genuinely
out-of-root path (e.g. a fixture standing in for `$HOME`), invokes `od storage gc plan --json`
against them, and asserts neither appears as a candidate. Positive control in the same run: a
real in-registry, past-window file in a genuinely-contained path *does* appear.

---

### C10F-3 — Symlink escape refusal

**Statement.** A symlink located inside an allowed root, whose resolved target lies outside every
allowed root (or inside `PROJECTS_DIR`/a `metadata.baseDir`), is never followed for deletion
purposes — neither is its target deleted, nor is content reached through it enumerated as a
candidate. Closes **T2**.

**Satisfiability.** The containment check in C10F-2 additionally resolves the candidate with
`fs.realpathSync` (or equivalent) before the containment test, so a symlink's *target* — not its
literal path — is what gets checked. A symlink itself, if it lives inside an allowed root and its
target is also safely contained, may be removed as the symlink entry; its target is never touched
through it.

**Decoy.** An implementation that checks containment on the literal (un-resolved) path passes every
non-symlink test but fails the red spec: a symlink at `<tmp>/.tmp/tools-dev/expired-ns/escape` →
`<external-fixture>/real-user-file.txt` (outside every allowed root). The decoy sees
`.tmp/tools-dev/expired-ns/escape` as literally inside the allowed root and deletes through it;
`real-user-file.txt` in the external fixture disappears. The red spec's oracle is exactly that file
surviving.

**Verification.** Red spec creates the symlink fixture above under an otherwise-eligible (aged,
inactive-namespace) directory, runs `gc plan` then `gc apply --confirm`, and asserts (a) the
external target file still exists with unchanged content/hash, and (b) — positive control — a real
non-symlinked expired file in the same directory *is* removed by the same apply call.

---

### C10F-4 — Active-namespace refusal

**Statement.** A `.tmp/<source>/<namespace>` runtime root is never planned or applied against while
a live OS process carries a matching sidecar stamp for that `{source, namespace}` pair. Closes
**T3**.

**Satisfiability.** The eligibility check for Tier 1 categories calls the production stamp-matching
primitives directly — `packages/platform/src/process.ts`'s process enumeration +
`matchesStampedProcess`/`readProcessStampFromCommand` against `packages/sidecar-proto`'s
`SIDECAR_STAMP_FIELDS`/contract — never a bespoke `ps`-output regex (root `AGENTS.md` forbids
hand-built stamp scanning). A namespace with a matching live process is excluded from the plan
outright, not merely warned about.

**Decoy.** An implementation that infers "active" from the namespace directory's own mtime (e.g.
"a lock file was touched in the last hour") rather than an actual live-process check fails the red
spec: a namespace directory aged past its retention window but with a genuinely live process still
holding it (started, mtime never touched again because the process only opened the file once at
startup) is wrongly planned/deleted by the mtime-heuristic decoy.

**Verification.** Red spec spawns a real, short-lived child process carrying valid `--od-stamp-*`
flags for a fixture `{source, namespace}` (a static, non-interpolated launch script — no dynamic
code generation), points a fixture `.tmp/<source>/<namespace>` runtime root at that pair aged past
every retention window, runs `gc plan`, and asserts the namespace is excluded while the process is
alive; kills the process, waits for exit, re-runs `gc plan`, and asserts — positive control — the
same namespace now appears as a candidate.

---

### C10F-5 — Imported-folder `baseDir` is untouchable

**Statement.** No GC code path enumerates, stats, or deletes anything under a project's
`metadata.baseDir` (an imported-folder project's external workspace), at any age, under any
registry category. Closes **T4**.

**Satisfiability.** A legitimate implementation either (a) never enumerates `PROJECTS_DIR` or
project metadata at all — consistent with Scope's "PROJECTS_DIR is out of scope entirely," which
is the simplest way to satisfy this — or, if any future registry entry ever needs project-adjacent
enumeration, (b) explicitly excludes any path for which `apps/daemon/src/projects.ts`'s
`hasExternalProjectRoot`/`resolveProjectDir` identifies an external root, before that path is ever
considered.

**Decoy.** An implementation that filters on a hardcoded substring check (e.g. "skip paths
containing `PROJECTS_DIR`") rather than the real metadata-driven external-root detection fails the
red spec's second fixture: an imported project whose `metadata.baseDir` happens to resolve to a
path that does **not** textually contain `PROJECTS_DIR` (any external directory) but whose stale
content a naive age-based scan would otherwise reach if the implementation scans project metadata
at all.

**Verification.** Red spec creates a real imported-folder project via the daemon's own project
creation API with `metadata.baseDir` pointing at a fixture directory, ages every file in it past
every retention window, runs `gc plan` and `gc apply --confirm`, and asserts every file under
`baseDir` is untouched (existence + content hash unchanged) and none appear in the plan's candidate
list at all — not merely "present but marked ineligible." Positive control: a real managed
project's *non-`PROJECTS_DIR`* stale registry-category content in the same run (e.g. an orphaned
Tier-2 cache entry) **is** collected, proving the refusal is `baseDir`-specific, not a global no-op.

---

### C10F-6 — Dry-run is the default and the only read path

**Statement.** `od storage gc plan` / `GET /api/storage/gc-plan` never mutates the filesystem,
regardless of candidate count. There is no invocation shape of the plan surface that deletes
anything. Closes part of **T6**.

**Satisfiability.** `plan` is implemented as a pure read: registry iteration + eligibility checks +
size accounting, with no `fs.rm`/`fs.unlink` call reachable from its code path at all (not "guarded
by a flag that defaults false" — structurally absent).

**Decoy.** An implementation where `plan` and `apply` share one function gated by a boolean
parameter defaulting to `false` fails this criterion's stricter form (see C10F-7) even if the
default is safe today, because a decoy fixture calls the shared function with the boolean
explicitly (but incorrectly, e.g. via a stray `true` default reintroduced in a later edit) and nothing
in the type/control-flow shape prevents it — the AST check requires structurally separate plan/apply
entry points, not a shared function with a default-off flag.

**Verification.** Full recursive file listing + content hash of every fixture root, before and
after `gc plan --json` against a tree with several eligible candidates; asserts the multiset of
{path, hash} pairs is byte-identical (occurrence-count comparison, not a Set — a moved/renamed
file must be visible as a real diff, not silently absorbed). AST scan of the production module
confirms `plan`'s call graph (transitive local-import BFS) never reaches a filesystem-mutating call.

---

### C10F-7 — Apply is a distinct, plan-bound, re-validated action

**Statement.** `od storage gc apply` requires an explicit `--confirm` flag **and** a `planId`
referencing a specific prior `plan` call's candidate set. At execution time, apply re-validates
every candidate against C10F-2/C10F-3/C10F-4/C10F-5 immediately before deleting it — a candidate
that was eligible when planned but is no longer (e.g. its namespace became active, or the file
disappeared) is skipped and reported, never force-deleted. The realized deletion set is exactly the
plan's candidate set minus anything that failed re-validation — never a superset. Closes **T6, T7**.

**Satisfiability.** `apply` looks up the stored plan by `planId`, iterates its exact candidate list
(not a fresh registry scan), re-runs the four safety checks per candidate, deletes only survivors,
and records every skip with a reason. `plan` and `apply` are separate CLI subcommands / HTTP
routes, so no single flag flip converts one into the other.

**Decoy.** An implementation that re-scans the registry from scratch at apply time (ignoring
`planId`) rather than re-validating the plan's own candidate list fails the red spec: between plan
and apply, a new file appears in the same category that would also be eligible under a fresh scan
but was never in the original plan — the decoy deletes it anyway (a set expansion the operator
never saw or approved); the correct implementation's realized set is bounded by the plan.

**Verification.** Red spec: call `plan`, capture its candidate set and `planId`; before calling
`apply`, (a) make one previously-eligible candidate ineligible (start a stamped process in its
namespace) and (b) introduce one *new* eligible-looking file not in the original plan; call `apply
--plan <planId> --confirm`; assert the realized deletion multiset equals `plan's candidates minus
(a)`, that (a) survives with a recorded skip reason, and that the new file from (b) is untouched
(not in the realized set, proving apply didn't silently re-scan).

---

### C10F-8 — Retention windows are configurable, named, independently effective, and stated

**Statement.** Each registry category has its own named, overridable retention-window
configuration value (`OD_STORAGE_RETENTION_<CATEGORY>_DAYS`-shaped). Changing one category's
window changes only that category's eligibility, provably. A zero, negative, or malformed value is
rejected at config-read time (fails closed to "nothing in this category is eligible" plus a
reported config error), never silently coerced to "everything is eligible now." **The *effective*
window value actually in force for each category — whatever resolved it, default or override — is
echoed verbatim in every `plan`/`report` response**, so "configurable" cannot regress into a value
that is only auditable by re-deriving it from an env var an operator has to already trust was read
correctly. Closes **T8**.

**Satisfiability.** Config is read once per invocation through a validated parser (integer,
positive, explicit min/max sanity bounds) with a named default per category (defaults themselves
are Open question 1 — not fixed by this PRD), the retention comparison is a plain age-vs-window
check per category, independently overridable via distinct env vars, and the same resolved value
the eligibility check used is attached to the response payload under that category's key — not
recomputed a second time for display (which could silently diverge from what was actually applied).

**Decoy.** A single global `OD_STORAGE_RETENTION_DAYS` knob applied uniformly to every category
fails the red/green pair: the test sets a wide window for category A and a narrow window for
category B, and the decoy — having only one knob — cannot make an identical-age fixture survive in
A while being collected in B, which the red spec requires. Separately, an implementation that
reads the env var correctly for eligibility but hardcodes a documentation-default string in the
response body (rather than the value it actually resolved and used) fails the "stated" half
specifically: the red spec sets a non-default override and asserts the echoed value in the
response equals the override, not the shipped default.

**Verification.** For each registry category, seed an identically-aged fixture file; run `gc plan`
under a wide window (survives) and again under a narrow window (collected) for that category only,
holding every other category's window fixed; assert the other categories' eligibility is
unaffected by the changed knob, **and** that the response's echoed effective-window value for each
category equals the value that run actually set (never the default, once overridden). Separately:
set a `0` and a `-5` window value and assert `gc plan` reports a config validation error for that
category (not a plan containing everything in it).

---

### C10F-9 — Size/inventory report, before and after, re-derived at runtime

**Statement.** Every `plan`/`apply`/`report` call returns a per-category and total byte count +
file count computed from real `fs.stat` calls over the actual current filesystem state at call
time — never cached, hardcoded, or derived purely from the plan's stale numbers. `apply`'s
after-totals reconcile exactly with before-totals minus the realized deletion set. Closes **T9**.

**Satisfiability.** `report`/`plan` walk each registry category's actual root (bounded by the
registry, not a generic walk — consistent with C10F-1) and `fs.stat` every entry found there at
call time; `apply` calls the same accounting function again after deleting, and the two numbers are
diffed programmatically, not asserted independently.

**Decoy.** An implementation that computes the "after" report by subtracting the plan's *predicted*
bytes from the "before" report, rather than re-stating the filesystem after apply, fails the red
spec: a candidate file grows between plan and apply (simulating concurrent write activity) — the
decoy's arithmetic-subtraction after-report is wrong (based on the stale predicted size), while a
real re-stat after-report is correct.

**Verification.** Seed a fixture tree, capture `report` before, run `plan` then `apply --confirm`
with one candidate file's size deliberately changed between plan and apply (still eligible, just
bigger/smaller), capture `report` after; assert after-totals equal an independently-computed
ground truth (verifier's own `fs.stat` walk of the same fixture tree post-apply), not the
plan-predicted arithmetic.

---

### C10F-10 — UI/CLI parity over one shared `/api/storage/*` contract

**Statement.** `od storage gc plan`, `od storage gc apply`, `od storage report`, and the web
Settings-area panel all drive `GET /api/storage/gc-plan`, `POST /api/storage/gc-apply`, `GET
/api/storage/report` respectively — the same
handler code, the same `packages/contracts/src/api/storage-gc.ts` DTOs — per root `AGENTS.md` →
"Capability exposure." A `scripts/waves/capability-manifest.json` row exists for this capability
with `parityApplicable: true` and is consistent with the live `SUBCOMMAND_MAP` in `cli.ts`, so
`pnpm guard`'s existing capability-manifest/CLI-parity check (`scripts/guard.ts`, "Capability
manifest / CLI parity") covers it going forward.

**Satisfiability.** `cli.ts`'s `SUBCOMMAND_MAP` registers a `storage` key resolving (directly or
via one hop of local imports) to a handler that issues the same HTTP requests the web panel issues
against the daemon's own `/api/storage/*` routes — both surfaces are thin clients over one HTTP
implementation.

**Decoy.** A CLI implementation that calls internal daemon functions directly (bypassing HTTP
entirely) while the web UI goes through `/api/*` fails the reachability check in C10F-11 applied to
this criterion's own binding requirement: the CLI's call graph never reaches the route handler
through the `/api/storage/*` HTTP layer, so the "same contract, both surfaces" claim cannot be
mechanically confirmed the way `od backup`/`od restore` are confirmed to operate on the same
`RUNTIME_DATA_DIR` resolution the HTTP layer uses.

**Verification.** `capability-manifest.json` row present and valid per `scripts/guard.ts`'s
existing shape checks; TS-compiler-API trace from `SUBCOMMAND_MAP.storage` to its handler
(transitive local-import BFS, mirroring `verify-w0.ts`'s own `resolveCliHandlerModule` +
`backupCallReachableFrom` pattern) confirms the handler issues requests against the exact
`/api/storage/gc-plan|gc-apply|report` paths the daemon routes file registers.

---

### C10F-11 — Every red spec binds to the production GC path

**Statement.** Every red spec required by C10F-2 through C10F-9 imports and exercises the real
production module reachable from both `od storage gc …` (via `SUBCOMMAND_MAP`) and `POST/GET
/api/storage/*` (via the daemon's route registration) — never a same-shaped module nothing calls.

**Satisfiability.** Red spec test files import the storage module by its real path (or invoke it
exclusively through the real `od` CLI binary / real HTTP requests against a daemon booted from this
tree — "real transport," per `VERIFICATION-CONTRACT.md` §3 R2), and the verifier's static BFS from
both real entry points (CLI `SUBCOMMAND_MAP` handler, HTTP route registration in `server.ts`)
reaches the same module the test imports.

**Decoy.** A second, unwired module implementing identical GC logic — e.g. `apps/daemon/src/storage-gc/legacy-gc.ts`,
imported only by the test files and by nothing reachable from `cli.ts` or `server.ts` — passes
every other criterion's fixture-level assertions (the logic is correct) but fails this one: the
verifier's transitive-import BFS from the two real entry points never reaches `legacy-gc.ts`, so every
red spec that imports it directly is flagged as unbound, and the wave fails even though the tests
themselves are green.

**Verification.** For each red spec file, TS-compiler-API-derived import graph from that file's own
`import` specifiers; separately, transitive local-import BFS from `SUBCOMMAND_MAP`'s `storage`
handler and from `server.ts`'s route registration call. A spec passes this check only if the module
it imports (or, for HTTP/CLI-driven specs, the module the real surface's BFS reaches) is the same
module both BFS traversals reach. A spec driving only real HTTP/CLI (no direct import) passes by
construction, since it can only observe the production path.

---

### GATE-INTEGRITY, LEASE, HEAD-DRIFT

Standard infra checks, mirroring `verify-w0.ts`/`verify-w9-ingest.ts`:

- **GATE-INTEGRITY** — sha256 of `scripts/waves/verify-w10f.ts` (and, for this wave, this PRD file
  too — both are frozen artifacts per the house rule below) checked against an
  orchestrator-held `~/.claude/goal-state/mishmash-w10f-storage/approved-gate.sha256`. Advisory
  (pass, noted) when that file doesn't exist yet (pre-approval); blocking (hash must match) once it
  does. Defense-in-depth; the primary control is the orchestrator running an approved out-of-repo
  copy, matching `verify-w0.ts`'s documented model.
- **LEASE** — `git diff --name-only <baseCommit>...HEAD` must be a subset of
  `leases.json@baseCommit`'s `W10f` entry, read via `git show <baseCommit>:docs/plans/waves/leases.json`
  (never the working tree — a wave cannot widen its own lease by editing the file it's being
  checked against). **Fails cleanly, by name, pre-freeze**, because no `W10f` entry exists in
  `leases.json` yet — this is the expected, correct state until the orchestrator adds the entry
  after this PRD freezes.
- **HEAD-DRIFT** — `git rev-parse HEAD` re-resolved at the end of the run must equal the value
  resolved at the start.

## Proposed lease

PRD text only — **`leases.json` is not edited by this wave's expansion**. The orchestrator adds a
`W10f` entry to `leases.json` after this document and its verifier are frozen and approved; the
globs below are the proposal for that entry.

**Allow (future implementation):**

- `apps/daemon/src/storage-gc/**` — new module (registry, plan, apply, report, CLI handlers).
  **Deliberately not `apps/daemon/src/storage/**`** — that directory already exists and holds the
  unrelated Phase-5 `ProjectStorage`/S3 adapter (`aws-sigv4.ts`, `project-storage.ts`, `daemon-db.ts`,
  `db-inspect.ts`); reusing it would both collide with an existing lease-worthy module and blur two
  unrelated concerns under one glob.
- `apps/daemon/src/routes/storage-gc.ts` — new HTTP route file.
- `apps/daemon/tests/storage-gc-*.test.ts` — red specs.
- `packages/contracts/src/api/storage-gc.ts` — new contract DTOs (new file; does not touch other
  contract files).
- `apps/web/src/components/StorageRetention*` — new Settings-area panel (prefix glob for
  not-yet-named files, mirroring the convention `W4`'s lease used for `DesignsTab*`/`RecentProjectsStrip*`).
- `apps/daemon/src/cli.ts` — to register the `storage` key in `SUBCOMMAND_MAP`. **Shared,
  contested file** — by the time this wave executes (gates only on W0, so it may run well before
  or after W1/W2/W4's bursts land), confirm no concurrent W-series writer currently holds it; if a
  same-burst conflict emerges, resolve via the established amend-on-proof pattern (one file, on
  proof of necessity), not a standing pre-claim.
- `apps/daemon/src/server.ts` — to register the new routes. Same shared-file caveat as `cli.ts`
  above; W1 and W4 have both held this file at various points in the program's execution order.
- `scripts/waves/capability-manifest.json` — one new row for the `storage` capability, per C10F-10
  (same pattern W1's C1-8 and W4's C4-12 required).
- `docs/security/daemon-threat-model.md` — append-only, a new `## Wave 10f` section bounded to the
  next `## ` heading (mirroring W9's C9-7 convention); must not edit any other wave's section.
  Shared with W0 (already landed) and W9-ingest; temporally serialized, never concurrent.
- `docs/plans/waves/DECISIONS.md` — for recording founder rulings on the open questions below,
  mirroring W9-ingest's lease rationale (attribution/scope decisions belong in a founder-authorized
  record, never an implementation-authored assertion).

**Deny (explicit, house rule):**

- `docs/plans/waves/W10f-storage.md` — this PRD. Frozen; the implementing agent may not edit its
  own acceptance criteria after seeing its own implementation. This is the specific failure mode
  the expansion gate exists to prevent (`W5-W11-gated.md` lines 10–13).
- `scripts/waves/verify-w10f.ts` — this verifier. Same reasoning; gate integrity is bound by the
  orchestrator-held approved copy + `approved-gate.sha256`, not by trusting the implementer not to
  edit it.
- `docs/plans/waves/leases.json` — mechanical, orchestrator-owned; never implementer-edited.
- `docs/plans/waves/VERIFICATION-CONTRACT.md`, `docs/plans/waves/GLOBAL-GOAL.md` — frozen program
  contract documents.
- `apps/daemon/src/projects.ts`, `apps/daemon/src/daemon-paths.ts` — this wave **cites and reuses**
  `hasExternalProjectRoot`/`resolveProjectDir`/`isPathWithin`; it does not modify them. A proven
  need to change either is an amend-on-proof request, not a standing grant, given how
  security-sensitive both files already are.
- Every other wave's exclusively-owned files (`apps/daemon/src/backup/**`,
  `apps/daemon/src/routes/library.ts`, `apps/web/src/components/EntryShell.tsx`, etc.) — implicit
  via the allowlist-only enforcement model (`VERIFICATION-CONTRACT.md` §3 R9), listed here only
  for the highest-collision-risk items.

## Open founder questions

Enumerated, not resolved. Each needs a `docs/plans/waves/DECISIONS.md` entry before or during
implementation; none blocks freezing this PRD or its verifier.

1. **Default retention windows per category.** This PRD deliberately does not pick numbers. The
   skeleton's "30 GB" figure is unverified (Scope, "Why this wave exists"). The implementer should
   measure real `.tmp`/`.od` growth on a representative dev machine and propose defaults per
   category for founder sign-off, rather than this PRD guessing.
2. **Does this wave's GC cover `e2e/ui/{reports,test-results,.od-data}` at all**, or does
   `e2e/scripts/playwright.ts clean` remain the sole owner of that tree (this PRD's default, per
   Scope)? The skeleton named e2e artifacts explicitly; this PRD's allowed-root constraint
   (inherited from `AGENTS.md`'s daemon data directory contract) structurally excludes them unless
   the founder wants a distinct, separately-chartered surface for that tree.
3. **Should GC ever run on a timer inside the daemon process** (like the existing snapshot GC's
   `setInterval`), or does it stay a strictly operator/automation-invoked action (plan, then apply)
   for v1, with scheduling deferred? This PRD defaults to the latter (Scope).
4. **Which `RUNTIME_DATA_DIR`-derived categories, if any, belong in the Tier 2 registry for v1?**
   This PRD requires each Tier 2 entry to carry a provable-orphan-or-pure-cache justification
   (Scope) but does not enumerate the categories itself — that requires investigation this
   expansion pass did not do (e.g. confirming whether `CRITIQUE_ARTIFACTS_DIR` entries are ever
   referenced by a live SQLite row, which this PRD does not know). The implementer proposes
   specific categories with their justification; the founder (or an adversarial reviewer, per this
   program's review process) confirms each before it ships.
5. **Resumability/idempotency contract for a failed or interrupted `apply`.** Is "some deleted,
   report says exactly which, a fresh `plan`+`apply` cycle is always safe to re-run" sufficient
   (this PRD's assumption, embedded in C10F-7's re-validation requirement), or does the founder
   want a stronger transactional/resumable guarantee?
6. **Durable audit log of apply runs** (what was deleted, when, under which plan) — should one
   exist, and if so, where does it live without becoming its own unbounded-growth vector this GC
   would then need to cover? Not addressed by this PRD.
7. **Size-based trigger in addition to age-based retention** — should the report surface a
   "you are over N GB, consider running apply" signal (UI/CLI advisory only, never automatic), or
   is pure per-category age-based eligibility sufficient for v1? This PRD assumes the latter.

## How the verifier runs

```bash
pnpm exec tsx scripts/waves/verify-w10f.ts
```

Writes a commit-bound proof manifest to
`~/.claude/goal-state/mishmash-w10f-storage/proof/manifest.json` (per
`VERIFICATION-CONTRACT.md` §2) and prints a per-criterion scoreboard. Exits non-zero if any
criterion fails, the tree is dirty, or the manifest fails to write. **Pre-implementation (current
`main`), every C10F-* criterion fails by name** ("product surface missing: od storage gc …" /
"no storage registry module found") — this is the expected clean-red state; the verifier does not
crash, and GATE-INTEGRITY/LEASE report their own honest pre-freeze states (advisory /
no-lease-entry-yet respectively) rather than false-passing.
