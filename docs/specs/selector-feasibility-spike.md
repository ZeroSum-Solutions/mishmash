# Selector feasibility spike (S7-5)

**Status:** throwaway, by design. The code that produced this spike's output lives at
`evals/selector/spike/compose.ts` and is explicitly disposable — it exists to prove the IR can
express one real case end to end, not to become W8's foundation. Nothing here is a generator.

## Case

marketing-hero-grid

This case has a real cross-source `layout` conflict (`mkt-grid-a` vs `mkt-flex-b`), a `palette`
claim, and a `typography` claim — four directive claims total, spanning three of the six directive
axes, which makes it a reasonable single case to exercise most of the IR's moving parts by hand.

## What the spike did

`evals/selector/spike/compose.ts` loaded the case's already-authored IR
(`evals/selector/corpus/ir/marketing-hero-grid.json`), walked its four `directives` entries, and
for each one resolved `(source, scope)` against that source's own captured snapshot data — the
same kind of resolution `evals/selector/scorer/provenance-resolve.ts` performs, done here by hand
(well, by 90 lines of throwaway script) to prove the IR schema doesn't have to be reverse-engineered
by a generator; a straightforward walk over `directives` is enough to produce a real, resolvable
composition. All four claims resolved. The transcript is `evals/selector/spike/run-log.txt`; the
output is `evals/selector/spike/composed-output.json`.

## IR insufficiencies found

- The IR's `conflictResolution` records a `winningSource` and a short `losingClaim` string per
  contested axis, but nothing in the schema gives the losing claim's evidence its own address —
  there is no `scope` pointer alongside `losingClaim` that a human auditing "what did we discard
  and why" could follow directly, without re-deriving it by cross-referencing `directives` for the
  same axis.
- `provenance` entries carry a `breakpoint` field, but nothing in `directives` or `scope` records
  which breakpoint a claim implicitly targets when its scope's `domPath` exists at more than one
  captured breakpoint — `compose.ts` had to invent a resolution policy ("prefer desktop when
  present") that the IR itself is silent on.
- `variantAxes` declares four axis `name`/`distanceMetric` pairs, but a single IR instance has no
  field for the MEASURED distance a specific composed output actually achieves against a sibling
  variant — the axes are purely declarative inside one instance; nothing here records whether this
  particular composition is diverse from anything.

## Responses

- Added `losingClaim` as a short human-readable string on every `conflictResolution` entry (see
  `evals/selector/scorer/resolve-conflicts.ts` and the generated IR instances), but deliberately
  did NOT add a `scope` pointer to the losing directive's own evidence in this pass — deciding
  whether a losing claim's evidence should be independently addressable, or just re-derivable by
  querying `directives` for the same `axis`+`source` pair, is a real schema design call this
  one-case spike is not positioned to make well; it needs a second conflict case with genuinely
  different shape to avoid over-fitting the field to this example.
- No `breakpoint` field was added to `directives`/the claim shape. `compose.ts`'s "prefer desktop
  when the scope resolves at multiple breakpoints" policy is recorded here, in this document, as
  the working default rather than promoted into the schema — a policy choice backed by exactly one
  case is exactly the kind of premature schema commitment S7-5 exists to catch before it happens,
  not to make.
- No measured-distance field was added to `variantAxes`. Keeping the axis definitions purely
  declarative (name + distanceMetric) and leaving the MEASURED distance to
  `evals/selector/scorer/diversity.ts` — never to the IR instance that produced the composition —
  is deliberate: letting a single IR instance self-report its own diversity score would be exactly
  the kind of self-graded, ungrounded claim that `directive_claim_coverage` exists to catch for
  directives (PRD S7-3); the same principle rules out a generator self-reporting its own diversity.

## Evidence

This spike's evidence is case `marketing-hero-grid`, output hash
`59478f2c42784f3b5a2c796471c1c2cc426a4c092c68510371b551a03868eff2` (sha256 of
`evals/selector/spike/composed-output.json`), and run-log hash
`5283837c6de2faa30ccff9eb939c5025b3bc5ae1f51ea164524a8f2f7b6f49e9` (sha256 of
`evals/selector/spike/run-log.txt`) — the transcript that produced that exact output, ending in a
terminal `exit code: 0`.
