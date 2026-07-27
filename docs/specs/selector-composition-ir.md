# Selector Composition IR

**Status:** frozen for W7 (spike/foundations). Schema: `selector-composition-ir.schema.json`
(sibling file, same directory). This document is prose; the schema is the enforced contract —
where they disagree, the schema wins and this document has a bug.

## Why an IR at all

The Selector (backlog C2) takes 1–4 references and a natural-language brief ("the layout of one,
the animations of another...") and must produce 3 structurally distinct, directive-faithful
variants. Two adversarial reviews of the backlog ticket (see
`docs/plans/waves/W7-selector-foundations.md`) found the ticket ill-posed without an explicit
answer to four questions:

1. What does "the layout of A" *denote* — which breakpoint, which state, which subtree?
2. When two references disagree on an axis, who wins, and is the loser recorded or silently
   dropped?
3. After composition, can any emitted pixel be traced back to the source it came from?
4. What makes three "prototype" outputs actually *different*, as opposed to three coats of paint
   on one skeleton?

The IR is the answer: a single serializable structure that a natural-language parser produces and
a composer consumes, with every one of these four questions given a field.

## The six concepts

### 1. Source slots (`sourceSlots`)

One entry per reference. A source slot is `{id, breakpoints, evidencePointers}`: the breakpoints
actually captured for that source, and the DOM-path + breakpoint evidence pointers available to
ground later directives and provenance against it. A source slot is not the raw capture — it is
the addressable surface the rest of the IR can point into. `evidencePointers` is an array of
compact `"<domPath>@<breakpoint>"` strings; each must correspond to a real node in that source's
pinned snapshot (see `evals/selector/CORPUS.md` for how the corpus pins snapshots).

### 2. Directive parse (`directives`)

Natural language turns into typed claims: `{axis, source, scope, strength}`.

- `axis` is a closed vocabulary: `layout | motion | palette | typography | section | interaction`.
  This is deliberately narrower than free text — an unbounded axis vocabulary means two engineers
  (or two runs of an NL parser) can name the same concept two different ways and never conflict,
  which defeats conflict resolution entirely.
- `source` names the source slot the claim is about.
- `scope` addresses a subtree: a `domPath` matching one of that source's evidence pointers, or a
  whole-document sentinel scope. A scope that does not resolve to any evidence pointer is not a
  parser bug to be silently normalized away — it is exactly the "directive naming a non-existent
  element" degenerate case the corpus's quota table requires (`evals/selector/CORPUS.md`), and the
  IR must be able to *express* that failure mode, not just the success path.
- `strength` is a `[0,1]` weight the parser assigned the claim (confidence, or emphasis inferred
  from the brief's own language — "mostly," "just," "exactly").

### 3. Constraints (`constraints`)

What must hold post-composition regardless of which sources won which axes: grid integrity,
contrast minimums (a11y axis), responsive behavior across the case's declared breakpoints. A
constraint is `{type, rule}` — a named invariant class plus the rule text. Constraints are not
directives: a directive says what a *specific* source contributed; a constraint says what must be
true of the *output* no matter which source contributed it.

### 4. Conflict resolution (`conflictResolution`)

When two or more sources claim the same axis on overlapping scope, something must arbitrate
deterministically, and the losing claim must be **recorded, not silently dropped** — this is the
PRD's explicit correction to a first draft that had no conflict policy at all. Each entry is
`{axis, winningSource, losingSource?, losingClaim?, rationale?}`. An axis with only one claimant
still gets a trivial entry (`winningSource` set, no `losingSource`) recording that no contention
existed — this keeps "no conflict" and "conflict silently unresolved" structurally distinguishable
in every IR instance, rather than making an empty array do double duty for both.

The resolver (`evals/selector/scorer/resolve-conflicts.ts`) is a pure function over
`{directives, conflictResolution}`: it groups directive claims by axis, and for any axis with more
than one distinct claiming source, applies the precedence `conflictResolution` declares, emitting
one `losingClaims` record per axis actually in contention. It is deterministic — the same IR
produces byte-identical output on every call, checked by `verify-w7.ts` C7-3 across three runs.

### 5. Provenance (`provenance`)

Every emitted element traces to `{elementId, sourceId, nodeId, domPath, breakpoint}`. Provenance
is not just record-keeping — it is the thing that makes "3 pixels came from source A, 2 from
source C" a checkable claim instead of an assertion. A provenance entry **resolves** only when
`(sourceId, nodeId, domPath, breakpoint)` names a node that was genuinely captured in that
source's pinned snapshot (`evals/selector/scorer/provenance-resolve.ts`). Attaching a
real-looking-but-wrong `sourceId` to otherwise-correct coordinates does not resolve — this is what
lets `verify-w7.ts` C7-4 catch a shuffled-ID control (every provenance pointer structurally present,
none of them true) and score it at zero resolution.

### 6. Variant axes (`variantAxes`)

The dimensions along which the 3 output variants must *structurally* differ, each with its own
named distance metric so "diverse" cannot be redefined per run to mean "different border-radius."
Four axes are pre-registered and frozen before any W8 work (`evals/selector/diversity-axes.json`):

- **layout-skeleton** — the *set* of `domPath` values present (order-independent). Distance:
  Jaccard dissimilarity of the domPath sets across a pair of variants.
- **section-order** — the *sequence* of scoped elements (order-dependent). Distance: fraction of
  positions where the two variants' element-at-position differ.
- **motion-timeline** — the `motionSignature` assigned per element. Distance: fraction of
  positions with a differing motion signature.
- **breakpoint-behavior** — the `breakpoint` assigned per element (does behavior vary by viewport,
  and does the case use more than one declared breakpoint's worth of variation). Distance:
  fraction of positions with a differing breakpoint assignment.

A recolor-only trio or a class-name-only trio moves none of these four axes (color and CSS class
names are not represented anywhere in the composition schema at all — see
`evals/selector/scorer/diversity.ts`), so they cannot satisfy `structural_variant_diversity` by
construction, which is the PRD's explicit bar ("Without pre-registration the definition begs its
own question and an agent sets distance = tree-edit over class names").

## Serialization and round-trip

An IR instance is plain JSON matching `selector-composition-ir.schema.json`: six required
top-level arrays (`sourceSlots`, `directives`, `constraints`, `conflictResolution`, `provenance`,
`variantAxes`), all but `constraints` required non-empty. Every corpus case has exactly one IR
instance at the path recorded in `evals/selector/corpus/manifest.json`'s `irPath` field (`.json`
for non-sealed cases, `.enc` — AES-256-CBC, decrypted only by `verify-w7.ts` — for the sealed
held-out split). `JSON.parse(JSON.stringify(ir))` must reproduce the identical structure
(no `Date`, no `Map`/`Set`, no functions, no `undefined` values) — this is checked mechanically by
`verify-w7.ts` C7-1 over every corpus IR instance, sealed cases included (decrypted first).

## What the IR does not do

The IR does not compose anything. There is no generator in this wave — S7-5's feasibility spike is
explicitly throwaway code that proves the IR *can* express one real case end-to-end
(`docs/specs/selector-feasibility-spike.md`), not a foundation for W8. The IR also does not decide
which 3 variants to produce; it only defines the axes along which any 3 outputs must be measured
apart. Variant selection strategy is W8's problem.
