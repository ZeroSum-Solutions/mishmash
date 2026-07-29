# Wave 10f — Storage retention & GC (NM-36C)

**Slug:** `mishmash-w10f-storage`
**Gates on:** W0 (landed)
**Loop:** `loop:red-green-review` (`VERIFICATION-CONTRACT.md` §6)
**Verifier:** `scripts/waves/verify-w10f.ts`
**Write lease (proposed, not yet in `leases.json`):** see **Proposed lease** below. This wave has
**no** `leases.json` entry today — that is expected and mechanically checked (see the **LEASE**
criterion): the orchestrator adds the entry only after this PRD and its verifier are frozen and
independently approved.

**Status: EXPANSION DRAFT, fix round 2 (round 1 REJECTed).** This document is an **expansion of
the `W5-W11-gated.md` Wave 10 skeleton (`w10f-storage` row, NM-36C paragraph)**, produced under the
"expansion gate" (`W5-W11-gated.md` lines 8–24): written and frozen *before* any implementation
work starts, reviewed by an adversarial reviewer who did not write it and will not implement it,
and unfrozen for a `/goal` run only after that review returns APPROVE. **No implementation exists
yet.** Any agent that begins implementing storage GC from this document, from the skeleton it
expands, or from its own reading of the codebase before this PRD and its verifier are frozen and
reviewed is committing the exact self-certification failure the expansion gate exists to prevent
(`W5-W11-gated.md` lines 10–13) — a hard reject.

**Round-1 disposition.** Round 1 REJECTed with one CRITICAL finding (the verifier's own fixture
methodology could delete real data in the operator's checkout) and seven HIGH findings (weak or
false-greenable criteria, a spoofable review record, an incomplete lease, and three founder
questions that determine safety/scope left silently open). Every finding is closed in this round —
see **Round-1 findings → closures** near the end. The three freeze-blocking founder questions have
since been answered by founder delegation (see **Founder rulings**, immediately after Scope) — this
PRD encodes them, but the mechanical gate (C10F-14) still stays red until the actual decision
records land in `docs/plans/waves/DECISIONS.md`, which this wave's author does not edit.

---

## Why this wave exists

The `W5-W11-gated.md` Wave 10 skeleton states the problem in one line: **".tmp at 30 GB, e2e
artifacts, and .od growth need a retention policy and GC. This item had no home in the first draft
and would have been silently dropped."** That 30 GB figure is the skeleton's own claim, not
independently measured in this session.

**This PRD inverts the skeleton's framing on purpose.** The skeleton is written as a disk-space
problem. It is not one. A garbage collector that runs against a live daemon's data directory is
code whose failure mode is **irreversible deletion of a user's design work**. Disk space recovered
is a nice-to-have; a user's project silently vanishing is the kind of defect this program's own
non-negotiable operating rule 1 exists to prevent for backup/restore — the same principle applies
in reverse here: **nothing is deleted that cannot be proven, mechanically, to be disposable.**
Round 1 sharpened this further: **the gate itself is part of the threat surface.** A verifier that
runs real `apply` calls to prove GC safety must not, in the process, become the very data-loss
incident it exists to prevent — see "Verifier fixture-isolation guarantee" below.

## Ground facts (verified directly in this tree)

- **`RUNTIME_DATA_DIR` is the one daemon data-root truth source**, per root `AGENTS.md` → "Daemon
  data directory contract" (binding). `apps/daemon/src/server.ts:842` resolves it via
  `resolveDataDir(process.env.OD_DATA_DIR, PROJECT_ROOT, …)`, defaulting to `<project-root>/.od`
  when unset. Every daemon-owned subdirectory the GC may ever touch derives from this constant:
  `ARTIFACTS_DIR`, `CRITIQUE_ARTIFACTS_DIR`, `PROJECTS_DIR`, `USER_SKILLS_DIR`,
  `USER_DESIGN_SYSTEMS_DIR`, `BRANDS_DIR`, `LIBRARY_DIR`, the plugin asset-cache dir,
  `USER_DESIGN_TEMPLATES_DIR`.
- **`.tmp/<source>/<namespace>/...` is the other allowed root family**, per root `AGENTS.md` →
  "Boundary constraints." `packages/sidecar/src/paths.ts`'s `resolveProjectTmpRoot` takes
  `projectRoot` as a **parameter** — it is not hardcoded to the checkout. `SIDECAR_SOURCES`
  enumerates `packaged | tools-dev | tools-pack`; `tools-serve` is a fourth control plane that
  follows the same convention.
- **A compiled `od` CLI's own notion of "project root" is normally fixed to the checkout**:
  `apps/daemon/src/backup/cli.ts` resolves it via `resolveProjectRootFromNestedModule`, walking up
  from the CLI file's own on-disk location — never `cwd`. **This wave's GC surface is the
  deliberate exception** (`OD_STORAGE_TMP_ROOT`, below) because a gate that must run real `apply`
  calls to prove GC safety cannot share the checkout's real `.tmp` tree with the operator's own dev
  sessions — round 1's CRITICAL finding was exactly this gap.
- **Sidecar liveness is a real, checkable OS-process fact.** `packages/sidecar-proto/src/index.ts`
  fixes the stamp shape at exactly five fields; `packages/platform/src/process.ts` supplies
  `readProcessStampFromCommand`/`matchesStampedProcess`/`isProcessAlive`/`listProcessSnapshots`/
  `collectProcessTreePids`/`stopProcesses` (SIGTERM-then-SIGKILL, confirming exit — not assuming a
  signal landed). Root `AGENTS.md` requires reuse of these exact primitives, never a bespoke
  reimplementation — including for this wave's own verifier daemon-subprocess teardown (round-1
  finding 4).
- **Imported-folder projects have a real, already-defended external-root mechanism.**
  `apps/daemon/src/projects.ts`: `hasExternalProjectRoot`/`resolveProjectDir`.
  `POST /api/import/folder` (`apps/daemon/src/import-export-routes.ts:241`) is the real production
  route that creates such a project — C10F-5's red spec uses it directly.
- **`apps/daemon/src/storage/` already exists and is unrelated to this wave** — a Phase-5
  `ProjectStorage`/S3 adapter. This wave's module lives at `apps/daemon/src/storage-gc/`
  specifically to avoid colliding with it.
- **Wiring a Settings section requires more than the panel component itself.**
  `apps/web/src/components/SettingsDialog.tsx`'s `SettingsSection` is a closed string-literal union
  and every nav entry reads translated copy via a typed `t('settings.…')` call; root `AGENTS.md` →
  "i18n keys": `apps/web/src/i18n/types.ts` (typed `Dict`) and `apps/web/src/i18n/locales/en.ts`
  (the only locale file) are both required together, or the build fails typecheck.
- **`e2e/scripts/playwright.ts`'s `cleanArtifacts()` already names the exact, already-audited set of
  paths this repo treats as "100% machine-generated, safe to always wipe"**: `.od-data`,
  `test-results`, `reports/test-results`, `reports/visual-test-results`, `reports/html`,
  `reports/playwright-html-report`, `reports/results.json`, `reports/visual-results.json`,
  `reports/visual-screenshots`, `reports/visual-report`, `reports/junit.xml`, `.DS_Store` (all
  under `e2e/ui/`) — an unconditional, no-retention-window, no-dry-run CI hygiene tool with a
  different threat profile than this wave's GC. Founder Ruling 2 (below) brings a **narrow, aged**
  subset of this same, already-vetted path family into this wave's scope instead of inventing a new
  "is this generated content" heuristic — see "Founder rulings."

## Verifier fixture-isolation guarantee (closes round-1 finding 1, CRITICAL — outranks everything else in this document)

**The single most safety-critical property this PRD states.** The verifier proves storage-GC
safety by running real `plan`/`apply` cycles against fixtures. Round 1 found those fixtures were
built under the checkout's REAL `.tmp/tools-dev/...`, so a production `plan` could pick up **real,
inactive namespaces from the operator's own past dev sessions**, and a subsequent `apply` would
delete them. Fatal regardless of how correct the rest of the implementation is.

**Fix, belt and braces — both mandatory, neither substitutes for the other:**

1. **BRACE (primary isolation).** The storage-gc surface **must** accept `OD_STORAGE_TMP_ROOT` — an
   env var, read at daemon-boot time exactly like the existing `OD_DATA_DIR` precedent — that
   redirects every Tier-1 `.tmp/<source>/<namespace>` root resolution to
   `<OD_STORAGE_TMP_ROOT>/.tmp/<source>/<namespace>`. Unset, it falls back to the real project root
   exactly as today.
2. **BELT (independent, unconditional, verifier-side).** Before issuing **any** `apply` call, the
   verifier parses the `plan` response and refuses to call `apply` at all — fails the criterion
   outright — unless every candidate path is provably confined under that run's own
   `OD_STORAGE_TMP_ROOT`. Does not depend on the implementation honoring brace 1 correctly.
3. **PROOF (`FIXTURE-ISOLATION`, a verifier-safety meta-check, never a product criterion).**
   Structural: the verifier's own source is self-scanned to confirm the real checkout's
   `.tmp/tools-dev/` is referenced from **exactly one**, provably read-only function — a future edit
   that reintroduces a write-capable call elsewhere fails this check by construction. Runtime:
   before any fixture work, a read-only listing of whatever namespaces already exist in the real
   checkout is taken (never written to), and none may ever appear among the plan candidates
   observed across the entire run.

Every fixture in every dynamic criterion is built under a freshly `mkdtemp`'d temp project root —
never the checkout — and every daemon this verifier boots carries that temp root as
`OD_STORAGE_TMP_ROOT`.

## Threat model

| ID | Threat | Why it's catastrophic, not just buggy |
|---|---|---|
| T1 | **Root escape.** A candidate path resolves outside every allowed root, deleted anyway. | Nothing bounds the blast radius. |
| T2 | **Symlink escape.** An in-root symlink's target — especially a whole DIRECTORY — is outside it, enumerated/deleted through. | Unlink of a symlink never dereferences; the real risk is recursion following the link. |
| T3 | **Active-namespace deletion.** Deleted while a live process still uses it. | Corrupts or crashes a running session destructively. |
| T4 | **Imported-folder deletion.** Reaches into `metadata.baseDir`. | The user's own filesystem, outside this wave's entire boundary. |
| T5 | **Generic-walker misclassification.** "Walk RUNTIME_DATA_DIR, delete anything old" instead of an explicit allowlist. | Staleness and disposability are unrelated properties for user content. |
| T6 | **TOCTOU between plan and apply.** A stale plan blindly executed. | Dry-run-by-default is worthless if apply doesn't re-validate. |
| T7 | **Partial-failure inconsistency.** Report doesn't reflect what was actually removed vs. skipped. | A data-integrity failure one layer up from deletion itself. |
| T8 | **Retention-window misconfiguration treated as "delete everything now."** | The one operator-tunable knob becomes the easiest way to nuke a category. |
| T9 | **Report/reality drift.** Totals cached/derived from the plan rather than the filesystem. | Defeats the report's entire audit value. |
| T10 | **The gate itself deletes real data.** The verifier's own fixtures reach the operator's real checkout. | Round-1 CRITICAL. Closed by `OD_STORAGE_TMP_ROOT` + the belt check + `FIXTURE-ISOLATION`. |
| T11 | **Orphan-detection false positive.** A referenced artifact is misclassified as orphaned and deleted (Founder Ruling 3's "dangerous" category). | The orphan check is itself a bug surface with the same blast radius as T5 — a wrong "no referencing row" read destroys live, referenced user content. |

## Scope

**In scope**, per the pure-data registry (below), gated by Founder Rulings 1–3:

1. **Tier 1 — ephemeral tooling runtime roots** (`justification: 'inactive-namespace'`):
   `.tmp/tools-dev/<namespace>`, `.tmp/tools-serve/<namespace>`, `.tmp/tools-pack/<namespace>`
   (dormant in this fork). Eligibility: age past the category's window **and** namespace inactive
   (T3). **Default window: 7 days** (Ruling 1).
2. **Tier 2 — `RUNTIME_DATA_DIR`-derived content**, exactly the Ruling-3 allowlist, never more:
   - `justification: 'log-retention'` — daemon-owned log files under the resolved data root.
     **Default window: 14 days** (Ruling 1).
   - `justification: 'regenerable-cache'` — caches provably regenerable from a durable source (e.g.
     the plugin asset cache). **No default window** — not collectable until an operator explicitly
     sets one (Ruling 1: "a category with no stated window is NOT collectable").
   - `justification: 'orphan-checked'` — staging/temp artifacts with no referencing database row.
     **No default window**, same reason. **Closes T11 via C10F-17's mandatory paired red spec**
     (referenced survives; orphaned is collected) — Ruling 3's explicit "design consequence."
3. **Tier 3 — e2e test-output artifacts** (`justification: 'e2e-artifact'`, Ruling 2): **only** the
   subset of `e2e/scripts/playwright.ts`'s own already-audited clean-target paths (Ground facts),
   pinned literally in the registry (`pinnedRelativePaths`) and cross-checked against that file's
   real target list at verifier run time — never a new "is this generated" heuristic. **Default
   window: 3 days.**
4. Dry-run planning, apply-with-re-validation bound to a specific plan, and a before/after
   size+inventory report.
5. Configurable, boot-time, independently-effective, **and stated** retention windows: the resolved
   value actually governing eligibility is echoed verbatim in every `plan`/`report` response, and
   the DEFAULTS themselves are configuration values the implementation reads (C10F-15), never
   literals the GC hardcodes separately from what it's configured with.
6. UI + CLI surfaces over one shared `/api/storage/*` contract.

**Explicitly, permanently out of scope — the non-deletable set, named per Founder Ruling 3 so the
boundary is auditable** (default is always "keep"; a category not provably in the Tier-2/3
allowlist above is not deletable, full stop): **projects and project files** (`PROJECTS_DIR`,
wholesale, managed or imported, any age); **artifacts referenced by any project**; **the SQLite
database and its journals**; **app configuration**; **MCP config and tokens**; **connector
credentials**; **memory**; **automation state**; **plugin state**; **agent runtime homes**; and
**anything under an imported-folder project's `metadata.baseDir`**.

- **`e2e/ui/{reports,test-results,.od-data}` beyond the Tier-3 pinned allowlist.** Anything a user
  could plausibly have authored or moved into an e2e-adjacent directory (Ruling 2: "if the
  implementation cannot distinguish generated from user-placed content in a directory, that
  directory is out of scope") stays with `e2e/scripts/playwright.ts clean`, unconditional, no
  retention window, a different tool for a different threat profile.
- **Scheduled/automatic background sweeps.** v1 ships plan+apply as operator/automation-invoked,
  not a daemon-internal timer (Open founder question 3, advisory).
- **AI/semantic classification of "important" vs "disposable."** Eligibility is purely mechanical.
- Anything already covered by W0's backup/restore, W9's route-hardening tranches, or W4's cover
  storage.

## Founder rulings (delegate-authorized; recorded separately in `docs/plans/waves/DECISIONS.md`, which this wave's author does not edit)

The three freeze-blocking questions round 1 raised (defaults, e2e scope, `.od` deletable set) have
been answered by founder delegation. This PRD encodes the rulings below as its own authoritative
scope text; **C10F-14 still mechanically requires the real decision records to exist in
`DECISIONS.md` at the base commit before the gate can pass** — a ruling stated here is not a
substitute for the recorded, founder-signed entry.

**Ruling 1 — retention window defaults.** Safety-first, generous, explicitly overridable:
Tier-1 inactive `.tmp/<source>/<namespace>` roots: **7 days**. Tier-3 e2e/test artifacts: **3
days**. Tier-2 `log-retention` (daemon-owned logs under the resolved data root): **14 days**.
**Nothing else has a default window** — a category with no stated default is not collectable
without an explicit operator override. Defaults must be configuration values the implementation
reads (not literals buried in the GC), and C10F-15 asserts the stated defaults match the configured
ones so the PRD and the code cannot drift.

**Ruling 2 — are named e2e artifacts in scope? Yes, narrowly.** Only artifacts under the
repository's own test-output paths (`.tmp/**` — already Tier 1 — `test-results/**`,
`playwright-report/**`), and only past the 3-day window. Anything a user could plausibly have
authored or moved there is out of scope; if the implementation cannot distinguish generated from
user-placed content in a directory, that directory is out of scope. Operationalized as Tier 3,
pinned to `e2e/scripts/playwright.ts`'s own already-audited target list (C10F-16) — reusing an
existing, reviewed boundary rather than inventing a new heuristic.

**Ruling 3 — which `.od` categories are deletable? An explicit allowlist, never a denylist.**
Deletable: (a) log files past their window, (b) caches provably regenerable from a durable source,
(c) orphaned staging/temp artifacts with no referencing database row. Everything else is not
deletable — the non-deletable set is named explicitly in Scope above so the boundary is auditable.
If a category cannot be proven to fall in the allowlist, it is not deletable; the default is always
"keep." **Design consequence (mandatory):** orphan detection (c) is itself dangerous — a bug in
"has no referencing row" deletes live data — so orphan collection must be proven by a red spec in
which a referenced artifact is NOT collected, paired with a positive control where a genuinely
orphaned one is (C10F-17).

## Proposed capability surface

Descriptive target for the implementer — this PRD does not implement it. Several elements below are
**mandatory structural/testability requirements**, because the verifier's mechanical checks depend
on them existing in exactly this shape.

- **`OD_STORAGE_TMP_ROOT`** (mandatory testability hook, "Verifier fixture-isolation guarantee").
  Read once, at daemon-boot time.
- **CLI:** `od storage gc plan [--json]` (always dry-run), `od storage gc apply --plan <planId>
  --confirm [--json]` (rejects with non-zero exit + `{ok:false,error:{code,message}}` if
  `--confirm` is omitted or `--plan` names an unknown plan), `od storage report [--json]` (a
  sibling of `gc`, not nested under it).
- **HTTP:** `GET /api/storage/gc-plan`, `POST /api/storage/gc-apply` (body
  `{ planId: string, confirm: true }`), `GET /api/storage/report` — the **exact three route paths**
  the verifier checks for.
- **Registry shape (mandatory, pure data — no function-valued fields):**
  ```ts
  export const STORAGE_GC_REGISTRY = [
    { category: 'tools-dev', tier: 1, retentionEnvVar: 'OD_STORAGE_RETENTION_TOOLS_DEV_DAYS',
      defaultRetentionDays: 7, justification: 'inactive-namespace' },
    { category: 'e2e-test-output', tier: 3, retentionEnvVar: 'OD_STORAGE_RETENTION_E2E_TEST_OUTPUT_DAYS',
      defaultRetentionDays: 3, justification: 'e2e-artifact',
      pinnedRelativePaths: ['test-results', 'reports/test-results', 'reports/playwright-html-report'] },
    { category: 'daemon-logs', tier: 2, retentionEnvVar: 'OD_STORAGE_RETENTION_DAEMON_LOGS_DAYS',
      defaultRetentionDays: 14, justification: 'log-retention' },
    // regenerable-cache / orphan-checked entries: defaultRetentionDays MUST be null.
  ] as const;
  ```
  `retentionEnvVar` must match `/^OD_STORAGE_RETENTION_[A-Z0-9_]+_DAYS$/`. `defaultRetentionDays`
  must be the EXACT literal (`7`/`3`/`14`/`null`) the `justification` mandates (C10F-15). Tier-3
  entries require `pinnedRelativePaths` ⊆ `e2e/scripts/playwright.ts`'s own real clean-target list
  (C10F-16).
- **Response schemas (mandatory fields; extra fields fine):**
  ```ts
  // GET /api/storage/gc-plan, od storage gc plan --json
  { ok: true, planId: string,
    retentionWindows: { [category: string]: { days: number, source: 'default' | 'override' } },
    candidates: Array<{ path: string, category: string, namespace?: string, sizeBytes: number, ageDays: number }>,
    totals: { count: number, bytes: number } }
  // POST /api/storage/gc-apply (success), od storage gc apply --confirm --json
  { ok: true, planId: string,
    removed: Array<{ path: string, category: string, sizeBytes: number }>,
    skipped: Array<{ path: string, category: string, reason: string }>,
    totals: { removedCount: number, removedBytes: number } }
  // Rejection: non-2xx / non-zero exit
  { ok: false, error: { code: string, message: string } }
  // GET /api/storage/report, od storage report --json
  { ok: true, byCategory: Array<{ category: string, count: number, bytes: number }>,
    totals: { count: number, bytes: number } }
  ```
- **Separable plan/apply exports (mandatory, exact names):** `planStorageRetention` and
  `applyStorageRetention` — so `planStorageRetention`'s transitive call graph can be proven to
  contain no filesystem-delete primitive without disentangling CLI dispatch internals.
- **Contracts:** DTOs land in `packages/contracts/src/api/storage-gc.ts`, re-exported from
  `packages/contracts/src/index.ts`.
- **UI:** `apps/web/src/components/StorageRetention*.tsx` — new `SettingsSection` union member,
  sidebar nav entry, typed i18n keys, "Plan"/"Apply" actions, real `fetch()` calls whose URL
  argument is the exact string for each of the three routes.

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w10f.ts`.
Every criterion is **mechanical** — none is `human:`.

---

### C10F-1 — Target registry is a finite, pure-data allowlist, never a generic walk

**Statement.** The GC's candidate set is produced by iterating the mandated pure-data registry (no
spreads/`__proto__`/accessors/methods/computed keys anywhere in the literal). A directory not named
in the registry is never a candidate, **regardless of age** — proven at runtime. Closes **T5, T8**.

**Satisfiability.** Literal, statically readable data with every entry carrying
`category`/`tier`/`retentionEnvVar`/`defaultRetentionDays`/`justification`; eligibility logic
elsewhere consumes this data at runtime.

**Decoy.** A generic walker with an age filter fails the runtime half: a decoy fixture under an
**unlisted** category, aged 5000 days, is correctly excluded by a registry-shaped implementation
and wrongly included by a walker-shaped one.

**Verification.** AST scan for the pure-data shape and per-entry field validity. Runtime:
`gc plan --json` against a fixture under an unlisted category, aged 5000 days — never a candidate.

---

### C10F-2 — Root confinement: real containment, not string prefix

**Statement.** Checked against the union of allowed roots using resolved containment
(`path.relative`-based), never `startsWith`. Closes **T1**.

**Satisfiability.** Matches `isPathWithin`'s semantics, evaluated against every allowed root.

**Decoy.** `candidatePath.startsWith(allowedRoot)` fails at the **source level**: a fixture source
root `.tmp/tools-dev/<ns>` vs. an unrelated sibling `.tmp/tools-devEVIL/<ns>` sharing only the
string prefix.

**Verification.** Red spec seeds the source-level collision fixture plus a genuine in-scope file,
asserts by **exact path equality** against `candidates[].path`: the collision sibling never
appears; the real file's exact absolute path does.

---

### C10F-3 — Symlink escape refusal

**Statement.** A symlink inside an allowed root whose target is an external **directory** is never
followed for enumeration or deletion. Closes **T2**.

**Satisfiability.** lstat's directory entries; does not recurse through a symlink whose realpath
resolves outside every allowed root.

**Decoy.** A symlink-to-a-**file** test proves nothing (`unlink` never dereferences). The real
vulnerability is a symlink to a directory, followed during recursion.

**Verification.** Symlink (`dir` type) inside an eligible namespace → external fixture directory
with an aged file, plus a real in-scope expired file. Asserts: nothing under the external directory
ever appears in `candidates[].path`; its content hash is unchanged post-apply; the real file **is**
removed; `apply` reports `ok: true`.

---

### C10F-4 — Active-namespace refusal, across every Tier-1 category

**Statement.** Never planned/applied while a live process carries a matching sidecar stamp —
proven for every Tier-1 category the registry declares. Closes **T3**.

**Satisfiability.** Calls the production stamp-matching primitives directly, for every Tier-1
category uniformly.

**Decoy.** An mtime heuristic fails a namespace whose only write was at startup. A decoy
special-casing one category fails the multi-category sweep.

**Verification.** Per registry-declared Tier-1 category: real short-lived stamped process; excluded
while alive (exact-path match); included once inactive (exact-path match).

---

### C10F-5 — Imported-folder `baseDir` is untouchable

**Statement.** Never enumerated/stated/deleted, at any age, under any category — proven while a
genuine Tier-2 item **is** collected in the same run. Closes **T4**.

**Satisfiability.** Never enumerates `PROJECTS_DIR`/project metadata, or explicitly excludes any
`hasExternalProjectRoot` path before considering it.

**Decoy.** A hardcoded `PROJECTS_DIR`-substring filter fails a `baseDir` that doesn't textually
contain it. A GC that collects nothing (global no-op) fails the missing positive control.

**Verification.** Real imported-folder project via `POST /api/import/folder`, plus a genuine
orphaned Tier-2 fixture in the same run. Asserts: no candidate path equals/is prefixed by anything
under `baseDir`; the Tier-2 control **is** removed (exact path in `apply`'s `removed[]`); `baseDir`
content's hash is byte-identical before/after; `apply` reports `ok: true`.

---

### C10F-6 — Dry-run is the default and the only read path

**Statement.** `plan` never mutates the filesystem; CLI exits `0` with schema-valid JSON;
`planStorageRetention`'s own transitive call graph contains no filesystem-delete primitive. Closes
part of **T6**.

**Satisfiability.** Pure read; no `fs.rm`/`unlink`/`rmdir` anywhere in `planStorageRetention`'s own
closure.

**Decoy.** A shared `planAndMaybeApply(mutate)` function fails the exact-export-name requirement —
there is no `planStorageRetention` for the reachability BFS to root at.

**Verification.** Multiset of two fixture namespaces before/after `plan --json`; exit `0`,
schema-valid JSON, both trees byte-identical. AST reachability BFS from
`export function planStorageRetention` confirms zero delete-primitive calls.

---

### C10F-7 — Apply is a distinct, plan-bound, re-validated, confirm-gated action

**Statement.** Missing `--confirm` rejected; unknown `planId` rejected; realized `removed[]`
compared **exactly** (multiset) against the plan minus whatever became ineligible; a
re-validated-ineligible candidate carries a non-empty `reason`. Closes **T6, T7**.

**Satisfiability.** Rejects both negative cases outright; iterates the plan's exact list; re-runs
safety checks per candidate; records every skip with a reason.

**Decoy.** Re-scanning the registry at apply time (ignoring `planId`) lets a post-plan surprise file
get swept in — the multiset comparison catches it exactly.

**Verification.** Two negative controls first (no `--confirm`; unknown `planId`), then: plan; make
one candidate's namespace active and add a new post-plan file; apply. Assert exact multiset equality
of `removed[]` vs. plan-minus-ineligible; the ineligible file survives with a non-empty skip reason;
the surprise file is untouched and absent from `removed[]`.

---

### C10F-8 — Retention windows: boot-time, independently effective, and stated

**Statement.** Read at daemon-boot time (a thin HTTP-client CLI cannot retroactively change an
already-running daemon's own environment). Changing one category's window changes only that
category, holding others fixed. `0`/negative rejected as config errors. Resolved value echoed
**exactly** as `retentionWindows[category].days`. Closes **T8**.

**Satisfiability.** Boot-time validated parser per category; the same resolved value used for
eligibility is attached to the response.

**Decoy.** Placing the override on a CLI subprocess's env after the daemon already booted has no
effect on a thin-HTTP-client CLI. `JSON.stringify(...).includes('365')` accepts a coincidental
substring match.

**Verification.** Four dedicated daemon boots (never the shared one), override set BEFORE boot:
wide (`365`, survives), narrow (`1`, collected), `0`/`-5` (both rejected). Exact field comparison;
a second, untouched category held fixed across wide/narrow.

---

### C10F-9 — Size/inventory report, before and after, re-derived at runtime

**Statement.** Computed from real `fs.stat` at call time; compared **exactly** against an
independently-computed ground truth. Closes **T9**.

**Satisfiability.** Walks each category's actual root and `fs.stat`s at call time; re-derives
post-apply, never arithmetic-subtracts the plan's prediction.

**Decoy.** Arithmetic subtraction fails when a candidate's size changes between plan and apply.

**Verification.** A file whose size changes between plan and apply, plus a never-eligible survivor.
Before/after report; changed file gone (ground truth); after-totals differ from before; after-totals
consistent with the verifier's own independent post-apply stat walk.

---

### C10F-10 — UI/CLI parity over the three EXACT `/api/storage/*` routes

**Statement.** CLI, HTTP, and UI all drive the same three exact routes and DTOs. Manifest row
`parityApplicable: true` with an exact-set `httpPath`.

**Satisfiability.** `SUBCOMMAND_MAP.storage`'s handler and the UI panel both issue real requests
against the three exact paths.

**Decoy.** A manifest `httpPath` that is merely a prefix passes a naive check but fails exact-set
membership. A UI component mentioning a path only in a comment fails the AST scan (comments are
never visited).

**Verification.** Manifest row validity. **Runtime proof:** the shared daemon's real
`http.Server`'s `'request'` events are captured to a log for the whole C10F-2..C10F-9 run (attached
from outside, no production-code change); the log must contain a real `GET .../gc-plan`, `POST
.../gc-apply`, `GET .../report`. AST scan of every `StorageRetention*.tsx` for exact-path string
literals in real call-expression position.

---

### C10F-11 — Every red spec binds to the production GC path, strictly scoped

**Statement.** Every red spec imports a module inside `storage`'s **own** reachable set (never a
server.ts-wide union) **and references** the binding, or drives the real CLI/HTTP surface via a
real AST call-site.

**Satisfiability.** Imports the storage-gc module by its real path, or drives it exclusively via
real CLI/HTTP.

**Decoy.** An unwired lookalike module (`storage-gc/legacy-gc.ts`) fails the strictly-scoped BFS.
An import that's never referenced fails the imported-but-unused check.

**Verification.** Per spec file: resolve relative imports; require at least one inside
`storageReachable` AND actually referenced, or a real AST call-site for one of the three exact
paths.

---

### C10F-12 — Gates

**Statement.** `pnpm guard` and `pnpm typecheck` both exit `0`.

**Satisfiability.** No lint/type errors; a `storage` `SUBCOMMAND_MAP` key without the manifest row
fails guard immediately.

**Decoy.** A working engine that skips the manifest row fails this criterion even if C10F-1..9 pass.

**Verification.** Both commands run for real; exit codes checked exactly.

---

### C10F-13 — Adversarial review of the implementation is on record, non-spoofable

**Statement.** `docs/security/storage-gc-implementation-review.json`:
`{reviewer, model, reviewedCommit, verdict}`. `reviewedCommit` a strict ancestor of `HEAD`.
`reviewer` matches git's `%an <%ae>` shape exactly and is exact-distinct from every author across
`baseCommit..reviewedCommit`. `model` non-placeholder. Diff over the **full owned/lease surface**
between `reviewedCommit` and `HEAD` empty. `verdict === 'APPROVE'`.

**Satisfiability.** Commit the whole implementation as P; a distinct reviewer reviews P; the record
naming `reviewedCommit: P` is committed afterward.

**Decoy.** `reviewedCommit: HEAD` rejected by the strict-ancestor check. Substring matching let an
**empty reviewer string** trivially "not match" (round 1) — exact-distinctness fixes this. A partial
owned-path list let load-bearing surfaces drift post-review (round 1) — the full list below fixes it.

**Verification.** Strict-ancestor + `git diff --name-only reviewedCommit HEAD -- <full owned-path
list>` empty (`apps/daemon/src/storage-gc/**`, `apps/daemon/src/routes/storage-gc.ts`,
`apps/daemon/src/cli.ts`, `apps/daemon/src/server.ts`, `apps/daemon/tests/**`,
`packages/contracts/src/api/storage-gc.ts`, `packages/contracts/src/index.ts`,
`apps/web/src/components/SettingsDialog.tsx`, `apps/web/src/i18n/types.ts`,
`apps/web/src/i18n/locales/en.ts`, `scripts/waves/capability-manifest.json`,
`docs/security/daemon-threat-model.md`, `docs/security/storage-gc-implementation-review.json`,
`docs/plans/waves/DECISIONS.md`); `reviewer` matches `/^[^<>]+ <[^<>@]+@[^<>]+>$/` and is
exact-absent from `git log --format='%an <%ae>' baseCommit..reviewedCommit`; `model` non-empty,
≥2 chars, not a placeholder; `verdict === 'APPROVE'`.

---

### C10F-14 — Freeze-blocking founder decisions are recorded

**Statement.** Founder Rulings 1, 2, and 4 [sic — questions 1, 2, 4] must exist as real,
non-trivial entries in `docs/plans/waves/DECISIONS.md` before this criterion can pass. This wave's
author never writes to `DECISIONS.md`; the gate stays red until the orchestrator lands the records.

**Satisfiability.** Three entries, each introduced by a bolded marker `**W10F-FOUNDER-1**`,
`**W10F-FOUNDER-2**`, `**W10F-FOUNDER-4**`, followed by a real ruling before the next
blank-line/heading/marker boundary.

**Decoy.** This PRD's own prose stating the rulings (above) is NOT a substitute — only
`DECISIONS.md` counts. A near-empty or copy-pasted-question "ruling" (under 20 characters) fails
the non-trivial-content check.

**Verification.** Read-only parse of `DECISIONS.md` for each marker; extract text to the next
boundary; require ≥20 characters after trimming. All three required.

---

### C10F-15 — Retention defaults match Founder Ruling 1, exactly, as configuration not literals

**Statement.** The registry's `defaultRetentionDays` per `justification` matches Ruling 1 exactly
(`inactive-namespace` → 7, `log-retention` → 14, `e2e-artifact` → 3, `regenerable-cache` /
`orphan-checked` → `null`, i.e. no default, not collectable without an explicit override). With no
env override set, the daemon's own reported `retentionWindows[category]` reflects these exact
values with `source: 'default'`; a category with no default never yields a candidate until an
operator sets one explicitly.

**Satisfiability.** Defaults are read from the same registry the eligibility logic consumes — one
source of truth, never duplicated as separate literals in the GC and in a doc.

**Decoy.** An implementation whose GC hardcodes `7`/`14`/`3` inline while the registry's own
`defaultRetentionDays` field says something else (or is absent) fails the structural half even if
runtime behavior happens to match today — the two are graded independently so they cannot silently
diverge later. An implementation that gives `regenerable-cache`/`orphan-checked` categories a
non-null default fails Ruling 1's "nothing else has a default" clause directly.

**Verification.** Structural: registry `defaultRetentionDays` per entry matches the Ruling-1 table
above by `justification`. Runtime: dedicated daemon boot, **no env overrides at all**; for an
`inactive-namespace` category, `retentionWindows[cat] = {days: 7, source: 'default'}` exactly; for
`log-retention`, `14`; for `e2e-artifact`, `3`. For a `regenerable-cache`/`orphan-checked` category:
an aged fixture under it never appears as a candidate with no override set (positive control:
setting `<category>`'s env var explicitly makes an identically-aged fixture collectable).

---

### C10F-16 — e2e test-output scope is pinned to the existing generated-only allowlist (Founder Ruling 2)

**Statement.** Tier-3 registry entries' `pinnedRelativePaths` are a subset of
`e2e/scripts/playwright.ts`'s own real `cleanArtifacts()` target list — never a new, separately
invented "is this generated" heuristic. Content outside the pinned set, even under an
e2e-adjacent directory, is never eligible regardless of age.

**Satisfiability.** The registry's Tier-3 `pinnedRelativePaths` values are drawn directly from that
existing, already-audited list.

**Decoy.** A registry entry claiming a Tier-3 path NOT in `e2e/scripts/playwright.ts`'s real target
list (i.e. a self-invented "this also looks generated" guess) fails the cross-reference structurally
— caught before any runtime probe even runs. An implementation that generalizes past the pinned set
(e.g. sweeps an entire `e2e/ui/` subtree by pattern rather than the named files) fails the runtime
negative control below.

**Verification.** Structural: AST-extract the real string-literal path segments passed to
`path.join(...)` inside `cleanArtifacts()`; every Tier-3 registry `pinnedRelativePaths` entry must
be an exact member of that set. Runtime: a fixture aged past 3 days under a pinned path IS
collected; an otherwise-identical fixture aged the same amount under an unpinned, e2e-adjacent path
(simulating user-authored content the implementation must not generalize to) is NEVER collected.

---

### C10F-17 — Orphan detection is proven safe (Founder Ruling 3's mandatory design consequence)

**Statement.** `orphan-checked` collection requires a red spec proving, in one paired test: a
referenced artifact (a real row exists pointing at it) is never collected; a genuinely orphaned one
(no referencing row) is collected. Closes **T11**.

**Satisfiability.** `apps/daemon/tests/storage-gc-orphan-detection.test.ts` exists, binds to
production per C10F-11's rules, and contains two distinctly-titled test cases whose titles name
"referenced" and "orphan" respectively.

**Decoy.** A test asserting only the orphaned-collected half (no referenced-survives control) passes
a naive "orphan detection exists" check while leaving T11 wide open — this criterion requires both,
by name, structurally.

**Verification.** File existence + C10F-11-style import/reachability binding. AST scan for at least
two `test(...)`/`it(...)` call sites whose first-argument string literal contains, case-insensitive,
"referenced" (for the survives case) and "orphan" (for the collected case) respectively — a real
AST string-literal match, never a text/comment scan. This is a structural existence-and-binding
proof, not a full fixture the verifier constructs itself (the real DB reference mechanism is an
implementation detail this PRD does not prescribe); **C10F-13's adversarial-review record is the
second, human-in-the-loop layer that must independently judge the genuineness of both fixtures**
before `verdict: APPROVE` is legitimate.

---

### FIXTURE-ISOLATION, GATE-INTEGRITY, LEASE, HEAD-DRIFT

Meta/infra checks — about the gate's own integrity and safety, never the product:

- **FIXTURE-ISOLATION** — see "Verifier fixture-isolation guarantee." Structural self-scan + runtime
  no-leak proof. Mechanical closure of round-1 finding 1.
- **GATE-INTEGRITY** — sha256 of the verifier and this PRD checked against an orchestrator-held
  `approved-gate.sha256`. Advisory pre-approval; blocking once it exists.
- **LEASE** — diff subset of `leases.json@baseCommit`'s `W10f` entry. Fails cleanly pre-freeze (no
  entry exists yet).
- **HEAD-DRIFT** — HEAD unchanged during the run.

## Proposed lease

PRD text only — `leases.json` is not edited by this wave's expansion.

**Allow (future implementation):**

- `apps/daemon/src/storage-gc/**` — new module. **Deliberately not `apps/daemon/src/storage/**`**
  (existing, unrelated Phase-5 S3 adapter).
- `apps/daemon/src/routes/storage-gc.ts` — new HTTP route file.
- `apps/daemon/tests/storage-gc-*.test.ts` — red specs, including
  `storage-gc-orphan-detection.test.ts` (C10F-17).
- `packages/contracts/src/api/storage-gc.ts` — new contract DTOs.
- `packages/contracts/src/index.ts` — narrow addition only: one new re-export line.
- `apps/web/src/components/StorageRetention*` — new Settings panel (prefix glob, mirrors W4's
  `DesignsTab*`/`RecentProjectsStrip*` convention).
- `apps/web/src/components/SettingsDialog.tsx` — narrow addition only: one `SettingsSection` union
  member, one nav button, one render branch. Shared/contested; confirm no concurrent writer;
  amend-on-proof if a same-burst conflict emerges.
- `apps/web/src/i18n/types.ts`, `apps/web/src/i18n/locales/en.ts` — narrow addition only: the new
  typed keys the panel needs. Shared; amend-on-proof if contested.
- `apps/daemon/src/cli.ts` — register the `storage` key. Shared/contested; amend-on-proof.
- `apps/daemon/src/server.ts` — register the new routes. Same caveat.
- `scripts/waves/capability-manifest.json` — one new row.
- `docs/security/daemon-threat-model.md` — append-only, new `## Wave 10f` section.
- `docs/security/storage-gc-implementation-review.json` — the C10F-13 review record.
- `docs/plans/waves/DECISIONS.md` — for recording the three founder rulings (C10F-14) and any
  further decisions from the advisory open questions.

**Deny (explicit, house rule):**

- `docs/plans/waves/W10f-storage.md` — this PRD. Frozen.
- `scripts/waves/verify-w10f.ts` — this verifier. Frozen.
- `docs/plans/waves/leases.json` — mechanical, orchestrator-owned.
- `docs/plans/waves/VERIFICATION-CONTRACT.md`, `docs/plans/waves/GLOBAL-GOAL.md` — frozen contract
  documents.
- `apps/daemon/src/projects.ts`, `apps/daemon/src/daemon-paths.ts` — cited/reused, not modified.
  Amend-on-proof.
- Every other wave's exclusively-owned files — implicit via the allowlist-only enforcement model.

## Open founder questions

**1, 2, and 4 are now RULED** (see "Founder rulings" above) — the gate stays mechanically bound to
the real `DECISIONS.md` records landing (C10F-14), not to this PRD's restatement of them. **3, 5,
6, 7 remain advisory** — this PRD states its working assumption for each and does not block
freezing on them.

3. **[Advisory] Should GC ever run on a timer inside the daemon process**, or stay strictly
   operator/automation-invoked for v1? This PRD assumes the latter (Scope).
5. **[Advisory] Resumability/idempotency contract for a failed or interrupted `apply`.** This PRD
   assumes "some deleted, report says exactly which, a fresh plan+apply cycle is always safe to
   re-run" is sufficient (embedded in C10F-7's re-validation requirement).
6. **[Advisory] Durable audit log of apply runs** — should one exist, and where does it live
   without becoming its own unbounded-growth vector? Not addressed by this PRD.
7. **[Advisory] Size-based trigger in addition to age-based retention** — an advisory-only "you are
   over N GB" signal? This PRD assumes pure per-category age-based eligibility suffices for v1.

## How the verifier runs

```bash
pnpm exec tsx scripts/waves/verify-w10f.ts
```

Writes a commit-bound proof manifest to
`~/.claude/goal-state/mishmash-w10f-storage/proof/manifest.json` and prints a per-criterion
scoreboard. Exits non-zero if any criterion fails, the tree is dirty, or the manifest fails to
write.

## Verified baseline (this run, pre-implementation, post round-2 fix)

Every `C10F-*` and `FOUNDER`/`FIXTURE-ISOLATION`/infra check runs clean-red: dynamic criteria fail
by name ("product surface missing"), C10F-14/15/16 (structural halves) fail by name pending the
implementation and the landed `DECISIONS.md` records, `FIXTURE-ISOLATION`/`GATE-INTEGRITY`/
`HEAD-DRIFT` pass, `LEASE` fails by name (no `W10f` entry yet). The run never touches ports
7456/51012 (confirmed via `lsof` before/after — unchanged) and leaves no orphaned processes.

## Round-1 findings → closures

| # | Severity | Finding (condensed) | Closure |
|---|---|---|---|
| 1 | CRITICAL | Fixtures built under the real checkout `.tmp/tools-dev/`; apply could delete real data | `OD_STORAGE_TMP_ROOT` (brace) + `assertPlanConfinedToTempRoot` before every apply (belt) + `FIXTURE-ISOLATION` structural+runtime proof |
| 2 | HIGH | C10F-1 accepted unsafe literals and banned all `readdir`; C10F-2 never injected the collision into the real path; C10F-3's symlink-to-file test proved nothing | Pure-data registry validator; runtime decoy-directory proof replaces the readdir ban; C10F-2 moved to source-level collision with exact-path JSON assertions; C10F-3 rebuilt around a symlink-to-DIRECTORY |
| 3 | HIGH | C10F-4 one category, substring match; C10F-5 no positive control, no apply-response check | C10F-4 sweeps every Tier-1 category with exact-path JSON; C10F-5 adds a genuine positive control and checks `apply`'s parsed response |
| 4 | HIGH | C10F-6 ignored exit/JSON validity, one namespace, no real reachability proof; C10F-7 missing negative controls, no exact multiset, no skip-reason check; daemon teardown unproven | C10F-6 checks exit+schema+multi-namespace+real reachability BFS; C10F-7 adds both negative controls + exact multiset diff + skip-reason check; teardown uses `@open-design/platform`'s real process-tree utilities |
| 5 | HIGH | C10F-8 set env on the CLI subprocess after the daemon already booted; one category; substring match | C10F-8 boots four dedicated daemons with the override set at BOOT time; exact field comparison; a second category held fixed |
| 6 | HIGH | C10F-10 accepted a path prefix and any similarly-named call; C10F-11 unioned the whole server.ts graph and accepted comment-text matches | C10F-10 requires the three exact routes AND real captured HTTP traffic AND an AST-exact UI call-site scan; C10F-11 scopes reachability strictly and adds an imported-but-unused check |
| 7 | HIGH | C10F-13 `model` unvalidated; `reviewer` substring-matched (empty string always "matched"); owned-paths list incomplete | `model` validated non-placeholder; `reviewer` exact-format + exact-distinctness; owned-paths expanded to the full lease surface |
| 8 | HIGH | Lease missing contracts-barrel/SettingsDialog/i18n grants; founder questions 1/2/4 left open | Lease expanded; C10F-14 added, mechanically binding the gate to real `DECISIONS.md` records; questions 1/2/4 now ruled (Founder rulings) and operationalized as C10F-15/16/17 |
