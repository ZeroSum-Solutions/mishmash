# Wave 10f — Storage retention & GC (NM-36C)

**Slug:** `mishmash-w10f-storage`
**Gates on:** W0 (landed)
**Loop:** `loop:red-green-review` (`VERIFICATION-CONTRACT.md` §6)
**Verifier:** `scripts/waves/verify-w10f.ts`
**Write lease (proposed, not yet in `leases.json`):** see **Proposed lease** below. This wave has
**no** `leases.json` entry today — that is expected and mechanically checked (see the **LEASE**
criterion): the orchestrator adds the entry only after this PRD and its verifier are frozen and
independently approved.

**Status: EXPANSION DRAFT, fix round 3 (rounds 1 and 2 REJECTed).** This document is an
**expansion of the `W5-W11-gated.md` Wave 10 skeleton (`w10f-storage` row, NM-36C paragraph)**,
produced under the "expansion gate" (`W5-W11-gated.md` lines 8–24): written and frozen *before* any
implementation work starts, reviewed by an adversarial reviewer who did not write it and will not
implement it, and unfrozen for a `/goal` run only after that review returns APPROVE. **No
implementation exists yet.** Any agent that begins implementing storage GC from this document, from
the skeleton it expands, or from its own reading of the codebase before this PRD and its verifier
are frozen and reviewed is committing the exact self-certification failure the expansion gate
exists to prevent (`W5-W11-gated.md` lines 10–13) — a hard reject.

**Round-1 disposition.** REJECTed on one CRITICAL finding (the verifier's own fixture methodology
could delete real data in the operator's checkout) plus seven HIGH findings. Closed via
`OD_STORAGE_TMP_ROOT` + a lexical "belt" check gating every `apply` call + a new `FIXTURE-ISOLATION`
meta-check — see **Round-1 findings → closures** near the end.

**Round-2 disposition.** REJECTed again on the SAME underlying defect class, disguised: the round-1
belt validated only the lexical paths a `plan` response *claimed*, then handed unconstrained
production code nothing but a bare `planId` — a description of the work, never the work itself.
Seven more HIGH findings accompanied it (a Tier-1-mislabeled-as-Tier-2 positive control, reported-
not-realized accounting, decorative AST bindings, a token-presence founder-decision gate, an
unsatisfiable review-record path set, unconfirmed daemon teardown, and a false-red in this PRD's own
registry example). **Binding ruling: the verifier must never invoke `apply` — not against a temp
root, not with `--confirm`, not ever.** This round is the resulting architectural change, not
another patch — see **Verifier safety model** (renamed from "fixture-isolation guarantee") and
**Round-2 findings → closures** near the end. The three freeze-blocking founder questions raised in
round 1 have since been answered by founder delegation (see **Founder rulings**, immediately after
Scope) and their real decision records have now landed in `docs/plans/waves/DECISIONS.md` — this
PRD's own author does not edit that file, and C10F-14 binds mechanically to the real headings there,
not to this PRD's restatement of them.

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
Round 1 sharpened this further: **the gate itself is part of the threat surface.** Round 2 sharpened
it again: a gate that can only inspect a *description* of a destructive action (a lexical check on
a `plan` response, a bare `planId` handed to a black box) is not a gate — the fix is not a tighter
description-checker, it is making the destructive action structurally unreachable from the gate at
all. This verifier **never invokes `apply`**, under any name, against any root, with or without
`--confirm` — see "Verifier safety model" below.

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

## Verifier safety model (closes round-1 finding 1 and the round-2 CRITICAL finding — outranks everything else in this document)

**The single most safety-critical property this PRD states, now in its third and final shape.**
Round 1 found the verifier's fixtures were built under the checkout's REAL `.tmp/tools-dev/...`, so
a production `plan` could pick up real, inactive namespaces from the operator's own past dev
sessions, and a subsequent verifier-issued `apply` would delete them. The round-1 fix — an
`OD_STORAGE_TMP_ROOT` "brace" plus a lexical "belt" gating every verifier-issued `apply` call — was
REJECTED again in round 2: the belt validated only the paths a `plan` response *claimed* it would
touch, then `apply` was invoked with nothing but a bare `planId`, which unconstrained production
code is free to re-derive its own deletion targets from however it likes. **The belt validated a
description of the work, never the work itself — no tighter belt fixes that, because the verifier
cannot observe or constrain what a black-box `apply` implementation does on the other side of an
HTTP/CLI boundary it doesn't control.**

**Binding ruling (round 2, unconditional): this verifier never invokes `apply` — not against a temp
root, not with `--confirm`, not as a negative control expected to be rejected, not ever.** Coverage
that used to come from calling `apply` and inspecting its response is re-established two different
ways, matched to what each criterion actually needs to prove:

1. **PLAN-ONLY, verifier-side (safe, real, never destructive).** Anything that only needs to prove
   something about *eligibility* — which paths become candidates, under what category, with what
   retention window, reported how — keeps booting an isolated daemon, building real fixtures under a
   fresh temp root, and calling `od storage gc plan`/`report` for real. `plan` is dry-run by
   construction and C10F-6 proves its own call graph contains no delete primitive, so this stays
   unconditionally safe regardless of what fixtures exist. The `OD_STORAGE_TMP_ROOT` brace from
   round 1 is kept exactly for this: the storage-gc surface **must** accept it — an env var, read at
   daemon-boot time exactly like the existing `OD_DATA_DIR` precedent — redirecting every Tier-1
   `.tmp/<source>/<namespace>` root resolution to `<OD_STORAGE_TMP_ROOT>/.tmp/<source>/<namespace>`.
   Unset, it falls back to the real project root exactly as today. Every Tier-1 fixture in every
   plan-only criterion is built under a freshly `mkdtemp`'d temp project root — never the checkout —
   and every daemon this verifier boots carries that temp root as `OD_STORAGE_TMP_ROOT`; every Tier-2
   (`RUNTIME_DATA_DIR`-rooted) fixture is built under that same daemon's freshly `mkdtemp`'d
   `OD_DATA_DIR`. The round-1 belt survives, renamed and repurposed as plan-CORRECTNESS evidence
   folded into every observed plan (never a destructive-action gate, since nothing destructive is
   gated here anymore): every plan candidate this run ever observes must stay confined to one of
   those two fixture roots.
2. **DELETION SEMANTICS, as the PRODUCT'S OWN vitest tests — never this verifier.** Proving a file is
   *really gone* (not merely "reported removed") can only be done by code that runs `apply` for real
   against a fixture root **it constructs itself**, entirely inside the daemon's own test process —
   exactly what `apps/daemon/tests/*.test.ts` already does throughout this codebase. Five **required
   red-spec test files** are mandated by exact name and exact required test title(s) — see "Required
   red-spec test files," below. Each one must assert REALIZED on-disk state (`fs.existsSync`/
   `fs.readdirSync` against the fixture root that test built itself) — a reported `removed[]`/
   `skipped[]` accounting is evidence a well-written test may also check, never the assertion the
   verifier trusts. For each required file the verifier proves, and never assumes: it **exists** at
   HEAD with every required title present (real AST `test(...)`/`it(...)` call sites); it is **bound**
   to the production GC path (imports a module inside `storage`'s own reachable set and references
   the binding, or drives a real endpoint path from a real call-expression position); and it went
   **red before green** — proved by REAL vitest execution, never by reading source: at HEAD, right
   now, in this real checkout, every required title passes; independently, the file's own
   *introduction commit* (the first commit in `baseCommit..HEAD` history adding that exact path) is
   checked out into an isolated `git worktree add --detach`, given a frozen `pnpm install --offline
   --frozen-lockfile`, and run for real *as committed at that commit* (no HEAD overlay) — proving the
   file did not arrive already fully green.

   **On "does the verifier reach `apply`" — a distinction stated explicitly so a future reviewer does
   not re-litigate it.** Running the required red specs means the verifier spawns `vitest`
   (`sh('pnpm', [...'vitest','run'...])`), which executes the product's own test file, which itself
   calls `apply`. That is *not* the class the round-2 binding ruling closed, and is not required to
   be closed by it. The failure mode that ruling exists to prevent is: the gate constructs a deletion
   plan, executes it, and thereby only ever inspects a *description* of the work it is supposed to
   judge. Running the product's own test suite is categorically different — the verifier chooses no
   target, builds no plan, passes no `--confirm`, and owns no fixture; it only reads a JSON verdict
   from a test file that constructs and owns its own fixture root, exactly what ordinary CI already
   does for every test in this repo. If executing the product's tests counted as the verifier
   "reaching" `apply`, no gate could ever run tests at all. **What this does NOT settle:** whether a
   given required red-spec file actually confines its own fixture root correctly is a genuine,
   separate concern — a badly-written product test could delete something real. That is a
   **product-test review concern, not a gate-architecture concern**, and C10F-13's adversarial review
   is where it is named and judged (see C10F-13, below).
3. **`NO-DESTRUCTIVE-INVOCATION` (new, self-enforcing) plus a type-level closure.** A dedicated
   meta-check AST-scans the verifier's own source and fails the gate if a future edit reintroduces an
   `apply`/`--confirm`/`gc-apply` invocation anywhere. Round 3: this scan is honestly a *regression
   guard* for the two literal idioms this file uses today (a literal array element, a literal/
   template URL) — it would not by itself catch a deliberately obfuscated future bypass (string
   concatenation, a renamed wrapper, variable indirection). The residual is closed at the type level
   instead of the scan level: `runStorageCli`'s `args` parameter is typed `readonly
   SafeStorageCliArg[]`, a closed literal-string union (`'gc' | 'plan' | 'report' | '--json'`) that
   does not include `'apply'` or `'--confirm'` at all — passing either is a TypeScript compile error,
   caught by `pnpm typecheck`, which C10F-12 already runs on every invocation (`tsc -p
   scripts/tsconfig.json --noEmit`, included via the root `typecheck` script, covers this file). A
   computed/concatenated string is never assignable to a closed literal union without an explicit,
   visible, auditable unsafe cast — obfuscation stops being a scan-evasion problem and becomes a
   compile error. The AST scan stays as defense in depth; it costs nothing.
4. **`FIXTURE-ISOLATION` (meta, carried forward from round 1, strengthened in round 2 and round 3).**
   Structural: the verifier's own source is self-scanned to confirm the real checkout's
   `.tmp/tools-dev/` is referenced from **exactly one**, provably read-only function. Runtime: before
   any fixture work, a read-only listing of whatever namespaces already exist in the real checkout is
   taken (never written to), and none may ever appear among the plan candidates observed across the
   entire run. Round 2 added two more mandatory conjuncts to this same check's pass condition: every
   plan candidate observed this run stayed confined to its own fixture roots (item 1, above), and
   **every daemon teardown this run performed confirmed zero survivors** — a failed or partial teardown fails
   `FIXTURE-ISOLATION`, and therefore fails the run; it is never merely recorded as evidence. Daemon
   teardown itself is rebuilt around POSIX process **groups**: every daemon subprocess is spawned
   detached (its own session/process group, pgid = its own pid), teardown signals the whole group
   (`process.kill(-pgid, sig)`, SIGTERM then SIGKILL escalation) and **polls for zero survivors**
   before resolving — a process-group leader's own `exit` event is never treated as proof the whole
   group exited, per `DECISIONS.md`'s `W9AS-PARK` carry-forward (a sibling wave was parked over
   exactly this failure mode).

   **Round 3: a third, honest terminal state — `not-exercised` — distinct from both `pass` and
   `fail`.** `allDaemonTeardownResults.every(r => r.ok)` on an empty array is `true` by JS semantics,
   not by evidence. Pre-implementation, `storageEntry` is `null`, so no plan-only criterion's
   `requireSharedDaemon()` call and no dedicated-daemon-boot criterion ever calls
   `bootIsolatedDaemon()` at all — zero plans observed, zero daemons booted, zero teardowns
   performed. Reporting a bare `pass` in that state would claim the process-group teardown mechanism
   had been proven safe when it never ran. `FIXTURE-ISOLATION` now distinguishes: an actual
   structural defect (always evaluated, since the self-scan runs regardless of implementation state)
   or an actual leak/confinement/teardown *failure* (only possible once something was exercised, so
   these cannot false-fail pre-implementation) still fails outright; a clean structural scan with
   zero plans observed and/or zero daemons booted reports `not-exercised` — not a defect finding, but
   not a proof either; only when everything checked *and* both runtime conjuncts were genuinely
   exercised does it report a real `pass`. `not-exercised` blocks the overall gate exactly like
   `fail` does (see "How the verifier runs") — it is reported separately for honesty, never treated
   as equivalent to a proven pass. This mirrors this program's existing precedent for an honest
   non-pass terminal state (W1's C1-12 `blocked-on-founder`, which can never read `pass`), and closes
   the same failure class `scripts/waves/verify-w0.ts` already guards against by pairing every
   `.every()` on a results array with an explicit `length > 0 &&` guard.

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
| T10 | **The gate itself deletes real data.** The verifier's own fixtures reach the operator's real checkout, or the verifier's own destructive calls reach real data through a black-box `apply`. | Round-1 CRITICAL, then round-2 CRITICAL on the same class disguised. Closed by never invoking `apply` from the verifier at all (`NO-DESTRUCTIVE-INVOCATION`, self-enforcing), `OD_STORAGE_TMP_ROOT` + `FIXTURE-ISOLATION` for the remaining plan-only fixture risk, and moving every deletion-realization proof into the product's own tests over fixture roots those tests construct themselves. |
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
- **Response schemas (mandatory fields; extra fields fine).** `retentionWindows[category].source` is
  **tri-state** (round-2 fix — the round-1 schema had no way to represent "no default and no
  override," so a no-default category's response shape was undefined): `'default'` (the registry's
  own Ruling-1 value is in effect), `'override'` (an operator env var is in effect), or `'unset'`
  (no default and no override — `days` **must** be the literal `null`, and the category may never
  yield a candidate). `days` is therefore `number | null`, never a fabricated number for an unset
  category.
  ```ts
  // GET /api/storage/gc-plan, od storage gc plan --json
  { ok: true, planId: string,
    retentionWindows: { [category: string]: { days: number | null, source: 'default' | 'override' | 'unset' } },
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
  The `gc-apply` schema is still a real, mandatory product surface — this verifier simply never
  calls it; the five required red specs (below) do, against fixture roots they build themselves.
- **Separable plan/apply exports (mandatory, exact names):** `planStorageRetention` and
  `applyStorageRetention` — so `planStorageRetention`'s transitive call graph can be proven to
  contain no filesystem-delete primitive without disentangling CLI dispatch internals.
- **Contracts:** DTOs land in `packages/contracts/src/api/storage-gc.ts`, re-exported from
  `packages/contracts/src/index.ts`.
- **UI:** `apps/web/src/components/StorageRetention*.tsx` — new `SettingsSection` union member,
  sidebar nav entry, typed i18n keys, "Plan"/"Apply" actions, real `fetch()` calls whose URL
  argument is the exact string for each of the three routes.

### Required red-spec test files (mandatory, exact names and exact required test titles)

The product's own tests, never the verifier, prove deletion is realized. Each file must build its
own fixture root (never the checkout, never a directory the verifier controls), run a real `apply`
against it, and assert `fs.existsSync`/`fs.readdirSync` on that root directly — reported
`removed[]`/`skipped[]` accounting may additionally be checked but never substitutes for the
on-disk assertion. Test titles are matched **exactly** (`test('<exact title>', ...)` /
`it('<exact title>', ...)`) — the verifier finds each file's own introduction commit by walking real
git history and replays it in an isolated worktree to prove genuine red-before-green (see "Verifier
safety model").

| File (`apps/daemon/tests/`) | Required test title(s) (verbatim) | Closes |
|---|---|---|
| `storage-gc-symlink-escape.test.ts` | `W10F-GC: a symlink to an external directory inside an eligible namespace is never entered by apply, and a real expired file in the same namespace is removed` | T2 |
| `storage-gc-imported-folder.test.ts` | `W10F-GC: apply never removes anything under an imported-folder project's metadata.baseDir, while a genuine orphaned Tier-2 fixture in the same run is removed` | T4 |
| `storage-gc-apply-semantics.test.ts` | `W10F-GC: apply without --confirm is rejected and deletes nothing`; `W10F-GC: apply against an unknown planId is rejected and deletes nothing`; `W10F-GC: apply's realized removed[] set exactly equals the plan's candidates minus a namespace that became active after planning, and the survivor is skipped with a non-empty reason`; `W10F-GC: a file created after planning is never removed by apply even though it lives in an otherwise-eligible namespace` | T6, T7 |
| `storage-gc-report-reconciliation.test.ts` | `W10F-GC: report totals after apply equal a fresh on-disk stat walk of the surviving fixture tree, not the plan's predicted totals` | T9 |
| `storage-gc-orphan-detection.test.ts` | `W10F-GC: a referenced artifact with a live database row is never a plan candidate and is never removed by apply`; `W10F-GC: a genuinely orphaned artifact with no referencing database row is a plan candidate and is removed by apply` | T11 |

`storage-gc-apply-semantics.test.ts` additionally must drive the exact `/api/storage/gc-apply` path
from a real call-expression position — C10F-10 cross-references this specific binding as its
gc-apply parity proof, since the verifier itself never generates gc-apply traffic to log.

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w10f.ts`.
Every criterion is **mechanical** — none is `human:`.

---

### C10F-1 — Target registry is a finite, pure-data allowlist, never a generic walk

**Statement.** The GC's candidate set is produced by iterating the mandated pure-data registry (no
spreads/`__proto__`/accessors/methods/computed keys anywhere in the literal, and legitimately
wrapped in `as const`). A directory not named in the registry is never a candidate, **regardless of
age**, at **either tier** — proven at runtime. Every registry category has a corresponding
`retentionWindows` key in the real runtime response, so a decorative registry paired with a parallel
hardcoded eligibility list cannot pass silently. Closes **T5, T8**.

**Satisfiability.** Literal, statically readable data with every entry carrying
`category`/`tier`/`retentionEnvVar`/`defaultRetentionDays`/`justification`; eligibility logic
elsewhere consumes this data at runtime, and the plan response's `retentionWindows` keys are drawn
from it.

**Decoy.** A generic walker with an age filter fails the runtime half: a decoy fixture under an
**unlisted** category, aged 5000 days, is correctly excluded by a registry-shaped implementation and
wrongly included by a walker-shaped one — round 2: probed at **both** Tier 1
(`.tmp/not-a-real-category/...`) and Tier 2 (a decoy directory directly under `RUNTIME_DATA_DIR`),
since a Tier-1-only probe never exercises the `.od`-side allowlist Founder Ruling 3 requires.

**Verification.** AST scan for the pure-data shape (unwrapping an `as const` assertion around the
array literal) and per-entry field validity. Runtime: `gc plan --json` against an unlisted-category
decoy at Tier 1 **and** an unlisted-category decoy directly under `RUNTIME_DATA_DIR` (Tier 2) —
neither is ever a candidate. Cross-check: every registry entry's `category` has a corresponding key
in the plan's own `retentionWindows`.

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
resolves outside every allowed root; the required red spec's own `apply` proves the external content
survives and the real in-scope file is removed.

**Decoy.** A symlink-to-a-**file** test proves nothing (`unlink` never dereferences). The real
vulnerability is a symlink to a directory, followed during recursion.

**Verification.** Two halves, never overlapping in what they prove. *Plan-only (verifier-side,
safe):* symlink (`dir` type) inside an eligible namespace → external fixture directory with an aged
file, plus a real in-scope expired file; asserts nothing under the external directory ever appears
in `candidates[].path`, and the real in-scope expired file does. *Deletion semantics (the product's
own test, never the verifier):* `storage-gc-symlink-escape.test.ts` (required red-spec table, above)
proves the external content's hash survives a real `apply` and the real in-scope file is actually
gone, over a fixture root it builds itself.

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
`hasExternalProjectRoot` path before considering it; the required red spec's own `apply` proves
`baseDir` survives byte-identical and the Tier-2 control is actually gone.

**Decoy.** A hardcoded `PROJECTS_DIR`-substring filter fails a `baseDir` that doesn't textually
contain it. A GC that collects nothing (global no-op) fails the missing positive control — round 2:
the positive control must be a genuine **Tier-2** (`RUNTIME_DATA_DIR`-rooted) fixture, never a
Tier-1 (`.tmp/...`) fixture mislabeled as Tier-2, which would prove nothing about `.od`-side
collection at all.

**Verification.** Two halves, never overlapping in what they prove. *Plan-only (verifier-side,
safe):* a real imported-folder project via `POST /api/import/folder`, plus a genuine Tier-2
(`RUNTIME_DATA_DIR`-rooted) fixture aged past a registry-declared window; asserts no candidate path
equals/is prefixed by anything under `baseDir`, and the Tier-2 fixture **is** a candidate.
*Deletion semantics (the product's own test, never the verifier):*
`storage-gc-imported-folder.test.ts` (required red-spec table, above) proves `baseDir`'s content
hash survives a real `apply` byte-identical while the Tier-2 control is actually gone, over a
fixture root it builds itself.

---

### C10F-6 — Dry-run is the default and the only read path

**Statement.** `plan` never mutates the filesystem; CLI exits `0` with schema-valid JSON;
`planStorageRetention`'s own call graph contains no filesystem-delete primitive. Closes part of
**T6**.

**Satisfiability.** Pure read; no `fs.rm`/`unlink`/`rmdir` reachable from `planStorageRetention`'s
own body, or from any function it actually calls, transitively.

**Decoy.** A shared `planAndMaybeApply(mutate)` function fails the exact-export-name requirement —
there is no `planStorageRetention` for the call-graph walk to root at. Round 2: a **file-level**
reachability check (any delete call anywhere in the whole transitively-imported file set) both
false-reds a `planStorageRetention` that happens to share a file with a correct
`applyStorageRetention` containing a real delete call, and under-attributes a delete call reached
only through an indirect same-file helper. A real, function-level call graph closes both directions.

**Verification.** Multiset of two fixture namespaces before/after `plan --json`; exit `0`,
schema-valid JSON, both trees byte-identical. A real, memoized, cycle-safe call graph walk rooted at
`export function planStorageRetention` — following only calls it actually makes, to same-file
functions or functions imported from inside `storage`'s own reachable set — confirms zero
delete-primitive calls anywhere in that graph.

---

### C10F-7 — Apply is a distinct, plan-bound, re-validated, confirm-gated action

**Statement.** Missing `--confirm` rejected; unknown `planId` rejected; realized `removed[]`
compared **exactly** (multiset) against the plan minus whatever became ineligible; a
re-validated-ineligible candidate carries a non-empty `reason`; a post-plan surprise file is never
swept in. Closes **T6, T7**.

**Satisfiability.** Rejects both negative cases outright; iterates the plan's exact list; re-runs
safety checks per candidate; records every skip with a reason; the required red spec's own `apply`
proves all of the above against realized on-disk state.

**Decoy.** Re-scanning the registry at apply time (ignoring `planId`) lets a post-plan surprise file
get swept in. Round 2: trusting the **reported** `removed[]` array for this comparison is itself
gameable — an implementation can delete the surprise file while simply omitting it from `removed[]`
and pass. The round-1 verifier-side version of this criterion also violates the round-2 binding
ruling by construction: proving any of this requires calling `apply`, which this verifier may never
do, including as a "should be rejected" negative control.

**Verification.** Entirely the required red spec (round 3 — this verifier calls `apply` for none of
this, ever): `storage-gc-apply-semantics.test.ts` (required red-spec table, above) must, over a
fixture root it builds itself, reject a missing `--confirm` and an unknown `planId`; assert the
realized on-disk survivor set exactly equals the plan minus a namespace that became active after
planning (multiset), with a non-empty skip reason on that survivor; and assert a post-plan surprise
file literally still exists on disk after `apply` returns. The verifier proves this file exists, is
bound to production (including the exact `/api/storage/gc-apply` call-expression binding), and
proves each required title red-before-green by real vitest execution — see "Verifier safety model."

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
substring match. Round 2: requiring the daemon to have successfully booted before treating `0`/`-5`
as "rejected" false-reds a correct implementation that fails fast and refuses to boot at all on an
invalid window — refusing to boot is itself a valid rejection.

**Verification.** Four dedicated daemon boots (never the shared one), override set BEFORE boot:
wide (`365`, survives), narrow (`1`, collected), `0`/`-5` (both rejected — by a nonzero CLI/HTTP
status **or** by the daemon refusing to boot at all). Exact field comparison; a second, untouched
category held fixed across wide/narrow.

---

### C10F-9 — Size/inventory report, before and after, re-derived at runtime

**Statement.** Computed from real `fs.stat` at call time; compared **exactly** against an
independently-computed ground truth. Closes **T9**.

**Satisfiability.** Walks each category's actual root and `fs.stat`s at call time; re-derives
post-apply, never arithmetic-subtracts the plan's prediction; the required red spec's own `apply`
and its own fresh `fs.stat` walk prove this against realized state.

**Decoy.** Arithmetic subtraction fails when a candidate's size changes between plan and apply.
Round 2: comparing the **reported** `report` totals against a loose "at least the survivor's bytes,
and different from before" bound (rather than an exact re-derivation) lets arbitrary inflated totals
pass — proving the report is exact requires bracketing a real `apply`, which this verifier may
never issue.

**Verification.** Entirely the required red spec (round 3): `storage-gc-report-reconciliation.test.ts`
(required red-spec table, above) must, over a fixture root it builds itself, change a candidate's
size between plan and apply, then assert the after-apply `report` totals equal a **fresh**
independently-computed `fs.stat` walk of the surviving fixture tree exactly — never the plan's
predicted totals. The verifier proves this file exists, is bound to production, and proves the
required title red-before-green by real vitest execution.

---

### C10F-10 — UI/CLI parity over the three EXACT `/api/storage/*` routes

**Statement.** CLI, HTTP, and UI all drive the same three exact routes and DTOs. Manifest row
`parityApplicable: true` with an exact-set `httpPath`.

**Satisfiability.** `SUBCOMMAND_MAP.storage`'s handler and the UI panel both issue real requests
against the three exact paths.

**Decoy.** A manifest `httpPath` that is merely a prefix passes a naive check but fails exact-set
membership. A UI component mentioning a path only in a comment fails the AST scan (comments are
never visited). Round 2: a matched string literal ANYWHERE in a file (an unused array literal, a
dead variable) is not proof of a real call — the literal must sit in real `CallExpression` argument
position.

**Verification.** Manifest row validity. **Runtime proof for `gc-plan`/`report`:** the shared
daemon's real `http.Server`'s `'request'` events are captured to a log for the whole plan-only run
(attached from outside, no production-code change, and never includes `gc-apply` since this
verifier never generates that traffic); the log must contain a real `GET .../gc-plan`,
`GET .../report`. **Binding proof for `gc-apply`:** cross-references `storage-gc-apply-semantics.test.ts`'s
own binding (required red-spec table, above) — that file must drive the exact `/api/storage/gc-apply`
path from a real call-expression position, and must itself be fully proven (exists, bound,
red-before-green) — the product's own test is the only safe source of real gc-apply traffic. AST
scan of every `StorageRetention*.tsx` for exact-path string literals in real call-expression
position, for all three routes.

---

### C10F-11 — Every red spec binds to the production GC path, strictly scoped

**Statement.** Every red spec imports a module inside `storage`'s **own** reachable set (never a
server.ts-wide union) **and references** the binding, or drives the real CLI/HTTP surface via a
real AST call-site.

**Satisfiability.** Imports the storage-gc module by its real path, or drives it exclusively via
real CLI/HTTP.

**Decoy.** An unwired lookalike module (`storage-gc/legacy-gc.ts`) fails the strictly-scoped BFS.
An import that's never referenced fails the imported-but-unused check — round 2: the AST traversal
implementing this check must genuinely *prune* descent into the `ImportDeclaration` node itself, or
the import specifier's own name identifier satisfies "referenced" trivially and the check never
fires.

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
`reviewer` matches git's `%an <%ae>` shape exactly, is exact-distinct from every author across
`baseCommit..reviewedCommit`, and has committed to this repository before (round 2). `model` a real,
non-placeholder-looking string. Diff over the **full owned/lease surface** between `reviewedCommit`
and `HEAD` empty. `verdict === 'APPROVE'`.

**Round 3, named explicitly: this review is also the fixture-confinement check the gate architecture
itself cannot perform.** The verifier proves the five required red-spec files (see "Verifier safety
model," item 2) exist, are bound to production, and went red before green — it deliberately never
inspects whether each one's *own* synthetic fixture root is actually confined to a throwaway
directory, versus, say, a path under the real checkout or a shared/reused location. A red-spec file
that builds its fixture correctly and one that (by bug or bad-faith) reuses a real path are
AST-indistinguishable at the level this verifier operates. The reviewer named in this record is
responsible for confirming each required red-spec file's fixture construction is genuinely isolated
before recording `verdict: 'APPROVE'` — the same standard already implicit in C10F-17's "the second,
human-in-the-loop layer that must independently judge the genuineness of both fixtures," generalized
here to all five required files.

**Satisfiability.** Commit the whole implementation as P; a distinct, previously-active reviewer
reviews P; the record naming `reviewedCommit: P` is committed afterward.

**Decoy.** `reviewedCommit: HEAD` rejected by the strict-ancestor check. Substring matching let an
**empty reviewer string** trivially "not match" (round 1) — exact-distinctness fixes this. A partial
owned-path list let load-bearing surfaces drift post-review (round 1). Round 2: the review record's
**own path** was itself inside the "diff must be empty" set — since the record necessarily gets
committed *after* `reviewedCommit` (it names that commit), that always produces a non-empty diff at
its own path, making the criterion unsatisfiable by any legitimate review record; the fix removes
the record's own path from the owned-path set (it is authenticated separately, by its own
`reviewedCommit`/`reviewer`/`verdict` fields) and adds the leased `StorageRetention*` UI glob, which
round 1's list omitted. Round 2 also found any fabricated `Name <email>` string, shaped correctly but
belonging to nobody who has ever touched this repository, passed — the added
"has-committed-to-this-repo-before" check raises that bar.

**Verification.** Strict-ancestor + `git diff --name-only reviewedCommit HEAD -- <full owned-path
list, excluding the review record's own path>` empty (`apps/daemon/src/storage-gc/**`,
`apps/daemon/src/routes/storage-gc.ts`, `apps/daemon/src/cli.ts`, `apps/daemon/src/server.ts`,
`apps/daemon/tests/**`, `packages/contracts/src/api/storage-gc.ts`,
`packages/contracts/src/index.ts`, `apps/web/src/components/SettingsDialog.tsx`,
`apps/web/src/components/StorageRetention*`, `apps/web/src/i18n/types.ts`,
`apps/web/src/i18n/locales/en.ts`, `scripts/waves/capability-manifest.json`,
`docs/security/daemon-threat-model.md`, `docs/plans/waves/DECISIONS.md`); `reviewer` matches
`/^[^<>]+ <[^<>@]+@[^<>]+>$/`, is exact-absent from `git log --format='%an <%ae>'
baseCommit..reviewedCommit`, and is exact-present in `git log --all --format='%an <%ae>'`; `model`
matches a real-looking name pattern (letters/digits/./-/space, ≥6 chars, contains a digit) and is not
a placeholder; `verdict === 'APPROVE'`.

---

### C10F-14 — Freeze-blocking founder decisions are recorded

**Statement.** Founder Rulings 1, 2, and 3 (retention-window defaults, e2e-artifact scope, `.od`
deletable categories) must exist as real, content-bound entries in `docs/plans/waves/DECISIONS.md`
before this criterion can pass, under the exact headings the orchestrator actually landed them
under: `### W10F-RETENTION-WINDOWS`, `### W10F-E2E-ARTIFACT-SCOPE`, `### W10F-OD-DELETABLE-CATEGORIES`.
This wave's author never writes to `DECISIONS.md`; the gate stays red until the orchestrator lands
the records.

**Satisfiability.** Three sections, each introduced by the real level-3 heading above, whose body
before the next heading states the actual ruling.

**Decoy.** This PRD's own prose stating the rulings (above) is NOT a substitute — only
`DECISIONS.md` counts. Round 2, two distinct bugs: (1) this file's own author found — independent of
the round-2 review, by reading the merged `DECISIONS.md` — that the round-1 marker text
(`**W10F-FOUNDER-1/2/4**`, bold inline markers) never matched what the orchestrator actually landed
(real `###` headings under different names), so this criterion would have stayed permanently red
even after the founder decisions were correctly recorded; (2) the round-1 verification only required
≥20 characters of ANY text after the marker — a near-empty, copy-pasted, or even a ruling stating
the OPPOSITE of the real decision would have passed. Both are fixed: real headings, and the body
must state the ruling's own content (the 7/14/3-day figures; "narrow" e2e scope; "allowlist").

**Verification.** Read-only parse of `DECISIONS.md` for each of the three real headings; extract the
body to the next heading boundary; require it to both exist and contain the ruling's own stated
content — the windows section must mention `7`, `14`, and `3` as whole-word tokens; the e2e-scope
section must mention "narrow[ly]"; the deletable-categories section must mention "allowlist". All
three required.

---

### C10F-15 — Retention defaults match Founder Ruling 1, exactly, as configuration not literals

**Statement.** The registry's `defaultRetentionDays` per `justification` matches Ruling 1 exactly
(`inactive-namespace` → 7, `log-retention` → 14, `e2e-artifact` → 3, `regenerable-cache` /
`orphan-checked` → `null`, i.e. no default, not collectable without an explicit override). With no
env override set, the daemon's own reported `retentionWindows[category]` reflects these exact
values with `source: 'default'`; a no-default category echoes `{days: null, source: 'unset'}` and
never yields a candidate until an operator sets one explicitly, at which point it echoes
`{days: <override>, source: 'override'}` and becomes collectable.

**Satisfiability.** Defaults are read from the same registry the eligibility logic consumes — one
source of truth, never duplicated as separate literals in the GC and in a doc.

**Decoy.** An implementation whose GC hardcodes `7`/`14`/`3` inline while the registry's own
`defaultRetentionDays` field says something else (or is absent) fails the structural half even if
runtime behavior happens to match today. An implementation that gives `regenerable-cache`/
`orphan-checked` categories a non-null default fails Ruling 1's "nothing else has a default" clause
directly. Round 2, two bugs: (1) the round-1 runtime check treated a **missing** registry entry
(`inactiveEntry`/`logEntry`/`e2eEntry` undefined) as a vacuous pass rather than a failure; (2) the
round-1 no-default probe only ran `if (noDefaultEntry.tier === 1)` — but `regenerable-cache`/
`orphan-checked` entries are always Tier 2 by this PRD's own Scope section, so that branch was dead
code that never actually executed against a real fixture. Both are fixed: a missing entry fails
outright, and the no-default probe is schema-based (asserting `retentionWindows[category] =
{days:null, source:'unset'}` directly) rather than guessing a Tier-1-shaped fixture path for a
Tier-2 category. The PRD's own claimed override positive control (below) was also never actually run
by the round-1/round-2 verifier code — it is now.

**Verification.** Structural: registry `defaultRetentionDays` per entry matches the Ruling-1 table
above by `justification`, and each of `inactive-namespace`/`log-retention`/`e2e-artifact` must
actually be present as a registry entry (a missing entry fails, never vacuously passes). Runtime,
three dedicated daemon boots: (1) **no env overrides at all** — `retentionWindows[cat] = {days: 7,
source: 'default'}` exactly for `inactive-namespace`, `{days: 14, source: 'default'}` for
`log-retention`, `{days: 3, source: 'default'}` for `e2e-artifact`; a `regenerable-cache`/
`orphan-checked` category echoes `{days: null, source: 'unset'}` exactly and an aged fixture under it
(built under `RUNTIME_DATA_DIR`, the correct Tier-2 location) is never a candidate; (2) **that same
no-default category's env var set explicitly** — an identically-aged fixture under it echoes
`{days: <override>, source: 'override'}` and **is** a candidate (the positive control).

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
be an exact member of that set. Runtime (**plan-only, verifier-side — deliberately, see below**): a
fixture aged past 3 days under a pinned path IS a plan candidate; an otherwise-identical fixture
aged the same amount under an unpinned, e2e-adjacent path (simulating user-authored content the
implementation must not generalize to) is NEVER a plan candidate.

**Why this one stays plan-only.** Unlike C10F-3/5/7/9/17, this criterion's threat is *scope* — which
paths are eligible at all — never the accuracy of realized-vs-reported deletion accounting. Plan
candidacy IS the correct and sufficient runtime observable for a scope question; there is nothing
further a real `apply` would prove here that plan-only candidacy doesn't already prove, so it does
not fall under the round-2 binding ruling's target (destructive calls proving deletion realization).
Realized deletion of an eligible e2e artifact, generically, is already covered by
`storage-gc-apply-semantics.test.ts`'s required assertions.

---

### C10F-17 — Orphan detection is proven safe (Founder Ruling 3's mandatory design consequence)

**Statement.** `orphan-checked` collection requires a red spec proving, in one paired test: a
referenced artifact (a real row exists pointing at it) is never collected and never removed by
`apply`; a genuinely orphaned one (no referencing row) is collected and IS removed by `apply`.
Closes **T11**.

**Satisfiability.** `apps/daemon/tests/storage-gc-orphan-detection.test.ts` exists, binds to
production per C10F-11's rules, contains the two required test titles (required red-spec table,
above), and proves each one red-before-green by real vitest execution.

**Decoy.** A test asserting only the orphaned-collected half (no referenced-survives control) passes
a naive "orphan detection exists" check while leaving T11 wide open — this criterion requires both,
by exact title. Round 2: checking only that titles matching "referenced"/"orphan" exist — never
executing the tests or verifying their assertions/fixtures for real — lets a stubbed-out or
vacuously-passing test satisfy this criterion; the round-3 fix requires full execution, exact
required titles, and red-before-green.

**Verification.** File existence + C10F-11-style import/reachability binding. Real vitest execution
at HEAD requires both required titles to report `passed`; each title's own introduction commit is
independently found and replayed in an isolated worktree to prove it was genuinely red before this
run. This is real-execution proof, not merely a fixture the verifier constructs itself (the real DB
reference mechanism is an implementation detail this PRD does not prescribe); **C10F-13's
adversarial-review record is the second, human-in-the-loop layer that must independently judge the
genuineness of both fixtures** before `verdict: APPROVE` is legitimate.

---

### NO-DESTRUCTIVE-INVOCATION, FIXTURE-ISOLATION, GATE-INTEGRITY, LEASE, HEAD-DRIFT

Meta/infra checks — about the gate's own integrity and safety, never the product:

- **NO-DESTRUCTIVE-INVOCATION** (new, round 3) — AST self-scan of the verifier's own source; fails
  if it contains any `apply`/`--confirm`/`gc-apply` invocation, anywhere, under any name. Mechanical,
  self-enforcing closure of the round-2 CRITICAL finding, independent of every other check.
- **FIXTURE-ISOLATION** — see "Verifier safety model." Structural self-scan + runtime no-leak proof
  + plan-confinement proof + all-daemon-teardowns-confirmed proof. Mechanical closure of round-1
  finding 1 and round-2 finding 7 (a failed/partial teardown now fails this check, and therefore
  fails the run — never merely recorded as evidence).
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

## Verified baseline (this run, pre-implementation, post round-3 architectural fix)

A real end-to-end run of `pnpm exec tsx scripts/waves/verify-w10f.ts` against this commit reports
**6/22 criteria pass, cleanly**: `C10F-1` through `C10F-11` and `C10F-15`/`C10F-16`/`C10F-17` fail by
name ("product surface missing: 'storage' not registered..." or "<file> does not exist -- expected
pre-implementation state"); `C10F-13` fails by name (no review record yet); `LEASE` fails by name
(no `W10f` entry yet). `C10F-12` (guard+typecheck) and `C10F-14` (the three founder decisions, now
actually landed in `DECISIONS.md`) legitimately **pass** pre-implementation, as does every meta/infra
check: `NO-DESTRUCTIVE-INVOCATION`, `FIXTURE-ISOLATION`, `GATE-INTEGRITY`, `HEAD-DRIFT`. The run
never touches ports 7456/51012 or the operator's live daemon pids (confirmed via `lsof`/`ps` before
and after — unchanged) and leaves no orphaned processes (confirmed via `ps aux` after the run).

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

## Round-2 findings → closures

| # | Severity | Finding (condensed) | Closure |
|---|---|---|---|
| 1 | CRITICAL | The round-1 "belt" validated only the lexical paths a `plan` response claimed; `safeApply` then handed unconstrained production code a bare `planId`, free to re-derive its own deletion targets. A description of the work is not the work. | Architectural: `safeApply` and every call to it are deleted. This verifier never invokes `apply` — plan-only criteria keep proving eligibility for real (safe by construction, since `plan` is dry-run and C10F-6 proves its call graph never deletes); deletion semantics move entirely to five named, required product tests (`REQUIRED_RED_SPECS`) that build their own fixtures, run `apply` for real inside the daemon's own test process, and are proven to exist/bind/red-before-green by this verifier without ever running `apply` itself. `NO-DESTRUCTIVE-INVOCATION` self-enforces against regression. |
| 2 | HIGH | C10F-1's registry-consumption was unproven and its only unknown-category probe was Tier-1-shaped; C10F-5's claimed Tier-2 positive control was actually `.tmp/tools-dev`, a Tier-1 fixture. | C10F-1 adds a genuine `RUNTIME_DATA_DIR`-rooted (Tier-2) unknown-category probe alongside the Tier-1 one, plus a registry-category-to-`retentionWindows`-key cross-check. C10F-5's positive control is rebuilt under `RUNTIME_DATA_DIR` against a real Tier-2 registry entry. |
| 3 | HIGH | C10F-7/C10F-9 trusted reported accounting (`removed[]`, `report` totals) over realized on-disk state. | Both criteria move entirely to required red specs (`storage-gc-apply-semantics.test.ts`, `storage-gc-report-reconciliation.test.ts`) that assert `fs.existsSync`/an independent `fs.stat` walk directly against their own fixture root. |
| 4 | HIGH | `fileCallsStorageEndpointByExactPath` matched a literal anywhere in a file, never requiring call-expression position; `importedIdentifierIsReferenced`'s pruning was fake (the generic `walk` helper always recurses regardless of the visitor's return), so an unused import's own specifier name satisfied "referenced." | The endpoint matcher now requires `parent is CallExpression && parent.arguments includes node`. The unused-import check is a dedicated, self-contained traversal that genuinely returns before calling `ts.forEachChild` on an `ImportDeclaration`. |
| 5 | HIGH | C10F-14 accepted any ≥20-character text after its markers, including contradicting text; C10F-15 vacuously passed a missing registry entry and its no-default probe was dead code (gated on `tier === 1`, but no-default categories are always Tier 2); C10F-17 checked only test titles, never executing the tests. | C10F-14 requires content matching the ruling's own stated figures/scope. C10F-15 requires each entry to actually exist and redesigns the no-default probe around the tri-state `retentionWindows` schema at the correct Tier-2 location, plus the previously-unrun override positive control. C10F-17 becomes a full required-red-spec check (existence + binding + real execution + red-before-green). |
| 6 | HIGH | C10F-13's `OWNED_REVIEW_PATHS` included the review record's own path, making the "diff must be empty since `reviewedCommit`" check unsatisfiable by any legitimate record (the record is necessarily committed after `reviewedCommit`); the leased `StorageRetention*` glob was missing; a fabricated `Name <email>` distinct from commit authors passed. | The review record's own path is removed from the owned-path set; `StorageRetention*` is added; `reviewer` must additionally appear in `git log --all` (a real prior contributor identity), and `model` must match a real-looking pattern with a digit. |
| 7 | HIGH | Daemon teardown returned an `ok` result that dedicated-daemon callers discarded; `FIXTURE-ISOLATION` never consumed it, so a remaining listener-owning descendant could coexist with a green gate. | Teardown is rebuilt around POSIX process groups (`detached:true` + `process.kill(-pgid, sig)` + poll-for-zero-survivors); every result is pushed into one shared `allDaemonTeardownResults` array by `bootIsolatedDaemon`'s own `.stop()` wrapper; `FIXTURE-ISOLATION` requires every entry `ok`, so a failed/partial teardown fails the run. |
| 8 | HIGH | `findRegistryLiteral` required the array literal to be the DIRECT initializer, so this PRD's own `as const`-wrapped example would false-red; C10F-8 required `daemonBooted===true` for a rejection, false-redding a correct fail-fast boot refusal; C10F-6's file-level delete-call scan both false-reds a legitimate `planStorageRetention` colocated with a correct `applyStorageRetention`, and under-attributes indirect delete calls. | `findRegistryLiteral` unwraps an `AsExpression` before checking for an array literal. C10F-8 accepts either a nonzero status or a boot refusal as "rejected." C10F-6 walks a real, memoized, cycle-safe call graph rooted at `planStorageRetention` specifically. |
