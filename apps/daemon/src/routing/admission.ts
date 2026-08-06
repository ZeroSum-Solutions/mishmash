// L4 admission control (WR wave, P2 tranche -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.1 budget bullet, §3.2 L4).
//
// PURE by design, the same discipline decision.ts documents for itself:
// `evaluateAdmission` takes a loaded policy + a routing context + a
// candidate + an already-aggregated spend snapshot + an injected clock, and
// returns a typed per-candidate verdict. No I/O, no SQLite (telemetry.ts's
// `computeStageSpendUsd`/`computeBuildSpendUsd`/`computeDaySpendUsd` own
// that), no `Date.now()` anywhere in this file (the caller injects `now`)
// -- every test in apps/daemon/tests/routing-admission.test.ts constructs
// its inputs in memory, no daemon boot, no SQLite, no network.
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
//
// Sol fix-round (post-t6 adversarial review): HIGH-1 (cost estimation
// priced input tokens only -- output rates run 2-6x input, so this was a
// systematic underestimate), HIGH-2 (the stage-ceiling check ignored
// already-recorded stage spend, comparing the estimate against the raw cap
// instead of "spend so far + estimate"), and LOW-7 (a clock that predates
// every dated price row silently fell back to the earliest row instead of
// admitting the price is genuinely unknown at that instant) are fixed
// below; see each finding's own comment at its fix site.
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
 * `apps/daemon/src/routing/telemetry.ts`'s `computeStageSpendUsd`/
 * `computeBuildSpendUsd`/`computeDaySpendUsd` -- this module never queries
 * telemetry itself, the same "arrives as a plain argument" discipline
 * `decideRouting` uses for lane meters (see decision.ts's own doc comment
 * on `DecideRoutingInput#laneMeters`). */
export interface AdmissionSpendLookup {
  /**
   * Sol review HIGH-2: already-spent total (estimated+exact mixed) for
   * THIS build's THIS stage, via `computeStageSpendUsd` -- the literal
   * "lane meter + estimate" comparison plan §3.1 asks for at the
   * stage-ceiling check, not a hardcoded `0`. `0` when `buildId` is `null`
   * (non-build-scoped work has no stage-spend history to look up).
   */
  stageSpentUsd: number;
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
   * `policy.budgetCeilings.perStageEstimatedCostUsd`, and the scope
   * `spendLookup.stageSpentUsd` is assumed to already be filtered to. */
  stage: string;
  /** Passed through into `estimatedRunCostUsd`'s output-token-bound
   * resolution (a taskClass may override `budgetCeilings.outputTokenBound
   * .default`) and into denial reason text. `null` for work with no §2/§15
   * task-class identity (general chat). */
  taskClass: string | null;
  candidate: RoutingCandidate;
  /** Plan §3.1's "tokenizer-estimated context of the composed prompt" --
   * the only PRE-RUN input-token count available; see
   * `estimatedRunCostUsd`'s own comment on how the output side is
   * estimated from this same number. */
  contextEstimateTokens: number;
  /** `null` for non-build-scoped work (general chat, WR-routing.md
   * Fallback B) -- the per-stage and per-build cap checks are both skipped
   * entirely for those, since there is no build to charge stage/build
   * spend against. */
  buildId: string | null;
  spendLookup: AdmissionSpendLookup;
  /** Injected clock (Sol-pattern testability requirement, mirrors this
   * task's own brief: "inject a clock parameter for testability, no
   * Date.now() inside the pure core") -- used only for Sonnet's dated price
   * row selection. */
  now: Date;
}

const USD_PER_MILLION_TOKENS_DIVISOR = 1_000_000;

/**
 * Sol review HIGH-1: the conservative default output-token bound used when
 * `policy.budgetCeilings.outputTokenBound` is entirely absent (an older or
 * hand-authored policy document that predates this field) -- chosen to
 * roughly match the largest single-response output ceiling most of this
 * policy's priced runtimes advertise. NEVER used when the policy DOES
 * configure `outputTokenBound`; that config always wins (see
 * `resolveOutputTokenBound`).
 */
const DEFAULT_OUTPUT_TOKEN_BOUND = 32_000;

/**
 * Sol review HIGH-1: `min(contextEstimateTokens, bound)`, where `bound` is
 * `outputTokenBound.perTaskClass[taskClass]` when set, else
 * `outputTokenBound.default`, else the hardcoded
 * `DEFAULT_OUTPUT_TOKEN_BOUND` when the policy configures no
 * `outputTokenBound` at all. See `RoutingPolicyOutputTokenBound`'s own doc
 * comment (packages/contracts/src/api/routing-policy.ts) for why this is a
 * bound rather than a guessed output/input ratio.
 */
function resolveOutputTokenEstimate(policy: RoutingPolicyDocument, taskClass: string | null, contextEstimateTokens: number): number {
  const config = policy.budgetCeilings.outputTokenBound;
  const bound = (taskClass !== null ? config?.perTaskClass?.[taskClass] : undefined) ?? config?.default ?? DEFAULT_OUTPUT_TOKEN_BOUND;
  return Math.min(contextEstimateTokens, bound);
}

/**
 * Selects the price row that applies to `model` at instant `now`. Sonnet
 * carries two dated rows (plan §3.2 L2: "Both Sonnet prices carried with an
 * effective date") -- this picks the LATEST row whose `effectiveDate` is
 * `<= now`.
 *
 * Sol review LOW-7 (fix-round): a clock that predates EVERY dated row for
 * a model used to fall back to the earliest row, silently assuming that
 * row's price applied retroactively. That is a fabricated price for an
 * instant this policy never actually priced -- returns `null` instead
 * (surfaces as `'not-evaluated'`, the same honest "cannot estimate" outcome
 * as no price row existing at all), so admission never guesses a rate for
 * a moment before the policy's own pricing history begins.
 *
 * Every other priced model has at most one row in `otherModelPriceRows`,
 * matched by exact model string (no dated-row history to predate). Returns
 * `null` when no row exists at all for this model (e.g. Kimi K3, which
 * plan §2 gives no per-token price for -- "no price row is carried for it;
 * do not invent one" per routing-policy.json's own top-level notes) --
 * callers must treat that as "cannot estimate," never fabricate a price.
 */
function findPriceRow(policy: RoutingPolicyDocument, model: string, now: Date): RoutingPolicyPriceRow | null {
  const datedRows = policy.sonnetPriceRows
    .filter((row) => row.model === model && row.effectiveDate !== undefined)
    .map((row) => ({ row, effectiveMs: Date.parse(row.effectiveDate!) }))
    .sort((a, b) => a.effectiveMs - b.effectiveMs);
  if (datedRows.length > 0) {
    const nowMs = now.getTime();
    const applicable = [...datedRows].reverse().find((entry) => entry.effectiveMs <= nowMs);
    return applicable ? applicable.row : null;
  }
  return (policy.otherModelPriceRows ?? []).find((row) => row.model === model) ?? null;
}

/**
 * Estimates the pre-run cost of dispatching `candidate` with a composed
 * prompt of `contextEstimateTokens` input tokens, using ONLY the policy's
 * own §2-sourced price anchors ("no invented prices"). Returns `null` when
 * no usable price row exists for `candidate.model` at `now` -- never a
 * fabricated number.
 *
 * Sol review HIGH-1 (fix-round): the original version of this function
 * priced ONLY the input-context estimate. Every priced model's output rate
 * runs 2-6x its input rate, so that was a systematic underestimate, not a
 * conservative floor -- a candidate whose primary cost driver is response
 * length could sail under a stage ceiling that its real (input+output) cost
 * would have blown. There is still no real pre-run OUTPUT-token count
 * anywhere in the routing key (plan §3.1's context term is an INPUT
 * quantity), so this bounds rather than invents one:
 * `resolveOutputTokenEstimate` caps the assumed output at
 * `min(contextEstimateTokens, bound)`, `bound` being an operator-tunable
 * policy value (see `RoutingPolicyOutputTokenBound`), not a guessed
 * output/input ratio -- inventing a RATIO would be exactly as much a
 * fabrication as inventing a price.
 *
 * `thresholdedPricing` (Gemini "doubling >200k", plan §2) multiplies BOTH
 * the input and output rate once `contextEstimateTokens` exceeds the
 * threshold -- Gemini's real long-context surcharge applies symmetrically,
 * and now that output is priced at all, applying the multiplier to input
 * only would have silently exempted the (now-priced) output half from the
 * same surcharge. The boundary is EXCLUSIVE: exactly `thresholdTokens`
 * prices at the base rate; only STRICTLY GREATER triggers the multiplier.
 *
 * A price row missing a finite `outputPerMillion` (defense in depth --
 * `isRoutingPolicyDocument` already requires one on every row that loads)
 * is treated the same as no row at all: `null`, never priced at $0.
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
  taskClass: string | null = null,
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
  if (!Number.isFinite(priceRow.outputPerMillion) || !Number.isFinite(priceRow.inputPerMillion)) return null;

  let inputPerMillion = priceRow.inputPerMillion;
  let outputPerMillion = priceRow.outputPerMillion;
  if (priceRow.thresholdedPricing && contextEstimateTokens > priceRow.thresholdedPricing.thresholdTokens) {
    inputPerMillion *= priceRow.thresholdedPricing.multiplier;
    outputPerMillion *= priceRow.thresholdedPricing.multiplier;
  }

  const outputTokens = resolveOutputTokenEstimate(policy, taskClass, contextEstimateTokens);
  const inputCostUsd = (contextEstimateTokens / USD_PER_MILLION_TOKENS_DIVISOR) * inputPerMillion;
  const outputCostUsd = (outputTokens / USD_PER_MILLION_TOKENS_DIVISOR) * outputPerMillion;
  return inputCostUsd + outputCostUsd;
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
  if (!Number.isFinite(input.spendLookup.stageSpentUsd) || input.spendLookup.stageSpentUsd < 0) {
    throw new RoutingAdmissionInputError(
      `spendLookup.stageSpentUsd must be a finite nonnegative number, got ${input.spendLookup.stageSpentUsd}`,
    );
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
 *   1. Cost estimability -- `estimatedRunCostUsd` returning `null` (no
 *      usable price row) is `'not-evaluated'`, never a silent admit.
 *      Checked FIRST (Sol review MED-5, fix-round): every OTHER verdict
 *      this function returns must carry a real, non-null cost figure
 *      (`RoutingAdmissionCandidateResult`'s own invariant), so resolving
 *      cost-estimability up front means every later branch can rely on
 *      `estimatedCostUsd` being a real number without a per-branch
 *      best-effort fallback.
 *   2. Metered kill-switch -- transport-level, doesn't need cost
 *      information to fire, but runs after step 1 purely so it always has
 *      a real cost figure to attach to its result too.
 *   3. Stage ceiling -- compared against `spendLookup.stageSpentUsd + this
 *      estimate` (Sol review HIGH-2, fix-round: previously compared the
 *      estimate alone against the raw cap, ignoring spend already recorded
 *      against this build's this stage -- plan §3.1's literal "lane meter
 *      + estimate" comparison). A stage with NO entry in
 *      `perStageEstimatedCostUsd` (WR-routing.md Fallback-C's granular
 *      ingestion sub-stages: classify/extract/distill/verify/register --
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
  const { policy, stage, taskClass, candidate, contextEstimateTokens, buildId, spendLookup, now } = input;

  const estimatedCostUsd = estimatedRunCostUsd(candidate, contextEstimateTokens, policy, now, taskClass);
  if (estimatedCostUsd === null) {
    return result(
      candidate,
      'not-evaluated',
      null,
      `no price row for model "${candidate.model}" in policy version ${policy.policyVersion} -- admission cannot be evaluated without a cost estimate; this is never treated as a silent admit.`,
    );
  }

  if (policy.budgetCeilings.meteredKillSwitch && candidate.transport === 'metered-api') {
    return result(
      candidate,
      'deny-metered-killswitch',
      estimatedCostUsd,
      `metered-lane kill-switch is ON (budgetCeilings.meteredKillSwitch); candidate "${candidate.model}" on lane "${candidate.lane}" uses the metered-api transport and is denied regardless of estimated cost.`,
    );
  }

  const headroomFraction = headroomFractionOf(policy);

  const stageCeilingUsd = policy.budgetCeilings.perStageEstimatedCostUsd[stage];
  if (stageCeilingUsd !== undefined && !admitsUnderCap(stageCeilingUsd, spendLookup.stageSpentUsd, headroomFraction, estimatedCostUsd)) {
    return result(
      candidate,
      'deny-stage-ceiling',
      estimatedCostUsd,
      `estimated cost $${estimatedCostUsd.toFixed(4)} added to $${spendLookup.stageSpentUsd.toFixed(4)} already spent on stage "${stage}" exceeds its $${stageCeilingUsd} ceiling after a ${(headroomFraction * 100).toFixed(0)}% headroom margin (effective cap $${(stageCeilingUsd * (1 - headroomFraction)).toFixed(4)}).`,
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
