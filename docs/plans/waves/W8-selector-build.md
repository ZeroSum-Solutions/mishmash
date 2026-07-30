# Wave 8 — Selector build (PRD expansion)

**Slug:** `mishmash-w8-selector-build` · **Gates on:** W7 (landed, both reviewers signed off), W4
(landed), W3 (landed) · **Loop:** `loop:eval-gate` (defined in `VERIFICATION-CONTRACT.md` §6, used
here exactly as W7 defined it)

**Status of this document:** PRD expansion per `W5-W11-gated.md`'s expansion gate and NM-41C. This
is the independently-reviewable pass that must be frozen — by a reviewer who will not implement it
— before any W8 implementation commit lands. **An agent may not begin implementation from this
page until it has been through its own adversarial review round and both this file and
`scripts/waves/verify-w8.ts` are committed.** Writing implementation code from this PRD before that
review lands is a hard reject, identically to the skeleton-page rule it replaces.

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
reference becomes one `sourceSlot` in a `CompositionIR` instance, addressed and evidenced exactly as
`docs/specs/selector-composition-ir.md` §1 describes. No URL input field, no live-site capture, no
screenshot acquisition anywhere in this wave's surfaces.

**S8-2 — Directive parsing.** A natural-language brief, plus the acquired reference set, produces a
real `CompositionIR` instance satisfying `docs/specs/selector-composition-ir.schema.json`. This
implements the call signature `evals/selector/nl-to-ir/parser.ts` already froze (S7-4/C7-14) — see
"Implementation contract" below for exactly where this code lives and why it is not a modification
of that frozen file.

**S8-3 — Composition engine.** Consumes one `CompositionIR` instance and produces exactly 3
structurally distinct composed outputs ("variants"), each a `CompositionElement[]` in the shape
`evals/selector/scorer/index.ts`'s `CompositionElement` interface already defines
(`elementId, sourceId, domPath, nodeId, breakpoint, motionSignature?, styleFingerprint?`). The engine
resolves conflicts using the case's own `conflictResolution` records (the same deterministic
precedence `evals/selector/scorer/resolve-conflicts.ts` reads), and produces genuine variation along
the four pre-registered axes in `evals/selector/diversity-axes.json` — not three coats of paint on
one skeleton.

**S8-4 — Selection → project.** The user picks one of the 3 variants. That choice creates a real
project (`kind: 'prototype'`, matching the existing `ProjectKind` enum — no new enum value is
introduced) seeded from the chosen variant's composed output, carrying `selectorRunId` and
`selectorVariantIndex` provenance metadata (the same discriminator-on-existing-kind pattern
`ProjectMetadata` already uses for `web-clone`/`document`/etc.).

**S8-5 — Provenance surface.** Every emitted element in every variant is traceable, on demand,
back to `{sourceId, nodeId, domPath, breakpoint}` — reusing the resolution semantics
`evals/selector/scorer/provenance-resolve.ts` already defines, exposed as a real, queryable API
surface (not just data present in a response body nobody can ask about after the fact).

**S8-6 — Degenerate-directive handling.** A directive whose `scope` does not resolve to any real
evidence pointer (the corpus's `phantom-element-directive` case) must not crash the composer or
silently vanish. It fails gracefully: the run still produces its other, resolvable claims, and the
unresolvable one is surfaced to the user by name (which directive, which source, why it did not
resolve) — mirroring exactly how the IR spec already requires this to be *expressible*
(`selector-composition-ir.md` §2: "the IR must be able to express that failure mode, not just the
success path").

**S8-7 — UI/CLI parity.** Every capability above is reachable through the web UI **and** `od
selector …`, both against the identical `/api/*` contract, CLI supporting `--json`, per
`AGENTS.md` → Capability exposure. This is not a checkbox after the fact; the HTTP contract in
"Implementation contract" below is the single source both surfaces call.

## Non-goals (explicit)

- **Live-URL / screenshot reference acquisition.** Cut per the NM-42C decision above. Unblocks when
  W6b lands a reviewed `ReferenceSnapshot` acquisition contract; re-adding it then is an amendment to
  S8-1, not a re-litigation of S8-2 through S8-7.
- **Any change to W7's grader, corpus, thresholds, or held-out split.** Hard non-goal, enforced
  mechanically (C8-1, C8-3) — not a matter of implementer discipline.
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
things, and `scripts/waves/verify-w8.ts` has nothing stable to call. Every path below is **new**
product code W8 creates; none of it is a modification to any file under `evals/**` or
`docs/specs/**` — see "Why product code does not live under `evals/`" below.

**New pure modules (no daemon required to exercise them — `scripts/waves/verify-w8.ts` imports
them directly, exactly as it imports `evals/selector/scorer/index.ts`):**

- `apps/daemon/src/selector/types.ts` — `SelectorSourceSlot`, `SelectorDirectiveClaim`,
  `SelectorConstraint`, `SelectorConflictResolutionRecord`, `SelectorProvenanceEntry`,
  `SelectorVariantAxis`, `SelectorCompositionIR` (the six-array shape
  `selector-composition-ir.schema.json` defines, field-for-field), and
  `SelectorCompositionElement` (structurally identical to `evals/selector/scorer/index.ts`'s
  `CompositionElement` — `elementId, sourceId, domPath, nodeId, breakpoint, motionSignature?,
  styleFingerprint?` — so a `SelectorCompositionElement[]` can be passed to `scoreComposition`
  without transformation).
- `apps/daemon/src/selector/parse-directive.ts` — `export function parseDirective(brief: string):
  SelectorCompositionIR`. Implements S8-2. Must be a real implementation (not a rename of the frozen
  stub in `evals/selector/nl-to-ir/parser.ts`, which stays permanently unimplemented as W7's frozen
  interface reference).
- `apps/daemon/src/selector/compose.ts` — `export function composeVariants(ir:
  SelectorCompositionIR): [SelectorCompositionElement[], SelectorCompositionElement[],
  SelectorCompositionElement[]]`. Implements S8-3. Must return exactly 3 variants; conflict
  resolution must follow `ir.conflictResolution`'s declared precedence; a directive whose `scope`
  does not resolve must be omitted from the composed output (not crash), and the omission must be
  independently reported (see the routes below) — this is S8-6.

**Why product code does not live under `evals/`:** `evals/` is program scaffolding —
`VERIFICATION-CONTRACT.md` §1 says `scripts/waves/` (and by the same logic, the eval harness it
grades against) is deleted in one commit when the program closes. Product code that imported from a
directory slated for deletion would break the shipped product. The bridge is one-directional:
`scripts/waves/verify-w8.ts` (scaffolding) imports **both** the frozen grader from `evals/` **and**
the real product modules from `apps/daemon/src/selector/`, and feeds the product's real output
through the frozen grader. Product code never imports from `evals/`.

**New route file:** `apps/daemon/src/routes/selector.ts`, registered in `apps/daemon/src/server.ts`,
namespace `/api/selector/*`:

| Method + path | Body | Response | Notes |
|---|---|---|---|
| `POST /api/selector/runs` | `{ references: Array<{sourceType: 'library'; assetId: string} \| {sourceType: 'upload'; uploadId: string}>, brief: string }` (1–4 entries) | `{ id: string, ir: SelectorCompositionIR, variants: SelectorCompositionElement[][], unresolvedDirectives: Array<{axis, source, scope, reason}> }` | Creates a run; parses the brief via `parseDirective`, composes via `composeVariants`. `unresolvedDirectives` is S8-6's surfaced-failure list; always present, possibly empty. |
| `GET /api/selector/runs/:id` | — | Same shape as the create response | Idempotent read of a prior run. |
| `GET /api/selector/runs/:id/provenance` | query `elementId`, `variant` (0\|1\|2) | `{ elementId, sourceId, nodeId, domPath, breakpoint, resolved: boolean }` | S8-5. `resolved:false` when the pointer does not resolve — never omit the row. |
| `POST /api/selector/runs/:id/select` | `{ variant: 0 \| 1 \| 2 }` | `{ projectId: string }` | S8-4. Creates the `kind:'prototype'` project with `selectorRunId`/`selectorVariantIndex` metadata. |

**New CLI subcommands** (`apps/daemon/src/cli.ts`, registered in `SUBCOMMAND_MAP` under `selector`,
calling the same routes above — never a parallel code path):

```
od selector run --reference library:<assetId> [--reference upload:<uploadId> ...] --prompt-file <path|-> [--json]
od selector show --run <id> [--json]
od selector provenance --run <id> --element <id> --variant <0|1|2> [--json]
od selector select --run <id> --variant <0|1|2> [--json]
```

**Capability manifest:** `scripts/waves/capability-manifest.json` gains a `selector` row (same shape
every other capability row uses — `uiEntryPoint`, `cliArgs`, `httpMethod`, `httpPath`,
`knownNamespaceRoutes`, `parityApplicable: true`), so `scripts/guard.ts`'s existing
manifest/`SUBCOMMAND_MAP`/route-inventory parity check covers `selector` automatically the same way
it covers every other capability.

**Web UI:** a new Selector entry point (`apps/web/src/components/Selector*.tsx`) reachable from the
existing New Project flow, calling the same four routes above through `apps/web/src/providers/`
(never a bespoke client, per AGENTS.md's "both surfaces must call the same `/api/*` endpoints").

### Lease note (not this document's to grant)

Per the binding constraints on this PRD-authoring pass, `docs/plans/waves/leases.json` is
orchestrator-owned and is **not edited by this document**. Before implementation starts, the
orchestrator must add a `W8` entry there covering (at minimum): `apps/daemon/src/selector/**`,
`apps/daemon/src/routes/selector.ts`, `apps/daemon/src/server.ts`, `apps/daemon/src/cli.ts`,
`apps/web/src/components/Selector*`, `apps/web/src/providers/registry.ts`,
`scripts/waves/capability-manifest.json`, `scripts/waves/verify-w8.ts`,
`docs/plans/waves/W8-selector-build.md`. This PRD deliberately does not propose exact glob syntax —
that is the same amend-on-proof pattern every other wave's lease used (see `leases.json`'s W1/W4
notes), decided once real file paths exist. **Zero paths under `evals/**`, `docs/specs/**`, or
`scripts/waves/verify-w7.ts` appear in that list, and none should be added later** — C8-1/C8-3 make
that mechanical, not aspirational.

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w8.ts`. Every
criterion below is checked against **real, imported W7 grader/corpus code and real, imported (or
honestly-absent) W8 product code** — never a description of what either should do.

| ID | Criterion | Verification |
|---|---|---|
| C8-1 | W7's grader, corpus, and thresholds are the genuine landed artifacts | Eleven named W7 files (scorer's five modules, `floors.json`, `diversity-axes.json`, `eval-manifest.json`, corpus `manifest.json`, the IR schema + spec doc, the NL→IR goldens + stub) are sha256-pinned against their content at W8's `baseCommit`; any mismatch is a hard fail naming the file and both hashes |
| C8-2 | Grader-integrity control is re-proved in W8's own run | The real, imported `scoreComposition` scores a verifier-constructed population (8 deliberately-wrong + 8 faithful compositions, one pair per non-sealed corpus case) with zero overlap between the two score distributions — never assumed from W7's own prior verification |
| C8-3 | W7's surfaces are immutable to W8 | `git diff --name-only <baseCommit>...HEAD` contains zero paths under `evals/**`, `docs/specs/**`, or `scripts/waves/verify-w7.ts`; a W8 commit that edits any of them is a hard fail naming the mutated path(s), not a warning |
| C8-4 | Held-out split stays sealed through W8 | The two sealed cases' `.enc` ciphertext is byte-identical to the git blob at the W7 seal commit (same content-binding check W7's own C7-11 uses); a leak scan over every git-tracked file under `evals/` (5×64-byte content windows, base64/hex variants) finds no sealed-plaintext fragment anywhere in W8's tree |
| C8-5 | Reference acquisition: 1–4 Library/upload references | A real isolated daemon serves `POST /api/selector/runs` with 1, 2, 3, and 4 Library-asset references and rejects (with an attributable 4xx, not a 500) a 0-reference and a 5-reference request; no URL-typed reference field exists anywhere in the request schema |
| C8-6 | NL brief → IR reproduces every frozen golden | `apps/daemon/src/selector/parse-directive.ts`'s real `parseDirective` is called once per golden in `evals/selector/nl-to-ir/goldens.json`; the resulting IR's `directives` array contains a claim matching `{axis, source, scope}` exactly and `strength` within 0.05, for all 11 goldens with zero exceptions |
| C8-7 | Every non-sealed corpus case composes end-to-end and clears every floor | For each of the 8 non-sealed cases, the real `composeVariants` is called on the case's own frozen IR (`evals/selector/corpus/ir/*.json`); every one of the 11 scorer axes, on every one of the 3 returned variants, scores at or above `floors.json`'s floor, graded by the unmodified `scoreComposition` |
| C8-8 | Held-out split meets the same floors at gate time | The 2 sealed cases are decrypted only inside `verify-w8.ts` (same `seal.key`/`openssl` path W7's own verifier uses), scored the same way as C8-7, same floors, same axes; sealed plaintext is never written outside the verifier's own proof directory and never logged |
| C8-9 | `directive_claim_coverage` clears its floor, and moves under a real counterfactual swap | Every case's every variant clears `directive_claim_coverage`'s 0.5 floor (subset of C8-7, restated because it is the axis with no compensating floor elsewhere); additionally, for a real conflict case (`marketing-hero-grid`), `composeVariants` is called on both the case's real IR and a verifier-constructed IR with the `layout` conflict's winner/loser swapped, and the resulting `directive_claim_coverage` (or the axis the swap targets) moves by at least `floors.json`'s `counterfactualMinDelta` (0.1) between the two real composer outputs |
| C8-10 | 3 variants are structurally diverse per the pre-registered axis set | `evals/selector/scorer/diversity.ts`'s real `scoreDiversity`, called on the real 3-variant output for every non-sealed case, returns a positive score; a verifier-constructed recolor-only/class-name-only trio built from the SAME case's real elements (varying only `styleFingerprint`) is fed through the same function and must score 0, proving the check cannot be satisfied by cosmetic variation alone |
| C8-11 | Provenance is queryable for any output element | For every element in a composed variant, `GET /api/selector/runs/:id/provenance?elementId=…&variant=…` returns a row whose `(sourceId, nodeId, domPath, breakpoint)` resolves against that source's real captured snapshot (using the same resolution semantics as `evals/selector/scorer/provenance-resolve.ts`); a shuffled-`sourceId` negative control on a real element must report `resolved:false`, never a false positive |
| C8-12 | A directive naming a nonexistent element fails gracefully and attributably | Running `phantom-element-directive`'s case through the real composer does not throw; the response's `unresolvedDirectives` names the exact `{axis, source, scope}` that failed to resolve; the run's other, resolvable directives still produce composed output (a total failure is not "graceful") |
| C8-13 | UI/CLI parity over the identical `/api/*` contract | A real isolated daemon serves `POST /api/selector/runs`; `od selector run --json` against the same daemon (`--daemon-url`) produces a response structurally identical to the HTTP call (same fields, same values, modulo formatting); `scripts/guard.ts`'s capability-manifest/`SUBCOMMAND_MAP`/route-inventory parity check passes for the `selector` capability specifically |
| C8-14 | Selecting a variant creates a real project | `POST /api/selector/runs/:id/select` with a real prior run and `variant:0` returns a `projectId` that resolves to a real project via `GET /api/projects/:id`, with `kind:'prototype'` and `metadata.selectorRunId`/`selectorVariantIndex` matching the run and the selected index |
| LEASE | W8's diff stays inside its granted lease | `git diff --name-only <baseCommit>...HEAD` ⊆ `leases.json`'s `W8` entry, read from `baseCommit` (never from HEAD, so W8 cannot widen its own lease). **Expected to FAIL until the orchestrator grants the W8 lease** (see "Lease note" above) — this is the honest pre-grant state, not a defect in this PRD or its verifier |

### Design notes on specific criteria

- **C8-1 vs C8-3** are deliberately two different mechanisms proving two different things. C8-1
  proves the artifacts W8 is building against are the *correct*, unmutated W7 outputs (a static hash
  table, defense against a corrupted or rolled-back base). C8-3 proves W8's *own commits* never
  touched them (a dynamic diff against `baseCommit`, defense against W8 itself). Together they are
  G-12's anti-tamper requirement; neither alone is sufficient — a hash-only check would miss a
  brand-new file added under `evals/` that happens to not collide with a pinned path, and a
  diff-only check would miss a `baseCommit` that was itself already wrong.
- **C8-2's population is verifier-constructed, not W7's fixtures.** `evals/selector/fixtures/
  population/{faithful,wrong}/` exists but only covers 2 cases each; C8-2 builds its own
  faithful/wrong pair for all 8 non-sealed cases directly from `buildSnapshotsBySource`/`loadCaseIR`,
  so the re-proof is not merely replaying W7's own construction.
- **C8-9's counterfactual swap is built on W8's real composer**, not a verifier-synthesized
  substitute standing in for it — this is the literal instruction this PRD was commissioned under:
  counterfactual separation must be re-proved on real Selector output, not assumed from W7's C7-10.
- **C8-13 always boots a real, isolated daemon** (fresh `mkdtemp` `OD_DATA_DIR`, port 0, first-party
  workspace packages rebuilt from tracked source immediately before boot) even though, at this
  PRD's freeze time, the boot will succeed and the route will 404 — the 404 itself is the honest,
  runtime-observed evidence that the surface does not exist yet, which is stronger evidence than a
  static grep for `SUBCOMMAND_MAP['selector']` and is the same posture `W5-W11-gated.md` demands
  ("Runtime truth over source structure").

## Human/founder items

None. Unlike W7 (where feasibility and go/no-go were genuinely open questions), W7's feasibility
spike and go/no-go decision (`docs/specs/selector-go-no-go.md`, decision: **GO**) already closed
that question. Every C8-* criterion above resolves mechanically to `pass`/`fail` — there is no
`human:`-marked criterion in this wave.

## Open questions for the review round

1. **`SelectorCompositionElement` vs `packages/contracts`.** This PRD deliberately keeps the
   product-side composition types in `apps/daemon/src/selector/types.ts` rather than
   `packages/contracts` to avoid speculatively growing the shared contracts surface before a second
   consumer (the web UI) proves the shape is stable. `apps/web` only ever sees the HTTP response
   JSON, not the TS type. If a reviewer believes DTOs this central belong in `packages/contracts` on
   principle (matching how every other route's request/response types are organized per AGENTS.md's
   boundary rules), that is a legitimate implementation-detail disagreement to resolve before
   implementation starts, not after.
2. **`SelectorCompositionElement[3]` as a fixed-length tuple vs `SelectorCompositionElement[][]`
   with a length-3 runtime check.** The contract above writes it as a TS tuple type for the strongest
   compile-time guarantee "always exactly 3." A reviewer may prefer a runtime-checked array (simpler
   generic-code interop) with the tuple constraint enforced only in `verify-w8.ts` and the route
   handler. Both satisfy every C8-* criterion identically; this is a style question, not a scope one.
3. **Whether the "5-reference request rejected" half of C8-5 needs its own explicit corpus case.**
   The eval corpus's degenerate quota (`CORPUS.md`) covers n=1 source and a nonexistent-element
   directive, but not an over-quota reference count — that boundary is purely a request-validation
   concern (the IR schema itself has no upper bound on `sourceSlots`), so C8-5 checks it directly at
   the route rather than via a corpus case. Flagging this so a reviewer can confirm that placement is
   right rather than a gap.

None of these are genuinely unresolvable from the ratified record — they are implementation-detail
calls this PRD made a reasonable default on, named here per the "open questions ONLY if genuinely
unresolvable" instruction, so the review round can affirm or override the default rather than
silently inheriting it.
