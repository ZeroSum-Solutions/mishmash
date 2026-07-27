# MishMash — Wave Plan

**Created:** 2026-07-26
**Inputs:** `../2026-07-26-mishmash-completion-assessment.md` (+ its post-audit addendum),
two adversarial audits (Grok 4.5 prose-only; GPT-5.6 Sol with repo access).
**How to run:** each wave is a `/goal`-drivable PRD in this directory. The global run is
`GLOBAL-GOAL.md`, which sequences the waves and enforces the gates between them.

---

## Design principles (derived from the audits, not invented)

1. **Nothing exposed or migrated before it can be restored.** Backup/restore and a daemon
   threat boundary precede every surface change. Both auditors put this first.
2. **Separate threat models never share a substrate.** Untrusted *remote* navigation
   (SSRF/egress), trusted *local* rendering (hostile HTML/resource exhaustion), and the
   web-clone capture branch (currently REJECT) stay in different waves with different reviews.
3. **Schema before UI.** Where a display would otherwise lie (model routing), the run record
   gains real fields first; the badge renders what exists.
4. **Spec + eval before generator.** For the Selector, an intermediate representation and a
   scored eval corpus exist before a line of generation code.
5. **UI/CLI parity is repo policy** (`AGENTS.md`). Every capability ships through the web UI
   *and* the `od` CLI over the same HTTP contract. Each wave carries that acceptance.
6. **Convergent findings from two independent adversaries are settled**, not opinions.

---

## Wave map

| Wave | Name | Gates on | Parallel with | Items |
|---|---|---|---|---|
| **W-C** | Clone pipeline close-out | — (lands after W0) | W0, W7 | NM-20C |
| **W0** | Substrate: recovery, boundary, baselines | — | W-C, W7 | NM-21C, NM-25C, NM-26C(inventory), NM-27C(measure), NM-33C, NM-28 |
| **W1** | Routing & spend truth | W0 | W2 | NM-13a/b/c, NM-14, NM-20, NM-33, NM-37C, NM-29C(picker) |
| **W2** | Brand honesty & docs | W0 | W1 | NM-02, NM-03, NM-04, NM-05, NM-06, NM-26, NM-31C, NM-34C, D-11/A3 retractions |
| **W3** | Library dark-launch readiness | W0 + W9-ingest + W4 | — (serial) | NM-07, NM-28C(library), NM-29C(library) |
| **W4** | Local project covers | W0 | W9-ingest | NM-18(reframed), NM-27C(fix), NM-35C |
| **W5** | Library usefulness | W3 **+ W1** | — | NM-08, NM-09, NM-10, NM-11, NM-12, NM-24C, NM-30C |
| **W6a** | Client Website, guided flow | W2, W4 | W5 | NM-15 |
| **W6b** | Remote capture isolation | **W-C**, W9-external-fetch | — | NM-22C, NM-17 |
| **W7** | Selector foundations (spec + grader) | — | everything | NM-23C |
| **W8** | Selector build | W7, W4, W3 (**not** full W5) | — | NM-16 |
| **W9** | Route hardening tranches | W0 | rolling | NM-22 (by boundary) |
| **W10** | Integration tail (**splits by capability**) | per slice | — | NM-19, NM-21, NM-23, NM-24, NM-25, NM-27, NM-32C, NM-36C |
| **W11** | Namespace & fork ops (deferred) | all | — | NM-01, NM-26C |

> **IDs cite [`NM-REGISTER.md`](NM-REGISTER.md) only.** Three documents independently proposed
> conflicting NM-35..NM-49 numbering; the register is the tiebreaker. NM numbers appearing in the
> raw audit outputs are that auditor's local numbering, not register IDs.

**W5–W11 are skeletons, not executable PRDs.** Each requires an independently-reviewed expansion
pass, frozen before implementation begins. See `W5-W11-gated.md`.

### Parallelization (revision 2 — the first version was wrong twice)

Both reviewers attacked the burst structure, and **both were right**. I verified their two
overlap claims against the tree rather than taking them on faith; both hold. Corrected:

**Burst 1 — execute together, `W0` lands first:** `W0` + `W-C` + `W7`
Isolation is real here: `W-C`'s six daemon test files are all `web-clone-*.test.ts` (checked
against the branch diff), and `W7` writes only `docs/specs/` + `evals/`, neither of which exists
yet. `W0` owns `pnpm guard` and the rest of `apps/daemon/tests/`. W-C and W7 rebase onto post-W0
`main` and re-run their verifiers before merging.

**Burst 2 — after W0 lands:** `W1` + `W2`, with **W1 owning `EntryShell.tsx` and `server.ts`**
Not disjoint as first claimed: `EntryShell.tsx` holds W2's `open-design.ai` newsletter default
(line 228) *and* W1's model picker (lines 119, 2672, 3023–3182). W2's one-line change executes
inside W1's lease as `C2-1a`; everything else in W2 is genuinely separate.

**Burst 3 — after W0:** `W4` + the `W9` **ingest tranche**
Genuinely disjoint — W4 is covers/grid, W9-ingest is `routes/library.ts`.

**Then `W3`, serially.** `providers/registry.ts` holds `fetchProjectFiles` (W4, line 1457) and
`fetchLibraryAssets` (W3, line 2563) in one 2,500+ line module. W3 also *must* follow the W9
ingest tranche — the first draft gated it on W0 alone while W9's own text said ingest must come
first.

**Serial thereafter:** `W5` (gates on W3 **and W1**) → `W6a` → `W6b` (gates on W-C + W9's
external-fetch tranche) → `W8`, with remaining `W9` tranches rolling alongside. `W10` splits by
capability. `W11` deferred by default.

Leases are machine-readable in **`leases.json`** and asserted by each wave's verifier — a lease
that only exists in prose is not a control.

---

## Loops

Defined in **[`VERIFICATION-CONTRACT.md`](VERIFICATION-CONTRACT.md) §6** — that file is
authoritative. Summary:

- **`loop:red-green-review`** (code waves) — red spec on the parent SHA → implement → adversarial
  review → fix → re-review → land. **2 fix rounds**, one cap program-wide. A reviewer timeout or
  unparsable verdict is a REJECT, not a pass.
- **`loop:tranche`** (W9) — highest-risk boundary first; "attributed" requires owner + authn +
  authz + validation + limits + test-ref. `auth:none` is a finding, not an attribution.
- **`loop:eval-gate`** (W7/W8) — accept a change only if it clears **absolute floors** *and*
  delta rules, with a pinned scorer version and a finite iteration budget. Relative-only
  improvement was the hole: it lets a run cash out below every threshold.

**Stop rule (revised).** The original — "three consecutive rounds of new HIGH findings in *new
places*" — is gameable by disputing what counts as a "new place." Replaced with: stop and escalate
on **three consecutive non-APPROVE verdicts**, or a **non-decreasing HIGH count across three
rounds**. Neither requires interpreting "new."

---

## Global adversarial policy

- Every wave gets an adversarial review before landing. **Reviewer ≠ author**, always.
- Reviewers with **repo access** (GPT-5.6 Sol) outrank prose-only reviewers on factual claims.
  The Grok-vs-Sol split in this very plan proved that: Grok's route/import counts and its
  cover-iframe threat were both wrong; Sol's AST-verified numbers stood.
- **Spot-check load-bearing numbers before acting on them.** The original backlog note claimed
  1,806 rebrand hits (real: 301) and my own assessment claimed 602 imports (real: 760) and 239
  endpoints (real: 340). Numbers in planning documents are hypotheses.
- Any finding a wave disputes must be refuted with **captured evidence**, not argument.

---

## Founder decisions still open

These block or reshape specific waves and are surfaced in `GLOBAL-GOAL.md`:

1. **NM-03 / NM-01** — internal identifiers (`od`, `OD_*`, `.od/`, `@open-design/*`): keep as
   deliberate (recommended, both auditors) or rename? Blocks W11's existence.
2. ~~**NM-20C** — web-clone disposition.~~ **Closed by the plan itself:** scoped class-A repair,
   then land. W-C exists to execute that ruling, so listing it as an open question while a wave
   executes it was contradictory (Grok #49). Reopen only to *reject* the class-A/class-B split.
3. **NM-24** — Instatic tether shape (MCP + Super Import seam vs deeper integration).
4. **NM-21** — memory scope: Library embeddings only (recommended) vs evaluating Gemini File
   Search / Vertex RAG.
5. **NM-29 / NM-30 / NM-31** — scroll-speed bug closure, mirror-width threshold override,
   `od2-debloat` worktree deletion.
6. **NM-33** — Kimi Code paid membership: buy or stay on print-mode.
