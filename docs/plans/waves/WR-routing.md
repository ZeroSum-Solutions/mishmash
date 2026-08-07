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
**Review status:** fix round 2 (final before escalation per `VERIFICATION-CONTRACT.md` §6's stop
rule), addressing GPT-5.6 Sol's second REVISE verdict on the round-1 fix commits. Round 1 addressed
a REVISE on commit `a2030ef87` (10 findings: HIGH-1..6, MED-7..10); round 2 found findings 3/9/10
RESOLVED, the rest partial, and 5 new HIGHs, with one root cause underneath most of them: **a
verifier on an unlanded branch cannot fully self-attest — every in-branch pin is a floating
self-attestation.** Round 2 replaces the round-1 two-commit `GOVERNANCE_COMMIT` pin with the repo's
own convention instead of continuing to fight that limitation: read governance from `baseCommit`
(merge-base with `origin/main`), exactly like every other wave verifier, with an explicitly-labeled
`pre-landing` mode for the (current) state where this wave hasn't landed yet. Every finding's fix is
cited by ID at its resolution point below so a re-reviewer can check each one directly.

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
all four of the following before the tranche's register entry (see "Tranche register" below) may
flip from `open` to `complete` — asserted mechanically by the verifier at the commit that flips it:

1. **Fresh-main ancestry.** `origin/main`'s current tip (verified against the live remote, not a
   possibly-stale local ref) is an ancestor of the tranche-completing commit — the tranche was
   rebased onto (or merged with) the latest `main` immediately before landing, not built against a
   stale base. Checked by `HEAD-DRIFT` below (fix-round-1, HIGH-5(a); hardened fix-round-2, new-HIGH-4).
2. **Byte-preservation on every overlap file.** Every line present in a shared/overlap file (the
   six named under "Lease") at the wave's own base commit (merge-base with `origin/main`) is still
   present, unmodified, at the tranche-completing commit, and the file itself still exists — the
   diff for that file may only add lines, never delete, rewrite, or remove the file. Checked by
   `BYTE-PRESERVE` below (fix-round-1, MED-7; hardened fix-round-2, new-HIGH-3). **One-line
   exception process:** if a shared file's existing line genuinely must change (not just have lines
   added around it — e.g. a function signature the new routing call site needs), that is `human:`
   judgment (`VERIFICATION-CONTRACT.md` §3 R7) and resolves to `blocked-on-founder`; it is never
   silently downgraded to "additive" by the implementing agent. No such exception is expected for
   any of the six named files' documented change types below.
3. **W6a untouched.** The tranche-completing commit's diff contains none of the deny-listed W6a
   paths. Checked by `LEASE`'s deny-glob assertion (below), same mechanism as every other deny.
4. **P0 (governance) must have landed to `main` first.** No product tranche may ever be declared
   `complete` while its own verifier run is in `pre-landing` mode (see "Verifier contract" →
   "Base-anchored governance, with an explicit pre-landing mode"). This is now enforced at **two**
   independent levels, not one — a fix-round-3 correction after Sol found the first level alone
   insufficient: gating **and** diff scope both lock down while `mode === "pre-landing"`:
   - **Gating lock (fix-round-2).** The verifier hardcodes gating to P0's own criteria only
     whenever `mode === "pre-landing"`, full stop, regardless of what the Tranche register claims
     for P1/P2 — a verifier run recorded as `pre-landing` can never be cited as evidence that a
     product tranche's criteria passed.
   - **Diff-scope lock (fix-round-3, finding 1 — closes the gap the gating lock alone left open).**
     **Pre-landing diffs are governance-only; product tranches require P0 landed to main.** While
     `mode === "pre-landing"`, `PRE-LANDING-SCOPE` asserts the commit's entire diff touches *only*
     `docs/plans/waves/WR-routing.md`, `docs/plans/waves/leases.json`, and
     `scripts/waves/verify-wr-routing.ts` — nothing else, unconditionally. Without this, a
     pre-landing diff could still carry untested product code sitting quietly inside a lease-allowed
     path (e.g. a stub file under `apps/daemon/src/routing/`): the gating lock alone means that
     code's criteria never block the *verifier*, but nothing stopped the code itself from riding
     along in a mergeable diff. With both locks, **nothing product-shaped can be present in, let
     alone pass from, a pre-landing diff** — the claim below is now literally true at the file level,
     not just the criteria level.

## Tranche register

Read from `baseCommit` once P0 has landed (see "Verifier contract"); read from `HEAD` only, with
gating locked to P0 **and diff scope locked to governance-only files**, while `mode ===
"pre-landing"` (the current, actual state — this table has never yet been read from a landed
`baseCommit`). Once landed, a tranche's `Status` cell may only move `open → complete` relative to
its `baseCommit` version, never back — checked mechanically. The `Owns criteria` column in each row
below is not itself trusted for gating (fix-round-3, finding 2): `GATE-INTEGRITY` cross-checks it
against the hardcoded `CRITERION_TRANCHE` map in `verify-wr-routing.ts` (the actual source of truth
for which criterion belongs to which tranche) and fails on any divergence, and the verifier's gating
computation reads only the hardcoded map plus each tranche's `Status` cell — **never** this column's
parsed text. This closes the exploit Sol reproduced: editing this table to move a criterion into
`P0`'s row (always `complete`) no longer changes what actually gates, because gating never looked at
this column in the first place; it only ever looked at `CRITERION_TRANCHE`, and `GATE-INTEGRITY`
would immediately flag the resulting mismatch as a failure. A tranche that flips `open → complete`
**within the current diff** (i.e. `open` at `baseCommit`, `complete` at `HEAD`) is graded gating *in
that same diff* — a tranche must pass its own criteria to land its own register flip, it cannot flip
first and prove itself later. `P0`'s row lists its own tranche-scoped criteria **union** the
`always-gating` criteria (`LEASE-INTEGRITY`, `GATE-INTEGRITY`, `CWR-P2-5`, `PRE-LANDING-SCOPE`) —
there is no separate table row for `always-gating`, since those criteria bypass the tranche/register
mechanism entirely regardless of which row documents them; `GATE-INTEGRITY`'s cross-check computes
that same union when validating the `P0` row. This table exists to track *progress*, not to redefine
*what* each criterion asserts or which tranche gates it (fix-round-1, HIGH-3; base-anchored
fix-round-2, point A.4; hardcoded-map fix-round-3, finding 2).

| Tranche | Status | Owns criteria |
|---|---|---|
| P0 | complete | CWR-P0-1, CWR-P0-2, CWR-P0-3, CWR-P0-4, LEASE, LEASE-INTEGRITY, HEAD-DRIFT, BYTE-PRESERVE, GATE-INTEGRITY, CWR-P2-5, PRE-LANDING-SCOPE |
| P1 | open | CWR-P1-1, CWR-P1-2, CWR-P1-3 |
| P2 | complete | CWR-P2-1, CWR-P2-2, CWR-P2-3, CWR-P2-4 |

P1 remains `open` solely because CWR-P1-3's frozen probe requires a `routingPolicyVersion`
reference in `apps/daemon/src/backup/create.ts`, which sits outside the WR lease — a governance
amendment (blocked-on-founder, drafted alongside this wave's landing) must extend the lease before
a WR tranche can satisfy it. CWR-P1-1 and CWR-P1-2 already pass; P1 flips in the follow-up tranche
after the amendment lands.

**Grading rule (fix-round-1, HIGH-3, replacing the removed `skip` status):** every criterion in
every tranche is graded `pass`, `fail`, or `blocked-on-founder` on every verifier run — there is no
fourth "not yet applicable" status, matching `VERIFICATION-CONTRACT.md` §2's enum exactly. A
criterion belonging to an `open` tranche that has no implementation yet **legitimately fails** (its
behavioral probe finds no code to exercise), and that failure is recorded honestly in the manifest
— but it does **not** affect the verifier's exit code, because exit code is computed only over
criteria the hardcoded `CRITERION_TRANCHE` map assigns to tranches marked `complete` (P0's own
criteria, always; P1/P2's criteria, only once their row above says `complete` **and** `mode !==
"pre-landing"`, per the Tranche-entry gate's rule 4). **`LEASE-INTEGRITY`, `GATE-INTEGRITY`,
`CWR-P2-5`, and `PRE-LANDING-SCOPE` are the sole exceptions: they are unconditionally exit-blocking
regardless of any tranche's status, register content, or `mode`** (fix-round-2, new-HIGH-2;
extended fix-round-3) — a bookkeeping failure in the manifest or lease itself, or a scope violation
in a pre-landing diff, is never something an `open` tranche's non-gating status can absorb. Any
non-`pass` status, including `blocked-on-founder`, blocks exit `0` for a gating criterion —
`blocked-on-founder` is a legal terminal state for *landing* decisions (a human must act), but an
autonomous verifier run still exits non-zero on one (fix-round-2, MED-7). This means the *same*
probe code ships now, in this fix commit, already wired to assert real behavior — it simply has
nothing to pass against yet. Once a later tranche lands real code and flips its row to `complete`
(with `mode !== "pre-landing"`), the identical probe starts gating for real, with no verifier
rewrite (Success criteria table entries for CWR-P1-*/CWR-P2-* describe exactly what each probe
checks).

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
`LEASE`, `LEASE-INTEGRITY`, `HEAD-DRIFT`, `BYTE-PRESERVE`, or `GATE-INTEGRITY` passed, per
`VERIFICATION-CONTRACT.md` §1. Status values are exactly `pass` | `fail` | `blocked-on-founder` —
the same enum `VERIFICATION-CONTRACT.md` §2 defines; the `skip` status from the earliest draft is
**removed entirely** (fix-round-1, HIGH-3). Every criterion in every tranche gets a real verdict on
every run; see "Tranche register" for how an `open` tranche's honest failures stay non-gating.

### Base-anchored governance, with an explicit pre-landing mode (fix-round-2, replaces the round-1 two-commit pin)

**Round-1 root cause (Sol round 2):** a verifier running on an unlanded branch cannot fully
self-attest — any pin it stores in its own commit history is a floating self-attestation, because
the branch that contains the pin is exactly the branch whose content the pin is supposed to
constrain. The round-1 `GOVERNANCE_COMMIT` two-commit dance did not escape this; it only moved the
self-reference one commit over.

**The fix is to stop fighting it and use the mechanism every other wave verifier already uses:**
read governance from `baseCommit` (`git merge-base origin/main HEAD`) — a commit this branch does
not control, because it is defined by where `origin/main` actually is. This is fully sound **once
P0 has landed to `main`**, exactly as it is for every other wave in `leases.json`.

**Mode detection.** At the start of every run, the verifier reads `leases.json` at `baseCommit`:

- **`mode: "post-landing"`** — a `WR` key already exists in `leases.json` at `baseCommit`. This
  wave's own governance has landed to `main`; everything below reads from `baseCommit` as the
  frozen reference, the same way `CWR-P0-3` already reads every *other* wave's lease from
  `baseCommit`.
- **`mode: "pre-landing"`** — no `WR` key exists at `baseCommit` yet. **This is the current, actual
  state** (this wave has not landed). The verifier reads its own governance content (the `WR` lease
  entry, the normative PRD sections, the Tranche register) from `HEAD` instead, because there is
  nothing at `baseCommit` to read. The manifest records `mode: "pre-landing"` prominently (top-level
  field, not buried), and — per the Tranche-entry gate's rule 4 — **both gating and diff scope lock
  down** while in this mode: gating is hardcoded to P0's own criteria only, regardless of what the
  Tranche register claims for P1/P2, **and** `PRE-LANDING-SCOPE` asserts the diff touches only the
  three governance files (fix-round-3, finding 1 — pre-landing diffs are governance-only; product
  tranches require P0 landed to main). Pinning becomes enforceable the moment P0 lands; until then,
  **the landing PR's own adversarial review is the enforcement surface for the governance content
  itself** — this verifier cannot be that surface for content it has no landed reference point to
  check against, and it says so honestly in the manifest rather than pretending otherwise with a
  self-issued sentinel.

No sentinel shas, no self-referential pin line, no two-commit sequence. `GOVERNANCE_COMMIT` and
`PIN_LINE_PATTERN` are deleted from the verifier entirely.

**What "frozen" means once `mode === "post-landing"`:** `leases.json`'s `WR` entry (`allow`, `deny`)
must deep-equal its `baseCommit` version (checked by `CWR-P0-4`); the identity-bearing **preamble**
(this document's title through the end of its front matter — Slug/Gates-on/Parallel-with/Loop/
Program/Review-status — everything before the first `## ` heading, frozen as that byte range since
it has no heading of its own) and the `## Scope`, `## Tranche-entry gate for P1/P2`, `##
Routing-key fallback (normative)`, `## Screenshot-baseline rules (normative)`, `## Verifier
contract`, `## Enforcement boundaries`, `## Lease`, `## Review protocol`, `## Explicitly out of
scope`, and `## Success criteria` sections of this document must be byte-identical to their
`baseCommit` versions (also `CWR-P0-4`, fix-round-3 finding 4 extended by fix-round-4 finding 1 to
cover the preamble and `## Scope` too — the wave's identity, authorized phases, and gates must not
be widenable post-landing); every *other* wave's lease entry must be
byte-identical to its `baseCommit` version too (`LEASE-INTEGRITY`, fix-round-2 new-HIGH-5 — this
wave's own diff must never touch another wave's entry, checked the same way regardless of mode
since other waves' leases are always already on `main`). **`scripts/waves/verify-wr-routing.ts`
itself must also be byte-identical to its `baseCommit` version once post-landing** (fix-round-3,
finding 3, folded into `CWR-P0-4`) — verifier changes are governance changes: land them via a
governance-only diff reviewed as `blocked-on-founder`, the same review posture as any other
frozen-section edit. Pre-landing exempts this one check (the file is still being authored on this
very branch), which is safe *only* because `PRE-LANDING-SCOPE` already confines a pre-landing diff
to the three governance files — the exemption and the scope lock are a matched pair, not two
independent decisions. The `## Tranche register` section is explicitly **not** frozen — see
"Tranche register" for its own forward-only rule, now anchored to `baseCommit` instead of a
self-issued pin.

**The hardcoded criterion→tranche map (fix-round-3, finding 2).** `CRITERION_TRANCHE` in
`verify-wr-routing.ts` is the sole source of truth for which criterion belongs to which tranche —
not the Tranche register table above, which is display/progress-tracking only. `GATE-INTEGRITY`
cross-checks every row of the table against this constant and fails on any divergence; the gating
computation itself reads only the constant plus each tranche's `open`/`complete` status, **never**
the table's own parsed "Owns criteria" text. This is the fix for the exploit Sol reproduced against
round 2: editing the table to move a criterion's *listed* ownership did nothing to its *actual*
gating status before this map existed as code, but round 2's gating computation still trusted the
table's parsed list directly — round 3 removes that trust entirely.

### Fresh-main, fail-closed (fix-round-1, MED-8; hardened fix-round-2, new-HIGH-4)

`HEAD-DRIFT` resolves `baseCommit` (merge-base of `HEAD` and `origin/main`) and `HEAD` at the
**start** of the run, hard-fails the whole run on any git command erroring anywhere (no swallowed
git failures — a git error is a verifier failure, not an empty string quietly treated as "no
change"), and **re-resolves both again after every behavioral probe has finished** (fix-round-2,
partial-8) — a concurrent commit landing mid-run, including during a slow `vitest`/CLI probe, is
caught rather than silently validating a tree that no longer exists. Fresh-main is now **fail-closed
by construction, not best-effort**: the verifier queries the live remote (`git ls-remote origin
main`), attempts to fetch that exact sha so its object is available locally
(`git fetch origin main`, bounded timeout), and requires it to be an ancestor of `HEAD`. Three
outcomes, all recorded in the manifest as `freshMain`: `"verified"` (remote reachable, sha fetched,
ancestor confirmed — pass), `"stale"` (remote reachable but `HEAD` does not include its tip —
fail), `"unverifiable"` (the remote could not be reached or fetched at all — **fail, not a pass**;
this is a `blocked-on-founder`-eligible condition since a person may need to confirm connectivity,
but an autonomous run still exits non-zero on it). The round-1 version treated an unreachable remote
as a soft, non-blocking note; that was wrong — an unverifiable fresh-main claim is exactly the kind
of unenforced guarantee `VERIFICATION-CONTRACT.md` §3 R5 forbids.

### Byte-preservation, unconditional (fix-round-1, MED-7; hardened fix-round-2, new-HIGH-3)

`BYTE-PRESERVE` checks, for each of the six named overlap files under "Lease", whether the file
existed at `baseCommit`. If it did not, there is nothing to preserve and the file is skipped. **If
it did, the file MUST still exist at `HEAD` — a missing file is an unconditional fail**, and
`git diff --unified=0 <baseCommit>..HEAD -- <file>` must contain zero removed/changed lines (only
additions). The round-1 version silently skipped a file that had gone missing from the *current*
tree instead of checking existence at `baseCommit` first, which let a deletion pass as "nothing to
check." The one-line exception process is in "Tranche-entry gate for P1/P2" above.

### Real lease-collision detection, with corrected deny-precedence (fix-round-1, HIGH-2; corrected fix-round-2, partial-2)

`CWR-P0-3` computes glob intersection structurally: two globs intersect when one's literal prefix
(everything before its first `*`/`?`) is a prefix of the other's literal prefix (or vice versa).
**This detection step is deliberately conservative (over-inclusive) by design** — prefix
containment can flag two globs as intersecting even where their true match sets do not actually
overlap in every case, and that is the correct failure direction for a collision check: a false
positive costs a line of documentation, a false negative costs a silent write conflict.

**Deny-precedence, corrected.** The round-1 version treated *any* intersecting deny glob as
excluding the *entire* overlap — wrong, because a deny only narrows the paths it actually matches,
not everything the two allow globs could ever jointly touch. The fix: a would-be collision is
excluded by deny-precedence only when the excluding wave's deny pattern, checked with a real regex
match (`globToRegExp`, not the conservative prefix heuristic), actually matches our specific
**literal** glob (no wildcard) — the one case where "the deny covers it" is unambiguous, because a
single concrete path either matches a pattern or it does not. When our side of the intersection is
itself a wildcard glob, deny-precedence never applies (the overlap is always surfaced and must be
documented) — the fix-round-1 version's `globsIntersect(d, ourGlob)` deny check is deleted, since it
inherited the same over-broad prefix logic used for detection and reintroduced exactly the bug this
fix removes.

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
  criterion folded in per HIGH-6. A stub that prints `{}` fails the required-keys check. See
  "Enforcement boundaries" below for exactly what this class of probe does and does not prove.

### GATE-INTEGRITY runs last, as a two-phase write (fix-round-2, LOW-8)

`GATE-INTEGRITY` computes its checks strictly after every other criterion (including the
behavioral probes and the re-resolved `HEAD-DRIFT`) has been recorded, so its "every criterion
present exactly once" assertion is checking the *complete* result set, not a partial one. It writes
itself in two phases: phase 1 records a verdict from everything recorded so far; phase 2
immediately re-reads that just-written artifact **from disk** (not from the in-memory value) and
re-validates it is present, non-empty, and hash-matched — if phase 2 finds a problem (a write race,
a truncated artifact), it replaces the phase-1 record with a corrected `fail` before the manifest is
written, rather than trusting an in-memory object that might not reflect what actually landed on
disk.

## Enforcement boundaries

*(fix-round-2, part C — accepted residuals, documented rather than mechanized.)*

This wave's verifier is mechanical, not adversarial, and it is honest about where that line falls:

- **Suite existence + green + negative-control keyword matching is what the verifier proves for
  `CWR-P1-1`, `CWR-P1-2`, `CWR-P2-1`, `CWR-P2-2`, `CWR-P2-3`.** It does **not** prove the suite's
  *quality* — that a test named with the right keyword actually exercises override/budget/constraint
  *behavior* rather than, say, asserting a constant or mocking away the thing it claims to test. A
  test that is green, present, and keyword-matched but exercises nothing real is a **review-catchable
  violation** (the per-tranche adversarial review, reviewer ≠ author, required by "Review protocol"
  below), **not a verifier-catchable one**. Keyword matching narrows what a reviewer has to check; it
  does not replace the check.
- **`CWR-P2-4`'s HTTP/UI surface proof lives in the focused daemon test suites (supertest-level or
  equivalent), not in this verifier booting a live server.** The verifier's CLI invocation proves the
  `route` subcommand exists and returns the required shape; it does not itself exercise
  `/api/routing/*` end-to-end. That proof is the responsibility of the P2 tranche's own daemon test
  suite (part of `apps/daemon/tests/routing*.test.ts` / `apps/daemon/tests/routing/**`, already
  graded green by `CWR-P2-1`..`CWR-P2-3`'s behavioral probes) — the verifier requires those suites
  green, and trusts them for the HTTP-level proof rather than re-implementing a server-boot harness
  that would duplicate what the suite already has to do correctly.

This is the honest boundary between what is mechanical (this verifier) and what is adversarial (the
reviewer) — stated here so a future reader does not mistake "the verifier is green" for "there is
nothing left for a reviewer to check."

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
    "apps/web/src/components/AssistantMessage.tsx",
    "apps/daemon/src/backup/create.ts",
    "packages/contracts/src/api/chat.ts",
    "packages/contracts/src/errors.ts",
    "apps/web/src/components/SettingsDialog.tsx"
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
| `apps/daemon/src/backup/create.ts` | W0, W4 (landed) | *(Amendment 1, 2026-08-06)* include `routingPolicyVersion` in the backup manifest plus the app-config write — the additive marker CWR-P1-3's frozen probe greps for, nothing else |
| `packages/contracts/src/api/chat.ts` | W1, W4 (landed; W1 notified via the amendment PR) | *(Amendment 1, 2026-08-06)* add optional wire fields `routingOverride?: { model; lane; reason } \| null`, `templateId?`, `buildClass?`, `taskClass?` — additive only, never change an existing field |
| `packages/contracts/src/errors.ts` | W1, W4 (landed) | *(Amendment 1, 2026-08-06)* add `'ROUTING_BLOCKED'` to the closed `ApiErrorCode` union — additive member only, migration path from the interim `FORBIDDEN`+`RoutingBlockedErrorDetail` shape t9 shipped |
| `apps/web/src/components/SettingsDialog.tsx` | no other wave | *(Amendment 1, 2026-08-06)* mount the `RoutingPanel` as an additive settings section alongside the existing sections — closes the t7 H2 disposition; never modify an existing section |

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
Status enum is exactly `pass`/`fail`/`blocked-on-founder`. A criterion's tranche ownership comes
from the hardcoded `CRITERION_TRANCHE` map (cross-checked against the Tranche register below, never
trusted from the register's own text) and determines whether a non-`pass` status blocks the
verifier's exit code — **except** `LEASE-INTEGRITY`, `GATE-INTEGRITY`, `CWR-P2-5`, and
`PRE-LANDING-SCOPE`, which block unconditionally regardless of tranche or `mode`.

| ID | Tranche | Criterion | Verification |
|---|---|---|---|
| CWR-P0-1 | P0 | Wave identity document complete | This document exists with every required section — read by exact heading/phrase match |
| CWR-P0-2 | P0 | Lease matches PRD exactly | `leases.json`'s `WR` entry's `allow`/`deny` deep-equal this document's declared JSON block |
| CWR-P0-3 | P0 | No undocumented lease collisions | Real glob-intersection (prefix-containment) against every other wave's allow list at `baseCommit`, corrected deny-precedence applied; every surviving intersection is one of the documented overlaps above |
| CWR-P0-4 | P0 | Governance content, including this verifier, is base-anchored and un-widened once landed | `mode: "pre-landing"` (current state) passes trivially — nothing to widen against yet, enforced by the landing PR's own review instead. Once `mode: "post-landing"`: `leases.json`'s `WR` entry, this document's frozen sections, and `verify-wr-routing.ts` itself are byte-identical to their `baseCommit` versions |
| CWR-P1-1 | P1 | `routing-policy.json` + drift-failing policy test | Behavioral: `packages/contracts/tests/routing*polic*` runs green with ≥1 test, including one matching `/drift\|unknown stage\|constraint/i` |
| CWR-P1-2 | P1 | Telemetry row completeness (routed-vs-observed model) | Behavioral: `packages/contracts/tests/routing*telemetry*` runs green with ≥1 test, including one matching `/routed.*observed\|observed.*routed/i` |
| CWR-P1-3 | P1 | Policy + telemetry are in the backup set | Behavioral: an `app-config` archive dump contains a `routingPolicyVersion` key matching the active policy's version; the archived SQLite database contains the telemetry table with ≥1 row after a routed run |
| CWR-P2-1 | P2 | Dispatch-time routing with override | Behavioral: `apps/daemon/tests/routing*.test.ts` + `apps/daemon/tests/routing/**` run green with a passing test matching `/override/i` |
| CWR-P2-2 | P2 | Admission control denies over-budget dispatch | Behavioral: same suite, a passing test matching `/admission\|budget/i` |
| CWR-P2-3 | P2 | Deterministic L3 gate runner for lane-A | Behavioral: same suite, a passing test matching `/l3\|deterministic.*gate/i` |
| CWR-P2-4 | P2 | Escalation/pass rates + lane meters via `/api/routing/*` and `od route --json` | Behavioral: direct CLI invocation of the `route` subcommand with `--json`, zero exit, parseable JSON with `escalationRate`, `passRate`, non-empty `laneMeters`; HTTP-level proof deferred to the daemon test suite per "Enforcement boundaries" |
| CWR-P2-5 | always-gating | Selector-eval floors unchanged | `evals/selector/floors.json` byte-identical between `baseCommit` and `HEAD` on every run, including this P0 run |
| LEASE | P0 | Write lease is mechanical | `git diff --name-only <base>...HEAD` ⊆ `WR`'s allow globs, touches none of `WR`'s deny globs |
| LEASE-INTEGRITY | always-gating | Other waves' leases are untouched | Every non-`WR` entry in `leases.json` is byte-identical between `baseCommit` and `HEAD` |
| PRE-LANDING-SCOPE | always-gating | Pre-landing diffs are governance-only | While `mode: "pre-landing"`: `git diff --name-only <base>...HEAD` is a subset of exactly `{WR-routing.md, leases.json, verify-wr-routing.ts}` — any other path is an unconditional fail. Passes trivially once `mode: "post-landing"` |
| HEAD-DRIFT | P0 | Base is fresh, not stale, and git errors are fatal | `baseCommit`/`HEAD` resolved at start, re-checked after all behavioral probes, and re-resolved a FINAL, authoritative time immediately before the manifest write; the live remote's `main` tip is fetched and confirmed an ancestor of `HEAD` (fail-closed — an unreachable remote is a fail, recorded as `freshMain: "unverifiable"`, not a pass); any git command error fails the run |
| BYTE-PRESERVE | P0 | Overlap files are additive-only and never deleted | For each of the six named overlap files that existed at `baseCommit`: it still exists at `HEAD` (missing = unconditional fail), and `git diff --unified=0 <base>..HEAD` contains zero removed/changed lines |
| GATE-INTEGRITY | always-gating | Manifest and register are self-consistent | Runs last, after every other criterion including the final `HEAD-DRIFT` re-read; every criterion ID above has exactly one manifest entry with a non-empty, hash-matched artifact, verified via a two-phase write that re-reads its own artifact from disk; the Tranche register's rows are cross-checked against the hardcoded `CRITERION_TRANCHE` map |

## Adversarial review

**GPT-5.6 Sol.** Focus for this fix round: does reading governance from `baseCommit` (with the
`pre-landing` fallback) actually close the self-attestation hole, or does the `pre-landing` mode
itself become a new hole if a future tranche's verifier run is misreported as `post-landing`
against a `baseCommit` that doesn't actually carry a landed `WR` key? Does the corrected
deny-precedence (literal-only, real regex match) still let through a case where a wildcard-vs-
wildcard overlap should have been excluded but isn't documented? Do the behavioral probes' keyword
requirements actually block a stub, or can a stub satisfy the keyword by naming its one trivial test
something like `"override test"`? Does `BYTE-PRESERVE`'s existence-at-`HEAD` check correctly
distinguish "file renamed" (which git may report as a delete+add, not caught by a naive
`cat-file -e` check on the old path) from "file genuinely deleted"? Is the backup/restore resolution
(reusing `app-config` + `sqlite-database` instead of a new archive class) actually sufficient, or
does something in `restore.ts` need the policy version validated at restore time in a way a bare
JSON key cannot provide?
