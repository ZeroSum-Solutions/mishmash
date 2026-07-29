# Decision: deepseek CLI PATH hygiene (NM-37C)

**Status:** Pending founder sign-off
**Date:** 2026-07-28 (drafted during W1 routing-truth implementation)
**human:** blocked-on-founder — VERIFICATION-CONTRACT.md §3 R7. This is not this
agent's call to make; recorded here so it is decided deliberately instead of
silently invented.

## Context

NM-37C (`docs/plans/waves/NM-REGISTER.md`, carried into the W1 PRD as "NM-37C
— deepseek CLI PATH hygiene, or an explicit won't-fix recorded in the lanes
runbook") is the only surviving text on this finding across the available
source documents (`NM-REGISTER.md`, `docs/plans/2026-07-26-mishmash-completion-assessment.md`).
Neither names the specific defect — no repro, no described symptom, no linked
issue. This document records that gap explicitly rather than guessing at a
problem and "fixing" something that may not be the thing the original
finding meant.

## Investigation performed

Read the deepseek runtime adapter and the shared executable-resolution path
it goes through:

- `apps/daemon/src/runtimes/defs/deepseek.ts` — the `deepseek` dispatcher owns
  `exec`/`--auto`, with `fallbackBins: ['codewhale']` for installs that only
  have the post-rename CodeWhale binary (upstream renamed the CLI; issue
  #2983, per that file's own comment). Prompt delivery is argv-based
  (`maxPromptArgBytes: 30_000`) because deepseek's CLI does not accept a `-`
  stdin sentinel, unlike most other adapters — this is a real, documented
  quirk but is about argv delivery, not PATH resolution.
- `apps/daemon/src/runtimes/executables.ts` — the shared binary-resolution
  path every adapter goes through: `AGENT_BIN_ENV_KEYS` maps `deepseek` to
  `DEEPSEEK_BIN` (a same-shape override key as every other CLI agent);
  `resolveOnPath` walks `PATH` plus the well-known user-toolchain
  directories (Homebrew, `~/.local/bin`, version-manager dirs, …) via
  `resolvePathDirs`/`userToolchainDirs`; `inspectAgentExecutableResolution`
  tries the configured override, then packaged built-ins (not applicable to
  deepseek), then PATH, in that order — identical machinery to `claude`,
  `codex`, `kimi`, and every other PATH-resolved agent. No deepseek-specific
  branch, special case, or workaround exists anywhere in this resolution
  path.

**Finding: no deepseek-specific PATH defect was located.** The adapter uses
the exact same resolution machinery as every other CLI-based agent, with one
legitimate accommodation already in place for the upstream CodeWhale rename
(the `fallbackBins` entry). If there is a real bug here, it was not
reproducible from reading the current source, and the original finding gives
no symptom to chase further.

## What "won't-fix" would mean here

Recording this as won't-fix does not mean "PATH resolution for deepseek is
perfect and can never break" — it means: the generic, shared PATH-resolution
path already treats deepseek symmetrically with every other agent, a known
real quirk (the CodeWhale rename) already has a real accommodation
(`fallbackBins`), and no further deepseek-specific defect could be identified
from the available source material. A future report with a concrete
repro (e.g. "deepseek resolves to the wrong binary when both `deepseek` and
`codewhale` are on PATH", or a specific env-var precedence bug) should reopen
this rather than be treated as already covered by this document.

## Decision

Decision: Pending — no founder ruling has been recorded yet. Interim
recommendation (not a ruling): treat as **won't-fix** on the current
evidence, since no specific PATH-hygiene defect could be located distinct
from the shared, already-adequate resolution path every other agent uses. If
the founder has additional context on what the original finding actually
observed, record it here and re-open as a concrete bug instead.

## Consequences of leaving this pending

- No code changes made under this decision. `executables.ts` and
  `defs/deepseek.ts` are unmodified by this document.
- This satisfies the "record before implementation" requirement (C1-12): no
  PATH-resolution change was implemented without this document existing
  first, and none is implemented as a result of it either.
