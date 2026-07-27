# Wave 7 — Selector foundations (spike: IR + eval corpus)

**Slug:** `mishmash-w7-selector-foundations`
**Gates on:** nothing — pure specification work, start immediately
**Parallel with:** everything (writes only to `docs/` and `evals/`, no product code)
**Blocks:** W8 (the Selector build). **W8 must not start until this wave's eval corpus exists.**
**Loop:** `loop:eval-gate` (defined here, used by W8)

## Why this wave exists

Backlog C2 — the "Mishmash Selector" — is the flagship: take 1–4 references (URL, library, or
upload), say in natural language which areas to adopt from each ("the layout of one, the
animations of another, the colour design or horizontal scrolling of a third, a full specific
section of a fourth"), compile that, and produce **3 prototype variants** to choose from.

The GitHub sweep found **nothing integrable anywhere** — the only comparable work is an academic
project with no code release. That is a signal about ambition, not a gap to paper over.

**Both auditors independently returned HIGH findings that this is ill-posed as a build ticket.**
Their shared diagnosis:

- There is no **reference-addressing model** — what does "the layout of A" *denote*? Which
  breakpoint? Which state (hover/scrolled/loaded)? Which subtree?
- There is no **conflict policy** — A's grid and C's palette can be incompatible; something must
  arbitrate deterministically.
- There is no **provenance map** — after composition, nobody can say which pixel came from where,
  which makes both debugging and rights-tracking impossible.
- There is no **definition of variant diversity** — "3 prototypes" that differ only cosmetically
  satisfy the letter and betray the intent.
- **"The user picks one" measures preference, not fidelity.** A run can produce three attractive
  variants that ignore the directives entirely and still pass every criterion the backlog states.
  Sol named this the "Selector demo trap" and listed it as a top-3 program risk.

So this wave writes the specification and the grader. **No generator code.**

## Scope

**S7-1 — Composition IR (the core deliverable).**
A serializable intermediate representation with, at minimum:
- **Source slots** — each reference gets an id, a captured snapshot, and an evidence pointer set
  (DOM path, computed styles, breakpoint, state).
- **Directive parse** — natural language → typed claims: `{axis, source, scope, strength}` where
  `axis ∈ {layout, motion, palette, typography, section, interaction, …}` and `scope` addresses a
  subtree or the whole document.
- **Constraints** — what must hold post-composition (grid integrity, contrast minimums,
  responsive behavior).
- **Conflict resolution** — deterministic precedence when two sources claim the same axis, with
  the losing claim *recorded*, not silently dropped.
- **Provenance** — every emitted element/rule traces to a source slot + evidence pointer.
- **Variant axes** — the dimensions along which the 3 outputs must *structurally* differ, with a
  distance metric that cosmetic recoloring cannot satisfy.

**S7-2 — Eval corpus (frozen, quota-sampled, with a held-out split).**
Both reviewers rejected "10–15 cases" as a **demo set**: a count with no sampling frame lets an
agent pick ten static marketing pages that all use Tailwind and call the corpus representative.
Replace the count with a **quota table**, published in `evals/selector/CORPUS.md`:

| Dimension | Minimum coverage |
|---|---|
| Layout systems | ≥3 distinct (e.g. CSS grid-first, flex/utility, absolute/canvas) |
| Page genres | ≥4 (marketing, ecommerce, docs, app dashboard) |
| Breakpoints scored | ≥2 per case (mobile + desktop; a case scored at one width is not scored) |
| Conflict pairs | ≥3 cases where two sources claim the same axis incompatibly |
| Degenerate cases | n=1 source; directive naming a non-existent element; hostile/heavy DOM |
| Documented skips | ≥1 login-walled or bot-walled target recorded as an explicit non-capture |

**Held-out split (non-negotiable).** A fixed fraction of cases is **sealed** — not readable by W8's
implementing agent, not used for tuning, scored only at gate time. Without it, W7 and W8 are the
same program defining, optimizing, and passing its own metric. Sol named this the program's most
likely plausible-but-wrong "done."

**S7-3 — Scored axes (the grader), with the axis the first draft was missing.**
`layout geometry` · `palette fidelity` · `type fidelity` · `motion timing` · `section identity` ·
`responsiveness` · `broken assets` · `a11y (contrast/focus/reduced-motion)` · **`source bleed`** ·
**`structural variant diversity`** · **`directive_claim_coverage`** ← *added in revision 2*.

> **Why the added axis is the whole point.** Both reviewers independently found the same fatal
> hole: a generator can score well on **every** axis in the original list while ignoring the user
> entirely. Average all references into a plausible house style — geometry, palette, type, and
> motion all land near the sources; bleed scores clean *because it abstains from anything
> distinctive*; diversity is satisfied with random layout templates unrelated to any directive.
> Nothing in the original grader measured whether the output does what the user **asked**.
>
> `directive_claim_coverage` scores it directly: every claim in the IR (`{axis, source, scope,
> strength}`) must resolve to **evidence in the output** — a concrete element/rule attributed to
> the claimed source at the claimed scope. Unresolved claims score zero; the axis has a floor no
> other axis can compensate for.

Two metrics must ship as **code with unit tests in `evals/`, not prose** — the first draft left
both as English, which is unimplementable and therefore whatever the implementer decides:

- **Source bleed** — style/content fingerprints from a *non-selected* source appearing above
  threshold in a region another source claims. Not "source B's name isn't in an HTML comment."
- **Structural variant diversity** — a **pre-registered axis set** (layout-skeleton hash, section
  order, motion-timeline signature, breakpoint-behavior class) with a minimum pairwise distance.
  Without pre-registration the definition begs its own question and an agent sets distance =
  tree-edit over class names.

**S7-4 — `loop:eval-gate` definition.**
Defined in `VERIFICATION-CONTRACT.md` §6. The key correction: **absolute floors per axis, frozen
here and immutable by W8**, in addition to delta rules. Relative-only acceptance ("improve ≥1 axis
without regressing another") lets a run oscillate within tolerance and cash out below every
threshold — accepted step by accepted step, each individually legal.

**S7-6 — Counterfactual scoring harness.**
For each case, a paired variant with **one directive axis swapped** (e.g. "layout from A" →
"layout from C"). A grader that cannot separate the pair is not measuring directive fidelity, and
the harness proves that mechanically rather than by inspection.

**S7-5 — Feasibility spike (throwaway).**
One case, by hand, end-to-end, to prove the IR can actually express a real directive. Code is
**explicitly disposable** — it exists to falsify the IR, not to become W8's foundation.

## Explicitly out of scope

Any production generator. Any UI. Any capture infrastructure (uses W-C's landed pipeline for
snapshots once available, or manual captures for the corpus — the corpus must be *pinned*
regardless, so it does not depend on live sites staying unchanged).

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w7.ts`.

| ID | Criterion | Verification |
|---|---|---|
| C7-1 | IR schema exists and is serializable | `docs/specs/selector-composition-ir.md` + JSON Schema; round-trip test over all corpus IR instances |
| C7-2 | IR expresses every corpus directive | Every case has an IR instance validating against the schema — **including the sealed held-out cases**, authored before the seal |
| C7-3 | Conflicts resolve deterministically and visibly | Conflict cases produce a stable result across 3 runs plus a recorded losing claim; determinism asserted by re-run hash |
| C7-4 | Provenance pointers **resolve** | Every emitted node's evidence pointer resolves to a real node in the named source snapshot. Attaching arbitrary source IDs fails: a shuffled-ID control must score zero |
| C7-5 | Corpus is pinned, quota-satisfying, and reproducible | Snapshots content-hashed; `verify-w7.ts` asserts the S7-2 quota table row by row; re-scoring yields byte-identical inputs |
| C7-6 | Grader discriminates on a **population**, not an example | Scores a set of ≥5 deliberately-wrong compositions low and ≥5 faithful ones high, with no overlap between the distributions. One hand-picked wrong output proves nothing |
| C7-7 | Source bleed metric is implemented and tested | Metric is code in `evals/`; unit tests over injected-bleed and clean fixtures; a "source name absent from comments" implementation fails the tests by construction |
| C7-8 | Diversity is structural against a pre-registered axis set | Recolor-only trio scores insufficient; a trio differing only in class names also scores insufficient; axis set frozen before any W8 work |
| C7-9 | **Directive claim coverage is measured** | Every IR claim resolves to attributed evidence in the output; a house-style composite that ignores directives scores **below the floor** on this axis while scoring well on geometry/palette/type — the exact gaming path both reviewers found |
| C7-10 | **Counterfactual separation** | For each paired case, swapping one directive axis moves the score by more than the stated minimum meaningful delta. A grader that cannot separate the pair fails |
| C7-11 | **Held-out split is sealed** | Sealed cases hashed and access-controlled; `verify-w7.ts` records the seal; W8's agent context demonstrably never contained them |
| C7-12 | **Absolute floors frozen** | Per-axis minimums committed with a version; the file is immutable to W8 (change requires a founder decision record) |
| C7-13 | **Scorer is versioned and deterministic** | Scorer version recorded in every eval manifest; same inputs → identical scores across runs and machines |
| C7-14 | NL→IR goldens exist with a parse interface | Frozen natural-language → IR golden pairs plus a stub parser interface. Without this, W7 ships a hand-authored IR that no agent can produce from a user's sentence, and W8 fails on contact |
| C7-15 | Feasibility spike documented | One case end-to-end; every place the IR proved insufficient written down, including what was changed in response |
| C7-16 | `human:` Go/no-go recorded | **Declared human-judgment** (§3 R7) → resolves to `blocked-on-founder`. Is the Selector buildable as specified, what is genuinely hard, what W8 must assume. Both reviewers sign off before W8 starts |

## Adversarial review

**Both** auditors — this is the one wave where prose-only review is as valuable as repo access,
because the deliverable is a specification.
- **GPT-5.6 Sol:** is the IR implementable? Where does it under-specify to the point that two
  engineers build different things? Can the grader be gamed by a generator that optimizes the
  metric without honoring the directive?
- **Grok 4.5:** is the decomposition right? Is a critical axis missing? Is the corpus
  representative or cherry-picked toward cases that happen to work?

Both must sign off before W8 is allowed to start.
