# Wave 1 — Routing & spend truth

**Slug:** `mishmash-w1-routing-truth`
**Gates on:** W0 (landed)
**Parallel with:** W2 — but **not disjoint as first claimed**. This wave **owns
`apps/web/src/components/EntryShell.tsx`, `apps/daemon/src/server.ts`, and
`packages/contracts/**`** for the burst. W2's one-line newsletter fix (`EntryShell.tsx:228`,
`open-design.ai/subscribe` → MishMash) executes **here**, tagged `C2-1a`, because that file also
carries this wave's model picker at lines 119 / 2672 / 3023–3182.
**Loop:** `loop:red-green-review` (`VERIFICATION-CONTRACT.md` §6)

## Why this wave exists

The founder selected Kimi K3 in the picker and Claude did the work. That erodes trust in every
other feature, and the investigation found **three independent mechanisms**, not one bug:

1. **Codex never echoes its executed model.** Its `thread.started` event carries only
   `sessionId`. Claude, Gemini-shaped `init`, and Cursor's `system/init` all report `model`,
   which `AssistantMessage.tsx` renders — so the UI's confidence is silently lane-dependent.
2. **Antigravity races.** `agy` has no `--model` flag; the daemon writes the choice into the
   **process-global** `~/.gemini/antigravity-cli/settings.json` immediately before spawn. Two
   concurrent non-default runs can swap models. A lock greps a log file for a propagation line
   with a timeout — it reduces the window, it does not close it. `streamFormat: 'plain'` means
   there is no structured init event to confirm anything.
3. **Silent daemon-side fallback.** `agentModelSelection.ts` client-side correction is hardcoded
   to `agent.id === 'amr'`. Every other agent keeps a stale/disabled model id in the UI while
   `resolveModelForAgent` substitutes silently. `run.model` (telemetry) records the **raw
   requested** model, set *before* resolution — so analytics disagree with execution too.

**Critical framing (from the audit):** "one authoritative model badge" is **not achievable** —
Codex and Antigravity cannot always report what ran. The honest goal is *truthful uncertainty*,
not false certainty. Ship what is locally controllable; treat upstream echoes as a bounded
enhancement.

## Scope

**NM-13a — Schema before UI.**
Persist three distinct fields on the run record: `requested` (what the user picked),
`resolved` (what the daemon chose after fallback), `reported` (what the CLI echoed, if it did).
Derive a display state: `verified` (reported === resolved), `substituted` (resolved ≠ requested),
`unverified` (no echo available). Fix `run.model` telemetry to record `resolved`, not raw
requested.

**NM-13b — Surface it.**
Show the state in the per-message model detail and the picker. A substitution must be **visible**
(backlog D3: "if there is a fallback to any model, this should be clear"). Extend the client-side
correction beyond `amr` so a disabled model id cannot sit selected in the UI.

**NM-13c — Antigravity honesty. `unverified` is an evidence ceiling, not an alternative to
fixing the race.**

The first draft said "either serialize non-default Antigravity runs **or** mark them
`unverified`." Both reviewers rejected the disjunction, and they are right: an agent takes the
cheap branch, labels every run `unverified`, ships no concurrency control at all, and the actual
model-swap race — the bug the founder reported — survives untouched behind an honest-sounding
label.

Revised, non-optional: **serialize non-default-model Antigravity runs**, or hard-fail the spawn
when a second non-default run would overlap. Then, separately, mark runs `unverified` because
`agy`'s plain stream genuinely cannot echo what executed. Labeling describes the *evidence*
available; it never substitutes for *execution control*.

**NM-14 — Gemini lane decision.**
D4 is already done (Antigravity wired, binary `agy`). D5 as written is obsolete — no standalone
Gemini CLI def exists and the legacy `gemini` CLI lost individual-tier auth. Decide: is
Gemini-via-Antigravity + BYOK Google sufficient, or is a first-class Gemini BYOK lane wanted?
Record the decision; implement only if the answer is the latter.

**NM-20 — Cost & usage meter (in-app first).**
The hard part exists: `run-analytics-observability.ts` normalizes input/output/total/cache tokens
across provider conventions, `codex-rollout-usage.ts` handles Codex's cumulative-only stream, and
`langfuse-trace.ts` computes `cost_usd` with a `pricing_version` marker. Build **in-app
aggregation + UI** over those numbers — total and per project. Self-hosted Langfuse stays
optional; a solo local-first studio should not need a second service to see its own spend.
Surface `pricing_version: 'unavailable'` honestly rather than showing a confident fake number.

**NM-33 — Kimi silent-success guard.** Kimi non-Bash tool failures currently parse as success.
Add a guard//warning so a failed tool call cannot read as a completed one.

**NM-37C — deepseek CLI PATH hygiene**, or an explicit won't-fix recorded in the lanes runbook.

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w1.ts`.

| ID | Criterion | Verification |
|---|---|---|
| C1-1 | Run record carries `requested`/`resolved`/`reported`, **populated** | Contract type in `packages/contracts`; **every successful run** has non-null `requested` and `resolved`. `reported` may be null only where the lane's evidence ceiling says so. Three fields persisted as permanent nulls satisfied the original wording |
| C1-2 | Substitution is visible **to a user**, not just to a test | Red spec: disabled model id on a non-`amr` agent → run completes → substitution appears as **visible text naming both models** in a non-test-only node, with an accessible name. A `data-testid` or a colour-only badge fails |
| C1-3 | Launch input is recorded separately and reconciled | The model written to Antigravity's settings file (or passed to any lane) is persisted as launch input and compared against `reported` when an echo exists. Self-consistent-but-false records — set all three before spawn, let the race run something else — passed every original criterion |
| C1-4 | Unverifiable lanes say so | Codex run → `unverified`, never `verified` — **and** `unverified` is not applied to a lane that does echo |
| C1-5 | Telemetry records what executed | `run.model` equals `resolved`, asserted by test |
| C1-6 | **Antigravity concurrency is controlled, not just labelled** | Two concurrent non-default-model `agy` runs either serialize (proven by test) or the second spawn hard-fails. Prove no cross-apply of settings. `unverified` alone does **not** satisfy this |
| C1-7 | Cost uses **resolved**-model pricing and survives real stream shapes | Multi-lane fixtures incl. cache-**inclusive** vs cache-**additive** conventions, plus retry, resume, and daemon-restart cases. Project total = sum of its runs. One recorded run with flat pricing cannot verify aggregation |
| C1-8 | Cost meter reaches both surfaces | Route + UI + `od` subcommand with `--json` over the same `/api/*` contract; W0's capability-manifest harness green |
| C1-9 | Unknown pricing is not faked | `pricing_version: 'unavailable'` renders as unknown, not `$0.00`; a mixed known/unknown project shows a partial total, not a confident one |
| C1-10 | Kimi tool failure **cannot** terminate as success | Property test: any non-zero tool-error field ⇒ run status is failed **and** the CLI exits non-zero. A warning beside a successful run is not a fix. Red spec against a recorded failing trace via `mocks/` |
| C1-11 | Picker/substitution states are accessible | axe clean on picker + substituted + unverified states; substitution reaches a screen reader. Routing trust is a UI claim, so a11y is in scope here, not deferred to W3 |
| C1-12 | `human:` NM-14 and NM-37C decisions recorded **before** implementation | Gemini-lane decision and deepseek PATH won't-fix written to `docs/decisions/`. Both are `blocked-on-founder`; neither had criteria in the first draft, so an agent would have silently invented the answer |
| C1-13 | C2-1a — newsletter default de-branded | `EntryShell.tsx:228` no longer defaults to `open-design.ai`; W2's brand verifier reads the landed tree to confirm |
| C1-14 | Parity + gates | `pnpm guard`, `pnpm typecheck` exit 0; no `skip`/`only`/`todo` added |

## Evals

Use the `mocks/` replay CLIs (PATH-overlay, anonymized Langfuse traces) to verify each lane's
event shapes round-trip without provider spend:
`export PATH="$PWD/mocks/bin:$PATH" OD_MOCKS_TRACE=<id> OD_MOCKS_NO_DELAY=1`.
Cover at minimum: claude (echoes), codex (no echo), a `json-event-stream` lane, and antigravity
(plain stream).

## Adversarial review

GPT-5.6 Sol. Focus: can the UI still display a model that did not run? Is `unverified` applied
correctly per lane, or does a lane get optimistically marked `verified`? Does the cost
aggregation double-count cache tokens (the provider conventions differ — inclusive vs additive)?
Does any doc claim verification the mechanism cannot deliver?
