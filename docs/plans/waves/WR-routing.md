# Wave WR — Model routing system (deterministic dispatch-time routing)

**Slug:** `wr-routing`
**Gates on:** nothing at P0 — pure wave identity, lease, and verifier; no product code changes.
P1/P2 tranches gate on this P0 tranche's verifier being green on `main`.
**Parallel with:** every currently active `mishmash-completion` wave in `docs/plans/waves/leases.json`.
The allow list below is disjoint from all of them except six documented additive overlaps (see
"Lease" below); `apps/web/src/providers/registry.ts` is denied outright rather than negotiated, to
stay clear of the standing W4→W3 serialization (`VERIFICATION-CONTRACT.md` §4.1).
**Loop:** `loop:red-green-review` (`VERIFICATION-CONTRACT.md` §6) for the P1/P2 code tranches. P0
itself ships no behavior to red-green — its own gate is the mechanical identity/lease check defined
in "Verifier contract" below.
**Program:** this wave belongs to `docs/plans/2026-08-05-model-routing-system.md`, a separate plan
from `docs/plans/waves/GLOBAL-GOAL.md`'s `mishmash-completion` program. It reuses that program's
verification machinery (`VERIFICATION-CONTRACT.md`, `leases.json`) but is tracked under its own
goal-state root, `~/.claude/goal-state/wr-routing/`, not under a `mishmash-` prefix.

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

`routing-policy.json` (plan §3.2 L2: the §2 model table + PRD §15 constraints as hard rules) plus a
policy test that fails on drift — an unknown stage, a missing constraint, or a §15 violation
(`check-context-isolation`-style, per plan §3.2). Per-run telemetry rows in the daemon's existing
SQLite layer (plan §3.2 L5): stage, template, design system, **routed-vs-observed model**, tokens,
cache hits, latency, cost (estimated flag), gate outcomes, escalations. The router recommends; a
human confirms. No dispatch-time enforcement yet.

*Gate (plan §5): every run logs a complete telemetry row including routed-vs-observed model.*

### P2 — Dispatch routing + admission control + deterministic gates

The router decides by default, with an override in the UI (plan §3.1: binds at dispatch time,
before spawn — it cannot bind a CLI's inner loop, so per-runtime pinning flags plus post-run
usage-divergence reconciliation are the mitigation). Admission control denies dispatch when the
pre-run estimated-cost ceiling for the stage would be exceeded (plan §3.1 L4). The L3 deterministic
gate runner (plan §3.2: TS compile, ESLint, `design.md lint`, `tokens.schema.ts`, link/form smoke,
axe, Lighthouse CI budgets, screenshot SSIM against baseline) runs for lane-A (MishMash-native
static) websites. Escalation and pass rates are visible through `/api/routing/*` and `od route
--json` (plan §3.4 capability closure — HTTP endpoint + contract type + UI surface + CLI
subcommand, landed together per `AGENTS.md` "Capability exposure"). The W7/W8 selector-eval floors
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

### Routing-key fallback (normative)

Plan §5's P0 bullet and Sol v2 #5 (plan §3.1) require the routing key defined before any dispatch
code lands, because `od.mode` alone is too coarse (most web work is `prototype`). The **primary**
key, for `ClientWebsiteBrief`-backed work, is:

> **template id × build-class (from `ClientWebsiteBrief`) × stage (plan §3.3) × tokenizer-estimated
> context of the composed prompt (not file-plan size) × lane meters.**

For work that has **no** `ClientWebsiteBrief` — the case the primary key does not cover — the
fallback is, normatively:

| Non-brief work | Routing key |
|---|---|
| General chat (no brief, no template) | `runtime default` + `template id` |
| Ingestion (plan §4 rights-laned pipeline) | its own stage key, scoped to the ingestion pipeline stage (`classify` / `extract` / `distill` / `verify` / `register`), never the brief build-class axis |
| Mobile (plan §1 Lane C) | its own stage key, scoped to the mobile build phase, independent of the web build-class enum |

These three fallback rows are frozen at this tranche. A later tranche implementing the routing key
type must express exactly these four key shapes (primary + three fallbacks) and may not invent a
fifth without amending this section first.

### Screenshot-baseline rules (normative)

Plan §5's P0 bullet and Sol v2 #12 (plan §3.2 L3, deterministic gates) require the screenshot-SSIM
baseline rule defined before any L3 gate code lands. Normatively:

1. **Baseline = the first frontier-tier-passed render for a given build**, not an arbitrary early
   render and not a hand-picked "best" one. "Frontier-tier-passed" means it cleared the deterministic
   L3 gates in force at the time it was captured.
2. **The baseline is versioned with the token freeze** (plan §3.3: "Frozen tokens are versioned; any
   change revs the freeze and invalidates dependent sections"). A token-freeze revision invalidates
   its baseline; a new baseline is captured only after the next frontier-tier pass under the revised
   freeze. A baseline never survives across a freeze revision by default.
3. **Baselines carry negative controls** — at least one deliberately-broken render (a known-bad
   variant) that must score below the SSIM floor against the baseline. A baseline with no negative
   control cannot prove the SSIM comparison discriminates at all; it only proves the comparison
   runs.

These three rules are frozen at this tranche. A later tranche implementing the L3 screenshot gate
must satisfy all three or amend this section first.

## Verifier contract

`scripts/waves/verify-wr-routing.ts` is the only thing that may declare a `CWR-*` criterion,
`LEASE`, `HEAD-DRIFT`, or `GATE-INTEGRITY` passed, per `VERIFICATION-CONTRACT.md` §1. At this P0
tranche it asserts:

- **`CWR-P0-1`** — this document exists and carries the required sections (identity header, the
  P0/P1/P2 phase table above, the explicit P2.5/P6 exclusion, the two normative rule sections, this
  verifier-contract section, and the review-protocol section below) — read directly, by exact
  heading and phrase match, not by narrative claim.
- **`CWR-P0-2`** — the `WR` lease entry in `docs/plans/waves/leases.json` matches this document's
  own declared allow/deny lists byte-for-byte (cross-document consistency: the lease is not allowed
  to drift from what this PRD says it is).
- **`CWR-P0-3`** — every lease-glob collision between `WR`'s allow list and another wave's allow
  list in `leases.json` is one of the six documented additive overlaps below, and each is named in
  `WR`'s own `note` field; the two denied files are absent from `WR`'s allow list and present in its
  deny list.
- **`LEASE`** — `git diff --name-only <base>...HEAD` is a subset of `WR`'s allow globs
  (`VERIFICATION-CONTRACT.md` §3 R9).
- **`HEAD-DRIFT`** — the recorded `baseCommit` is a real ancestor of `HEAD` and is the actual
  merge-base with `origin/main` at run time, not a stale base.
- **`GATE-INTEGRITY`** — every criterion ID in this document's Success criteria table has exactly
  one entry in the proof manifest, with a non-empty, hash-matched artifact.

For **P1/P2 criteria** (`CWR-P1-1`, `CWR-P1-2`, `CWR-P2-1`..`CWR-P2-4`), the verifier already
contains the check it will run once the corresponding module/test files exist — it looks for them,
and where they are absent it records an explicit `status: "skip"` line (never a silent omission,
never an implicit pass) naming exactly what is missing and which later tranche will supply it. Once
those files land, the same verifier run starts asserting real pass/fail against them without any
further edit to this contract — the gate is strictly stronger over time, never re-authored to fit
whatever a later tranche happens to ship. **`CWR-P2-5`** (selector-eval floors unchanged) is the one
P2-numbered criterion that is mechanically checkable today regardless of implementation status —
`evals/selector/floors.json` must be byte-identical between `baseCommit` and `HEAD` on every run of
this verifier, including this P0 run — and it is graded for real starting now, not staged.

`skip` is a status this verifier defines in addition to `VERIFICATION-CONTRACT.md`'s
`pass`/`fail`/`blocked-on-founder` enum, scoped to criteria whose implementation genuinely does not
exist yet in this wave's own tranche sequence (as opposed to `blocked-on-founder`, which is for
criteria needing a human judgment call). A `skip` never counts toward the wave's exit code the way a
`fail` does, but it is never silent: it appears in the manifest, in the console summary, and names
the exact missing artifact, satisfying `VERIFICATION-CONTRACT.md` §3 R7's spirit — declared, not
disguised — even though R7's letter is written for human-judgment criteria specifically.

## Lease

Canonical copy: `docs/plans/waves/leases.json`, key `WR`. The block below must match it exactly;
`CWR-P0-2` asserts that.

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
    "packages/contracts/src/api/model-routing.ts"
  ]
}
```

**The six additive overlaps**, each shared with an already-landed wave's allow list and bound to
the additive-only discipline established by the `EntryShell.tsx` precedent
(`VERIFICATION-CONTRACT.md` §4.1):

| File | Shared with | This wave may only |
|---|---|---|
| `apps/daemon/src/cli.ts` | W0, W1, W3, W4 (landed) | register new `od route`/`od routing` subcommands through `SUBCOMMAND_MAP` — an additive entry, never edit an existing subcommand's dispatch |
| `apps/daemon/src/server.ts` | W1, W4 (landed) | mount the new `/api/routing/*` route module and add its dispatch hook — additive route wiring only, never touch existing route mounts |
| `scripts/waves/capability-manifest.json` | W1, W4 (landed) | append the routing capability's manifest row — additive entry only, per the same C1-8/C4-12 ruling that put this file under W1 and W4's leases |
| `scripts/guard.ts` | W0, W2 (landed) | additive test-wiring for the routing module only, never change an existing guard rule |
| `packages/contracts/src/index.ts` | W1's broad `packages/contracts/**` grant (landed) | append `export * from './api/routing-policy.js'` / `routing-decision.js` / `routing-telemetry.js` — additive barrel exports only |
| `apps/web/src/components/AssistantMessage.tsx` | W1 (landed) | add the "why this model" routing-decision detail render inside the existing per-message model-detail area (`assistantModelDetail`, the `displayState` rendering block) — additive only, must not modify the existing `substituted`/`unverified` rendering W1 shipped |

All six waves listed above have landed (per `docs/plans/waves/DECISIONS.md`'s amendment trail), so
none of these six files has a live concurrent writer; the overlap is with the *historical* grant
recorded in `leases.json`, not a wave executing in parallel today. `docs/plans/waves/leases.json`
itself is not treated as a seventh overlap: `W-C`, `W0`, and `W7` hold the broader
`docs/plans/waves/**` grant, but this wave's own entry is the narrower literal path
`docs/plans/waves/leases.json`, and the edit it makes — adding a new `WR` key — is additive to the
JSON map, not a change to any existing wave's entry.

**Denied outright, never negotiated:**

| File | Reason |
|---|---|
| `apps/web/src/providers/registry.ts` | Standing W4→W3 serialization (`VERIFICATION-CONTRACT.md` §4.1) — a 2,500+ line module two waves already had to serialize over. This wave adds a third claimant to nothing; it stays out entirely, including for any routing-relevant provider fetch it might otherwise want. |
| `packages/contracts/src/api/model-routing.ts` | W1's file, a different concept — W1's `model-routing.ts` is the requested/resolved/reported *picker-truth* contract (plan-unrelated to this wave); this wave's routing-decision/policy/telemetry contracts are new, separate files. Conflating them would blur two concepts the plan (§3.1) and W1's PRD both treat as distinct. |

## Review protocol

The adversarial reviewer for this wave is **GPT-5.6 Sol (Codex OAuth)**, per the 2026-08-05 plan's
own review lineage (v1 reviewed by Sol + Grok 4.5; v2 confirmation pass by Sol). Reviewer ≠ author
always (`VERIFICATION-CONTRACT.md` §6): the agent implementing a tranche of this wave is never the
agent that reviews it. Review happens **per task during the run** — each tranche (P0, P1, P2, and
any further split within them) gets its own review before it is considered landable — **and again
across the whole branch before landing**, per `AGENTS.md` → Code review guide and
`VERIFICATION-CONTRACT.md` §6's `loop:red-green-review` (round cap: 2 fix rounds, then escalate;
stop-and-escalate on three consecutive non-APPROVE verdicts or a non-decreasing HIGH count across
three rounds).

**PRD §15 constraint compliance is binding on every dispatch this wave's code makes**, not just
documented: plan §2 states it verbatim — *"No Anthropic model may use API credits, Nous, or
OpenRouter for this program."* **Claude models are dispatched through Claude Code OAuth (Max) only**
for this program; `routing-policy.json` (P1) must encode this as a hard constraint the drift-failing
policy test enforces, and the P2 admission-control layer must refuse a dispatch that would route a
Claude model through any lane other than Claude Code OAuth. This is one of the concrete rules
`CWR-P1-1`'s policy test proves it enforces once P1 lands; at P0 it is recorded here so no later
tranche can silently soften it.

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-wr-routing.ts`.

| ID | Phase | Criterion | Verification |
|---|---|---|---|
| CWR-P0-1 | P0 | Wave identity document complete | This document exists with every required section (identity, phase scope, P2.5/P6 exclusion, both normative rule sections, verifier contract, review protocol) — read by exact heading/phrase match |
| CWR-P0-2 | P0 | Lease matches PRD exactly | `leases.json`'s `WR` entry's `allow`/`deny` deep-equal this document's declared JSON block |
| CWR-P0-3 | P0 | No undocumented lease collisions | Every allow-glob collision with another wave's allow list is one of the six documented overlaps, named in `WR`'s `note`; both denied files are absent from `allow` and present in `deny` |
| CWR-P1-1 | P1 | `routing-policy.json` + drift-failing policy test | **Deferred to the P1 tranche.** Skips explicitly today, naming `packages/contracts/src/api/routing-policy.ts` and its policy test as the missing artifacts; once they exist, the verifier runs the test suite and requires it green |
| CWR-P1-2 | P1 | Telemetry row completeness (routed-vs-observed model) | **Deferred to the P1 tranche.** Skips explicitly today, naming `packages/contracts/src/api/routing-telemetry.ts` and its test as the missing artifacts |
| CWR-P2-1 | P2 | Dispatch-time routing with override | **Deferred to the P2 tranche.** Skips explicitly today, naming `apps/daemon/src/routing/**` and `apps/daemon/src/routes/routing.ts` as the missing artifacts |
| CWR-P2-2 | P2 | Admission control denies over-budget dispatch | **Deferred to the P2 tranche.** Skips explicitly today, same missing artifacts as CWR-P2-1 |
| CWR-P2-3 | P2 | Deterministic L3 gate runner for lane-A | **Deferred to the P2 tranche.** Skips explicitly today, naming `apps/daemon/src/routing/**` as the missing artifact |
| CWR-P2-4 | P2 | Escalation/pass rates visible via `/api/routing/*` and `od route --json` | **Deferred to the P2 tranche.** Skips explicitly today, naming `apps/daemon/src/routes/routing.ts` and the `od route` `cli.ts` subcommand as the missing artifacts |
| CWR-P2-5 | P2 | Selector-eval floors unchanged | **Graded for real starting at P0.** `evals/selector/floors.json` byte-identical between `baseCommit` and `HEAD` |
| LEASE | — | Write lease is mechanical | `git diff --name-only <base>...HEAD` ⊆ `WR`'s allow globs |
| HEAD-DRIFT | — | Base is not stale | `baseCommit` is an ancestor of `HEAD` and equals the live merge-base with `origin/main` |
| GATE-INTEGRITY | — | Manifest is self-consistent | Every criterion ID above has exactly one manifest entry with a non-empty, hash-matched artifact |

## Adversarial review

**GPT-5.6 Sol.** Focus for the P0 tranche specifically: does the lease actually avoid a live
concurrent writer, or does "landed" rest on an unverified claim? Is the routing-key fallback
genuinely exhaustive of non-brief work, or is there a fifth shape (e.g. the design-kit ingestion
pipeline of plan §4 vs. the "ingestion" row above — are they the same stage or two)? Does the
screenshot-baseline rule's negative-control requirement actually block a baseline that never had
one, or is it prose only? Does the `skip` status quietly become a second way to claim "done" for
work that was supposed to be `fail`?
