# MishMash — Global Goal

**Slug:** `mishmash-completion`
**Type:** program-level PRD. Drives the wave sequence; each wave has its own PRD in this directory.
**Created:** 2026-07-26 · **Revised:** 2026-07-26 (revision 2, after two adversarial reviews)
**Binding companion:** [`VERIFICATION-CONTRACT.md`](VERIFICATION-CONTRACT.md) — read it before any
wave. It defines the verifier, the proof manifest, the nine anti-gaming rules, the write leases,
and the loops. Where a wave criterion conflicts with it, that file wins.

---

## Goal

Take MishMash from "a working fork with a long backlog" to "a product whose surfaces are
trustworthy, recoverable, and complete," culminating in the two features that define it: the
**Client Website** flow and the **Mishmash Selector**.

## Non-negotiable operating rules

These come from two adversarial audits and from failures observed in this repo *today*. They bind
every wave.

1. **Nothing is exposed, migrated, or enriched before it can be restored.** W0 **lands** first.
   Other waves may *execute* in parallel with it, but nothing else merges until W0's verifier is
   green on `main`, and anything built alongside it rebases and re-verifies before landing. The
   first draft said "ships first" while simultaneously letting W-C merge during Burst 1 — a
   contradiction both reviewers caught.
2. **Separate threat models never share a substrate.** Untrusted remote navigation, trusted local
   rendering, and the web-clone capture branch stay in different waves with different reviews.
3. **Schema before UI.** Where a display would otherwise lie, the data model gains real fields first.
4. **Spec and grader before generator.** The Selector's IR and eval corpus exist before generation code.
5. **UI/CLI parity is repo policy** (`AGENTS.md` → Capability exposure). Every capability ships in
   the web UI *and* `od`, over the same `/api/*` contract, with `--json`.
6. **Numbers in planning documents are hypotheses.** Spot-check before acting. Precedent: the
   backlog claimed 1,806 rebrand hits (real: 301); the assessment claimed 602 imports (real: 760)
   and 239 endpoints (real: 340).
7. **Reviewer ≠ author, always.** Reviewers with repo access outrank prose-only reviewers on
   factual claims.
8. **Stop and escalate on three consecutive non-APPROVE verdicts, or a non-decreasing HIGH count
   across three rounds.** That pattern means the approach is wrong, not the implementation. (The
   earlier phrasing — "new HIGHs in *new places*" — was gameable: an agent simply disputes what
   counts as "new." Neither replacement condition requires interpretation.)
9. **A false guarantee in a comment or doc is a hard reject.** Fix behavior first, then narrow the
   claim to what is enforced.
10. **A criterion is passed by a checked-in verifier or it is not passed.** No narrative, no
    reviewer nod, no green `pnpm guard` substitutes for a criterion-specific probe with a
    commit-bound artifact. See `VERIFICATION-CONTRACT.md` §1–§2.
11. **Leases are mechanical, not social.** A wave's diff must be a subset of its globs in
    `leases.json`. Two agents "agreeing" to stay out of each other's files is not a control.

## Execution order

Corrected in revision 2: two of the three original bursts claimed file-disjointness that **does
not hold in the tree**. Both overlaps were verified directly, not taken on the reviewers' word.

**Burst 1 — execute together (leases in `leases.json`), land W0 first:**
- `W0-substrate.md` — backup/restore, daemon threat boundary, scale baseline, parity harness
- `W-C-clone-closeout.md` — land the clone pipeline (class-A fixes + honest limitation docs)
- `W7-selector-foundations.md` — composition IR + eval corpus + grader (writes only `docs/specs/`,
  `evals/` — neither directory exists yet, so the isolation is real)

W-C and W7 rebase onto post-W0 `main` and **re-run their verifiers** before merging.

**Burst 2 — after W0 lands, execute together with W1 holding the shared files:**
- `W1-routing-truth.md` — requested/resolved/reported model truth + cost meter
- `W2-brand-honesty.md` — favicon, README, i18n tail, metadata route, retractions

> ⚠️ **`EntryShell.tsx` is not disjoint.** It carries W2's `open-design.ai` newsletter default
> (line 228) *and* W1's model picker (lines 119, 2672, 3023–3182). W1 owns the file; W2's
> one-line change lands inside W1's lease as `C2-1a`.

**Burst 3 — after W0, execute together (genuinely disjoint):**
- `W4-project-covers.md` — persisted covers + fan-out fix
- `W9` **ingest tranche** — harden `routes/library.ts` before anything exposes the Library

**Then W3, serially:**
- `W3-library-launch.md` — gated on W0 **and** the W9 ingest tranche **and** W4 releasing
  `registry.ts`

> ⚠️ **`providers/registry.ts` is not disjoint either.** `fetchProjectFiles` (W4, line 1457) and
> `fetchLibraryAssets` (W3, line 2563) share one 2,500+ line module. A lease across a file two
> agents must both edit is fiction, so these serialize.

**Then, serially, with remaining `W9` tranches rolling alongside:**
`W5` (Library usefulness — gates on W3 **and W1**, because its spend controls need the meter) →
`W6a` (guided Client Website) → `W6b` (isolated remote capture — gates on W-C and W9's
external-fetch tranche) → `W8` (Selector build).
`W10` splits by capability; its onboarding slice gates on W6a/W8, not W1/W3.
`W11` is **deferred by default**.

**W5–W11 may not begin execution from their current skeletons.** Each needs a PRD-expansion pass
that is independently reviewed and frozen *before* implementation starts — otherwise the executing
agent writes its own acceptance criteria after seeing its implementation and certifies itself.

## Program success criteria

| ID | Criterion | Verification |
|---|---|---|
| G-1 | Clone pipeline landed | `f0c4bda56` merged (squashed) to `main`; class-A criteria green; limitations documented |
| G-2 | State is recoverable | W0 backup → restore into a fresh data root → verified equal |
| G-3 | Daemon boundary documented and enforced | `docs/security/daemon-threat-model.md` + ingest capability tokens + red specs |
| G-4 | Scale baseline exists, and later waves beat it | Committed baseline; W4 posts improved numbers |
| G-5 | Parity mechanically enforced | W0 harness in `pnpm guard`; fails on a one-surface capability |
| G-6 | The picker never lies | `requested`/`resolved`/`reported` persisted; substitution visible; unverifiable lanes say `unverified` |
| G-7 | Spend is visible | Per-project + total meter over existing telemetry; unknown pricing shown as unknown |
| G-8 | No live old-brand egress or chrome | Guard check green; favicon/README/i18n tail closed |
| G-9 | Library is safely reachable | Enabled-state integration test; degraded states distinguishable; a11y gate green; runtime-reversible rollout |
| G-10 | Covers persist, invalidate, and stay local | Stored covers; content-hash invalidation; red spec proves no remote fetch |
| G-11 | Selector is specified and gradeable | IR schema + pinned corpus + grader that scores a deliberately-wrong composition low |
| G-12 | Selector works by its own grader | W8 meets W7's thresholds — not by lowering them |
| G-13 | Route surface attributed | Every W9 row carries owner + authn + authz + validation + limits + test-ref; `auth:none` is a finding, not an attribution |
| G-14 | Every wave adversarially reviewed | Machine-readable verdict recorded per wave, with reviewer identity, model, and reviewed commit; reviewer ≠ author asserted from that record |
| G-15 | Every wave passes its own verifier | `scripts/waves/verify-<wave>.ts` exits 0 with a commit-bound, non-dirty proof manifest covering **every** criterion ID |
| G-16 | Landings are serialized and leased | Every merge from fresh `origin/main` through one integrating writer; each wave's diff ⊆ its `leases.json` globs |

Each `G-i` is verified by `scripts/waves/verify-program.ts` reading the wave manifests — see the
evidence index in `VERIFICATION-CONTRACT.md` §7. Program criteria are not independently assertable;
without that index an agent can approve every wave and demonstrate no program-level outcome.

## Founder decisions (surface at start, do not block on them)

1. **NM-03 / NM-01** — internal identifiers and the `@open-design/*` scope: **Resolved 2026-07-27
   — KEEP** as deliberate (both auditors recommended keeping). W11 will not fire.
2. **NM-24** — Instatic tether: **Resolved 2026-07-27** — seam = MCP + Super Import only; W10a
   pinned to that seam; deeper coupling needs separate evidence.
3. **NM-21** — memory scope: **Resolved 2026-07-27** — library embeddings only.
4. **NM-25** — VoiceBox: **Resolved 2026-07-27** — register the MCP and stop; W10b shrinks to
   registration only.
5. **NM-29 / NM-30 / NM-31** — scroll-speed bug closure, mirror-width threshold override,
   `od2-debloat` worktree deletion.
6. **NM-33** — Kimi Code paid membership: buy, or stay on print-mode.

W-C, W0, and W7 need **none** of these — start there regardless.

## State

- Run state: `~/.claude/goal-state/mishmash-completion/`
- Per-wave state: `~/.claude/goal-state/mishmash-<wave-slug>/`
- Assessment + register: `docs/plans/2026-07-26-mishmash-completion-assessment.md` (read its
  **ADDENDUM** — it supersedes the body where they disagree)
- Wave PRDs: `docs/plans/waves/`
