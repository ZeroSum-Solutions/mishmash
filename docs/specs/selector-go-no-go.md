# Selector feature — founder go/no-go decision (C7-16)

Decision record only. Structure, not judgment — see `VERIFICATION-CONTRACT.md` S2 rule 3 / S3
R7: this record's existence and shape are machine-checked (`scripts/waves/verify-w7.ts` C7-16),
but the decision itself is a human call the verifier never renders on its own behalf.

## Founder

Devin, 2026-07-27, via the program's interactive decision interface.

## Context

The feasibility spike (`docs/specs/selector-feasibility-spike.md`, S7-5) ran end to end against
case `marketing-hero-grid`: all four directive claims resolved, with a hash-pinned composed
output and run-log as evidence.

- Composed-output hash (sha256 of `evals/selector/spike/composed-output.json`):
  `619266819008ef47e4a9e00519b4a3e651de4617b7025b14b9306f3f2aa7d7e9`
- Run-log hash (sha256 of `evals/selector/spike/run-log.txt`):
  `a985f69919148fc57d7d7f9a0f0ca0449f50a42bba8a6844011c8314a46d7807`
- Terminal exit code: 0

## Reviewer 1

GPT-5.6 Sol (codex default lane)

Verdict: GO
Rationale: The spike executed end to end on a real corpus case with a hash-pinned composed
output and run-log, and every claim resolved against real captured evidence. Nothing in the
spike's findings, nor in the wave's subsequent evidence-gating and conflict-resolution work this
review lane exercised throughout W7, indicates a blocking technical-feasibility defect.

## Reviewer 2

Grok 4.5

Verdict: GO
Rationale: The end-to-end spike run, its hash-pinned artifacts, and the terminal exit 0 confirm
the composition pipeline executes cleanly against real captured corpus data. Combined with the
IR schema and scorer machinery holding up under this lane's own adversarial review across W7,
there is no basis to withhold a GO on feasibility grounds.

## Overall decision

Decision: GO

Consequence: selector product work is greenlit for scheduling in a later wave. This decision
does **not** authorize product code in W7 — W7's lease is `evals/**`, `docs/specs/**`,
`scripts/waves/verify-w7.ts`, `docs/plans/waves/**` only, and forbids product code regardless of
this decision. This decision did not block W7 landing either way.
