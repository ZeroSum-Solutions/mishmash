# Wave 8 — Selector build (PRD expansion)

**Slug:** `mishmash-w8-selector-build` · **Gates on:** W7 (landed, both reviewers signed off), W4
(landed), W3 (landed) · **Loop:** `loop:eval-gate` (defined in `VERIFICATION-CONTRACT.md` §6, used
here exactly as W7 defined it — see "loop:eval-gate parameters" below for the four required rules
this revision adds)

**Status of this document:** PRD expansion per `W5-W11-gated.md`'s expansion gate and NM-41C.
**Round 1 of independent review returned REJECT** (16 findings, 12 HIGH/4 MED; verdict log:
`w8-round1-reject.log`). This revision closes every finding — see "Round-1 closure log" near the
end of this document for a finding-by-finding record. This is the independently-reviewable pass
that must be frozen — by a reviewer who will not implement it — before any W8 implementation commit
lands. **An agent may not begin implementation from this page until it has been through its own
adversarial review round and both this file and `scripts/waves/verify-w8.ts` are committed.**
Writing implementation code from this PRD before that review lands is a hard reject, identically to
the skeleton-page rule it replaces.

This document supersedes the W8 skeleton in `W5-W11-gated.md` ("Wave 8 — Selector build"), which
remains as historical scope context but is not itself executable per that file's own header.

---

## Why this wave exists, and what "done" is not

Backlog C2, the Mishmash Selector, is one of the two features (`GLOBAL-GOAL.md` G-11/G-12) the
whole program culminates in: take 1–4 references, say in natural language which areas to adopt
from each, and produce 3 structurally distinct prototype variants to choose from — selection
becomes the project template.

W7 answered the four questions that made the original backlog ticket ill-posed (reference
addressing, conflict policy, provenance, variant diversity) with a frozen IR
(`docs/specs/selector-composition-ir.schema.json`), a pinned eval corpus
(`evals/selector/corpus/`), and a grader (`evals/selector/scorer/`) that scores a deliberately-wrong
composition low and a faithful one high. **W8's job is to make a real generator satisfy that
grader — not to relitigate what the grader measures, and not to declare success by any means other
than the grader itself scoring real output.** G-12 states this as the program's success criterion:
"W8 meets W7's thresholds, NOT by lowering them."

The single biggest risk this PRD defends against is the one both W7 reviewers named directly: a
generator that produces three attractive-looking, plausible variants that quietly ignore the user's
actual directives — the "Selector demo trap." `directive_claim_coverage` exists specifically to
catch this, and it is the axis with the highest floor in `evals/selector/floors.json` (0.5, versus
0.25–0.35 everywhere else) for exactly that reason. Every criterion below that touches scoring
inherits this posture: a composition is graded by the real, frozen `scoreComposition` function,
never by a description of what it should do.

**Round 1 added a second risk this revision now defends against explicitly: the VERIFIER ITSELF
being tamperable or gameable**, not just the composer under test. Round 1's central finding was that
the original verifier's oracle (the process that grades composer output) shared a mutable module
registry with the composer code it was grading — closeable by an implementer without ever touching
a pinned file. Every mechanism section below states, for each check, why the *oracle* — not just the
composer — cannot be fooled.

## Reference-input scope decision (NM-42C), made now, not discovered mid-wave

`W5-W11-gated.md`'s gate correction requires this decision before implementation starts: W8's
advertised "1–4 references (URL, library, or upload)" needs a safe URL → pinned snapshot producer
(a `ReferenceSnapshot` acquisition contract), and W7 explicitly excludes capture. That contract is
W6b's deliverable. **W6b has not landed** — there is no `ReferenceSnapshot` type anywhere in
`packages/contracts`, no capture-isolation service, and no route that turns an arbitrary URL into a
pinned snapshot anywhere in this tree (verified directly: `grep -rl ReferenceSnapshot apps/
packages/` matches nothing outside wave-planning prose).

**Decision: W8's scope narrows to Library assets and direct upload as reference inputs. The
live-URL reference flow is cut from this wave's claims entirely** — not deferred silently, but
named as a non-goal below with its unblock condition stated. This is the second of
`W5-W11-gated.md`'s two allowed outcomes, taken because waiting on W6b (gated on W-C landed **and**
W9's external-fetch tranche green — neither confirmed complete as of this PRD) would block the
flagship wave on unrelated infrastructure indefinitely. Nothing in this scope cut requires
revisiting W7's IR or grader: a `sourceSlot`'s `evidencePointers` are addressed against a captured
snapshot regardless of how that snapshot was acquired, and the eval corpus is entirely
hand-authored fixtures (`CORPUS.md` "Provenance of the data") — it never depended on live capture
either.

## Scope (S8-*)

**S8-1 — Reference acquisition.** 1–4 references, each either a Library asset (via the existing
`fetchLibraryAssets`/Library picker surface W3 shipped) or a direct file upload. Each accepted
reference becomes one `sourceSlot` in a `SelectorCompositionIR` instance, addressed and evidenced
exactly as `docs/specs/selector-composition-ir.md` §1 describes. No URL input field, no live-site
capture, no screenshot acquisition anywhere in this wave's surfaces. A request naming 0 or 5+
references is rejected with an attributable cardinality error; a request naming exactly 1–4 real
references succeeds — both halves are proved (round-1 F6: a check that only proves rejection, never
success, can pass while every real request also fails).

**S8-2 — Directive parsing.** A natural-language brief, plus the **acquired reference set's real
captured evidence** (not just its addresses — round-1 F3, see "Implementation contract" below),
produces a real `SelectorCompositionIR` instance satisfying
`docs/specs/selector-composition-ir.schema.json`. This is a real implementation of the interface
`evals/selector/nl-to-ir/parser.ts` sketched (S7-4/C7-14); see "Why product code does not live under
`evals/`" for why W8's real parser is a new file, never a rewrite of that frozen stub.

**S8-3 — Composition engine.** Consumes one `SelectorCompositionIR` instance **and the reference
set's real captured evidence** (computed styles, motion timing — the data needed to construct
genuine `styleFingerprint`/`motionSignature` values; round-1 F3) and produces exactly 3 structurally
distinct composed outputs ("variants"), each a `SelectorCompositionElement[]` in the shape
`evals/selector/scorer/index.ts`'s `CompositionElement` interface already defines
(`elementId, sourceId, domPath, nodeId, breakpoint, motionSignature?, styleFingerprint?`) — checked by
**runtime validation, not a type system tuple** (round-1 ruling: TS tuples erase at runtime and
cannot enforce HTTP/JSON output; see "Implementation contract"). The engine resolves conflicts using
the case's own `conflictResolution` records (the same deterministic precedence
`evals/selector/scorer/resolve-conflicts.ts` reads), and produces genuine variation along the four
pre-registered axes in `evals/selector/diversity-axes.json` — not three coats of paint on one
skeleton.

**S8-4 — Selection → project.** The user picks one of the 3 variants. That choice creates a real
project (`kind: 'prototype'`, matching the existing `ProjectKind` enum — no new enum value is
introduced) seeded from the chosen variant's composed output, carrying `selectorRunId` and
`selectorVariantIndex` provenance metadata (the same discriminator-on-existing-kind pattern
`ProjectMetadata` already uses for `web-clone`/`document`/etc.), independently readable back via
`GET /api/projects/:id` (round-1 F10: a check that never reads the project back does not prove it
was created).

**S8-5 — Provenance surface.** Every emitted element in every variant is traceable, on demand,
back to `{sourceId, nodeId, domPath, breakpoint}` — reusing the resolution semantics
`evals/selector/scorer/provenance-resolve.ts` already defines, exposed as a real, queryable API
surface over a **real prior run's real elements** (round-1 F7: querying a fabricated run ID with no
real elements to enumerate proves nothing), with a negative control proving the endpoint can say "no"
(round-1 F7).

**S8-6 — Degenerate-directive handling.** A directive whose `scope` does not resolve to any real
evidence pointer (the corpus's `phantom-element-directive` case) must not crash the composer or
silently vanish. It fails gracefully: the run still produces its other, resolvable claims, and the
unresolvable one is surfaced **as part of `composeVariants`'s own return value** (round-1 F8: not
through a side-channel introspection export queried from a separately re-imported module instance),
naming which directive, which source, which scope, and why it did not resolve — mirroring exactly
how the IR spec already requires this to be *expressible* (`selector-composition-ir.md` §2: "the IR
must be able to express that failure mode, not just the success path").

**S8-7 — UI/CLI parity.** Every capability above is reachable through the web UI **and** `od
selector …`, both against the identical `/api/*` contract, CLI supporting `--json`, per
`AGENTS.md` → Capability exposure. This is proved by an actual byte-for-byte payload comparison
between the two surfaces against the same daemon, plus a real `scripts/guard.ts` run (round-1 F9:
neither existed in round 1) — not a checkbox after the fact.

## Non-goals (explicit)

- **Live-URL / screenshot reference acquisition.** Cut per the NM-42C decision above. Unblocks when
  W6b lands a reviewed `ReferenceSnapshot` acquisition contract; re-adding it then is an amendment to
  S8-1, not a re-litigation of S8-2 through S8-7.
- **Any change to W7's grader, corpus, thresholds, or held-out split.** Hard non-goal, enforced
  mechanically (C8-1, C8-3) — not a matter of implementer discipline. See "G-12 anti-tamper
  mechanism" below for how the oracle itself is protected, not just the on-disk files.
- **A general-purpose NLU system.** S8-2 must reproduce every golden in
  `evals/selector/nl-to-ir/goldens.json` (C8-6) and produce IR instances that clear the corpus floors
  end-to-end (C8-7/C8-9); it is not required to correctly parse directive phrasings outside what the
  corpus and goldens exercise. Broader natural-language robustness is real future work, not this
  gate's bar.
- **Post-selection editing of the chosen variant.** The chosen variant becomes an ordinary project;
  editing it afterward uses the product's existing artifact-edit tooling, not new Selector surface.
- **Client Website (W6a).** A separate wave, separate `ProjectKind` question (if any), not touched
  here. W8 does not depend on it and does not share code with it beyond the already-landed
  `brands/` engine, which W8 does not use (that engine is deterministic token derivation from a
  captured site; the Selector composes from user-supplied structural directives, a different
  problem).
- **Capture isolation (W6b).** Separate wave, separate threat model (`GLOBAL-GOAL.md` rule 2:
  untrusted remote navigation and trusted local composition do not share a substrate). W8 consumes
  W6b's output type once it exists; W8 does not build any part of W6b.
- **Regenerating or re-authoring the eval corpus.** If the composition engine reveals the corpus or
  grader is wrong (as opposed to the engine being wrong), the correct move per
  `W5-W11-gated.md`'s stop rule is to return to W7 with the finding — not to patch `evals/**` from
  inside this wave.

## Implementation contract (frozen by this PRD; a real implementation must satisfy this exactly)

This section exists for the same reason `evals/selector/nl-to-ir/parser.ts` exists: without a frozen
call signature, two implementers (or one implementer across two sessions) build two different
things, and `scripts/waves/verify-w8.ts` has nothing stable to call. **Round-1 finding F3**
established that the previous revision's signatures (`parseDirective(brief)`,
`composeVariants(ir)`) could not be satisfied by any honest implementation: an IR's `sourceSlots`
carry only opaque `evidencePointers` strings, never computed styles, so nothing in the old contract
could construct a real `styleFingerprint`/`motionSignature`. This revision fixes that at the root by
threading the reference set's **real captured evidence** through both functions.

### DTOs live in `packages/contracts`, not daemon-private types (round-1 ruling, F16)

`packages/contracts/src/api/selector.ts` — **new file**, pure TypeScript, no Node/Express/browser
dependencies (repo rule, `AGENTS.md` → Boundary constraints: "Keep shared API DTOs ... in
`packages/contracts`"):

```ts
export type SelectorDirectiveAxis = 'layout' | 'motion' | 'palette' | 'typography' | 'section' | 'interaction';

export interface SelectorSourceSlot {
  id: string;
  breakpoints: string[];
  evidencePointers: string[]; // "<domPath>@<breakpoint>[@<state>]"
}

// The reference set's REAL captured evidence -- structurally identical to
// evals/selector/scorer/corpus-loader.ts's CapturedNode, so a real
// reference's computed style is expressible without inventing a second
// vocabulary. This is what round-1 F3 found missing: without this type,
// composeVariants had no legitimate way to build a real styleFingerprint.
export interface SelectorEvidenceNode {
  nodeId: string;
  domPath: string;
  breakpoint: string;
  state: string; // 'default' | 'hover' | 'scrolled' | 'loaded'
  computedStyle: Record<string, string>;
}
export interface SelectorReferenceSnapshot {
  sourceId: string; // matches a SelectorSourceSlot.id
  nodes: SelectorEvidenceNode[];
}

export interface SelectorDirectiveClaim {
  axis: SelectorDirectiveAxis;
  source: string;
  scope: string;
  strength: number;
  breakpoint?: string;
}
export interface SelectorConstraintPredicate { property: string; pattern: string }
export interface SelectorConstraint { type: string; rule: string; predicate?: SelectorConstraintPredicate }
export interface SelectorConflictResolutionRecord {
  axis: string;
  winningSource: string;
  losingSource?: string;
  losingClaim?: string;
  rationale?: string;
  scopeOverlap?: string;
}
export interface SelectorProvenanceEntry { elementId: string; sourceId: string; nodeId: string; domPath: string; breakpoint: string }
export interface SelectorVariantAxis { name: string; distanceMetric: string }

export interface SelectorCompositionIR {
  sourceSlots: SelectorSourceSlot[];
  directives: SelectorDirectiveClaim[];
  constraints: SelectorConstraint[];
  conflictResolution: SelectorConflictResolutionRecord[];
  provenance: SelectorProvenanceEntry[];
  variantAxes: SelectorVariantAxis[];
}

// Structurally identical to evals/selector/scorer/index.ts's
// CompositionElement, so an array of these can be handed to the real,
// frozen scoreComposition without transformation.
export interface SelectorCompositionElement {
  elementId: string;
  sourceId: string;
  domPath: string;
  nodeId: string;
  breakpoint: string;
  motionSignature?: string;
  styleFingerprint?: string;
}

export interface SelectorUnresolvedDirective { axis: string; source: string; scope: string; reason: string }

// NOT a fixed-length tuple type (round-1 ruling: TS tuples are erased at
// runtime and cannot enforce HTTP/JSON output). `variants` MUST contain
// EXACTLY 3 entries -- enforced by RUNTIME validation at every boundary
// that produces or consumes this type (composeVariants' own return,
// the POST /api/selector/runs route handler, and verify-w8.ts).
export interface SelectorComposeResult {
  variants: SelectorCompositionElement[][];
  unresolvedDirectives: SelectorUnresolvedDirective[];
}

export type SelectorReferenceInput = { sourceType: 'library'; assetId: string } | { sourceType: 'upload'; uploadId: string };
export interface SelectorRunCreateRequest { references: SelectorReferenceInput[]; brief: string }
export interface SelectorRunRecord { id: string; ir: SelectorCompositionIR; variants: SelectorCompositionElement[][]; unresolvedDirectives: SelectorUnresolvedDirective[] }
export interface SelectorProvenanceQueryResponse { elementId: string; sourceId: string; nodeId: string; domPath: string; breakpoint: string; resolved: boolean }
export interface SelectorSelectRequest { variant: 0 | 1 | 2 }
export interface SelectorSelectResponse { projectId: string }
```

### Pure product modules (new; not modifications to any file under `evals/**` or `docs/specs/**`)

- `apps/daemon/src/selector/parse-directive.ts` — `export function parseDirective(brief: string,
  sourceSlots: SelectorSourceSlot[], referenceSnapshots: SelectorReferenceSnapshot[]):
  SelectorCompositionIR`. Implements S8-2. `referenceSnapshots` gives the parser real evidence to
  ground scope resolution against (e.g. confirming a claimed element genuinely exists before citing
  its `domPath`). Must be a real implementation — never a rename of the frozen stub in
  `evals/selector/nl-to-ir/parser.ts`, which stays permanently unimplemented as W7's frozen interface
  reference.
- `apps/daemon/src/selector/compose.ts` — `export function composeVariants(ir:
  SelectorCompositionIR, referenceSnapshots: SelectorReferenceSnapshot[]): SelectorComposeResult`.
  Implements S8-3/S8-6. `variants` must contain **exactly 3** non-empty arrays (runtime-checked by
  every caller, including this wave's verifier — see C8-7). Conflict resolution must follow
  `ir.conflictResolution`'s declared precedence. A directive whose `scope` does not resolve against
  any `referenceSnapshots` entry is omitted from the composed output (not a crash) and reported by
  name in the SAME return value's `unresolvedDirectives` array (round-1 F8) — never through a
  separate export, a global, or a side-channel only reachable by re-importing the module.

**Why product code does not live under `evals/`:** `evals/` is program scaffolding —
`VERIFICATION-CONTRACT.md` §1 says `scripts/waves/` (and by the same logic, the eval harness it
grades against) is deleted in one commit when the program closes. Product code that imported from a
directory slated for deletion would break the shipped product. The bridge is one-directional:
`scripts/waves/verify-w8.ts` (scaffolding) derives `SelectorReferenceSnapshot[]` input from the
frozen corpus, runs the real product modules **in an isolated subprocess** (see "G-12 anti-tamper
mechanism" below — this is new in this revision, closing round-1 F1), and feeds the product's real
returned output through the frozen grader **in the verifier's own process, which never imports
product code**. Product code never imports from `evals/`, and — as of this revision — never shares a
process, module registry, or object reference with the code that grades it.

### New route file: `apps/daemon/src/routes/selector.ts`, registered in `server.ts`, namespace `/api/selector/*`

| Method + path | Body | Response | Notes |
|---|---|---|---|
| `POST /api/selector/runs` | `SelectorRunCreateRequest` (**exactly 1–4** `references` entries; `sourceType` is `'library'` or `'upload'` only — no `'url'` variant exists in this type) | `SelectorRunRecord` | Creates a run: resolves each reference to a `SelectorReferenceSnapshot`, parses the brief via `parseDirective`, composes via `composeVariants`. A request with 0 or ≥5 references is rejected with an attributable 4xx naming the cardinality violation (never a 500). |
| `GET /api/selector/runs/:id` | — | `SelectorRunRecord` | Idempotent read of a prior run. |
| `GET /api/selector/runs/:id/provenance` | query `elementId`, `variant` (0\|1\|2) | `SelectorProvenanceQueryResponse` | S8-5. `resolved:false` when the pointer does not resolve or the (elementId, variant) pair does not exist in that run — never omit the row, never a false positive. |
| `POST /api/selector/runs/:id/select` | `SelectorSelectRequest` | `SelectorSelectResponse` | S8-4. Creates the `kind:'prototype'` project with `selectorRunId`/`selectorVariantIndex` metadata; `projectId` resolves via `GET /api/projects/:id`. |

### New CLI subcommands (`apps/daemon/src/cli.ts`, `SUBCOMMAND_MAP['selector']`, calling the same routes above)

```
od selector run --reference library:<assetId> [--reference upload:<uploadId> ...] --prompt-file <path|-> --json
od selector show --run <id> --json
od selector provenance --run <id> --element <id> --variant <0|1|2> --json
od selector select --run <id> --variant <0|1|2> --json
```

`--json` is load-bearing for C8-13's payload-parity check, not merely offered — every subcommand
supports it per `AGENTS.md`'s CLI contract.

**Capability manifest:** `scripts/waves/capability-manifest.json` gains a `selector` row (same shape
every other capability row uses — `uiEntryPoint`, `cliArgs`, `httpMethod`, `httpPath`,
`knownNamespaceRoutes`, `parityApplicable: true`), so `scripts/guard.ts`'s existing
manifest/`SUBCOMMAND_MAP`/route-inventory parity check covers `selector` automatically the same way
it covers every other capability — and C8-13 runs `scripts/guard.ts` for real (round-1 F9), rather
than re-deriving an equivalent check inside the verifier.

**Web UI:** a new Selector entry point (`apps/web/src/components/Selector*.tsx`) reachable from the
existing New Project flow, calling the same four routes above through `apps/web/src/providers/`
(never a bespoke client, per AGENTS.md's "both surfaces must call the same `/api/*` endpoints").

### Lease note (not this document's to grant)

Per the binding constraints on this PRD-authoring pass, `docs/plans/waves/leases.json` is
orchestrator-owned and is **not edited by this document**. Before implementation starts, the
orchestrator must add a `W8` entry there covering (at minimum): `packages/contracts/src/api/
selector.ts` (round-1 F16 — added this revision), `apps/daemon/src/selector/**`,
`apps/daemon/src/routes/selector.ts`, `apps/daemon/src/server.ts`, `apps/daemon/src/cli.ts`,
`apps/web/src/components/Selector*`, `apps/web/src/providers/registry.ts`,
`scripts/waves/capability-manifest.json`, `scripts/waves/verify-w8.ts`,
`docs/plans/waves/W8-selector-build.md`. This PRD deliberately does not propose exact glob syntax —
that is the same amend-on-proof pattern every other wave's lease used (see `leases.json`'s W1/W4
notes), decided once real file paths exist. **Zero paths under `evals/**`, `docs/specs/**`, or
`scripts/waves/verify-w7.ts` appear in that list, and none should be added later** — C8-1/C8-3 make
that mechanical, not aspirational.

## G-12 anti-tamper mechanism (round-1 F1 closure — read this before the criteria table)

Round 1's highest-severity finding was architectural, not a missing check: the original verifier
imported the real W7 scorer **and** dynamically imported product code **into the same Node process**.
`evals/selector/scorer/corpus-loader.ts::loadManifest()` returns a **cached, mutable object by
reference** — any code running in that process (including product code the verifier itself imported)
can walk `loadManifest().cases`, mutate a case's `irPath` or a source's snapshot path, and every
*later* call to `loadCase`/`loadCaseIR`/`buildSnapshotsBySource`/`scoreComposition` in that same
process silently reads the mutated view — with zero `evals/**` diff on disk, so C8-1's file hashes
and C8-3's git diff both stay green while the oracle itself scores against substituted data.

This revision closes it with **two independent, additive layers**, matching the two distinct threats:

1. **Process isolation (closes the shared-mutable-state exploit specifically).** Product code
   (`parse-directive.ts`, `compose.ts`) is **never** imported into `verify-w8.ts`'s own process.
   Every call runs inside a freshly spawned `pnpm exec tsx` subprocess that receives its input as
   plain serialized JSON (a temp file) and returns its output the same way — a hard OS process
   boundary with no shared module registry, no shared object reference, nothing product code can
   reach back through. The **oracle** (`evals/selector/scorer/*`, imported once, only in the
   verifier's own process) never runs in the same process as product code, in either direction. This
   was the option `w9fs`/`w1`'s own subprocess-isolation precedent already establishes for booting a
   daemon; this revision applies the identical principle to grading.
2. **Corpus content pinning, extended to the transitive closure (closes the "diff stayed green"
   half).** C8-1 now pins, **in addition to** the 14 previously-named files, the git tree hash of
   `evals/selector/corpus` (`git rev-parse HEAD:evals/selector/corpus`) — a single value that
   changes if **any** file anywhere under that tree changes, is added, or is removed, recursively,
   including every `ir/*.json` and every `snapshots/**/*.json`/`.enc` file the 14-file table did not
   individually enumerate. C8-3 additionally re-runs a **live, on-disk** clean-diff check
   (`git status --porcelain -- evals/selector docs/specs`) immediately **before** every scoring
   phase, not only once at the end — closing the TOCTOU window where a hostile subprocess could
   write directly to an on-disk corpus file between generation and scoring (which C8-3's
   committed-history diff alone would not see until a later `git status`).

Neither layer alone is sufficient: process isolation without content pinning would still let a
compromised generator overwrite disk files the oracle later reads (mitigated by defense 2); content
pinning without process isolation would still leave the shared-mutable-cache exploit open even with
every file on disk byte-perfect (mitigated by defense 1). Both are required and both are checked on
every run.

## loop:eval-gate parameters (round-1 F15 closure)

`VERIFICATION-CONTRACT.md` §6 requires `loop:eval-gate` to state, not merely reference, four rules.
W8's implementation loop (the sequence of composer iterations an implementing agent runs against this
gate) must follow all four, with these concrete values:

1. **Absolute floors** — `evals/selector/floors.json`, frozen, immutable to W8 (C8-1/C8-3). Already
   stated.
2. **Minimum meaningful delta** — `floors.json`'s `counterfactualMinDelta` (**0.1**) is the one W7
   already froze for counterfactual separation (C8-9); this PRD adopts the same value as the general
   "improves ≥1 axis beyond a stated minimum meaningful delta" bar for any other accepted-step
   comparison the implementing agent makes across iterations.
3. **Regression tolerance** — an accepted composer change may not regress any of the 11 scorer axes,
   on any corpus case, by more than **0.02** from its immediately-prior accepted value. 0.02 is
   chosen as one-fifth of the smallest counterfactual delta (0.1), keeping the tolerance strictly
   smaller than the signal the gate is designed to detect.
4. **Cumulative score non-degradation** — the mean `overall` score across all 8 non-sealed cases must
   be **monotonically non-decreasing** across accepted steps. The implementing agent records each
   accepted step's per-case, per-axis, and cumulative scores in a running log (e.g.
   `~/.claude/goal-state/mishmash-w8-selector-build/iteration-log.jsonl`, one line per accepted
   step) so this is auditable, not asserted from memory.
5. **Finite iteration budget** — on **5** consecutive rounds with no accepted change (a round that
   clears floors but fails the delta/regression/cumulative rules above, or fails floors outright),
   stop and escalate to the founder rather than continuing indefinitely. 5 matches this program's
   existing "round cap" convention (`VERIFICATION-CONTRACT.md` §6's 2-fix-round cap for
   `loop:red-green-review`, scaled up here because `loop:eval-gate` iterations are cheaper and more
   automatable than a full adversarial review round).

These are process rules for the *implementing* agent's iteration loop, not new `C8-*` criteria —
`verify-w8.ts` has no prior "accepted step" to compare against at PRD-freeze time (nothing is
implemented yet). C8-7/C8-8/C8-9 mechanically enforce rule 1 (and, for the counterfactual pair,
rule 2) against whatever the *current* HEAD contains; rules 3–5 govern how the implementing agent is
expected to get there.

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w8.ts`. Every
criterion below is checked against **real, imported W7 grader/corpus code (in the verifier's own,
product-code-free process) and real product code (run in an isolated subprocess, or honestly absent)
— never a description of what either should do, and never a check whose evidence is weaker than its
stated claim** (round-1's binding instruction, restated here so it is not lost between revisions).

| ID | Criterion | Verification |
|---|---|---|
| C8-1 | W7's grader, corpus, and thresholds are the genuine landed artifacts, transitively | 14 named W7 files (scorer's five modules, `floors.json`, `diversity-axes.json`, `eval-manifest.json`, corpus `manifest.json`, the IR schema + spec doc, the NL→IR goldens + stub) are sha256-pinned; **plus** the git tree hash of `evals/selector/corpus` (recursive — covers every IR/snapshot file, named and unnamed) is pinned separately. Any mismatch is a hard fail naming the file/tree and both hashes. |
| C8-2 | Grader-integrity control is re-proved in W8's own run, with attribution and evidence isolated as independent variables | Three verifier-constructed populations per multi-source case (faithful / wrong-attribution-only-with-real-evidence / correct-attribution-with-missing-evidence), scored by the real, imported `scoreComposition`. Both `min(faithful.coverage) > max(wrongAttribution.coverage)` AND `min(faithful.coverage) > max(missingEvidence.coverage)` must hold — proving the grader discriminates on attribution and on evidence independently, closing round-1 F2's confound. |
| C8-3 | W7's surfaces are immutable to W8, on disk AND live during the run | `git diff --name-only <baseCommit>...HEAD` contains zero paths under `evals/**`, `docs/specs/**`, or `scripts/waves/verify-w7.ts`; **plus** `git status --porcelain -- evals/selector docs/specs` is re-verified empty immediately before every scoring phase (TOCTOU defense — closes round-1 F1's second half). A W8 commit, or a live on-disk mutation during the run, that touches any of them is a hard fail naming the mutated path(s). |
| C8-4 | Held-out split stays sealed through W8, ciphertext-bound to the seal commit | All 10 sealed `.enc` payloads (2 cases × (1 IR + 2 sources × 2 breakpoints)) are content-bound: current on-disk ciphertext bytes equal `git show <sealCommit>:<path>` via `readBufferAtCommit`, the defining commit of each path is an ancestor of the seal commit, and zero commits after the seal commit touch any sealed path. Each is decrypted and its plaintext sha256 cross-checked against the manifest's recorded value. A leak scan (utf8 **+ base64 + hex** windows — round-1 F5 added hex) over every git-tracked file under `evals/` must find zero sealed-plaintext fragments; an empty tracked-file enumeration is a hard fail (fail-closed, round-1 F5), never a silent pass. |
| C8-5 | Reference acquisition: 1–4 Library/upload references succeed; 0/5/URL-typed requests are rejected specifically for that reason | A real isolated daemon serves `POST /api/selector/runs` with 1, 2, 3, and 4 real references (mixing `library`/`upload` sourceTypes) and **all four must succeed** (2xx) — round-1 F6 closed: previously any single non-404 among the four passed the whole check, so "everything fails" could pass. 0-reference and 5-reference requests are rejected with an attributable 4xx naming the cardinality violation specifically. A request whose reference carries an unrecognized `sourceType` (e.g. `'url'`) is rejected with an attributable 4xx naming the invalid sourceType — proving no URL-shaped reference is ever accepted, not merely that the TS type omits it. |
| C8-6 | NL brief → IR reproduces every frozen golden, via the isolated subprocess | `apps/daemon/src/selector/parse-directive.ts`'s real `parseDirective` runs once per golden in `evals/selector/nl-to-ir/goldens.json`, called through the process-isolated runner (never imported directly into the oracle process). The resulting IR's `directives` array contains a claim matching `{axis, source, scope}` exactly and `strength` within 0.05, for all 11 goldens with zero exceptions. A satisfiability self-test (a verifier-internal reference stub, run through the identical isolated-subprocess mechanism) proves the check itself is capable of a full pass before it judges the real module. |
| C8-7 | Every non-sealed corpus case composes end-to-end and clears every floor, via the isolated subprocess | For each of the 8 non-sealed cases, the real `composeVariants(ir, referenceSnapshots)` runs in the isolated subprocess, fed the case's own frozen IR and the case's own real captured evidence (derived from the pinned, tamper-checked corpus — never product-supplied). The return is runtime-validated to contain **exactly 3** non-empty variant arrays (never merely typed as one); every one of the 11 scorer axes, on every one of the 3 returned variants, scores at or above `floors.json`'s floor, graded by the unmodified `scoreComposition` running in the oracle's own, product-code-free process. |
| C8-8 | Held-out split meets the same floors at gate time | **BLOCKED, honestly, pending a W7 amendment.** `scoreComposition` has no parameter through which already-decrypted case data can be injected — it unconditionally re-derives the case by ID from the single process-global corpus-loader cache, which still marks sealed cases `sealed:true` and points at `.enc` paths. The only way to make it score sealed plaintext without modifying `evals/selector/scorer/corpus-loader.ts` is to mutate that shared cache in place — the exact tamper mechanism C8-1/C8-3's process isolation exists to close, so doing it from inside the "trusted" verifier would not be an equally authoritative mechanism, it would be the same architectural hazard wearing a verifier badge. See "C8-8 status" below for the precise W7 amendment this needs and why every alternative was rejected. This criterion is designed to **fail honestly** until that amendment lands; it does not attempt a weaker partial check in the meantime (round-1 ruling: "the partial check may not pass as C8-8"). |
| C8-9 | `directive_claim_coverage` clears its floor on every variant, and a real counterfactual swap separates cleanly across ALL 3 variants | Every case's every variant (not just variant 0 — round-1 F11 closed) clears `directive_claim_coverage`'s 0.5 floor. Additionally, for `marketing-hero-grid`'s real `layout` conflict, `composeVariants` runs (via the isolated subprocess) on both the case's real IR and a verifier-constructed IR with the conflict's winner/loser swapped (the resolver's own `resolveConflicts` independently confirms the winner flipped); both runs must return exactly 3 valid variants, and for **every one of the 3 variant indices**, `directive_claim_coverage` moves by at least `counterfactualMinDelta` (0.1) between before/after. |
| C8-10 | 3 variants are structurally diverse per the pre-registered axis set | `evals/selector/scorer/diversity.ts`'s real `scoreDiversity`, called on the real 3-variant output for every non-sealed case, returns a positive score; a verifier-constructed recolor-only/class-name-only trio built from the SAME case's real elements (varying only `styleFingerprint`) is fed through the same function and must score exactly 0, proving the check cannot be satisfied by cosmetic variation alone. |
| C8-11 | Provenance is queryable for any output element, against a real run, with a real negative control | A real run is created via `POST /api/selector/runs`; **for every element in a real composed variant**, `GET /api/selector/runs/:id/provenance?elementId=…&variant=…` returns `resolved:true` with the correct `(sourceId, nodeId, domPath, breakpoint)` tuple (round-1 F7: no more fabricated run IDs, no more accepting any non-404 as proof). Negative control: querying the same real `elementId` against a variant index it does not belong to must return `resolved:false`, never a false positive. |
| C8-12 | A directive naming a nonexistent element fails gracefully and attributably | Running `phantom-element-directive`'s case through the real composer (via the isolated subprocess) does not throw; `composeVariants`'s own return value's `unresolvedDirectives` (round-1 F8: not a separately-imported introspection export) names the exact `{axis, source, scope}` that failed to resolve; the run's other, resolvable directives still produce composed output (a total failure is not "graceful"). |
| C8-13 | UI/CLI parity over the identical `/api/*` contract, with an actual payload comparison and a real guard run | A real isolated daemon serves `POST /api/selector/runs`; `od selector run --json` against the same daemon (`--daemon-url`) is parsed as JSON and compared field-by-field against the HTTP response for the same logical request (round-1 F9: no more "any non-404" or omitted `--json`); an HTTP 500 is never accepted as evidence the route exists. `scripts/guard.ts` is executed for real (not re-derived) and must exit 0, specifically covering the `selector` capability-manifest row. |
| C8-14 | Selecting a variant creates a real, independently-readable project | `POST /api/selector/runs/:id/select` with a real prior run and `variant:0` returns a `projectId`, which is then used in a real `GET /api/projects/:id` call (round-1 F10: previously never performed) that must return 200 with `kind:'prototype'` and `metadata.selectorRunId`/`selectorVariantIndex` matching the run and the selected index. |
| LEASE | W8's diff stays inside its granted lease | `git diff --name-only <baseCommit>...HEAD` ⊆ `leases.json`'s `W8` entry, read from `baseCommit` (never from HEAD, so W8 cannot widen its own lease). **Expected to FAIL until the orchestrator grants the W8 lease** (see "Lease note" above) — this is the honest pre-grant state, not a defect in this PRD or its verifier. |

### C8-8 status: requires a W7 amendment (round-1 ruling (c), STOP-and-report path taken)

Per the round-1 ruling's explicit instruction ("if that genuinely requires touching W7's scorer
surface, STOP and report that precisely and I will rule on a W7 amendment as founder"), this PRD
author evaluated every mechanism available **without** editing `evals/selector/scorer/*` and
concluded none is honest:

- `scoreComposition(input, siblings?)` takes only `{caseId, composition}` — it always internally
  calls `loadCase(caseId)` → `loadManifest().cases.find(...)`, which reads the single process-global
  cached manifest. There is no parameter to inject an already-resolved case or pre-decrypted snapshot
  data.
- The only way to make `scoreComposition` operate on decrypted sealed plaintext without editing
  `corpus-loader.ts` is for the caller to reach into the cached manifest object `loadManifest()`
  returns (a live reference) and mutate the sealed case's `sealed`/`irPath`/snapshot-path fields in
  place, then restore them afterward. This is mechanically identical to the tamper vector round-1 F1
  found — the only difference is that the **verifier** would be doing it instead of product code.
  That is not "an equally authoritative isolated mechanism"; it is the same architectural hazard,
  just performed by a party currently trusted not to abuse it. A future reviewer re-auditing this
  file would find the exact same mutable-cache pattern this revision spent its highest-severity fix
  removing.

**The requested W7 amendment, precisely:** a small, additive export in
`evals/selector/scorer/corpus-loader.ts` that accepts already-decrypted bytes instead of deriving
case data from `fs.readFileSync` + the `sealed` guard — for example
`loadCaseFromDecryptedSealedPayload(caseId: string, decryptedIrJson: string,
decryptedSnapshotsByBreakpoint: Record<string, Record<string, string>>): { ir: CaseIR; bySource:
Record<string, CapturedNode[]> }`, performing the identical parsing `loadCaseIR`/
`buildSnapshotsBySource` already do, from caller-supplied bytes. Pairing this with a
`scoreSealedComposition` (or an optional third parameter on `scoreComposition` itself) that accepts
pre-resolved case data instead of re-deriving it from the global cache would let `verify-w8.ts` score
sealed cases through the real, frozen scoring **logic** without ever touching the sealed/threshold
decision surface. This changes *how case data enters* the function, not the scoring rules
themselves, the floors, or the corpus.

**Until that amendment lands and is itself reviewed and pinned, C8-8 fails, honestly, every run.**
This is not a defect in this PRD or its verifier — it is the correct outcome given the actual
constraint, reported precisely per the round-1 ruling rather than routed around.

### Design notes on specific criteria

- **C8-1 vs C8-3** are deliberately two different mechanisms proving two different things, now with a
  second layer each per the G-12 anti-tamper mechanism section above. C8-1 proves the artifacts W8 is
  building against are the *correct*, unmutated W7 outputs (static hash + tree-hash pins, defense
  against a corrupted or rolled-back base). C8-3 proves W8's *own commits*, and any live on-disk
  mutation during the run, never touch them (dynamic diff against `baseCommit` plus a live re-check
  immediately before scoring). Neither alone is sufficient — see the anti-tamper section for the
  specific gap each closes.
- **C8-2's three populations are verifier-constructed, not W7's fixtures.**
  `evals/selector/fixtures/population/{faithful,wrong}/` exists but only covers 2 cases each and
  conflates attribution with evidence (round-1 F2); C8-2 builds its own faithful /
  wrong-attribution-only / missing-evidence-only triple for every multi-source non-sealed case (7 of
  8 — `single-source-landing` has no second source to misattribute to, and is used only in the
  missing-evidence population, explicitly noted in the criterion's evidence).
- **C8-9's counterfactual swap is built on W8's real composer**, not a verifier-synthesized
  substitute standing in for it, across **all 3** returned variants — this is the literal instruction
  this PRD was commissioned under: counterfactual separation must be re-proved on real Selector
  output, not assumed from W7's C7-10, and not satisfiable by special-casing one variant while the
  other two ignore the swap (round-1 F11).
- **C8-13 always boots a real, isolated daemon** (fresh `mkdtemp` `OD_DATA_DIR`, port 0, first-party
  workspace packages rebuilt from tracked source immediately before boot) even though, at this PRD's
  freeze time, the boot will succeed and the route will 404 — the 404 itself is the honest,
  runtime-observed evidence that the surface does not exist yet, which is stronger evidence than a
  static grep for `SUBCOMMAND_MAP['selector']` and is the same posture `W5-W11-gated.md` demands
  ("Runtime truth over source structure").
- **Process/teardown safety is a property of the verifier's shared daemon-lifecycle machinery, not a
  named criterion.** Every criterion that boots the daemon shares one lifecycle: rebuild from tracked
  source (memoized), boot `detached: true`, and a single teardown at the end that (a) proves the
  daemon's own leader pid was independently visible to the survivor-scan mechanism **before** any
  signal was sent (not just a synthetic self-probe — round-1 F13), and (b) only deletes temp
  artifacts once teardown is *confirmed* — an unconfirmed or failed teardown retains its temp
  directories for post-mortem and fails the whole run, never silently discards evidence (round-1
  F12). Request/asset/run identifiers and temp-directory names sent to or seen by product code carry
  no "verify"/"w8" fingerprint (round-1 F14) — product code cannot behave differently under test than
  it would in production by inspecting its own inputs.

## Human/founder items

None mechanical. **C8-8 is `blocked-on-founder` in a different sense**: it is not a
human-judgment criterion (§3 R7) — it resolves mechanically to `fail` every run — but it names a
concrete W7-lease amendment that only the founder can authorize per the round-1 ruling. Every other
`C8-*` criterion resolves mechanically to `pass`/`fail` with no person in the loop.

## Round-1 closure log

Each finding from `w8-round1-reject.log` (round 1, `e222f65ce`), closed in this revision:

| Finding | Closure |
|---|---|
| F1 (bypass found) | "G-12 anti-tamper mechanism" section: process isolation (subprocess-only product code execution) + extended content pinning (corpus tree hash) + live TOCTOU re-check (C8-1/C8-3). |
| F2 (gameable population) | C8-2 redesigned to three isolated-variable populations (faithful / wrong-attribution-only-with-real-evidence / correct-attribution-with-missing-evidence). |
| F3 (signatures insufficient) | `parseDirective`/`composeVariants` now take `SelectorReferenceSnapshot[]` (real computed-style evidence), not just opaque IR pointers. |
| F4 (C8-8 too weak) | C8-8 redesigned to fail honestly with a named, precise W7-amendment ask (see "C8-8 status"), per the ruling's STOP-and-report path. |
| F5 (C8-4 incomplete) | C8-4 now content-binds all 10 sealed `.enc` payloads (IR + every snapshot) to the seal commit via `readBufferAtCommit`, decrypts and hash-checks every one, and leak-scans in utf8+base64+hex with fail-closed empty-enumeration handling. |
| F6 (C8-5 gameable) | C8-5 now requires all four of the 1–4-reference requests to succeed, adds upload-type and URL-rejected controls. |
| F7 (C8-11 no real proof) | C8-11 now creates a real run, enumerates its real elements, and adds a negative control. |
| F8 (C8-12 undocumented export) | `unresolvedDirectives` moved into `composeVariants`'s own return value (contract change), closing the separate-module-instance and non-exact-match gaps together. |
| F9 (C8-13 no parity proof) | C8-13 now parses and field-compares CLI vs HTTP JSON, requires `--json`, executes `scripts/guard.ts` for real, and never accepts a 500 as "route exists." |
| F10 (C8-14 no read-back) | C8-14 now extracts `projectId` and performs a real `GET /api/projects/:id`. |
| F11 (C8-9 variant-0-only) | C8-9 now requires separation across all 3 variant indices. |
| F12 (cleanup not guaranteed) | Verifier body wrapped in a top-level `try/finally`; temp artifacts are retained (not deleted) on any unconfirmed cleanup path, and that retention fails the run. |
| F13 (no live pre-teardown proof) | Ported the `w9fs@7c43a8f14` leader-pid-visibility invariant: before any signal, the daemon's own leader pid (not just its pgid) must appear in a live `ps` scan; both the session-blind and leader-pid-filtered exploits are reproduced as permanent self-probes. |
| F14 (verifier fingerprints leak) | Temp-dir prefixes, request payload identifiers, and script/file names sent to or visible from product code no longer contain "verify"/"w8"; swept repo-wide in the verifier. |
| F15 (loop:eval-gate rules missing) | New "loop:eval-gate parameters" section states delta/regression-tolerance/cumulative-score/iteration-budget with concrete values. |
| F16 (DTOs not in packages/contracts) | All Selector DTOs moved to `packages/contracts/src/api/selector.ts`; lease list updated. |

**Rulings applied:** C8-8 mechanism → STOP-and-report (this document's "C8-8 status" section) rather
than either alternative in the ruling, since neither a reviewed sealed-aware entrypoint (not yet
landed) nor a self-built isolated mechanism (judged indistinguishable from the tamper vector under
review) was honestly available. IR/Selector DTOs → moved to `packages/contracts`. Tuple vs runtime
array → `SelectorComposeResult.variants` is a plain array, exactly-3 enforced by runtime validation
at every boundary, not by the type system. Five-reference rejection → stays a route-level check,
now paired with real 1–4-reference success controls (C8-5).

## Open questions for the review round

None remaining that are genuinely unresolvable from the ratified record. Round 1's three "open
questions" were resolved by explicit ruling (see "Round-1 closure log" above) rather than carried
forward; C8-8's mechanism question was resolved by the STOP-and-report path the ruling itself
specified, not left open.
