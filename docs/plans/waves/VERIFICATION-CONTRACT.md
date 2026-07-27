# Verification contract — binds every wave

**Created:** 2026-07-26 (revision 2, after two adversarial reviews of the wave plan)
**Status:** authoritative. Where a wave PRD's criterion conflicts with a rule here, this file wins.

## Why this file exists

Both reviewers of the first draft returned **REVISE**, and their single most damaging convergent
finding was the same one:

> No PRD names a checked-in verifier. Completion supposedly depends on a script exit code, but no
> script exists — so an agent can run `pnpm guard`, write plausible transcripts, and mark every
> criterion complete without ever executing a criterion-specific probe. (Sol #1; Grok #51)

Everything else they found was a variation on it: criteria that read as mechanical but resolve to
a human nodding, criteria satisfiable by a stub, criteria that pass because an unrelated thing
failed. This file makes the gate real and states the rules that criteria may not evade.

---

## 1. The verifier

Every wave ships a verifier **before** it ships an implementation.

- **Location:** `scripts/waves/verify-<wave>.ts` — one per wave (`verify-w0.ts`, `verify-wc.ts`, …).
- **Language:** TypeScript. Repo policy (`AGENTS.md` → Environment baseline) makes new scripts
  TypeScript-first, and `scripts/tsconfig.json` includes `./**/*.ts`, so `pnpm typecheck` covers
  `scripts/waves/` automatically with no config change.
- **Invocation:** `pnpm exec tsx scripts/waves/verify-<wave>.ts` — matching how `scripts/guard.ts`
  and the other repo-level checks already run. **Do not add a root `package.json` alias**; the root
  command boundary in `AGENTS.md` is deliberately narrow.
- **End of life:** `scripts/waves/` is program scaffolding, not product surface. It is deleted in
  one commit when the program closes. Say so in a header comment in every verifier so a future
  reader does not mistake it for permanent infrastructure.

The verifier is the **only** thing that may declare a criterion passed. An agent's narrative, a
reviewer's approval, and a green `pnpm guard` are all insufficient on their own.

## 2. The proof manifest

Each verifier run writes `~/.claude/goal-state/<wave-slug>/proof/manifest.json`:

```jsonc
{
  "wave": "W0",
  "commit": "<git rev-parse HEAD>",          // bound to the tree that was tested
  "treeDirty": false,                         // true ⇒ the run is advisory, never a pass
  "baseCommit": "<merge-base with main>",
  "toolchain": { "node": "…", "pnpm": "…" },
  "criteria": [
    {
      "id": "C0-1",
      "command": "pnpm exec tsx scripts/waves/probe-w0-restore.ts",
      "assertion": "restored row count == source row count AND integrity_check == ok AND asset body sha256 matches",
      "artifact": "proof/C0-1.txt",
      "artifactSha256": "…",
      "exitCode": 0,
      "status": "pass",                       // pass | fail | blocked-on-founder
      "durationMs": 41233
    }
  ]
}
```

**Rules the manifest enforces:**

1. **Every criterion ID in the PRD must appear.** A criterion with no entry is `fail`, never an
   implicit pass. Silence is failure.
2. **`treeDirty: true` can never produce a wave pass.** Verification binds to a commit or it does
   not count.
3. **`status: "blocked-on-founder"` is a legal terminal state** for criteria this contract marks as
   human-judgment (§3, R7). It does not block the autonomous loop; it blocks *landing*.
4. **The artifact must be non-empty and hash-matched.** The `/goal` gate (`check-complete.py`)
   already refuses empty proof files; the hash stops an artifact from being edited after the run.

## 3. Universal anti-gaming rules

These bind every criterion in every wave. A criterion that appears to permit otherwise is
overridden by this section.

**R1 — Red before green, on the parent commit.**
Any criterion asserting a fix works must ship a test that **fails on the named parent SHA** and
passes at head. The verifier records both transcripts. A test written after the fix, that has
never been observed red, is not evidence.

**R2 — No mocks at the boundary under test.**
If the criterion is about a transport, the test uses the real transport. SSE criteria may not use
a mocked `EventSource`; upload criteria may not use a mocked `fetch`; daemon-persistence criteria
may not use an in-memory stub. Mocking is fine *outside* the boundary being asserted (a fake model
provider behind a real HTTP path is fine; a fake HTTP path is not).

**R3 — Counting criteria are banned.**
"N+ tests pass" is not a criterion — it is satisfiable by splitting one test into three. Replace
with: the named suite passes, the suite contains **zero** `skip`/`only`/`todo` markers, and the
specific behaviors are asserted by name.

**R4 — Every "X is rejected" criterion needs a negative control.**
A test proving a request is refused must also prove it is refused **for the stated reason**. Pair
it with a control that should *succeed* and does. Otherwise an unrelated failure (offline host,
missing fixture, typo'd URL) passes the gate while the real hole stays open. This is precisely how
W-C's origin-leak check was gaming itself.

**R5 — Documentation may not close a behavioral finding.**
If egress still happens, "documented as deliberate" is not a pass. If a guarantee is not enforced,
narrow the claim **and** fix or explicitly accept the behavior with a founder decision record. A
doc-only escape hatch is available *only* for criteria this contract lists as class-B
(documented limitation), and only when no live behavior is implicated.

**R6 — Severity is reviewer-owned.**
The implementing agent may not downgrade, re-scope, or reclassify a finding. Findings are filed as
structured objects `{id, severity, file, claim, repro}`; only the reviewer that raised a finding —
or the founder — may change its severity. Moving a failing red test into "known limitations" is a
severity change and requires a founder token.

**R7 — Human judgment must be declared, not disguised.**
Criteria that genuinely need a person (aesthetic quality, "is this prose accurate", go/no-go) are
marked `human:` in the PRD and resolve to `blocked-on-founder`. They are legitimate — but they may
not masquerade as mechanical checks, because an autonomous run will rubber-stamp them. Every wave
must be able to reach "all mechanical criteria green, N founder items pending" without a person.

**R8 — Benchmark protocol.**
Any criterion comparing performance to a baseline must state: the same fixture corpus, the same
machine, a warmup policy, ≥5 repetitions, the reported statistic (p50 **and** p95), peak RSS, and
a **minimum improvement threshold** plus a **non-regression ceiling**. "Beats baseline" without
these passes on 0.1% noise. Baselines are versioned; rewriting a baseline requires a version bump
and a recorded reason.

**R9 — Write leases are mechanical.**
`git diff --name-only <base>...HEAD` must be a subset of the wave's lease globs (§4). The verifier
checks this. A lease is not a social agreement between agents; it is an assertion the gate makes.

## 4. Write leases

Canonical machine-readable copy: **`docs/plans/waves/leases.json`**. Prose here is explanatory.

| Wave | Owns (may write) | Notes |
|---|---|---|
| **W-C** | `skills/web-clone/**`, `apps/daemon/tests/web-clone-*.test.ts` | Verified against the branch diff: every daemon test it touches is `web-clone-`prefixed, so a prefix lease is real, not aspirational |
| **W0** | `scripts/waves/**`, `apps/daemon/src/{backup,security}/**`, `apps/daemon/tests/**` *except* `web-clone-*`, `docs/security/**`, `docs/testing/**`, `scripts/guard.ts` | Owns `pnpm guard` for Burst 1 — W-C may not edit it |
| **W7** | `docs/specs/**`, `evals/**` | Neither directory exists yet; W7 creates them. No product code, no root tooling |
| **W1** | `apps/daemon/src/runtimes/**`, `apps/daemon/src/server.ts`, `packages/contracts/**`, `apps/web/src/components/EntryShell.tsx`, `apps/web/src/components/agentModelSelection.ts`, cost-meter routes/UI/CLI | **Owns `EntryShell.tsx` and `server.ts` outright for Burst 2** |
| **W2** | `apps/web/public/**`, `README.md`, `apps/web/src/i18n/**`, `clipper/**`, `docs/**` *except* `security/`+`specs/`, `apps/daemon/src/routes/open-design-public-metadata.ts` | **Does not own `EntryShell.tsx`** — see §4.1 |
| **W4** | `apps/web/src/components/project-cover.tsx`, `DesignsTab`, `RecentProjectsStrip`, cover storage + render job, `apps/web/src/providers/registry.ts` | Owns `registry.ts` for its burst |
| **W9-ingest** | `apps/daemon/src/routes/library.ts` + its tests | Runs beside W4; different file set |
| **W3** | Library/nav/composer surfaces, `apps/web/src/providers/registry.ts` | Runs **after** W4 releases `registry.ts` |

### 4.1 The two overlaps the first draft got wrong

Both were asserted as "disjoint" and both are false. Verified directly in the tree:

- **`apps/web/src/components/EntryShell.tsx` carries both waves.** Line 228 is W2's
  `https://open-design.ai/subscribe` default; lines 119 / 2672 / 3023–3182 are W1's model-picker
  and `agentModelSelection` surface. **Resolution:** W1 owns the file. W2's one-line newsletter
  change is executed *inside W1's lease*, tagged `C2-1a`, and verified by W2's verifier reading
  the landed tree. W2 keeps every other brand surface, which is genuinely disjoint.
- **`apps/web/src/providers/registry.ts` carries both waves.** `fetchProjectFiles` (W4, line 1457)
  and `fetchLibraryAssets` (W3, line 2563) live in one 2,500+ line module. A "file lease" across
  one file two agents must both edit is fiction. **Resolution:** serialize — W4 then W3.

## 5. Execution order vs landing order

These are different, and conflating them created a real contradiction: the program says "nothing
is exposed before it can be restored," yet Burst 1 let W-C merge before backup existed.

- **Execution** may be parallel per the bursts.
- **Landing** is ordered. **W0 lands first.** No other Burst-1 wave merges until W0's verifier is
  green on `main`. W-C and W7 then rebase onto post-W0 `main` and **re-run their verifiers** before
  merging — a green verifier on a stale base is not a green verifier.
- One **integrating writer** performs merges, always from fresh `origin/main`. Concurrent agents
  do not merge their own work.

## 6. Loops

Three shapes. Every wave names the one it uses. All three inherit §3.

**`loop:red-green-review`** — red spec (on the parent SHA) → implement → adversarial review →
fix → re-review → land.
- **Round cap: 2 fix rounds**, then escalate to the founder. One coherent cap program-wide; the
  first draft said 2 in one place and 1 in another.
- A round ends only on a **machine-readable verdict** (`APPROVE` / `REVISE` + structured findings).
  A reviewer timeout, crash, or unparsable response is a **REJECT**, never a pass.
- The review record must carry reviewer identity, model, and the commit reviewed. Reviewer ≠ author
  is asserted from that record, not assumed.

**`loop:tranche`** (W9) — pick the highest-risk boundary → threat-model → red specs → harden →
verify → record → repeat.
- **"Attributed" has a definition**: an endpoint row counts only with `{owner, authn, authz,
  input-validation, size/rate limit, test-ref}` populated. `auth:none, validation:none` is not an
  attribution — it is a finding, and it requires either a control or a founder-signed accepted-risk
  entry naming who accepted it.

**`loop:eval-gate`** (W7/W8) — run the frozen corpus → score → accept a change only if it clears
**both**:
- **absolute floors** — per-axis minimums frozen in W7 and immutable by W8 (relative-only
  improvement lets a run cash out below every threshold), and
- **deltas** — improves ≥1 axis beyond a stated minimum meaningful delta, regresses none past
  tolerance, and does not degrade the **cumulative** score across accepted steps.
- Scorer version is pinned in the manifest. W8 may not edit W7's thresholds or the scorer; a
  threshold change requires a founder decision record.
- Finite iteration budget: on K rounds with no accepted change, stop and escalate.

**Stop rule (all loops).** The first draft said "three consecutive rounds of new HIGH findings in
*new places*" — which an agent games by disputing what counts as a "new place." Replaced:

> Stop and escalate on **three consecutive non-APPROVE verdicts**, or when the HIGH-severity count
> is **non-decreasing across three rounds**. Neither depends on interpreting "new."

## 7. Program criteria evidence index

`G-1 … G-16` in `GLOBAL-GOAL.md` are not separately verifiable — each maps to wave criteria whose
proof artifacts constitute its evidence. `scripts/waves/verify-program.ts` reads every wave
manifest and asserts each `G-i`'s mapped criteria are `pass`. Without this, an agent can approve
every wave and never demonstrate a single program-level outcome.

| G | Evidence (wave criteria) |
|---|---|
| G-1 | CC-1 … CC-11 |
| G-2 | C0-1, C0-2, C0-3, C0-4 |
| G-3 | C0-5, C0-6, C0-7, C0-8 |
| G-4 | C0-9 + C4-10 (same R8 protocol, same corpus, same machine) |
| G-5 | C0-10, C0-11 |
| G-6 | C1-1 … C1-6 |
| G-7 | C1-7, C1-8, C1-9 |
| G-8 | C2-1, C2-2, C2-3, C2-6, C2-9 |
| G-9 | C3-1 … C3-12 |
| G-10 | C4-1, C4-3, C4-6, C4-7, C4-11 |
| G-11 | C7-1 … C7-16 |
| G-12 | W8 criteria measured by W7's frozen scorer at W7's frozen floors |
| G-13 | W9 tranche rows meeting the §6 attribution definition |
| G-14 | Review records present, reviewer ≠ author, machine-readable verdict per wave |
| G-15 | Every wave manifest present, commit-bound, `treeDirty: false` |
| G-16 | Every landing from fresh `origin/main` via the integrating writer; leases held |
