# Wave 6a — Client Website Studio dispatch contract

**Status:** W6a-P freeze candidate; frozen only when commit-bound manifest passes

**Canonical product PRD:** [`../2026-08-03-client-website-studio-prd.md`](../2026-08-03-client-website-studio-prd.md)

**Program authority:** [`GLOBAL-GOAL.md`](GLOBAL-GOAL.md) and
[`VERIFICATION-CONTRACT.md`](VERIFICATION-CONTRACT.md) override this file on conflict

**Loop:** `loop:red-green-review` unless a tranche row narrows the planning loop

**Scope:** W6a only. W6b capture, customer-site analytics, managed hosting, one-fee packaging,
and W8 Selector remain separate programs.

This file is the W6a-P freeze candidate and does not restate or amend the product PRD. Criteria,
product behavior, non-goals, proposed path leases, and recovery semantics come from the canonical
PRD. This file and the PRD become frozen only when the commit-bound W6a-P manifest passes. A worker
must re-read all three authority documents from its own fresh merge base before acting.

## Sequence invariant

The program order is **W3 → W5 → W6a**. W6a-P is a plan-freeze-only exception that may run after
its own gates even when W5 is recorded as `not-landed`; it is not product implementation. W6a-F
cannot dispatch until W3 and W5 are both ancestors of fresh `origin/main` (W5 transitively requires
W1 and must reconcile W3's `landed-without-goal-proof` status). Nothing in this contract authorizes
product implementation ahead of W5 or permits W6a and W8 to hold their shared CLI, contract,
server, or capability-manifest paths concurrently.

## Dispatch table

Invoke `/goal docs/plans/waves/W6a-client-website.md --slug <slug>` only after the row's gates and
merge-base lease are recorded.

| Tranche | `/goal` slug | Hard gates | Criteria owned | Verifier |
|---|---|---|---|---|
| W6a-P Plan freeze | `mishmash-w6a-plan-freeze` | Founder decision landed; exact approval and preflight receipt contract green and hash-pinned in the separately granted `waves["W6a-P"]` lease; W2 retained gate accepted; W3 ancestry recorded without independent-proof claim; W4 accepted through the exact PRD-defined 15/15 or founder-waived 13/15 path; W5 status recorded but may be `not-landed`; active-lane audit clear | C6A-01; C6A-P-LEASE | `pnpm exec tsx scripts/waves/verify-w6a-plan.ts` |
| W6a-F Foundation | `mishmash-w6a-foundation` | W6a-P, W3, W5, and W4 landed; workspace-canvas change remains landed; W6a-F lease granted on fresh main | C6A-02–C6A-07; C6A-F-LEASE | `pnpm exec tsx scripts/waves/verify-w6a-foundation.ts` |
| W6a-B Boards | `mishmash-w6a-boards` | W6a-F landed; W6a-B lease granted on fresh main | C6A-08, C6A-09; C6A-B-LEASE | `pnpm exec tsx scripts/waves/verify-w6a-boards.ts` |
| W6a-G Guided generation | `mishmash-w6a-generation` | W6a-F and W6a-B landed; W6a-G lease granted on fresh main | C6A-10–C6A-13, C6A-17, C6A-18, C6A-23, C6A-24; C6A-G-LEASE | `pnpm exec tsx scripts/waves/verify-w6a-generation.ts` |
| W6a-S Placeholder safety | `mishmash-w6a-placeholder-safety` | W6a-G landed; exact deploy-path merge-base scan and live-worktree report clear; `dispatch-preflight.json` present; W6a-S lease granted | C6A-14–C6A-16; C6A-S-LEASE | `pnpm exec tsx scripts/waves/verify-w6a-placeholder-safety.ts` |
| W6a-U Easy Update | `mishmash-w6a-easy-update` | W6a-G landed; W6a-U lease granted; no deployment path leased or called | C6A-19, C6A-20; C6A-U-LEASE | `pnpm exec tsx scripts/waves/verify-w6a-easy-update.ts` |
| W6a-E Integration | `mishmash-w6a-integration` | W6a-S and W6a-U landed; fresh integration lease granted | C6A-21, C6A-22; C6A-E-LEASE | `pnpm exec tsx scripts/waves/verify-w6a-integration.ts` |

W6a-S and W6a-U may execute in parallel only after W6a-G lands and only when the granted leases
and live changed-path sets are disjoint. Every other tranche is serial. Landing is always through
one integrating writer from fresh `origin/main`.

## Lease and isolation gate

- PRD §14 lists proposed paths only. Dispatch authority exists only in
  `docs/plans/waves/leases.json` at the tranche merge base. Each verifier must fail when
  `git diff --name-only <baseCommit>...HEAD` exceeds that grant.
- The `waves["W6a-P"]` allowlist is exactly the PRD, this dispatch contract, and
  `scripts/waves/verify-w6a-plan.ts`. No fourth path or glob is permitted.
- W6a-P follows the PRD's non-circular ceremony exactly: the founder decision is already landed;
  the three-file candidate and final Fable approval exist off-main; the preflight audits freshly
  fetched **pre-lease** `originMain`; a separate single-parent orchestrator commit changes only
  `docs/plans/waves/leases.json` and pins all four receipt hashes; then W6a-P is created from that lease
  commit, receives the exact reviewed blobs, commits, and verifies. The decision grants review,
  not paths.
- Create each executable tranche in a new isolated worktree from fresh `origin/main`. Never
  implement in the root MishMash worktree, this Codex PRD-authoring worktree, or another agent's
  worktree.
- Treat `/Users/zero-suminc./projects/mishmash/.claude/worktrees/**` as read-only. Before dispatch,
  capture `git worktree list --porcelain`, branch ancestry, and each active worktree's changed
  paths. Do not edit, reset, clean, commit, or remove a Claude worktree.
- Historical draft snapshot only: `origin/main@941be4f15` contains the design-library,
  workspace-canvas, founder-waived W4 landing, and W6a-P founder decision. This snapshot is not dispatch authority.
  The hash-pinned preflight receipt must refresh origin,
  worktrees, ancestry, changed paths, and gate results immediately before the lease grant.
  A lane is released only when its
  branch is an ancestor of fresh `origin/main`, or a checked changed-path intersection is empty
  and `DECISIONS.md` records the exact release authority.
- The former workspace-canvas contract and i18n collision is temporally closed.
  The landed W4 candidate touches CLI, server, backup, contracts, and tests proposed across W6a;
  the PRD-defined dual-path ancestry, artifact, and blob proof is a mechanical gate, not background
  context.
- W6a-S additionally writes
  `~/.claude/goal-state/mishmash-w6a-placeholder-safety/proof/dispatch-preflight.json` containing
  the merge-base lease intersection and live-worktree intersection for
  `apps/daemon/src/deploy.ts` and `apps/daemon/src/routes/deploy.ts`. Any intersection blocks.

## W6a-P receipt and prerequisite evidence

PRD §14, **W6a-P immutable receipt contract**, is incorporated here verbatim by reference and is
the only accepted schema. The verifier may not accept aliases or downgrade any requirement below.

- `waves["W6a-P"]` pins `approvalReceiptSha256`, `dispatchPreflightReceiptSha256`,
  `reviewAttemptSha256`, and `reviewAttemptResultSha256`.
- The founder-authorized final Fable confirmation is permanently one-shot. After every local
  preflight check passes and immediately before Claude is invoked, the runner atomically creates
  `reviews/final-fable-attempt.json` with `O_CREAT | O_EXCL | O_NOFOLLOW`, fsyncs it, and fsyncs
  the parent directory. Its exact ordered schema is the PRD §14 marker schema:
  `schemaVersion`, `attemptId`, `startedAt`, `reviewedCommit`, `planAuthor`, `reviewer`, `model`,
  `route`, `reviewedFileSha256`, `reviewPromptPath`, `reviewPromptSha256`, and `sanitizedArgv`.
  Marker existence spends the authorization forever; later or concurrent runner invocations fail
  before Claude, and no crash, timeout, invalid result, publication failure, or `REVISE` permits
  marker rollback or another invocation.
- Every post-marker outcome exclusively publishes and fsyncs
  `reviews/final-fable-attempt-result.json` with the exact PRD §14 ordered schema:
  `schemaVersion`, `attemptId`, `completedAt`, `outcome`, `terminalVerdict`, `problems`,
  `reviewAttemptPath`, `reviewAttemptSha256`, `reviewPromptPath`, `reviewPromptSha256`,
  `rawResultPath`, `rawResultSha256`, `oauthInvocationPath`, `oauthInvocationSha256`,
  `sessionTranscriptPath`, and `sessionTranscriptSha256`. `outcome` is exactly `APPROVE`,
  `REVISE`, or `INVALID`; `terminalVerdict` is `APPROVE`, `REVISE`, or JSON `null`; and an
  unavailable artifact uses JSON `null` for both its path and hash. The prompt, raw result,
  invocation receipt, and attempt result use their canonical paths for both approval and
  non-approval whenever available. Only exact `APPROVE` creates an approval receipt. Any other
  outcome, missing/invalid result, or post-marker failure permanently parks W6a-P without retry.
- Approval bytes live at
  `~/.claude/goal-state/mishmash-w6a-plan-freeze/proof/final-fable-approval.json`. They bind
  `reviewedCommit`, `planAuthor`, a distinct `reviewer`, exact `model: "Fable 5"`, exact
  `route: "Claude Code OAuth"`, `verdict: "APPROVE"`, no blockers, all three reviewed-file
  hashes, `reviewPromptPath`/`reviewPromptSha256`,
  `reviewAttemptPath`/`reviewAttemptSha256`,
  `reviewAttemptResultPath`/`reviewAttemptResultSha256`, `rawResultPath`/`rawResultSha256`,
  `oauthInvocationPath`/`oauthInvocationSha256`, and
  `sessionTranscriptPath`/`sessionTranscriptSha256`. Marker, attempt-result, prompt, raw-result,
  and invocation paths are beneath the goal's `reviews/`; the transcript is the canonical
  `~/.claude/projects/.../<raw session_id>.jsonl` file.
- `reviews/final-fable-prompt.md` must be byte-for-byte equal to the canonical template expansion
  in PRD §14: the fixed adversarial-review text, one blank line, the exact ordered
  binding block populated from the approval receipt, one blank line, and the literal terminal
  instruction. The only variable bytes are the lowercase hexadecimal `reviewedCommit` and three
  reviewed-file hashes. Encoding is UTF-8 without a byte-order mark, line endings are LF, bytes
  begin with `You`, and exactly one terminal LF follows `VERDICT: REVISE.` No leading blank line,
  trailing blank line, arbitrary prefix, suffix, or additional interpolation is allowed. The
  verifier constructs the same expansion and requires exact byte equality and
  `reviewPromptSha256` equality.
- The raw Claude JSON must prove `subtype === "success"`, `is_error === false`,
  `stop_reason === "end_turn"`, `terminal_reason === "completed"`, string `result`, empty
  `permission_denials`, `modelUsage["claude-fable-5"].canonicalModel === "claude-fable-5"`, and
  `modelUsage["claude-fable-5"].provider === "firstParty"`. Its non-empty `session_id` selects the
  canonical transcript. Any row carrying `sessionId`, `cwd`, or `version` must match the raw
  session, invocation cwd, or leading semantic version parsed from the full invocation
  `claudeVersion`; every user/assistant row must carry and match all three. Queue, attachment, and
  auxiliary rows may omit them but may not conflict. The string user prompt equals prompt bytes,
  assistant model is `claude-fable-5`, and final assistant `end_turn` text equals raw `result`.
  A generic top-level model claim is rejected.
- `reviews/final-fable-oauth-invocation.json` records exact `cwd`,
  `attemptPath: "reviews/final-fable-attempt.json"`, the matching `attemptSha256`,
  `stdinPath`, `stdinSha256`,
  `claudeExecutable` equal to the realpath of live `command -v claude`, `claudeVersion` equal to
  live `claude --version`, `exitCode: 0`, the same raw hash, and exact
  `sanitizedArgv: ["-p", "--model", "fable", "--output-format", "json"]`. Its
  `credentialEnvAbsent` object contains exactly six true keys: `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`,
  `CLAUDE_CODE_USE_VERTEX`, and `OPENROUTER_API_KEY`.
- At verification time, the verifier runs that live canonical `claudeExecutable` with exactly
  `auth status --json`, requires exit zero and valid JSON, and requires `loggedIn: true`,
  `authMethod: "claude.ai"`, `apiProvider: "firstParty"`, and `subscriptionType` equal to `"max"`
  or `"pro"`. The invocation receipt records an `authStatus` object containing exactly those four
  sanitized fields and matching the four-field projection of the live result; raw auth output,
  tokens, account identifiers, and all other auth fields are forbidden. This check supplements the
  transcript and environment receipts and directly proves the active subscription OAuth session.
- `proof/dispatch-preflight.json` records the independently freshly fetched **pre-lease**
  `originMain`, RFC 3339 `fetchedAt`, successful fetch, live worktrees, intersections, and
  the exact five-key `founderDecision` plus structured W2/W3/W4/W5 evidence. The founder-decision
  schema and constants are canonical only in PRD §14. The lease commit must follow within ten minutes. A stale
  preflight requires a new receipt and replacement lease/hash commit before branch creation.
- At verification, fetch current `origin/main`; derive `leaseCommit` as the merge base; require
  preflight `originMain === leaseCommit^`; require the single-parent `leaseCommit` diff to be
  exactly `docs/plans/waves/leases.json`; and require `leaseCommit` to be ancestral to fresh
  current `origin/main`. Never require the pre-lease receipt's `originMain` to equal post-lease
  current `origin/main`.
- Re-run prerequisite ancestry, worktree, and W4 artifact/blob checks against fresh current
  `origin/main`. `reviewedCommit` may differ from W6a-P HEAD, but all three reviewed blob bytes and
  hashes must be identical at both commits.
- Require the PRD-defined founder-decision commit to be ancestral to preflight `originMain`, the
  lease commit, and fresh current `origin/main`; hash its exact decision-file blob.

Canonical decision-section extraction takes the bytes from the unique matching H2 heading through the byte immediately before the next H2 heading, or through EOF when no later H2 exists; it then trims all trailing whitespace and appends exactly one LF. The verifier hashes and compares only those normalized bytes at the decision commit, preflight `originMain`, lease commit, and fresh current `origin/main`.

Later unrelated decision sections may change the whole file but may not alter, duplicate, or remove
this founder-decision section.
- `activeWorktrees` is the sorted exact inventory of every other live worktree, excluding only the
  verifier's current W6a-P root. Each row binds exact `path`, `head`, `branch` or `detached`, and
  `changedPaths`, the sorted union of committed, staged, unstaged, and untracked paths.
  Verification recomputes and compares the complete inventory and exact
  `activePlanPathIntersections`; any drift fails.
- W2 proof is the retained gate, not its stale mutable manifest: base
  `1ac53c1591fd853cae6891e81637248acecac3cb`, approved candidate
  `fe1a34584fb0c4d615fcc4919c715e6136d6ef03`, squash landing
  `8c1b6225b54a0ff8471c765c76e772058600cd7d`, pinned `approved-gate.commit`,
  `approved-gate.sha256`, and `approved-verify-w2.ts` bytes, and the clean exact 15-pass
  `gate-of-record-fe1a34584-run4.txt` transcript. The exact four SHA-256 values are canonical in
  the PRD receipt contract. All 129 candidate blobs must match between the approved candidate and
  squash landing `8c1b6225b54a0ff8471c765c76e772058600cd7d`, and that landing must be an
  ancestor of freshly fetched `originMain`. W2 explicitly does not require current `originMain`
  blobs to remain identical after legitimate downstream landings. The landing's only four extra
  commit paths are the exact `tools/pack/tests/` files enumerated in the PRD.
  `0e5d499314649e51cbfa896f5e0ff4bb0c2b6ce4` is an unpark decision only, never W2 proof.
- W3 is exactly `2435edb2e282242ccea8fb2f0ae7d214738a4e26` with
  `status: "landed-without-goal-proof"`. Record ancestry only; never claim independent
  verification. W5 expansion owns reconciliation before W5 landing.
- W4 must satisfy exactly one PRD-defined path: the full-green path, or the sole canonical
  founder-waived tuple between `W6A_W4_FOUNDER_WAIVER_TUPLE_START` and
  `W6A_W4_FOUNDER_WAIVER_TUPLE_END` in PRD §14. No tuple value is restated or independently
  authoritative here. The waived manifest has exactly the two PRD-authorized fail/1 rows and 13
  pass/0 rows; every manifest-owned artifact is non-empty and rehashed. The landing has
  exactly one parent; that parent lacks or differs on at least one candidate final blob; the
  landing's own changed paths equal candidate paths union extras; every candidate path changes in
  that landing; and candidate blobs equal landing and fresh-current-origin blobs. This permits a
  real squash landing without relabeling a later ancestor.
- W5 `not-landed` with `foundationBlocked: true` blocks W6a-F, not W6a-P plan freeze.
- Fetch or preflight failure still writes non-empty C6A-01 and C6A-P-LEASE proof files and a
  commit-bound failure manifest before the verifier exits non-zero.

The W4 block is a separately authorized prerequisite-compatibility item, not an F5R-02/F5R-04
regression. The one authorized final Fable confirmation remains unspent. Its exact scope prose is:

```text
Review scope is limited to these two separately enumerated items:
1. F5R-01 through F5R-05 and regressions introduced by their closure.
2. Prerequisite compatibility only: verify the exact PRD W6A_W4_FOUNDER_WAIVER_TUPLE. It may waive only C4-5 and C4-10; it may not waive or change any other W4 criterion, change any other part of W4, or authorize any other wave.

APPROVE only if every blocker is closed and the documented landing ceremony is executable as written. REVISE if any blocker remains, any claimed closure is unsupported, the prerequisite-compatibility item exceeds that exact scope, or the ceremony is not executable.
```

## Model routes

| Work | Route |
|---|---|
| Product/architecture adversary for W6a-P | Grok 4.5 through prepaid Nous Portal |
| Final long-horizon plan confirmation | Fable 5 through Claude Code OAuth only |
| Scoped implementation after red specs | `deepseek-v4-flash` through the approved direct DeepSeek endpoint; live-probe the exact slug at dispatch |
| Screenshot or visual behavior review | Gemini through subscription `agy` |
| Independent code adversary for every implementation tranche | Opus 5 through Claude Code OAuth only |
| Criterion decisions | Deterministic verifier and tests; never model judgment |

No Anthropic model may use direct Anthropic API credits, Nous, or OpenRouter for this program.
The implementer may not be its own reviewer. Pass refs and changed-file lists to reviewers, not
relayed diffs.

## State and proof contract

Each slug owns:

```text
~/.claude/goal-state/<slug>/state.json
~/.claude/goal-state/<slug>/run.log.md
~/.claude/goal-state/<slug>/proof/<criterion-id>.txt
~/.claude/goal-state/<slug>/proof/manifest.json
~/.claude/goal-state/<slug>/summary.md
```

W6a-P additionally owns immutable receipt bytes at:

```text
~/.claude/goal-state/mishmash-w6a-plan-freeze/proof/final-fable-approval.json
~/.claude/goal-state/mishmash-w6a-plan-freeze/proof/dispatch-preflight.json
~/.claude/goal-state/mishmash-w6a-plan-freeze/reviews/final-fable-attempt.json
~/.claude/goal-state/mishmash-w6a-plan-freeze/reviews/final-fable-attempt-result.json
~/.claude/goal-state/mishmash-w6a-plan-freeze/reviews/final-fable-prompt.md
~/.claude/goal-state/mishmash-w6a-plan-freeze/reviews/final-fable-raw-result.json
~/.claude/goal-state/mishmash-w6a-plan-freeze/reviews/final-fable-oauth-invocation.json
~/.claude/projects/.../<raw session_id>.jsonl
```

Their SHA-256 values must equal the `approvalReceiptSha256`,
`dispatchPreflightReceiptSha256`, `reviewAttemptSha256`, and `reviewAttemptResultSha256` pins in
`waves["W6a-P"]` at the merge base and the `reviewAttemptSha256`,
`reviewAttemptResultSha256`, `reviewPromptSha256`, `rawResultSha256`, `oauthInvocationSha256`, and
`sessionTranscriptSha256` references inside the approval receipt. Missing receipts, mutable
post-grant bytes, mismatched hashes, or a decision and lease collapsed into one commit block the
freeze.

At every task transition, update `state.json` and append the route, commit, reviewer identity,
verdict, and artifact pointers to `run.log.md`. The manifest must satisfy
`VERIFICATION-CONTRACT.md` §2: exact wave and commit, `treeDirty: false`, merge base, toolchain,
every owned criterion, command, assertion, non-empty hash-matched artifact, exit code, status, and
duration. Red evidence comes from the named parent commit; green evidence comes from the candidate
commit. Only a passing commit-bound W6a-P manifest changes this file and the PRD from candidates to
frozen plan artifacts. That manifest has a `receipts` object carrying the immutable
`approvalReceiptSha256`, `dispatchPreflightReceiptSha256`, `reviewAttemptSha256`,
`reviewAttemptResultSha256`, `reviewPromptSha256`, `rawResultSha256`,
`oauthInvocationSha256`, and `sessionTranscriptSha256` values in addition to
the criterion artifact hashes. Fetch failure does not bypass this write: it emits failed criterion
artifacts and a failure manifest before exiting non-zero. W6a-E registers the final C6A evidence
index in
`VERIFICATION-CONTRACT.md`; local tranche green does not by itself close a program criterion.

## Mechanical gate

Each implementation tranche runs its row verifier plus the applicable subset below and stores
command, stdout/stderr, and exit code in proof artifacts:

```bash
pnpm guard
pnpm typecheck
pnpm --filter @open-design/contracts build
pnpm --filter @open-design/web test
pnpm --filter @open-design/daemon test
git diff --check
```

Visible behavior also requires a browser-driven check and screenshots. Security and refusal
criteria require paired positive and negative controls. HTTP, web, CLI, persistence, tests, lease,
and review closure land together; no surface may be deferred.

## Stop rules

Stop the affected tranche without expanding scope when any condition holds:

- A prerequisite commit, fresh-base lease, proof manifest field, or independent reviewer is absent.
- The final W6a-P Fable confirmation is non-APPROVE, adds a blocking finding, has a missing or
  invalid attempt result, or suffers any post-marker failure. The marker permanently spends the
  attempt, so park W6a-P and do not invoke Fable again.
- Three consecutive non-APPROVE verdicts occur, or HIGH findings are non-decreasing across three
  rounds.
- Two implementation attempts fail the same criterion.
- A proposed write intersects an unreleased agent worktree, W8, or any path outside the lease.
- The work introduces arbitrary remote capture, managed hosting or provider credentials,
  customer-site analytics, competitor-copy reuse, automatic deployment, or a GSAP visual-authoring
  control beyond the existing global multiplier.
- Rights cannot distinguish owned/licensed reuse from reference-only influence, or a refusal lacks
  its positive control.
- The independent adversary finds a blocking correctness, security, privacy, licensing, or data-
  integrity defect.

Destructive Git operations, edits to other worktrees, lease widening after implementation, and
criteria weakening are prohibited. Record the blocked state and request the required founder or
orchestrator decision; do not route around the gate.
