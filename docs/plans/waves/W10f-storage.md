# Wave 10f — Storage retention & GC (NM-36C)

**Slug:** `mishmash-w10f-storage`
**Gates on:** W0 (landed)
**Loop:** `loop:red-green-review` (`VERIFICATION-CONTRACT.md` §6)
**Verifier:** `scripts/waves/verify-w10f.ts`
**Write lease (proposed, not yet in `leases.json`):** see **Proposed lease** below. This wave has
**no** `leases.json` entry today — that is expected and mechanically checked (see the **LEASE**
criterion): the orchestrator adds the entry only after this PRD and its verifier are frozen and
independently approved.

**Status: EXPANSION DRAFT, fix round 4 (rounds 1, 2, and 3 REJECTed; round 3 tripped the program's
three-consecutive-REJECT stop rule and escalated to a binding GPT-5.6 tribunal ruling, implemented in
this round — exactly one further fix round, per the ruling's own terms).** This document is an
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
root, not with `--confirm`, not ever.** This round-2 rule is exactly what round 4 corrects.

**Round-3 disposition.** REJECTed a third time, tripping the program's stop rule. The round-2 "never
call apply" rule closed one defect class by introducing another: proving deletion semantics required
delegating to product-authored Vitest files and proving those files were "bound" to production via
AST import-graph inspection — the same source-shape-proves-runtime-behavior pattern this program's
`W9AS-PARK`/`W10A-PARK`/`W10B-PARK` records had already identified as unsound and non-convergent for
three other waves. **Binding tribunal ruling (round 4, this round): OS-level sandbox confinement
replaces the "never call apply" rule; static AST/registry/delete-call-graph proof is removed entirely
in favor of a runtime interposer plus doubled snapshot proof; every evidence commit rebuilds in a
fresh detached clone; teardown enumeration uncertainty hard-fails the run.** See **Verifier safety
model** for the full architecture and **Round 4 — binding tribunal ruling → closures** near the end
(the round-1/round-2 findings tables are retired — every mechanism they closed either still stands
under a new name or was itself superseded by this round; see that section for the mapping). The three
freeze-blocking founder questions raised in round 1 have since been answered by founder delegation
(see **Founder rulings**, immediately after Scope) and their real decision records have now landed in
`docs/plans/waves/DECISIONS.md` — this PRD's own author does not edit that file, and C10F-14 binds
mechanically to exact SHA-256 digests of the real sections there, not to this PRD's restatement of
them.

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

## Verifier safety model (round 4 — binding tribunal ruling, outranks everything else in this document)

**The single most safety-critical property this PRD states, now rebuilt on a fourth, final
architecture after a GPT-5.6 escalation tribunal.** Round 3's "the verifier itself never invokes
`apply`" rule was itself the defect the tribunal corrected: refusing to call the destructive endpoint
from the verifier only ever produced evidence about a black box's *description* of its own tests
(vitest title/import-binding proof), never about its actual runtime behavior, and the program's own
W9AS-PARK/W10A-PARK/W10B-PARK precedents (`DECISIONS.md`) had already established the same lesson for
sibling waves: a criterion asserting runtime behavior must OBSERVE that behavior, never infer it from
source shape. The tribunal's ruling replaces the "never call apply" rule with **OS-level confinement
that makes calling apply safe**: every product, daemon, CLI, and package-script process this verifier
ever spawns — and every descendant — runs inside one inherited `sandbox-exec` (macOS Seatbelt) jail
whose filesystem write authority is limited to a single fresh scratch envelope and whose network
authority is limited to a verifier-assigned loopback port that is never `7456` or `51012`. Inside that
jail, the verifier's own black-box probes MAY call real `gc-apply` — an apply implementation may
delete disposable fixtures the probe built itself, but no process in the verification tree has OS
authority to mutate operator data, because the jail — not a refusal to dial the endpoint — is what
makes that safe.

Four binding invariants govern every criterion below:

1. **`I-W10F-VITEST-CONFINEMENT`.** No implementation-authored code (product, daemon, CLI, browser,
   package-script, or test process, and every descendant) may execute outside a successfully
   preflighted OS jail. Before ANY repository code runs, a fixed preflight proves a child inside the
   jail can create/delete an inside-envelope canary but cannot modify or delete a byte-verified canary
   outside its writable subtree — missing sandbox tooling, policy rejection, `EPERM`, a failed canary,
   or inability to restrict network/filesystem authority is a hard failure, never a skip or an
   unsandboxed fallback. `HOME`, `TMPDIR`, XDG paths, package caches, `OD_DATA_DIR`,
   `OD_STORAGE_TMP_ROOT`, cwd, and proof-output paths all resolve inside that one fresh
   `mkdtemp`-created scratch envelope; the jailed process environment is built from an explicit
   allowlist, never spread from the ambient environment. **Implementation-authored Vitest files cease
   to be load-bearing evidence and are never spawned by the verifier** — the "required red-spec test
   files" table this document carried in rounds 1–3 is retired as a *verifier-graded* requirement (see
   "Required red-spec test files" for its replacement).
2. **`I-W10F-DELETE-PROOF`.** AST call graphs, registry-literal validation, imported-binding
   references, route-string positions, test titles, and assertion counts carry **zero behavioral
   authority**. Three runtime-truth layers replace them:
   - **A verifier-owned preload interposer**, installed via Node's `--import` before the daemon's own
     `server.ts` loads, wraps every mutating `node:fs`, `node:fs/promises`, and `node:child_process`
     operation, re-synchronizes Node's built-in ESM bindings after wrapping
     (`module.syncBuiltinESMExports()`), and denies the attempt while the real `GET
     /api/storage/gc-plan` request the verifier issued is in flight.
   - **Preflight canaries** independently prove the interposer intercepts five call shapes — property
     access, a direct `node:fs` import, a direct `node:fs/promises` import, an aliased/indirect
     wrapper, and a spawned deletion command — against a byte-verified denied canary, while deletion of
     an allowed scratch fixture still succeeds when the interposer is not in deny mode.
   - **Doubled real-request replay**: the daemon boots twice, with freshly randomized fixtures each
     time; each real `plan` request must trigger zero mutation-attempt events while it is in flight,
     and the fixture tree's full `lstat` snapshot (path, type, device, inode, mode, ownership, size,
     nanosecond timestamps, symlink target) plus SHA-256 for regular files must be byte-identical
     before and after (C10F-6). The OS jail remains the safety net if the interposer ever misses an
     exotic call.

   Every other deletion-semantics criterion (C10F-3, C10F-5, C10F-7, C10F-9, C10F-10's `gc-apply` leg,
   C10F-11, C10F-17) is proven by a **verifier-owned black-box probe**: it issues the real HTTP/CLI
   action against a jailed daemon it booted itself, over a fixture root it built itself, and compares
   exact realized filesystem state (existence, byte content, `lstat`) — never a reported `removed[]`/
   `skipped[]` array. Each probe is replayed against the criterion's *named red commit* — `baseCommit`,
   the last commit this program guarantees predates any storage-gc implementation — and against HEAD:
   at the red commit the probe must fail cleanly (not crash) while an unrelated positive control
   (`GET /api/health`, a core daemon route untouched by this wave) still succeeds; at HEAD, once
   implemented, the probe must be satisfied. Founder-authority (C10F-14) has no runtime observable, so
   it uses the narrow structural exception this program's own `W9AS-PARK` record allows: exact SHA-256
   digests of the three named `DECISIONS.md` sections, read via `git show` at `baseCommit` — never
   prose or token matching.
3. **`I-W10F-EVIDENCE-BINDING`.** Every load-bearing HEAD-or-red-commit execution runs from a **fresh
   detached clone** (`git clone --no-local --no-hardlinks --no-checkout <repoRoot> <clone>` then
   `git -C <clone> checkout --detach <exact 40-character sha>`, `HEAD` re-verified against the
   requested sha), a **frozen offline `pnpm install --offline --frozen-lockfile`** whose own
   postinstall scripts rebuild every workspace package (including the daemon's own `tsc -p
   tsconfig.json` and `packages/sidecar-proto`'s esbuild+`tsc` build) from tracked source inside the
   jail, and never the live checkout's `dist/`, `node_modules/`, or other ignored/build artifacts.
   Reviewer identity (C10F-13) comes only from two exact `git log` commands anchored at `baseCommit`
   (`git log --format=%an%x00%ae <baseCommit>` for known-before-implementation contributors; `git log
   --format=%an%x00%ae <baseCommit>..<reviewedCommit>` for implementation authors) — `--all` is
   forbidden.
4. **`I-W10F-TEARDOWN-FAIL-CLOSED`.** Process-group absence is established only by a successful,
   completely parsed `ps -Ao pid=,pgid=` enumeration returning a **known** set (including a known
   *empty* set). A nonzero exit, spawn error, timeout, or malformed line produces `state:"unknown"` —
   **never `[]`**. Each enumeration point retries three times, 200ms apart; after SIGTERM a known
   nonempty set is polled for up to 8 seconds, then escalated to a group SIGKILL with a 4-second
   confirmation window; if enumeration ever becomes `unknown`, teardown issues best-effort group
   SIGKILL and performs one final three-attempt enumeration, still returning `ok:false` unless that
   final result is `known` with zero members. Any enumeration uncertainty at any point this run
   **hard-fails `FIXTURE-ISOLATION` and the whole run**, and the scratch envelope is retained as
   forensic evidence (path + outstanding pgid printed) until zero survivors are independently
   confirmed — cleanup happens only after that confirmation.

**Superseded control paths removed this round, not left dormant beside the new ones:**
`REQUIRED_RED_SPECS`/`runVitestFileJson`/`replayFileRedAtCommit`/`checkRequiredRedSpecSync`/
`extractTestTitlesFromSource` (vitest is no longer evidence); `findRegistryLiteral` and the registry
literal-property helpers (registry AST validation carries zero authority — replaced by
`CATEGORY_MATRIX`, the verifier's own ground-truth statement of the ruling's exact seven-category
allowlist, asserted at runtime); `functionCallGraphContainsDeleteCall` and its supporting AST walk
(static delete-scanning is removed entirely — replaced by the interposer + doubled snapshot proof);
`safeApply`/`NO-DESTRUCTIVE-INVOCATION`'s self-scan and the `SafeStorageCliArg` closed-literal-union
type-level closure (the round-3 "verifier never calls apply" rule is exactly what this round
corrects). `FIXTURE-ISOLATION` is rebuilt around the jail's structurally stronger guarantee (the
sandbox denies any write outside the scratch envelope at the OS level, regardless of what a daemon's
own logic attempts) plus the `I-W10F-TEARDOWN-FAIL-CLOSED` enumeration-uncertainty hard-fail, and
still reports the honest third terminal state, `not-exercised` (distinct from both `pass` and `fail`,
blocking the gate exactly like `fail` does), when no daemon was ever booted this run — pre-
implementation, `storageEntry` is `null`, so nothing runs, and reporting a bare `pass` in that state
would claim a mechanism was proven safe when it never exercised. This mirrors this program's existing
precedent for an honest non-pass terminal state (W1's C1-12 `blocked-on-founder`).

**No retained manifest proves this architecture until a clean, exact-HEAD run exists.** Every
manifest this document or the goal-state proof directory references is timestamped and commit-bound;
a manifest from a prior architecture (rounds 1–3) proves nothing about this one.

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
| T10 | **The gate itself deletes real data.** The verifier's own fixtures or destructive calls reach the operator's real checkout. | Round-1 CRITICAL, round-2 CRITICAL on the same class disguised, round-3 CRITICAL again (source-shape proof of a "never call apply" rule that itself trapped the program's own deletion-semantics evidence in an unsound pattern). Round 4 (binding tribunal ruling): closed by OS-level `sandbox-exec` confinement (`I-W10F-VITEST-CONFINEMENT`) that makes it structurally impossible for ANY process this verifier spawns — including one that calls real `gc-apply` — to write outside one fresh scratch envelope, regardless of what the daemon's own logic attempts; the verifier's black-box probes now call real `gc-apply` safely, inside that jail. |
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

### Required red-spec test files — RETIRED as a verifier-graded requirement (round 4)

Rounds 1–3 mandated five named product-authored Vitest files as the sole evidence for deletion
semantics. **The round-4 binding tribunal ruling retires this table as verifier-graded evidence**:
"implementation-authored code" ceases to be load-bearing once the OS jail makes it safe for the
verifier to exercise the real `gc-apply` endpoint itself. C10F-3, C10F-5, C10F-7, C10F-9, and
C10F-17 (T2, T4, T6/T7, T9, T11) are now proven by **verifier-owned black-box probes** that build
their own fixture root inside the jail, issue the real HTTP/CLI action (including real `gc-apply`),
and compare exact realized filesystem state — see each criterion's Verification section, below, and
"Verifier safety model" for the shared red/HEAD replay pattern every probe uses. This does not lower
the bar on the eventual implementation's own test suite — ordinary engineering practice (and
`AGENTS.md`'s "Bug follow-up workflow") still expects the implementer to write real Vitest coverage
for `apps/daemon/src/storage-gc/**` — it only removes that suite from being the verifier's OWN
evidence, per the same reasoning `W9AS-PARK`/`W10A-PARK`/`W10B-PARK` already established for sibling
waves: a criterion asserting runtime behavior must observe that behavior directly.

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
wrongly included by a walker-shaped one — probed at Tier 1 (`.tmp/not-a-real-category/...`), Tier 2
(a decoy directory directly under `RUNTIME_DATA_DIR`), and Tier 3 (an unpinned e2e-adjacent decoy),
since a Tier-1-only probe never exercises the `.od`-side allowlist Founder Ruling 3 requires.

**Verification (round 4 — runtime only; no registry-literal AST result contributes to pass/fail,**
per `I-W10F-DELETE-PROOF`). The verifier's own ground truth is the ruling's exact seven-category
matrix (`tools-dev`, `tools-serve`, `tools-pack`, `daemon-logs`, `plugin-asset-cache`,
`orphaned-staging`, `e2e-test-output`) — asserted, never read from source. Two jailed daemon boots:
(1) no overrides — a real, eligible, aged positive fixture for every category with a stated default,
plus unlisted-category decoys at all three roots; (2) the two no-default categories overridden so
they can also yield a positive fixture, plus a narrow override on `tools-dev` held against boot (1)'s
untouched siblings. Pass requires: `retentionWindows` keys are exactly the seven named categories;
every category yields a real candidate; no unlisted-category decoy at any root ever leaks; changing
one category's window changes only that category.

---

### C10F-2 — Root confinement: real containment, not string prefix

**Statement.** Checked against the union of allowed roots using resolved containment
(`path.relative`-based), never `startsWith`. Closes **T1**.

**Satisfiability.** Matches `isPathWithin`'s semantics, evaluated against every allowed root.

**Decoy.** `candidatePath.startsWith(allowedRoot)` fails at the **source level**: a fixture source
root `.tmp/tools-dev/<ns>` vs. an unrelated sibling `.tmp/tools-devEVIL/<ns>` sharing only the
string prefix.

**Verification.** The verifier's own black-box probe (against a jailed HEAD daemon, no red/HEAD
replay needed — this is a scope check with no destructive half) seeds the source-level collision
fixture plus a genuine in-scope file, asserts by **exact path equality** against `candidates[].path`:
the collision sibling never appears; the real file's exact absolute path does.

---

### C10F-3 — Symlink escape refusal

**Statement.** A symlink inside an allowed root whose target is an external **directory** is never
followed for enumeration or deletion. Closes **T2**.

**Satisfiability.** lstat's directory entries; does not recurse through a symlink whose realpath
resolves outside every allowed root; a real `apply`, run by the verifier inside the OS jail, proves
the external content survives and the real in-scope file is removed.

**Decoy.** A symlink-to-a-**file** test proves nothing (`unlink` never dereferences). The real
vulnerability is a symlink to a directory, followed during recursion.

**Verification (round 4 — verifier-owned black-box probe, real `apply` inside the jail, no product
test file).** Symlink (`dir` type) inside an eligible namespace → external fixture directory (outside
the daemon's own fixture roots but still inside the verifier's scratch envelope) with a byte-verified
aged file, plus a real in-scope expired file. The probe calls real `gc plan` then real `gc apply
--confirm`, and asserts: nothing under the external directory ever appears in `candidates[].path`;
the external file's SHA-256 is unchanged after `apply`; the real in-scope expired file is actually
gone from disk. Replayed against `baseCommit` (must fail cleanly, `/api/health` still `ok:true`) and
HEAD (must be satisfied) per "Verifier safety model."

---

### C10F-4 — Active-namespace refusal, across every Tier-1 category

**Statement.** Never planned/applied while a live process carries a matching sidecar stamp —
proven for every Tier-1 category the registry declares. Closes **T3**.

**Satisfiability.** Calls the production stamp-matching primitives directly, for every Tier-1
category uniformly.

**Decoy.** An mtime heuristic fails a namespace whose only write was at startup. A decoy
special-casing one category fails the multi-category sweep.

**Verification.** Per `CATEGORY_MATRIX` Tier-1 category (round 4 — the verifier's own ground-truth
statement, never a registry AST read): real short-lived stamped process; excluded while alive
(exact-path match); included once inactive (exact-path match).

---

### C10F-5 — Imported-folder `baseDir` is untouchable

**Statement.** Never enumerated/stated/deleted, at any age, under any category — proven while a
genuine Tier-2 item **is** collected in the same run. Closes **T4**.

**Satisfiability.** Never enumerates `PROJECTS_DIR`/project metadata, or explicitly excludes any
`hasExternalProjectRoot` path before considering it; a real `apply`, run by the verifier inside the
OS jail, proves `baseDir` survives byte-identical and the Tier-2 control is actually gone.

**Decoy.** A hardcoded `PROJECTS_DIR`-substring filter fails a `baseDir` that doesn't textually
contain it. A GC that collects nothing (global no-op) fails the missing positive control — the
positive control must be a genuine **Tier-2** (`RUNTIME_DATA_DIR`-rooted) fixture, never a Tier-1
(`.tmp/...`) fixture mislabeled as Tier-2, which would prove nothing about `.od`-side collection at
all.

**Verification (round 4 — verifier-owned black-box probe, real `apply` inside the jail, no product
test file).** A real imported-folder project via `POST /api/import/folder`, plus a genuine Tier-2
(`RUNTIME_DATA_DIR`-rooted) fixture aged past its window. The probe calls real `gc plan` then real
`gc apply --confirm`, and asserts: no candidate path equals/is prefixed by anything under `baseDir`;
the Tier-2 fixture **is** a candidate; `baseDir`'s content SHA-256 is unchanged after `apply`; the
Tier-2 control is actually gone from disk. Replayed against `baseCommit` and HEAD per "Verifier
safety model."

---

### C10F-6 — Dry-run is the default and the only read path

**Statement.** `plan` never mutates the filesystem; CLI exits `0` with schema-valid JSON; the real
plan request, observed under a runtime interposer, triggers zero mutation-attempt events. Closes part
of **T6**.

**Satisfiability.** Pure read; no mutating `node:fs`/`node:fs/promises`/`node:child_process`
operation is ever attempted while handling a real `GET /api/storage/gc-plan` request.

**Decoy (round 4 — static delete-scanning is removed entirely, per `I-W10F-DELETE-PROOF`).** AST call
graphs cannot see indirection, obfuscation, or any mutating primitive outside a hardcoded name list —
this program's own round-2/round-3 history with this exact criterion is the demonstrated case: a
direct-import `rmSync` probe against this file's own historical shape returned zero hits, confirming
the underlying "the call graph never deletes" claim was unverified by the check that claimed to prove
it. A runtime interposer that wraps the actual mutating operations, not their spelling in source,
closes this class structurally.

**Verification (round 4 — runtime interposer + doubled real-request replay with exact whole-tree
snapshots; no AST call-graph walk).** Two independent jailed daemon boots, each with freshly
randomized fixtures. Each boot: full `lstat`+SHA-256 snapshot of the fixture tree (path, type,
device, inode, mode, ownership, size, nanosecond timestamps, symlink target, content hash) before a
real `GET /api/storage/gc-plan` request; the daemon process runs with the verifier's own runtime
interposer preloaded via `--import`, denying and recording any mutating `node:fs`/
`node:fs/promises`/`node:child_process` call while that specific request is in flight; snapshot again
after. Pass requires, for BOTH boots: CLI exits `0` with schema-valid JSON, zero mutation-attempt
events recorded during the request window, and the before/after snapshots are byte-for-byte
identical.

---

### C10F-7 — Apply is a distinct, plan-bound, re-validated, confirm-gated action

**Statement.** Missing `--confirm` rejected; unknown `planId` rejected; realized `removed[]`
compared **exactly** (multiset) against the plan minus whatever became ineligible; a
re-validated-ineligible candidate carries a non-empty `reason`; a post-plan surprise file is never
swept in. Closes **T6, T7**.

**Satisfiability.** Rejects both negative cases outright; iterates the plan's exact list; re-runs
safety checks per candidate; records every skip with a reason; a real `apply`, run by the verifier
inside the OS jail, proves all of the above against realized on-disk state.

**Decoy.** Re-scanning the registry at apply time (ignoring `planId`) lets a post-plan surprise file
get swept in. Trusting the **reported** `removed[]` array for this comparison is itself gameable — an
implementation can delete the surprise file while simply omitting it from `removed[]` and pass; this
criterion compares the verifier's own filesystem observation, never the reported array, as ground
truth (a reported `removed[]` may additionally be checked but never substitutes for it).

**Verification (round 4 — verifier-owned black-box probe, real `apply` inside the jail, no product
test file).** The probe plans two namespaces, then: (1) sends `gc apply` without `--confirm` — must
be rejected and the fixture must still exist; (2) sends `gc apply --confirm` against a fabricated
unknown `planId` — must be rejected; (3) makes one namespace active (a real short-lived stamped
process) and drops a post-plan surprise file into the other AFTER planning, then sends the real
`gc apply --plan <planId> --confirm` — asserts the realized on-disk survivor set exactly equals the
plan minus the namespace that became active (multiset over the verifier's own `fs.existsSync`
checks, never the reported array), the survivor carries a non-empty skip reason, and the surprise
file is still on disk. Replayed against `baseCommit` and HEAD per "Verifier safety model."

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
post-apply, never arithmetic-subtracts the plan's prediction; a real `apply`, run by the verifier
inside the OS jail, and the verifier's own fresh `fs.stat` walk prove this against realized state.

**Decoy.** Arithmetic subtraction fails when a candidate's size changes between plan and apply.
Comparing the **reported** `report` totals against a loose "at least the survivor's bytes, and
different from before" bound (rather than an exact re-derivation) lets arbitrary inflated totals pass
— proving the report is exact requires bracketing a real `apply` and comparing against the verifier's
own independent ground truth.

**Verification (round 4 — verifier-owned black-box probe, real `apply` inside the jail, no product
test file).** The probe plans a namespace with a survivor fixture, changes a candidate's size between
plan and apply (defeating arithmetic subtraction), sends real `gc apply --confirm`, then real
`report`. Asserts: the after-apply `report` totals are consistent with the verifier's own **fresh**
`fs.stat` walk of the surviving fixture tree — computed independently, never derived from the plan's
predicted totals or the apply response. Replayed against `baseCommit` and HEAD per "Verifier safety
model."

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

**Verification (round 4 — real captured traffic for all three routes, including `gc-apply`).**
Manifest row validity. Every jailed daemon this run boots has its real `http.Server`'s `'request'`
events captured to a log (attached from outside, no production-code change); the aggregated logs
across the whole run must contain a real `GET .../gc-plan`, `GET .../report`, and — now that the
verifier itself issues real `gc-apply` traffic inside the jail (C10F-3/5/7/9/17's probes) — a real
`POST .../gc-apply`. AST scan of every `StorageRetention*.tsx` for exact-path string literals in real
call-expression position, for all three routes (no runtime alternative exists for the UI leg without
adding browser automation, which this round does not do).

---

### C10F-11 — Every verifier-owned probe issues the real action it claims to (repurposed, round 4)

**Statement (repurposed).** Rounds 1–3 stated this criterion as "every red spec binds to the
production GC path" — meaningless once product-authored Vitest files stop being evidence
(`I-W10F-VITEST-CONFINEMENT`). Round 4 restates it as `I-W10F-DELETE-PROOF`'s own requirement made
auditable: **every black-box probe that claims runtime evidence this round actually issued a real
HTTP or CLI action against its exact expected production surface** — never a stub, and never a claim
decoupled from an actual request.

**Satisfiability.** Every probe (C10F-1 through C10F-9, C10F-17) logs its real action (method + exact
path, or exact `od storage` subcommand) to a shared ledger as it runs; C10F-11 asserts the ledger is
non-empty and surface-correct for every one of them.

**Decoy.** A probe that short-circuits on a caught error before ever calling `fetch`/spawning the CLI
would still be able to report a plausible-looking `satisfied: false` — the ledger check catches a
probe that silently never exercised the real surface even once, as opposed to one that exercised it
and observed a real rejection.

**Verification.** Cross-references the real-action ledger every probe above appends to while it ran;
requires at least one logged entry per criterion, naming its exact expected surface. Pre-
implementation (`storageEntry` is `null`), no probe above ever reaches its real-action call — this
criterion correctly fails by name in that state, not vacuously.

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

**Round 4: this review's fixture-confinement role narrows, since the verifier's own probes (not
product-authored Vitest files) are now the load-bearing evidence and those probes' fixtures are
themselves confined by the OS jail, not merely by convention.** What C10F-13's reviewer must still
independently judge is the ACTUAL implementation itself: whether `apps/daemon/src/storage-gc/**`'s
eligibility, apply, and orphan-check logic is sound beyond what the verifier's probes happen to
exercise — the same standard C10F-17's own doc comment already names for the orphan-detection
mechanism specifically, generalized here to the whole module.

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

**Verification (round 4 — reviewer identity via the two exact `git log` commands
`I-W10F-EVIDENCE-BINDING` specifies; `--all` is forbidden).** Strict-ancestor +
`git diff --name-only reviewedCommit HEAD -- <full owned-path list, excluding the review record's own
path>` empty (`apps/daemon/src/storage-gc/**`, `apps/daemon/src/routes/storage-gc.ts`,
`apps/daemon/src/cli.ts`, `apps/daemon/src/server.ts`, `apps/daemon/tests/**`,
`packages/contracts/src/api/storage-gc.ts`, `packages/contracts/src/index.ts`,
`apps/web/src/components/SettingsDialog.tsx`, `apps/web/src/components/StorageRetention*`,
`apps/web/src/i18n/types.ts`, `apps/web/src/i18n/locales/en.ts`,
`scripts/waves/capability-manifest.json`, `docs/security/daemon-threat-model.md`,
`docs/plans/waves/DECISIONS.md`); `reviewer` matches `/^[^<>]+ <[^<>@]+@[^<>]+>$/` and, parsed into a
name/email pair, is an exact member of `git log --format=%an%x00%ae <baseCommit>`'s output (a real
identity known before this wave's own implementation range) and exact-absent from `git log
--format=%an%x00%ae <baseCommit>..<reviewedCommit>`'s output (never one of the implementation's own
authors); `model` matches a real-looking name pattern (letters/digits/./-/space, ≥6 chars, contains a
digit) and is not a placeholder; `verdict === 'APPROVE'`.

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

**Verification (round 4 — exact SHA-256 digest, never prose/token matching, per `I-W10F-DELETE-PROOF`'s
F7 exception).** `git show "${baseCommit}:docs/plans/waves/DECISIONS.md"`; normalize CRLF to LF; for
each of the three real headings, extract heading-inclusive through the byte before the next Markdown
heading; trim trailing whitespace; append one LF; SHA-256. All three digests must exactly equal the
ruling's own stated values (`W10F-RETENTION-WINDOWS` →
`41cc817995122d00997142c6c8773ac468e0f048abc8e361db3721777c44c544`; `W10F-E2E-ARTIFACT-SCOPE` →
`5d81e84b9389c19486ca3f37de3fa07b0c29063b00fd316a33a49eae4788e4c4`; `W10F-OD-DELETABLE-CATEGORIES` →
`4f76d3eb93659494d4c37814cf18caf0f5a6c026c948b031892c199075d9b370`). The extraction algorithm was
validated against the real, landed `DECISIONS.md` content before this document was written — all
three digests matched exactly on the first attempt.

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

**Verification (round 4 — runtime only, against `CATEGORY_MATRIX`, the verifier's own ground-truth
statement of Ruling 1; no registry-literal AST result contributes to pass/fail).** Two jailed daemon
boots: (1) **no env overrides at all** — `retentionWindows[cat] = {days: 7, source: 'default'}`
exactly for every `inactive-namespace` category, `{days: 14, source: 'default'}` for `log-retention`,
`{days: 3, source: 'default'}` for `e2e-artifact`; `plugin-asset-cache` echoes `{days: null,
source: 'unset'}` exactly and an aged fixture under it (built under `RUNTIME_DATA_DIR`) is never a
candidate; (2) **that same no-default category's env var set explicitly** — an identically-aged
fixture under it echoes `{days: <override>, source: 'override'}` and **is** a candidate (the positive
control).

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

**Verification (round 4 — structural leg reads only the pre-existing, non-implementation
`e2e/scripts/playwright.ts`, never a registry AST read; scope itself is proven purely at runtime).**
Structural sanity: AST-extract the real string-literal path segments passed to `path.join(...)`
inside `cleanArtifacts()` — this is reading a frozen, already-audited file this wave does not touch,
not the implementation's own registry. Runtime (**plan-only — deliberately, see below**): a fixture
aged past 3 days under one of those real target paths IS a plan candidate; an otherwise-identical
fixture aged the same amount under an unpinned, e2e-adjacent sibling path (simulating user-authored
content the implementation must not generalize to) is NEVER a plan candidate.

**Why this one stays plan-only.** Unlike C10F-3/5/7/9/17, this criterion's threat is *scope* — which
paths are eligible at all — never the accuracy of realized-vs-reported deletion accounting. Plan
candidacy IS the correct and sufficient runtime observable for a scope question; there is nothing
further a real `apply` would prove here that plan-only candidacy doesn't already prove. Realized
deletion of an eligible e2e artifact, generically, is already covered by C10F-7's apply-semantics
probe.

---

### C10F-17 — Orphan detection is proven safe (Founder Ruling 3's mandatory design consequence)

**Statement.** `orphan-checked` collection requires, in one paired real-request probe: a referenced
artifact (the daemon is made aware of it via a real production request) is never a plan candidate and
is never removed by a real `apply`; a genuinely orphaned one (no daemon awareness at all) is a plan
candidate and IS removed by a real `apply`. Closes **T11**.

**Satisfiability.** The verifier's own black-box probe, run inside the OS jail, drives both halves
against a real jailed daemon.

**Decoy.** A probe asserting only the orphaned-collected half (no referenced-survives control) passes
a naive "orphan detection exists" check while leaving T11 wide open — this criterion requires both, in
the same run, against the same daemon.

**Verification (round 4 — verifier-owned black-box probe, real `apply` inside the jail, no product
test file).** The "referenced" fixture uses the closest real, generically-available production
mechanism for making the daemon aware of a path (`POST /api/import/folder`, already used by C10F-5);
the "orphaned" fixture is a file the verifier places directly under the `orphaned-staging` Tier-2 root
with no daemon awareness at all. The probe calls real `gc plan` then real `gc apply --confirm`, and
asserts: the referenced fixture is never a candidate and survives `apply` on disk; the orphaned
fixture IS a candidate and is actually gone after `apply`. Replayed against `baseCommit` and HEAD per
"Verifier safety model." The real DB-reference mechanism remains an implementation detail this PRD
does not prescribe — **C10F-13's adversarial-review record is the second, human-in-the-loop layer
that must independently judge the genuineness of the eventual implementation's own orphan-check logic
beyond what this probe happens to exercise** before `verdict: APPROVE` is legitimate.

---

### SANDBOX-CONFINEMENT, INTERPOSER-CANARY-VALIDATION, FIXTURE-ISOLATION, TEARDOWN-FAILS-CLOSED-SELFTEST, GATE-INTEGRITY, LEASE, HEAD-DRIFT

Meta/infra checks — about the gate's own integrity and safety, never the product:

- **SANDBOX-CONFINEMENT** (new, round 4) — the `I-W10F-VITEST-CONFINEMENT` preflight: an
  inside-envelope canary create+delete succeeds; a byte-verified outside-envelope canary write+delete
  both fail. Runs before any repository code executes; hard-fails the whole run (never a skip) if the
  jail is unavailable or the containment proof fails.
- **INTERPOSER-CANARY-VALIDATION** (new, round 4) — the `I-W10F-DELETE-PROOF` layer-(b) canary set:
  five independent call shapes (property access, direct `node:fs` import, direct `node:fs/promises`
  import, aliased/indirect wrapper, spawned deletion command) against a byte-verified denied canary,
  plus an allowed-scratch-fixture positive control. Every criterion that boots a jailed daemon or CLI
  is skipped honestly if this does not pass.
- **FIXTURE-ISOLATION** — rebuilt around the jail's structurally stronger guarantee (see "Verifier
  safety model"): self-scan for any `fs` mutation call in this file targeting a `repoRoot`-derived
  path, plus all-daemon-teardowns-confirmed-zero-survivors, with zero enumeration uncertainty
  anywhere this run (`I-W10F-TEARDOWN-FAIL-CLOSED` hard-fails this check on any `state:"unknown"`).
  `not-exercised`, never a vacuous pass, when no daemon was ever booted this run.
- **TEARDOWN-FAILS-CLOSED-SELFTEST** (new, round 4) — a controlled enumeration-uncertainty probe,
  isolated from every real daemon this run boots, against disposable dummy process groups: forced
  `ps` failure (nonzero exit, timeout, malformed output) must each yield `state:"unknown"`, never
  `[]`, and the full teardown wrapper must report `ok:false` with the scratch envelope retained for
  that case; a genuinely healthy empty enumeration remains the sole zero-survivor pass.
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

## Round 4 — binding tribunal ruling → closures

Rounds 1 and 2's finding tables are retired (round 4 is a wholesale architectural replacement, not a
patch on top of them; every mechanism they closed either still stands under a new name below or was
itself superseded). Round 3's own architecture — "the verifier never invokes `apply`," product-
authored Vitest files as evidence, AST call-graph/registry-literal proof — is what round 4 replaces,
per the escalation tribunal's binding ruling (three consecutive REJECTs on round 3 tripped this
program's stop rule).

| Invariant | What it closes | Closure in this document / verifier |
|---|---|---|
| `I-W10F-VITEST-CONFINEMENT` | T10 (the gate itself deletes real data) — round 3's "never call apply" rule is itself the defect: refusing to dial the endpoint only ever produced evidence about a black box's *description* of its own tests. | Every product/daemon/CLI/package-script process runs inside a `sandbox-exec` jail confined to one fresh scratch envelope with loopback-only, non-protected-port network authority; preflighted before any repository code executes. Implementation-authored Vitest files are retired as verifier evidence (see "Required red-spec test files"). |
| `I-W10F-DELETE-PROOF` | F4 (this program's recurring finding class: AST/registry/call-graph proof of runtime behavior is unsound and non-convergent, per `W9AS-PARK`/`W10A-PARK`/`W10B-PARK`) and F6 (registry-literal validation carrying pass/fail authority). | `findRegistryLiteral`, `functionCallGraphContainsDeleteCall`, and the red-spec import/binding machinery are removed. C10F-1 asserts the exact seven-category runtime matrix (`CATEGORY_MATRIX`) directly. C10F-6 is proven by a runtime interposer plus doubled real-request snapshot replay. C10F-3/5/7/9/10(apply leg)/11/17 are proven by verifier-owned black-box probes that call real `gc-apply` inside the jail and compare realized filesystem state, replayed at `baseCommit` and HEAD. C10F-14 is proven by exact SHA-256 digests of the named `DECISIONS.md` sections. |
| `I-W10F-EVIDENCE-BINDING` | Live-checkout `dist`/`node_modules`/ignored-artifact contamination of evidence; `--all`-scoped reviewer-identity spoofing. | Every evidence commit (HEAD and each probe's red-commit replay) rebuilds in a fresh `git clone --no-local --no-hardlinks --no-checkout` + `checkout --detach`, frozen offline `pnpm install --offline --frozen-lockfile` (whose own postinstall scripts rebuild every workspace package from tracked source). C10F-13's reviewer identity comes only from two exact `baseCommit`-anchored `git log` commands; `--all` is forbidden. |
| `I-W10F-TEARDOWN-FAIL-CLOSED` | The `W9AS-PARK` teardown carry-forward's residual gap: a `ps` enumeration that silently degrades to "no survivors" on a parse/spawn/timeout failure. | `listProcessGroupMemberPids` returns a discriminated `{state:"known", pids}` / `{state:"unknown", attempts}` — never `[]` on uncertainty. Any `unknown` result hard-fails `FIXTURE-ISOLATION` and the whole run, triggers best-effort SIGKILL escalation, and retains the scratch envelope until zero survivors are independently confirmed. `TEARDOWN-FAILS-CLOSED-SELFTEST` proves this against forced `ps` failure modes. |
