# Wave WR — Model routing system (deterministic dispatch-time routing)

**Slug:** `wr-routing`
**Gates on:** nothing at P0 — pure wave identity, lease, and verifier; no product code changes.
P1/P2 tranches gate on this P0 tranche's verifier being green on `main`, **and** on the
tranche-entry gate in "Tranche-entry gate for P1/P2" below.
**Parallel with:** every currently active `mishmash-completion` wave in `docs/plans/waves/leases.json`.
Every real allow/deny-glob intersection between this wave and another wave's lease is enumerated in
"Lease" below — computed by real glob-intersection, not literal-string matching (fix-round-1,
finding HIGH-2).
**Loop:** `loop:red-green-review` (`VERIFICATION-CONTRACT.md` §6) for the P1/P2 code tranches. P0
itself ships no behavior to red-green — its own gate is the mechanical identity/lease check defined
in "Verifier contract" below.
**Program:** this wave belongs to `docs/plans/2026-08-05-model-routing-system.md`, a separate plan
from `docs/plans/waves/GLOBAL-GOAL.md`'s `mishmash-completion` program. It reuses that program's
verification machinery (`VERIFICATION-CONTRACT.md`, `leases.json`) but is tracked under its own
goal-state root, `~/.claude/goal-state/wr-routing/`, not under a `mishmash-` prefix.
**Review status:** fix round 1, addressing GPT-5.6 Sol's REVISE verdict on commit `a2030ef87`
(10 findings: HIGH-1..6, MED-7..10). Every finding's fix is cited by ID at its resolution point
below so a re-reviewer can check each one directly.

## Why this wave exists

`docs/plans/2026-08-05-model-routing-system.md` §3 specifies a deterministic, dispatch-time
model-routing capability: today the daemon composes one prompt and spawns one user-selected
runtime CLI per chat run (`[REPO]`, plan §0); there is no routing key, no policy file, no admission
control, and no telemetry row that records what was *routed* versus what actually *ran*. The plan's
§7 adversarial-review table (Sol #13/#14) requires this capability to close as a full MishMash
capability — contracts, daemon routes, web UI, `od` CLI, and a wave verifier — not a private module,
and requires it to enter through the wave system on fresh `main`, honoring existing lease ordering
(plan §3.5).

This tranche is the **governance half** of plan §5's P0 phase: obtain an authorized wave identity
with exact, mechanically-checkable criteria and a verifier contract, and a lease map that does not
collide with active waves. The **build half** of P0 — the actual contracts/routes/CLI/UI
skeletons named in plan §5 — is separate follow-on work inside this same lease; it is not part of
this tranche's diff.

## Scope

This wave covers **phases P0–P2** of the 2026-08-05 plan (plan §5):

### P0 — Governance + closure scaffold (this tranche)

Wave identity (this document), the lease map (`docs/plans/waves/leases.json`), and the verifier
(`scripts/waves/verify-wr-routing.ts`). Also normative per plan §5's P0 bullet: the routing-key
fallback rules and the screenshot-baseline rules, both defined below and frozen at this tranche —
later tranches consume them, they do not redefine them here.

*Gate (plan §5): wave verifier passes; no lease collisions.*

### P1 — Policy + telemetry (advisory)

`routing-policy.json` at `apps/daemon/src/routing/routing-policy.json` (plan §3.2 L2: the §2 model
table + PRD §15 constraints as hard rules), covered by the existing `apps/daemon/src/routing/**`
lease glob — no separate lease entry needed for this exact path (fix-round-1, HIGH-6). A policy
test that fails on drift — an unknown stage, a missing constraint, or a §15 violation
(`check-context-isolation`-style, per plan §3.2). Per-run telemetry rows in the daemon's existing
SQLite layer (plan §3.2 L5): stage, template, design system, **routed-vs-observed model**, tokens,
cache hits, latency, cost (estimated flag), gate outcomes, escalations. The router recommends; a
human confirms. No dispatch-time enforcement yet.

**Backup/restore inclusion (fix-round-1, HIGH-6) — resolved without a new lease overlap.**
`apps/daemon/src/backup/create.ts` archives exactly two relevant classes today: `app-config`
(the daemon's `app-config.json`, archived whole, BYOK-stripped) and `sqlite-database` (the live
SQLite file, archived via online backup) — verified by reading `create.ts` directly. Telemetry rows
live in that same SQLite database, so they are **already** in the backup set with zero code change.
The routing policy's *active version marker* (not its full JSON body, which stays source-controlled
at `apps/daemon/src/routing/routing-policy.json`) is stored as a namespaced key inside
`app-config.json` — e.g. `appConfig.routingPolicyVersion` — which is likewise already archived
whole with zero code change. This is a deliberate simpler alternative to adding a new
`ArchiveClass` and touching `apps/daemon/src/backup/manifest.ts` / `create.ts`: it needs no new
lease overlap, no new backup-engine code path, and gets the same guarantee (the active policy
version and every telemetry row survive backup/restore) at lower risk. If a future tranche proves
this insufficient (e.g. the policy needs its own restore-time validation pass `manifest.ts` doesn't
support for arbitrary `app-config` keys), amending `apps/daemon/src/backup/manifest.ts` +
`create.ts` as a documented additive overlap with W0 (`apps/daemon/src/backup/**`) and W4
(`apps/daemon/src/backup/manifest.ts`, `apps/daemon/src/backup/create.ts` specifically) is the
fallback, decided then with evidence, not now on spec.

*Gate (plan §5): every run logs a complete telemetry row including routed-vs-observed model.*

### P2 — Dispatch routing + admission control + deterministic gates

The router decides by default, with an override in the UI (plan §3.1: binds at dispatch time,
before spawn — it cannot bind a CLI's inner loop, so per-runtime pinning flags plus post-run
usage-divergence reconciliation are the mitigation). Admission control denies dispatch when the
pre-run estimated-cost ceiling for the stage would be exceeded (plan §3.1 L4). The L3 deterministic
gate runner (plan §3.2: TS compile, ESLint, `design.md lint`, `tokens.schema.ts`, link/form smoke,
axe, Lighthouse CI budgets, screenshot SSIM against baseline) runs for lane-A (MishMash-native
static) websites. Escalation and pass rates, **and each lane's meter** (fix-round-1, HIGH-6's
lane-meter closure), are visible through `/api/routing/*` and `od route --json` (plan §3.4
capability closure — HTTP endpoint + contract type + UI surface + CLI subcommand, landed together
per `AGENTS.md` "Capability exposure"). The W7/W8 selector-eval floors
(`evals/selector/floors.json`) are a standing regression guard across every tranche of this wave —
see `CWR-P2-5` below — never edited by this wave's own diff.

*Gate (plan §5): escalation/pass rates visible; selector-eval floors unchanged.*

## Explicitly out of scope

**P2.5 and P6 of the 2026-08-05 plan are out of this wave's scope**, and every tranche after P0
must keep it that way:

- **P2.5 (the Craft system, plan §4b)** — the motion/layout/media/typographic/interaction token
  layer, Tier-0 craft primitives, `signatureMoment`, and the craft ship-gates are a design-systems
  and static-lane concern, not a routing concern. Craft's `signatureMoment` *feeds* a routing
  decision (plan §4b.3: "it drives... routing"), but building the craft token layer itself belongs
  to whichever wave owns `design-systems/`.
- **P6 (conditional learned routing, plan §5)** — gated on P1–P2's own telemetry showing the static
  table measurably leaving money or quality on the table (plan §5, `[PUBLISHED burden of proof]`).
  It cannot start before this wave's own gates close, and no criterion here presumes it will happen.

Also out of scope for this wave specifically: **P3 (run-boundary cascade + variations)** and **P4
(the orchestration graph)** — both named in plan §5 as later phases with their own gates, and
neither is part of the P0–P2 span this wave's identity covers. A future wave (or a later tranche of
this one, decided when P2 closes) picks them up.

**This wave does not bypass W3→W5→W6a ordering** (fix-round-1, HIGH-5). It builds routing
infrastructure only; every file it shares with another wave is touched only through the additive
seams documented under "Lease" below, mechanically enforced by `BYTE-PRESERVE` (no deletion or
modification of a pre-existing line in a shared file). **W6a's stop-rule state and every W6a
artifact are untouched, by construction**: `docs/plans/waves/W6a-client-website.md`,
`docs/plans/2026-08-03-client-website-studio-prd.md`, and `scripts/waves/verify-w6a-*.ts` are all
in this wave's `deny` list (see "Lease").

## Tranche-entry gate for P1/P2

Every product-code tranche of this wave (P1, P2, and any further split within them) must satisfy
all three of the following before the tranche's register entry (see "Tranche register" below) may
flip from `open` to `complete` — asserted mechanically by the verifier at the commit that flips it
(fix-round-1, HIGH-5):

1. **Fresh-main ancestry.** `origin/main`'s current tip is an ancestor of the tranche-completing
   commit — the tranche was rebased onto (or merged with) the latest `main` immediately before
   landing, not built against a stale base. Checked by `HEAD-DRIFT` below.
2. **Byte-preservation on every overlap file.** Every line present in a shared/overlap file (the
   six named under "Lease") at the wave's own base commit (merge-base with `origin/main`) is still
   present, unmodified, at the tranche-completing commit — the diff for that file may only add
   lines, never delete or rewrite one. Checked by `BYTE-PRESERVE` below. **One-line exception
   process:** if a shared file's existing line genuinely must change (not just have lines added
   around it — e.g. a function signature the new routing call site needs), that is `human:`
   judgment (`VERIFICATION-CONTRACT.md` §3 R7) and resolves to `blocked-on-founder`; it is never
   silently downgraded to "additive" by the implementing agent. No such exception is expected for
   any of the six named files' documented change types below.
3. **W6a untouched.** The tranche-completing commit's diff contains none of the deny-listed W6a
   paths. Checked by `LEASE`'s deny-glob assertion (below), same mechanism as every other deny.

## Tranche register

Frozen from the pinned governance commit forward (see "Verifier contract"). A tranche's `Status`
cell may only move `open → complete`, never back, and once a tranche is `complete` its `Owns
criteria` list may never change relative to the pinned governance commit's version of this table —
both checked mechanically. The criteria columns of this table are otherwise identical, in
substance, to the "Success criteria" table below; this table exists to track *progress*, not to
redefine *what* each criterion asserts (fix-round-1, HIGH-3).

| Tranche | Status | Owns criteria |
|---|---|---|
| P0 | complete | CWR-P0-1, CWR-P0-2, CWR-P0-3, CWR-P0-4, LEASE, HEAD-DRIFT, BYTE-PRESERVE, GATE-INTEGRITY, CWR-P2-5 |
| P1 | open | CWR-P1-1, CWR-P1-2, CWR-P1-3 |
| P2 | open | CWR-P2-1, CWR-P2-2, CWR-P2-3, CWR-P2-4 |

**Grading rule (fix-round-1, HIGH-3, replacing the removed `skip` status):** every criterion in
every tranche is graded `pass` or `fail` on every verifier run — there is no third "not yet
applicable" status. A criterion belonging to an `open` tranche that has no implementation yet
**legitimately fails** (its behavioral probe finds no code to exercise), and that failure is
recorded honestly in the manifest — but it does **not** affect the verifier's exit code, because
exit code is computed only over criteria owned by tranches marked `complete` (P0's own criteria,
always; P1/P2's criteria, only once their row above says `complete`). This means the *same* probe
code ships now, in this fix commit, already wired to assert real behavior — it simply has nothing
to pass against yet. Once a later tranche lands real code and flips its row to `complete`, the
identical probe starts gating for real, with no verifier rewrite (Success criteria table entries
for CWR-P1-*/CWR-P2-* describe exactly what each probe checks).

## Routing-key fallback (normative)

*(fix-round-1, MED-9: restated with an explicit nullable template component so the general-chat row
no longer contradicts the "key includes template id" framing.)*

Plan §5's P0 bullet and Sol v2 #5 (plan §3.1) require the routing key defined before any dispatch
code lands, because `od.mode` alone is too coarse (most web work is `prototype`). The key has five
components, the first two of which are **nullable**:

> **key = (templateId | NONE) × (buildClass | NONE) × stage × tokenizer-estimated context of the
> composed prompt × lane meters**

`templateId` and `buildClass` are independently nullable because they come from independent
sources — `templateId` from whichever runtime template a run selects (present even outside a
brief), `buildClass` only from a `ClientWebsiteBrief` (present only for brief-backed web work).
`stage` (plan §3.3), the context estimate, and lane meters are never null. Four shapes result, and
every routing key this wave ever computes is one of them — no fifth shape may be added without
amending this section first:

| Work shape | templateId | buildClass | Owning fallback |
|---|---|---|---|
| `ClientWebsiteBrief`-backed web build | present | present | **Primary key** (plan §3.1, Sol v2 #5) |
| Non-brief templated work (a template selected with no `ClientWebsiteBrief`, e.g. a saved prompt template used outside the Client Website flow) | present | `NONE` | **Fallback A** |
| General chat (no brief, no template) | `NONE` | `NONE` | **Fallback B** — `stage = 'chat'`, runtime default resolves the model |
| Non-web work with its own stage vocabulary (ingestion, mobile) | `NONE` (or a pipeline-internal id, never the web template enum) | `NONE` | **Fallback C** |

**Fallback C splits into its own stage keys**, per plan §5's P0 bullet:

| Non-brief, non-web work | Routing key |
|---|---|
| Ingestion (plan §4 rights-laned pipeline) | its own stage key, scoped to the ingestion pipeline stage (`classify` / `extract` / `distill` / `verify` / `register`), never the brief build-class axis |
| Mobile (plan §1 Lane C) | its own stage key, scoped to the mobile build phase, independent of the web build-class enum |

These four shapes (primary + fallbacks A/B/C) are frozen at this tranche. A later tranche
implementing the routing key type must express exactly these four shapes and may not invent a
fifth without amending this section first.

## Screenshot-baseline rules (normative)

*(fix-round-1, MED-10: the bootstrap sequence is now explicit, so "baseline = first frontier-passed
render" no longer begs the question of what gates a render before any baseline exists to compare
against.)*

Plan §5's P0 bullet and Sol v2 #12 (plan §3.2 L3, deterministic gates) require the screenshot-SSIM
baseline rule defined before any L3 gate code lands. Normatively, in this order:

1. **Bootstrap (no SSIM gate yet).** The very first render of a given build clears every **other**
   L3 deterministic gate (plan §3.2: TS compile, ESLint, `design.md lint`, `tokens.schema.ts`,
   link/form smoke, axe, Lighthouse CI budgets) — every gate except SSIM, which has nothing to
   compare against yet. A render that fails any of those is not eligible to become a baseline; the
   build simply has no baseline yet and stays in bootstrap.
2. **Negative-control calibration.** Before the bootstrap render is promoted, a deliberately
   perturbed variant of that same render (a known-bad control — e.g. a swapped color token or a
   shifted layout) is scored against it, and **must** score below the SSIM floor. This is the proof
   the comparison discriminates at all, done once per build before there is a real baseline to
   defend, not after.
3. **Promotion.** Only after both (1) and (2) hold does the render become **baseline v1**,
   versioned with the token freeze in force at that moment (plan §3.3: "Frozen tokens are
   versioned; any change revs the freeze and invalidates dependent sections"). A token-freeze
   revision invalidates its baseline; the next render under the revised freeze re-enters bootstrap
   at step 1 — a baseline never survives across a freeze revision by default.
4. **Steady state.** From the second render on, the SSIM gate is active: every subsequent render is
   scored against the current baseline, and the same negative-control check from step 2 is
   re-run whenever the baseline is replaced (freeze revision, manual re-baseline) — a baseline
   without a passing, currently-valid negative control is not a valid baseline, at any point in the
   build's life, not just at first promotion.

These four steps are frozen at this tranche. A later tranche implementing the L3 screenshot gate
must satisfy all four or amend this section first.

## Verifier contract

`scripts/waves/verify-wr-routing.ts` is the only thing that may declare a `CWR-*` criterion,
`LEASE`, `HEAD-DRIFT`, `BYTE-PRESERVE`, or `GATE-INTEGRITY` passed, per `VERIFICATION-CONTRACT.md`
§1. Status values are exactly `pass` | `fail` | `blocked-on-founder` — the same enum
`VERIFICATION-CONTRACT.md` §2 defines; the `skip` status from the pre-fix-round-1 verifier is
**removed entirely** (fix-round-1, HIGH-3). Every criterion in every tranche gets a real
pass/fail verdict on every run; see "Tranche register" for how an `open` tranche's honest failures
stay non-gating without a third status.

### Governance-pin freeze (fix-round-1, HIGH-1)

Without a pin, a later tranche could widen this wave's own lease or redefine its normative rules
and still pass, because the pre-fix verifier read `leases.json`/this document straight from the
branch working tree with no fixed reference point. The fix pins a specific commit as the frozen
governance baseline and checks every later commit against it, not against itself.

**Mechanism — a deliberate two-commit sequence, chosen over the alternatives for the reason
below.** A verifier cannot embed its own resulting commit sha (the sha is a hash of the commit's
content, which would have to include that sha — no fixed point exists in general). Two ways to
route around that:

- **(a) Commit the verifier last**, so it can name its own parent's sha as the pin. Rejected: the
  pin then names a commit that does *not* contain the verifier logic doing the checking, so the
  "verifier itself is pinned" half of this requirement is unsatisfiable by construction — there is
  no commit in that scheme where both the frozen content and the checking logic that enforces the
  freeze coexist.
- **(b) Two commits: content-freeze, then a pin-only follow-up.** Commit 1 ("fix(waves): apply WR
  P0 governance review findings") contains the complete, reviewed `WR-routing.md`, `leases.json`,
  and `verify-wr-routing.ts` — including all of this fix round's logic — with the pin constant
  (`GOVERNANCE_COMMIT` in the verifier) set to the literal sentinel `'PENDING-PIN'`. Commit 2
  ("chore(waves): pin WR governance commit sha") changes **exactly one line** — the
  `GOVERNANCE_COMMIT` assignment, to commit 1's real sha — and nothing else in the file. The
  verifier itself asserts this at every run from commit 2 onward: the diff between
  `GOVERNANCE_COMMIT` and `HEAD` for `scripts/waves/verify-wr-routing.ts` may add lines but may
  never delete or modify a pre-existing one, **except** the single `GOVERNANCE_COMMIT` assignment
  line itself, which is allowed to change exactly once (from sentinel to real sha) and is
  mechanically excluded from the no-deletion check by pattern, not by trust.

Chosen because it is the only scheme where a real commit exists containing both the frozen content
and the enforcement logic, and the one necessary exception (the pin line itself) is named and
checked by pattern rather than asserted by prose. **What is frozen, exactly, from
`GOVERNANCE_COMMIT` forward:** the `## Routing-key fallback (normative)` section, the `##
Screenshot-baseline rules (normative)` section, the `## Lease` section (including its fenced JSON
block), the `## Explicitly out of scope` section, and the `## Success criteria` table in this
document must be byte-identical to their `GOVERNANCE_COMMIT` versions at every later commit;
`leases.json`'s `WR` entry (`allow`, `deny`) must deep-equal its `GOVERNANCE_COMMIT` version
exactly (no widening, no narrowing without amending this document's frozen sections first, which
itself would require a new `GOVERNANCE_COMMIT` — an explicit, visible re-pin, never silent drift);
`verify-wr-routing.ts` may only grow (additions only) relative to its `GOVERNANCE_COMMIT` version,
modulo the one pin-line exception above. The `## Tranche register` section is explicitly **not**
frozen — its `Status` column is how future tranches report progress, gated by the rule in that
section that it may only move `open → complete`.

### Fresh-main + hard-fail git state (fix-round-1, MED-8)

`HEAD-DRIFT` resolves `baseCommit` (merge-base of `HEAD` and `origin/main`) and `HEAD` **at the
start** of the run, hard-fails the whole run on any git command erroring anywhere (no swallowed
git failures — a git error is a verifier failure, not an empty string quietly treated as "no
change"), asserts `origin/main`'s tip is an ancestor of `HEAD` (fresh-main ancestry, HIGH-5(a)),
attempts to confirm `origin/main` is fetchable (`git ls-remote --exit-code origin main`) and
records `originMainFetchable`/`originMainStale` honestly in the manifest rather than hard-failing
when offline, and **re-resolves `baseCommit`/`HEAD` again at the very end**, failing if either
changed mid-run (a concurrent commit landing on the branch while the verifier was running would
otherwise silently validate a tree that no longer exists).

### Byte-preservation (fix-round-1, MED-7)

`BYTE-PRESERVE` asserts, for each of the six named overlap files under "Lease" that exist in the
tree, that `git diff --unified=0 <baseCommit>..HEAD -- <file>` contains zero removed/changed lines
(only additions) — a real, mechanical proof of "additive only," not prose. The one-line exception
process is in "Tranche-entry gate for P1/P2" above.

### Real lease-collision detection (fix-round-1, HIGH-2)

`CWR-P0-3` computes glob intersection structurally: two globs intersect when one's literal prefix
(everything before its first `*`/`?`) is a prefix of the other's literal prefix (or vice versa) —
the conservative check the finding specified. A resulting intersection is **not** a live collision
if the other wave's own `deny` list already excludes the overlapping path (the repo's own
`deny-always-wins` convention, applied the same way W2's verifier reads a landed tree). Every
intersection that survives that filter is enumerated in "Lease" below by name, not asserted in the
abstract.

### Behavioral probes, not shape checks (fix-round-1, HIGH-4)

Every `CWR-P1-*`/`CWR-P2-*` criterion is graded by actually running something, never by checking
that a file merely exists with a plausible name:

- **Vitest-backed criteria** (`CWR-P1-1`, `CWR-P1-2`, `CWR-P2-1`, `CWR-P2-2`, `CWR-P2-3`) run the
  named test glob with `vitest --reporter=json`, require it to find at least one test file, require
  every collected test to pass, require **more than zero** tests collected, and require at least
  one **passing test whose full name matches a required keyword** specific to that criterion (the
  negative control: a stub file with one trivial `it('works', ...)` and no keyword-matching test
  cannot pass, because the keyword search comes up empty even though "a test exists and is green"
  would otherwise be true).
- **CLI-backed criterion** (`CWR-P2-4`) invokes the `route` subcommand directly
  (`tsx apps/daemon/src/cli.ts route --json`, the same invocation `od route --json` resolves to),
  requires a zero exit code, requires the stdout to parse as JSON, and requires the parsed object to
  carry `escalationRate`, `passRate`, and a non-empty `laneMeters` object — the lane-meter closure
  criterion folded in per HIGH-6. A stub that prints `{}` fails the required-keys check.

## Lease

Canonical copy: `docs/plans/waves/leases.json`, key `WR`. The block below must match it exactly
(`CWR-P0-2`), and from `GOVERNANCE_COMMIT` forward this whole section is frozen (`CWR-P0-4`).

```json
{
  "slug": "wr-routing",
  "allow": [
    "docs/plans/waves/WR-routing.md",
    "docs/plans/waves/leases.json",
    "scripts/waves/verify-wr-routing.ts",
    "apps/daemon/src/routing/**",
    "apps/daemon/src/routes/routing.ts",
    "apps/daemon/tests/routing*.test.ts",
    "apps/daemon/tests/routing/**",
    "packages/contracts/src/api/routing-policy.ts",
    "packages/contracts/src/api/routing-decision.ts",
    "packages/contracts/src/api/routing-telemetry.ts",
    "packages/contracts/tests/routing*.test.ts",
    "apps/web/src/components/routing/**",
    "apps/daemon/src/cli.ts",
    "apps/daemon/src/server.ts",
    "scripts/waves/capability-manifest.json",
    "scripts/guard.ts",
    "packages/contracts/src/index.ts",
    "apps/web/src/components/AssistantMessage.tsx"
  ],
  "deny": [
    "apps/web/src/providers/registry.ts",
    "packages/contracts/src/api/model-routing.ts",
    "docs/plans/waves/W6a-client-website.md",
    "docs/plans/2026-08-03-client-website-studio-prd.md",
    "scripts/waves/verify-w6a-*.ts"
  ]
}
```

**Every real overlap, by real glob intersection, not literal-string matching (fix-round-1,
HIGH-2).** Two kinds:

**A — exact-file overlaps** (one wave leases the literal filename, additive-only per the
`EntryShell.tsx` precedent, `VERIFICATION-CONTRACT.md` §4.1):

| File | Shared with | This wave may only |
|---|---|---|
| `apps/daemon/src/cli.ts` | W0, W1, W3, W4 (landed) | register new `od route`/`od routing` subcommands through `SUBCOMMAND_MAP` — an additive entry, never edit an existing subcommand's dispatch |
| `apps/daemon/src/server.ts` | W1, W4 (landed) | mount the new `/api/routing/*` route module and add its dispatch hook — additive route wiring only, never touch existing route mounts |
| `scripts/waves/capability-manifest.json` | W1, W4 (landed) | append the routing capability's manifest row — additive entry only, per the same C1-8/C4-12 ruling that put this file under W1 and W4's leases |
| `scripts/guard.ts` | W0, W2 (landed) | additive test-wiring for the routing module only, never change an existing guard rule |
| `apps/web/src/components/AssistantMessage.tsx` | W1 (landed) | add the "why this model" routing-decision detail render inside the existing per-message model-detail area (`assistantModelDetail`, the `displayState` rendering block) — additive only, must not modify the existing `substituted`/`unverified` rendering W1 shipped |

**B — structural glob overlaps** (this wave's specific path falls inside another wave's *broader*
directory grant; additive-only in the same sense — new files/exports/tests inside the shared
directory, never editing a pre-existing file another wave put there):

| This wave's path | Falls inside | Owning wave's broader grant |
|---|---|---|
| `docs/plans/waves/WR-routing.md`, `docs/plans/waves/leases.json` | `docs/plans/waves/**` | W-C, W0, W7 (all landed or foundational; `docs/plans/waves/leases.json` itself is not a change to any existing wave's *entry*, only an additive new `WR` key) |
| `scripts/waves/verify-wr-routing.ts`, `scripts/waves/capability-manifest.json` | `scripts/waves/**` | W0 (landed) |
| `packages/contracts/src/api/routing-policy.ts`, `routing-decision.ts`, `routing-telemetry.ts`, `packages/contracts/tests/routing*.test.ts`, `packages/contracts/src/index.ts` | `packages/contracts/**` | W1 (landed), W4 (landed) |
| `apps/daemon/tests/routing*.test.ts`, `apps/daemon/tests/routing/**` | `apps/daemon/tests/**` | W0 (landed), W1 (landed), W3 (has not yet started per its own gate, but its lease already grants this glob), W4 (landed) |

**Checked and found NOT a live collision (deny-precedence, same "deny always wins" convention W2's
verifier already uses):** W2 also leases `docs/**` broadly, which structurally contains
`docs/plans/waves/WR-routing.md` and `docs/plans/waves/leases.json` — but W2's own `deny` list
excludes `docs/plans/waves/**` outright, so W2 never had write access to this path in the first
place; there is no real collision to document beyond noting the check was made.

**Denied outright, never negotiated:**

| File/glob | Reason |
|---|---|
| `apps/web/src/providers/registry.ts` | Standing W4→W3 serialization (`VERIFICATION-CONTRACT.md` §4.1) — a 2,500+ line module two waves already had to serialize over. This wave adds a third claimant to nothing; it stays out entirely, including for any routing-relevant provider fetch it might otherwise want. |
| `packages/contracts/src/api/model-routing.ts` | W1's file, a different concept — W1's `model-routing.ts` is the requested/resolved/reported *picker-truth* contract (plan-unrelated to this wave); this wave's routing-decision/policy/telemetry contracts are new, separate files. Conflating them would blur two concepts the plan (§3.1) and W1's PRD both treat as distinct. |
| `docs/plans/waves/W6a-client-website.md`, `docs/plans/2026-08-03-client-website-studio-prd.md`, `scripts/waves/verify-w6a-*.ts` | W6a's stop-rule state and artifacts (fix-round-1, HIGH-5(c)) — this wave has no reason to ever touch them, and denying them outright makes that mechanical rather than a promise. |

## Review protocol

The adversarial reviewer for this wave is **GPT-5.6 Sol (Codex OAuth)**, per the 2026-08-05 plan's
own review lineage (v1 reviewed by Sol + Grok 4.5; v2 confirmation pass by Sol). Reviewer ≠ author
always (`VERIFICATION-CONTRACT.md` §6): the agent implementing a tranche of this wave is never the
agent that reviews it. Review happens **per task during the run** — each tranche (P0, P1, P2, and
any further split within them) gets its own review before it is considered landable — **and again
across the whole branch before landing**, per `AGENTS.md` → Code review guide and
`VERIFICATION-CONTRACT.md` §6's `loop:red-green-review` (round cap: 2 fix rounds, then escalate;
stop-and-escalate on three consecutive non-APPROVE verdicts or a non-decreasing HIGH count across
three rounds — this is fix round 1 of that cap).

**PRD §15 constraint compliance is binding on every dispatch this wave's code makes**, not just
documented: plan §2 states it verbatim — *"No Anthropic model may use API credits, Nous, or
OpenRouter for this program."* **Claude models are dispatched through Claude Code OAuth (Max)
only** for this program; `routing-policy.json` (P1) must encode this as a hard constraint the
drift-failing policy test enforces, and the P2 admission-control layer must refuse a dispatch that
would route a Claude model through any lane other than Claude Code OAuth. This is one of the
concrete rules `CWR-P1-1`'s policy test proves it enforces once P1 lands; at P0 it is recorded here
so no later tranche can silently soften it.

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-wr-routing.ts`.
Status enum is exactly `pass`/`fail`/`blocked-on-founder`; a criterion's tranche (see "Tranche
register") determines whether its `fail` blocks the verifier's exit code, never its own status.

| ID | Tranche | Criterion | Verification |
|---|---|---|---|
| CWR-P0-1 | P0 | Wave identity document complete | This document exists with every required section — read by exact heading/phrase match |
| CWR-P0-2 | P0 | Lease matches PRD exactly | `leases.json`'s `WR` entry's `allow`/`deny` deep-equal this document's declared JSON block |
| CWR-P0-3 | P0 | No undocumented lease collisions | Real glob-intersection (prefix-containment) against every other wave's allow list, deny-precedence applied; every surviving intersection is one of the documented overlaps above |
| CWR-P0-4 | P0 | Governance content is pinned and un-widened | `leases.json`'s `WR` entry and this document's frozen sections (normative rules, lease, out-of-scope, success-criteria table) are byte-identical to their `GOVERNANCE_COMMIT` versions; `verify-wr-routing.ts` has added no deletions relative to its `GOVERNANCE_COMMIT` version except the one sanctioned pin-line change |
| CWR-P1-1 | P1 | `routing-policy.json` + drift-failing policy test | Behavioral: `packages/contracts/tests/routing*polic*` runs green with ≥1 test, including one matching `/drift\|unknown stage\|constraint/i` |
| CWR-P1-2 | P1 | Telemetry row completeness (routed-vs-observed model) | Behavioral: `packages/contracts/tests/routing*telemetry*` runs green with ≥1 test, including one matching `/routed.*observed\|observed.*routed/i` |
| CWR-P1-3 | P1 | Policy + telemetry are in the backup set | Behavioral: an `app-config` archive dump contains a `routingPolicyVersion` key matching the active policy's version; the archived SQLite database contains the telemetry table with ≥1 row after a routed run |
| CWR-P2-1 | P2 | Dispatch-time routing with override | Behavioral: `apps/daemon/tests/routing*.test.ts` + `apps/daemon/tests/routing/**` run green with a passing test matching `/override/i` |
| CWR-P2-2 | P2 | Admission control denies over-budget dispatch | Behavioral: same suite, a passing test matching `/admission\|budget/i` |
| CWR-P2-3 | P2 | Deterministic L3 gate runner for lane-A | Behavioral: same suite, a passing test matching `/l3\|deterministic.*gate/i` |
| CWR-P2-4 | P2 | Escalation/pass rates + lane meters via `/api/routing/*` and `od route --json` | Behavioral: direct CLI invocation of the `route` subcommand with `--json`, zero exit, parseable JSON with `escalationRate`, `passRate`, non-empty `laneMeters` |
| CWR-P2-5 | P0 (always-gating) | Selector-eval floors unchanged | `evals/selector/floors.json` byte-identical between `baseCommit` and `HEAD` on every run, including this P0 run |
| LEASE | P0 | Write lease is mechanical | `git diff --name-only <base>...HEAD` ⊆ `WR`'s allow globs, touches none of `WR`'s deny globs |
| HEAD-DRIFT | P0 | Base is fresh, not stale, and git errors are fatal | `baseCommit`/`HEAD` resolved at start and re-resolved unchanged at end; `origin/main` is an ancestor of `HEAD`; any git command error fails the run |
| BYTE-PRESERVE | P0 | Overlap files are additive-only | `git diff --unified=0 <base>..HEAD` for each of the six named overlap files contains zero removed/changed lines |
| GATE-INTEGRITY | P0 | Manifest is self-consistent | Every criterion ID above has exactly one manifest entry with a non-empty, hash-matched artifact |

## Adversarial review

**GPT-5.6 Sol.** Focus for this fix round: does the two-commit pin actually close the widening hole,
or does the one sanctioned pin-line exception create a new one (could a second "exception" line be
smuggled in the same way)? Does the prefix-based glob-intersection check have false negatives (two
globs that can share a path without one prefix containing the other — e.g. two different wildcard
segments in the middle of the path)? Do the behavioral probes' keyword requirements actually block
a stub, or can a stub satisfy the keyword by naming its one trivial test something like
`"override test"`? Is the backup/restore resolution (reusing `app-config` + `sqlite-database`
instead of a new archive class) actually sufficient, or does something in `restore.ts` need the
policy version validated at restore time in a way a bare JSON key cannot provide?
