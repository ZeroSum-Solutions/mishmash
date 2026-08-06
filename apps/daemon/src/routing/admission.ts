// L4 admission control (WR wave, P2 tranche -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.1 budget bullet, §3.2 L4).
//
// PURE by design, the same discipline decision.ts documents for itself:
// `evaluateAdmission` takes a loaded policy + a routing context + a
// candidate + an already-aggregated spend snapshot + an injected clock, and
// returns a typed per-candidate verdict. No I/O, no SQLite (telemetry.ts's
// `computeBuildSpendUsd`/`computeDaySpendUsd` own that), no `Date.now()`
// anywhere in this file (the caller injects `now`) -- every test in
// apps/daemon/tests/routing-admission.test.ts constructs its inputs in
// memory, no daemon boot, no SQLite, no network.
//
// Scope discipline (WR t6): pre-run admission evaluation + cost estimation +
// fan-out cap math + runaway-heuristics CONFIG round-trip only.
//   - No dispatch/spawn wiring (t9's job).
//   - No stream monitoring: `runawayLimitsFor` only publishes the CONFIG a
//     future live-stream monitor would read (context-growth alarm,
//     wall-clock ceiling, retry ceiling) -- actually killing a running
//     stream against those numbers is t9's job, never evaluated here.
//   - `decideRouting` (decision.ts) is the only caller that wires this
//     module into a real decision; the HTTP/CLI/UI surfaces read the result
//     off `RoutingDecision#admissionResults`, they never call
//     `evaluateAdmission` directly.
import {
  isFiniteNonNegativeInteger,
  type RoutingAdmissionCandidateResult,
  type RoutingAdmissionCandidateVerdict,
  type RoutingCandidate,
  type RoutingPolicyDocument,
  type RoutingPolicyPriceRow,
  type RoutingPolicyRunawayLimits,
} from '@open-design/contracts';

/** Thrown by every pure function in this module on a malformed input
 * (NaN/Infinity/negative/non-integer where a count is required, an invalid
 * Date, an empty-string identifier) -- "typed error, not admit": admission
 * control must never let a corrupted input silently pass as a permissive
 * verdict, mirroring `loadRoutingPolicy`'s and `recordRoutingTelemetry`'s
 * own fail-loud stance elsewhere in this package. Callers that already
 * validate their own inputs (e.g. `decideRouting`, which runs its own
 * `findInvalidCoreInputReason` gate before ever reaching admission) will
 * never observe this in practice. */
export class RoutingAdmissionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingAdmissionInputError';
  }
}

/** Pre-aggregated spend the caller already computed via
 * `apps/daemon/src/routing/telemetry.ts`'s `computeBuildSpendUsd`/
 * `computeDaySpendUsd` -- this module never queries telemetry itself, the
 * same "arrives as a plain argument" discipline `decideRouting` uses for
 * lane meters (see decision.ts's own doc comment on `DecideRoutingInput
 * #laneMeters`). */
export interface AdmissionSpendLookup {
  /** Already-spent total (estimated+exact mixed) for the current build, or
   * `0` when `buildId` is `null` (non-build-scoped work never fails the
   * per-build check -- see `evaluateAdmission`'s own comment on that). */
  buildSpentUsd: number;
  /** Already-spent total (estimated+exact mixed) for the current calendar
   * day, in whatever window the caller defines as "today." */
  daySpentUsd: number;
}

export interface EvaluateAdmissionInput {
  policy: RoutingPolicyDocument;
  /** The routing key's stage -- looked up in
   * `policy.budgetCeilings.perStageEstimatedCostUsd`. */
  stage: string;
  /** Carried through into denial reason text only; v1 has no per-taskClass
   * budget dimension of its own (every ceiling is keyed by stage/build/day),
   * so this does not otherwise affect the verdict. Kept on the input shape
   * so a denial reason can name which task class triggered it, and so a
   * later tranche can add a taskClass-scoped ceiling without a breaking
   * signature change. */
  taskClass: string | null;
  candidate: RoutingCandidate;
  /** Plan §3.1's "tokenizer-estimated context of the composed prompt" --
   * the ONLY token quantity known pre-run (see `estimatedRunCostUsd`'s own
   * comment on why output tokens are deliberately not estimated). */
  contextEstimateTokens: number;
  /** `null` for non-build-scoped work (general chat, WR-routing.md
   * Fallback B) -- the per-build cap check is skipped entirely for those,
   * since there is no build to charge against. */
  buildId: string | null;
  spendLookup: AdmissionSpendLookup;
  /** Injected clock (Sol-pattern testability requirement, mirrors this
   * task's own brief: "inject a clock parameter for testability, no
   * Date.now() inside the pure core") -- used only for Sonnet's dated price
   * row selection. */
  now: Date;
}

const USD_PER_MILLION_TOKENS_DIVISOR = 1_000_000;

/** Selects the price row that applies to `model` at instant `now`. Sonnet
 * carries two dated rows (plan §3.2 L2: "Both Sonnet prices carried with an
 * effective date") -- this picks the LATEST row whose `effectiveDate` is
 * `<= now`, falling back to the earliest row when `now` predates every
 * dated row (there is no "no price yet" state for a model the policy
 * prices at all). Every other priced model has at most one row in
 * `otherModelPriceRows`, matched by exact model string. Returns `null` when
 * no row exists at all for this model (e.g. Kimi K3, which plan §2 gives no
 * per-token price for -- "no price row is carried for it; do not invent
 * one" per routing-policy.json's own top-level notes) -- callers must treat
 * that as "cannot estimate," never fabricate a price. */
function findPriceRow(policy: RoutingPolicyDocument, model: string, now: Date): RoutingPolicyPriceRow | null {
  const datedRows = policy.sonnetPriceRows
    .filter((row) => row.model === model && row.effectiveDate !== undefined)
    .map((row) => ({ row, effectiveMs: Date.parse(row.effectiveDate!) }))
    .sort((a, b) => a.effectiveMs - b.effectiveMs);
  if (datedRows.length > 0) {
    const nowMs = now.getTime();
    const applicable = [...datedRows].reverse().find((entry) => entry.effectiveMs <= nowMs);
    return (applicable ?? datedRows[0]!).row;
  }
  return (policy.otherModelPriceRows ?? []).find((row) => row.model === model) ?? null;
}

/**
 * Estimates the pre-run cost of dispatching `candidate` with a composed
 * prompt of `contextEstimateTokens` tokens, using ONLY the policy's own
 * §2-sourced price anchors ("no invented prices"). Returns `null` when no
 * price row exists for `candidate.model` -- never a fabricated number.
 *
 * v1 estimator, disclosed limitation: this prices ONLY the known
 * input-context estimate. There is no pre-run output-token estimate
 * anywhere in the routing key (plan §3.1 defines the key's context term as
 * "tokenizer-estimated context of the composed prompt," which is an INPUT
 * quantity), and inventing an assumed output/input token ratio to cover the
 * gap would violate the "no invented prices" discipline just as surely as
 * inventing a price would. This is therefore a floor on the true cost, not
 * a ceiling-safe upper bound -- revisit once L5 telemetry
 * (`computeLaneMeters`'s token aggregates) has enough real per-stage
 * output-token distributions to source a ratio from instead of guessing
 * one.
 *
 * DeepSeek V4-Flash's row IS priced at cache-miss already (plan §2's
 * verified anchor, $0.14/$0.28) -- there is no separate cache-hit row to
 * mistakenly prefer, so no special-casing is needed here beyond the normal
 * row lookup; this comment exists only so that fact stays documented next
 * to the code that could have gotten it wrong.
 */
export function estimatedRunCostUsd(
  candidate: RoutingCandidate,
  contextEstimateTokens: number,
  policy: RoutingPolicyDocument,
  now: Date,
): number | null {
  if (!isFiniteNonNegativeInteger(contextEstimateTokens)) {
    throw new RoutingAdmissionInputError(
      `contextEstimateTokens must be a finite nonnegative integer, got ${contextEstimateTokens}`,
    );
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new RoutingAdmissionInputError('now must be a valid Date');
  }
  const priceRow = findPriceRow(policy, candidate.model, now);
  if (!priceRow) return null;

  let inputPerMillion = priceRow.inputPerMillion;
  // Gemini 3.1 Pro "doubling >200k" (plan §2) -- the only priced model with
  // thresholdedPricing in v1 content, but this branch is generic over any
  // future row that sets it.
  if (priceRow.thresholdedPricing && contextEstimateTokens > priceRow.thresholdedPricing.thresholdTokens) {
    inputPerMillion *= priceRow.thresholdedPricing.multiplier;
  }
  return (contextEstimateTokens / USD_PER_MILLION_TOKENS_DIVISOR) * inputPerMillion;
}

function assertValidEvaluateAdmissionInput(input: EvaluateAdmissionInput): void {
  if (typeof input.stage !== 'string' || input.stage.length === 0) {
    throw new RoutingAdmissionInputError('stage must be a nonempty string');
  }
  if (!isFiniteNonNegativeInteger(input.contextEstimateTokens)) {
    throw new RoutingAdmissionInputError(
      `contextEstimateTokens must be a finite nonnegative integer, got ${input.contextEstimateTokens}`,
    );
  }
  if (input.buildId !== null && (typeof input.buildId !== 'string' || input.buildId.length === 0)) {
    throw new RoutingAdmissionInputError(`buildId must be null or a nonempty string, got ${JSON.stringify(input.buildId)}`);
  }
  if (!Number.isFinite(input.spendLookup.buildSpentUsd) || input.spendLookup.buildSpentUsd < 0) {
    throw new RoutingAdmissionInputError(
      `spendLookup.buildSpentUsd must be a finite nonnegative number, got ${input.spendLookup.buildSpentUsd}`,
    );
  }
  if (!Number.isFinite(input.spendLookup.daySpentUsd) || input.spendLookup.daySpentUsd < 0) {
    throw new RoutingAdmissionInputError(
      `spendLookup.daySpentUsd must be a finite nonnegative number, got ${input.spendLookup.daySpentUsd}`,
    );
  }
  if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) {
    throw new RoutingAdmissionInputError('now must be a valid Date');
  }
}

/** `[0, 1)` headroom fraction (plan §3.1 "conservative headroom margin
 * against provider billing lag", Grok F15) -- an absent or out-of-range
 * policy value is treated as `0` (no margin), never as a reason to skip
 * evaluation; the fraction is a tunable safety knob, not a config
 * requirement. */
function headroomFractionOf(policy: RoutingPolicyDocument): number {
  const fraction = policy.budgetCeilings.headroomFraction;
  return typeof fraction === 'number' && Number.isFinite(fraction) && fraction >= 0 && fraction < 1 ? fraction : 0;
}

/** `spent + estimate <= cap * (1 - headroom)`. Shrinking the CAP by the
 * headroom fraction (rather than shrinking the remaining-after-spend
 * amount) keeps the check monotonic even once `spent` already exceeds
 * `cap` -- an already-over-budget build must never become MORE permissive
 * just because headroom is applied, which a "shrink the remainder" formula
 * would do once the remainder goes negative. */
function admitsUnderCap(capUsd: number, spentUsd: number, headroomFraction: number, estimatedCostUsd: number): boolean {
  const effectiveCapUsd = capUsd * (1 - headroomFraction);
  return spentUsd + estimatedCostUsd <= effectiveCapUsd;
}

function candidateIdentity(candidate: RoutingCandidate): Pick<RoutingAdmissionCandidateResult, 'runtimeId' | 'model' | 'lane'> {
  return { runtimeId: candidate.runtimeId, model: candidate.model, lane: candidate.lane };
}

function result(
  candidate: RoutingCandidate,
  verdict: RoutingAdmissionCandidateVerdict,
  estimatedCostUsd: number | null,
  reason: string,
): RoutingAdmissionCandidateResult {
  return { ...candidateIdentity(candidate), verdict, estimatedCostUsd, reason };
}

/**
 * Evaluates ONE candidate against budget admission control (plan §3.1: "L4
 * enforces: pre-run estimated-cost ceiling per stage... per-build and
 * per-day caps checked at every dispatch... metered-lane hard
 * kill-switch"). Check order (first hit wins, cheapest/most-fundamental
 * gate first):
 *
 *   1. Metered kill-switch -- transport-level, needs no cost estimate at
 *      all, so it is checked before cost estimation can possibly fail.
 *   2. Cost estimability -- `estimatedRunCostUsd` returning `null` (no
 *      price row) is `'not-evaluated'`, never a silent admit.
 *   3. Stage ceiling -- `policy.budgetCeilings.perStageEstimatedCostUsd`
 *      has no running "spent so far" term of its own: a stage ceiling is a
 *      PER-DISPATCH cap (this call's own estimate must fit under it), not a
 *      cumulative one, so `spentUsd` is always `0` here. A stage with NO
 *      entry in that record (WR-routing.md Fallback-C's granular ingestion
 *      sub-stages: classify/extract/distill/verify/register --
 *      routing-policy.json's own notes document this as intentional, not a
 *      gap) has no per-stage ceiling to check at all -- this is a POLICY
 *      DECISION, not `'not-evaluated'`: the check simply does not apply,
 *      exactly the way `decideRouting` already treats those sub-stages as
 *      routable despite carrying no budget-ceiling entry.
 *   4. Build cap -- skipped entirely when `buildId` is `null` (no build to
 *      charge against).
 *   5. Day cap -- always evaluated (every dispatch happens on some day).
 *
 * Falls through to `'admit'` only once every applicable check passes.
 */
export function evaluateAdmission(input: EvaluateAdmissionInput): RoutingAdmissionCandidateResult {
  assertValidEvaluateAdmissionInput(input);
  const { policy, stage, candidate, contextEstimateTokens, buildId, spendLookup, now } = input;

  if (policy.budgetCeilings.meteredKillSwitch && candidate.transport === 'metered-api') {
    const estimatedCostUsd = (() => {
      try {
        return estimatedRunCostUsd(candidate, contextEstimateTokens, policy, now);
      } catch {
        return null;
      }
    })();
    return result(
      candidate,
      'deny-metered-killswitch',
      estimatedCostUsd,
      `metered-lane kill-switch is ON (budgetCeilings.meteredKillSwitch); candidate "${candidate.model}" on lane "${candidate.lane}" uses the metered-api transport and is denied regardless of estimated cost.`,
    );
  }

  const estimatedCostUsd = estimatedRunCostUsd(candidate, contextEstimateTokens, policy, now);
  if (estimatedCostUsd === null) {
    return result(
      candidate,
      'not-evaluated',
      null,
      `no price row for model "${candidate.model}" in policy version ${policy.policyVersion} -- admission cannot be evaluated without a cost estimate; this is never treated as a silent admit.`,
    );
  }

  const headroomFraction = headroomFractionOf(policy);

  const stageCeilingUsd = policy.budgetCeilings.perStageEstimatedCostUsd[stage];
  if (stageCeilingUsd !== undefined && !admitsUnderCap(stageCeilingUsd, 0, headroomFraction, estimatedCostUsd)) {
    return result(
      candidate,
      'deny-stage-ceiling',
      estimatedCostUsd,
      `estimated cost $${estimatedCostUsd.toFixed(4)} exceeds stage "${stage}"'s $${stageCeilingUsd} ceiling after a ${(headroomFraction * 100).toFixed(0)}% headroom margin (effective cap $${(stageCeilingUsd * (1 - headroomFraction)).toFixed(4)}).`,
    );
  }

  if (buildId !== null && !admitsUnderCap(policy.budgetCeilings.perBuildCapUsd, spendLookup.buildSpentUsd, headroomFraction, estimatedCostUsd)) {
    return result(
      candidate,
      'deny-build-cap',
      estimatedCostUsd,
      `estimated cost $${estimatedCostUsd.toFixed(4)} would push build "${buildId}" past its $${policy.budgetCeilings.perBuildCapUsd} cap (already spent $${spendLookup.buildSpentUsd.toFixed(4)}, ${(headroomFraction * 100).toFixed(0)}% headroom margin applied).`,
    );
  }

  if (!admitsUnderCap(policy.budgetCeilings.perDayCapUsd, spendLookup.daySpentUsd, headroomFraction, estimatedCostUsd)) {
    return result(
      candidate,
      'deny-day-cap',
      estimatedCostUsd,
      `estimated cost $${estimatedCostUsd.toFixed(4)} would push today's spend past the $${policy.budgetCeilings.perDayCapUsd} per-day cap (already spent $${spendLookup.daySpentUsd.toFixed(4)}, ${(headroomFraction * 100).toFixed(0)}% headroom margin applied).`,
    );
  }

  return result(
    candidate,
    'admit',
    estimatedCostUsd,
    `estimated cost $${estimatedCostUsd.toFixed(4)} fits within every applicable stage/build/day ceiling (${(headroomFraction * 100).toFixed(0)}% headroom margin applied).`,
  );
}

/**
 * Variation fan-out cap by remaining build budget (Grok F24, plan §3.2 L4).
 * Pure arithmetic floor -- `0` for a nonpositive remaining budget OR a
 * nonpositive per-variation estimate (a variation that costs nothing, or
 * negative, is not a real estimate this function can size a fan-out
 * against). Throws on a non-finite input rather than returning a
 * nonsensical fan-out count.
 */
export function maxVariationFanout(remainingBuildBudgetUsd: number, perVariationEstimateUsd: number): number {
  if (!Number.isFinite(remainingBuildBudgetUsd) || !Number.isFinite(perVariationEstimateUsd)) {
    throw new RoutingAdmissionInputError(
      `maxVariationFanout requires finite numbers, got remainingBuildBudgetUsd=${remainingBuildBudgetUsd} perVariationEstimateUsd=${perVariationEstimateUsd}`,
    );
  }
  if (remainingBuildBudgetUsd <= 0 || perVariationEstimateUsd <= 0) return 0;
  return Math.floor(remainingBuildBudgetUsd / perVariationEstimateUsd);
}

/**
 * Stream-level runaway heuristics CONFIG accessor (plan §3.1/§3.2 L4:
 * "context-growth alarm, wall-clock ceiling, retry ceiling") -- CONFIG
 * ONLY. Falls back to `policy.budgetCeilings.runawayLimits['default']` when
 * `stage` has no stage-specific entry, and to `{}` (every heuristic
 * unset/inapplicable) when neither exists. Enforcing these against a LIVE
 * stream is t9's dispatch-wiring job; this function's entire contract is
 * "policy in, config out," verified by round-trip tests only.
 */
export function runawayLimitsFor(policy: RoutingPolicyDocument, stage: string): RoutingPolicyRunawayLimits {
  const perStage = policy.budgetCeilings.runawayLimits?.[stage];
  const fallback = policy.budgetCeilings.runawayLimits?.default;
  return perStage ?? fallback ?? {};
}
