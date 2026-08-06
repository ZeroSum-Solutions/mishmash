// Dispatch-time routing integration (WR wave, P2 tranche, t9 -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.1 binding point + §5's P2
// phase gate). Fix-round (Sol review, post-t9): overrides now resolve into a
// vetted policy candidate and pass through the SAME §15 hard-constraint/
// data-classification/admission filters a routed decision does (HIGH-2); a
// routed or override decision naming a DIFFERENT runtime than the caller
// actually selected is blocked, never silently ignored (HIGH-1); a
// dispatch-validation slug recheck runs for any candidate that carries
// `dispatchValidation.slugRecheckAtDispatch` (MED-8, honesty boundary
// documented on `isWellFormedModelSlug`); `reconcilePostRun` takes
// an explicit `terminalOutcome` so a cancellation/unclassified terminal
// state never reads as a clean success and clears a cooldown it should not
// (MED-6); `computeRoutingRates` separates real dispatch escalations from
// synthetic gate-cascade probe rows instead of summing both into one number
// (MED-7).
//
// This is the seam a chat dispatch calls BEFORE spawn (plan §3.1: "The
// router selects (runtime, model flag, effort, lane, prompt composition)
// before spawn"). Four responsibilities, matching this task's own brief:
//
//   1. `resolveDispatchRouting` -- decide whether the router (`decideRouting`,
//      t5), the caller's explicit override, or the runtime's own default
//      resolves the model/lane for this dispatch, per
//      docs/plans/waves/WR-routing.md's "Routing-key fallback (normative)"
//      table. A fail-closed/denied-admission/structurally-invalid decision
//      BLOCKS dispatch outright (plan §3.2 L2: "it never falls through") --
//      this module returns a typed, user-surfaceable error for that case
//      rather than silently degrading to a runtime default.
//   2. `recordDispatchIntent` -- writes the PRE-SPAWN telemetry row (routed
//      side only; observed side stays null until reconciliation).
//   3. `reconcilePostRun` -- fills the observed side once the run reports
//      back, computes routed-vs-observed divergence (t4's
//      `reconcileRoutedVsObserved`), and feeds observed failures into t7's
//      reliability cooldowns / non-redispatchable side-effect marking.
//   4. `computeRoutingRates` -- the escalation-rate + gate-pass-rate (by
//      stage/template) + per-lane-meter snapshot the P2 gate requires to be
//      "visible" (plan §5), surfaced via GET /api/routing/rates and
//      `od route [rates] --json` (routes/routing.ts, cli.ts).
//
// Governance note (t9, see this task's report for the exact
// governance-amendment entry): `packages/contracts/src/api/chat.ts`
// (`ChatRequest`) is OUTSIDE this wave's lease -- docs/plans/waves/
// WR-routing.md's "Lease" section grants only routing-policy.ts/
// routing-decision.ts/routing-telemetry.ts/index.ts under
// packages/contracts/src/api -- so a `routingOverride` field cannot be
// declared as first-class DTO surface on `ChatRequest` yet. This module's
// `DispatchChatRequest` is therefore its OWN shape (not `ChatRequest`
// itself); apps/daemon/src/server.ts's wiring reads `routingOverride`
// permissively off the raw chat body and validates it against
// `isRoutingOverrideRequest` (packages/contracts/src/api/routing-decision.ts)
// before it ever reaches this module. The same gap means a real /api/chat
// request today carries no `templateId`/`buildClass`/`taskClass` (ChatRequest
// has no such fields), so 'routed' mode is honestly unreachable through the
// live chat path until a future tranche adds them -- every real chat
// dispatch resolves 'runtime-default' (WR-routing.md Fallback B) or
// 'override' (when the caller supplies one), which is the CORRECT, honest
// behavior per the routing-key fallback table, not a bug.
import type Database from 'better-sqlite3';
import {
  emptyLaneMeter,
  type LaneMeter,
  type RoutingCandidate,
  type RoutingBlockedCode,
  type RoutingDataClassification,
  type RoutingDecision,
  type RoutingKey,
  type RoutingOverrideRequest,
  type RoutingPolicyDocument,
  type RoutingRatesByStage,
  type RoutingRatesResponse,
  type RoutingSideEffectKind,
  type StoredRoutingTelemetryRow,
  type TrackingRunFailureCategory,
} from '@open-design/contracts';
import { evaluateAdmission, type AdmissionSpendLookup } from './admission.js';
import {
  decideRouting,
  estimatePromptTokens,
  filterByDataClassification,
  filterByHardConstraints,
  findCandidateByModelAndLane,
} from './decision.js';
import { loadRoutingPolicy } from './policy.js';
import {
  clearOnSuccess,
  markRunSideEffects,
  recordObservedFailure,
  resolveCooldownConfig,
  computeCooldownStatuses,
} from './reliability.js';
import {
  computeBuildSpendUsd,
  computeDaySpendUsd,
  computeLaneMeters,
  computeStageAggregates,
  computeStageSpendUsd,
  ensureRoutingTelemetryTable,
  getRoutingTelemetryByRunId,
  reconcileRoutedVsObserved,
  recordRoutingTelemetry,
  type RoutingReconciliation,
} from './telemetry.js';

// ---------------------------------------------------------------------------
// resolveDispatchRouting
// ---------------------------------------------------------------------------

/** The wire shape for an explicit dispatch override -- see
 * `packages/contracts/src/api/routing-decision.ts`'s `RoutingOverrideRequest`
 * for the full "temporary home" rationale (Sol review MED-3). Re-exported
 * under this module's existing name so every pre-fix-round call site keeps
 * compiling unchanged. */
export type DispatchRoutingOverride = RoutingOverrideRequest;

/** What the caller would spawn absent any routing decision -- the
 * WR-routing.md Fallback B "runtime default" itself. `lane` has no natural
 * source outside the routing policy for a plain runtime default (no §2/§15
 * candidate was ever matched), so callers pass the sentinel lane name
 * `'runtime-default'` (see server.ts's wiring) rather than fabricating a
 * transport this module has no way to verify. `runtimeId` doubles (t9
 * fix-round, Sol review HIGH-1) as "the runtime that will ACTUALLY spawn
 * regardless of mode" -- a routed/override decision naming any OTHER
 * runtime is blocked, since this integration cannot swap the underlying
 * CLI/runtime this deep in dispatch (see `crossRuntimeBlockedResult`). */
export interface DispatchRuntimeDefault {
  runtimeId: string;
  model: string;
  lane: string;
}

export interface DispatchChatRequest {
  /** Explicit user/caller override -- when present (and both `model` and
   * `lane` are non-empty), it is resolved into a real policy candidate and
   * run through the SAME §15 hard-constraint / data-classification /
   * admission filters a routed decision goes through (t9 fix-round, Sol
   * review HIGH-2) -- it is a deliberate user CHOICE of candidate, not a
   * bypass of the rules that govern which candidates may ever dispatch. */
  routingOverride?: DispatchRoutingOverride | null;
  templateId?: string | null;
  buildClass?: string | null;
  /** Defaults to `'chat'` (WR-routing.md Fallback B's stage) when omitted. */
  stage?: string | null;
  /** The §2/§15 identity this dispatch matches. `null` means "no §2/§15
   * identity at all" (general chat, WR-routing.md Fallback B) -- this is
   * the ONE field that decides 'routed' vs 'runtime-default' below; every
   * other field only shapes what a 'routed' decision resolves to. */
  taskClass?: string | null;
  /** Fail-closed default applied when omitted: `'client-confidential'`
   * (plan §3.2 L2 -- an unresolved sensitivity class must never default to
   * the LEAST restrictive value), mirroring routes/routing.ts's own
   * preview-endpoint default. */
  sensitivityClass?: RoutingDataClassification | null;
  contextEstimateTokens?: number | null;
  /** Used to derive `contextEstimateTokens` via `estimatePromptTokens` only
   * when `contextEstimateTokens` itself is omitted. */
  promptText?: string | null;
  buildId?: string | null;
  designSystemId?: string | null;
  runtimeDefault: DispatchRuntimeDefault;
}

export interface DispatchProjectContext {
  projectId: string;
  buildId?: string | null;
}

export type DispatchMode = 'routed' | 'override' | 'runtime-default' | 'blocked';

/** The pre-spawn telemetry row's routed-side content -- everything
 * `recordDispatchIntent` needs to write a row via
 * `apps/daemon/src/routing/telemetry.ts`'s `recordRoutingTelemetry`. Never
 * populated for `mode: 'blocked'` -- a blocked dispatch never spawns, so
 * there is nothing to record as routed (recording it would misrepresent a
 * refusal as a routing decision). */
export interface RecordedDispatchIntent {
  projectId: string;
  buildId: string | null;
  stage: string;
  templateId: string | null;
  designSystem: string | null;
  routedModel: string;
  routedLane: string;
  sensitivityClass: RoutingDataClassification;
  policyVersion: number;
  mode: Exclude<DispatchMode, 'blocked'>;
}

/** Typed, user-surfaceable reason a dispatch was blocked (plan §3.2 L2:
 * "it never falls through"). The closed set is imported from
 * `@open-design/contracts` (`RoutingBlockedCode`) rather than declared here,
 * so the daemon's SSE/status error payload can carry it through a leased DTO
 * (`RoutingBlockedErrorDetail`, Sol review MED-4) without a second,
 * independently-drifting copy of the enum. `'routing-error'` covers every
 * structural case beyond the two the task brief names explicitly
 * (`fail-closed-stop`/`denied-admission`): an unknown stage or no matching
 * §2/§15 row, an override naming an unresolvable `(model, lane)` pair, a
 * routed/override decision naming a different runtime than the caller
 * selected, or a candidate failing its dispatch-time slug recheck. */
export interface DispatchBlockedError {
  code: RoutingBlockedCode;
  message: string;
  decision: RoutingDecision;
}

export interface ResolveDispatchRoutingResult {
  mode: DispatchMode;
  decision: RoutingDecision | null;
  /** 'override' mode only: what the router would have decided had the
   * caller not overridden it. `null` when no `taskClass` was supplied (there
   * is nothing to compare the override against) or `mode !== 'override'`. */
  wouldHaveBeenDecision?: RoutingDecision | null;
  recordedIntent: RecordedDispatchIntent | null;
  blocked?: DispatchBlockedError;
}

export interface ResolveDispatchRoutingInput {
  db: Database.Database;
  policy: RoutingPolicyDocument;
  chatRequest: DispatchChatRequest;
  projectContext: DispatchProjectContext;
  /** Injected clock -- this module never calls `Date.now()`/`new Date()`
   * itself for decision-making, mirroring decision.ts's own discipline. */
  clock: Date;
}

/** `[dayStartMs, dayEndMsExclusive)` for the UTC calendar day containing
 * `now` -- duplicated from routes/routing.ts's identical helper (that
 * module is not something this one may import from; the two definitions
 * are pinned to agree by `apps/daemon/tests/routing-cli-dispatch.test.ts`'s
 * own dedicated case, not by a shared import). */
function utcDayWindowMs(now: Date): [number, number] {
  const dayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return [dayStartMs, dayStartMs + 24 * 60 * 60 * 1000];
}

/** Builds the routing key + runs the real advisory decision engine
 * end-to-end (lane meters, admission spend lookup, cooldown snapshot) --
 * shared by the 'routed' path and the 'override' path's "would have been"
 * comparison. Returns `null` when `chatRequest.taskClass` is omitted: per
 * WR-routing.md Fallback B, general chat has no §2/§15 identity to route
 * against at all, so there is nothing for `decideRouting` to do (it would
 * only ever return a typed 'error' decision for a null taskClass) -- the
 * caller of this function is what decides that `null` means
 * 'runtime-default', not this function inventing an 'error' decision that
 * was never really an error.
 */
function computeKeyAndDecision(args: {
  db: Database.Database;
  policy: RoutingPolicyDocument;
  chatRequest: DispatchChatRequest;
  projectContext: DispatchProjectContext;
  clock: Date;
}): RoutingDecision | null {
  const { db, policy, chatRequest, projectContext, clock } = args;
  const taskClass = chatRequest.taskClass ?? null;
  if (taskClass === null) return null;

  const templateId = chatRequest.templateId ?? null;
  const buildClass = chatRequest.buildClass ?? null;
  const stage = chatRequest.stage ?? 'chat';
  const sensitivityClass: RoutingDataClassification = chatRequest.sensitivityClass ?? 'client-confidential';
  const contextEstimateTokens = resolveContextEstimateTokens(chatRequest);

  const laneMeters = computeLaneMeters(db);
  const laneMetersRecord = Object.fromEntries(laneMeters.map((m) => [m.lane, m.throttleEvents]));
  const key: RoutingKey =
    templateId !== null && buildClass !== null
      ? { templateId, buildClass, stage, contextEstimateTokens, laneMeters: laneMetersRecord }
      : { templateId, buildClass: null, stage, contextEstimateTokens, laneMeters: laneMetersRecord };

  const buildId = chatRequest.buildId ?? projectContext.buildId ?? null;
  const [dayStartMs, dayEndMs] = utcDayWindowMs(clock);

  return decideRouting({
    policy,
    key,
    sensitivityClass,
    laneMeters,
    taskClass,
    admission: {
      buildId,
      spendLookup: buildSpendLookup(db, policy, buildId, key.stage, dayStartMs, dayEndMs),
      now: clock,
    },
    cooldown: { statuses: computeCooldownStatuses(db, resolveCooldownConfig(policy), clock) },
  });
}

function resolveContextEstimateTokens(chatRequest: DispatchChatRequest): number {
  return (
    chatRequest.contextEstimateTokens ??
    (chatRequest.promptText ? estimatePromptTokens(chatRequest.promptText) : 0)
  );
}

function buildSpendLookup(
  db: Database.Database,
  policy: RoutingPolicyDocument,
  buildId: string | null,
  stage: string,
  dayStartMs: number,
  dayEndMs: number,
): AdmissionSpendLookup {
  return {
    stageSpentUsd: buildId !== null ? computeStageSpendUsd(db, buildId, stage).totalCostUsd : 0,
    buildSpentUsd: buildId !== null ? computeBuildSpendUsd(db, buildId).totalCostUsd : 0,
    daySpentUsd: computeDaySpendUsd(db, dayStartMs, dayEndMs).totalCostUsd,
  };
}

function buildDecisionFromCandidate(
  candidate: RoutingCandidate,
  policy: RoutingPolicyDocument,
  sensitivityClass: RoutingDataClassification,
  contextEstimateTokens: number,
  rationale: string,
  reasonMessage: string,
): RoutingDecision {
  return {
    runtimeId: candidate.runtimeId,
    modelFlag: candidate.model,
    effort: candidate.effort,
    lane: candidate.lane,
    rationale,
    admissionVerdict: 'admitted',
    policyVersion: policy.policyVersion,
    promptComposition: [],
    sensitivityClass,
    status: 'ok',
    reasons: [
      {
        step: 'selection',
        code: `override:${candidate.model}@${candidate.lane}`,
        message: reasonMessage,
      },
    ],
    contextEstimateTokens,
    demotions: [],
    admissionResults: [],
  };
}

function blockedResultFor(decision: RoutingDecision): ResolveDispatchRoutingResult {
  const code: RoutingBlockedCode =
    decision.status === 'error' ? 'routing-error' : (decision.status as 'fail-closed-stop' | 'denied-admission');
  return {
    mode: 'blocked',
    decision,
    recordedIntent: null,
    blocked: { code, message: decision.rationale, decision },
  };
}

/** Synthesizes a terminal decision-shaped record for a block that never went
 * through `decideRouting` (an unresolved override, a cross-runtime mismatch,
 * a failed slug recheck) -- mirrors `decideRouting`'s own terminal-decision
 * shape (`runtimeId: 'none'`, `lane: 'none'`) so every `DispatchBlockedError
 * #decision` in this module carries the same shape regardless of which check
 * produced it. */
function syntheticBlockedDecision(
  policy: RoutingPolicyDocument,
  sensitivityClass: RoutingDataClassification,
  contextEstimateTokens: number,
  status: 'fail-closed-stop' | 'denied-admission' | 'error',
  rationale: string,
): RoutingDecision {
  return {
    runtimeId: 'none',
    modelFlag: 'none',
    effort: 'inherit',
    lane: 'none',
    rationale,
    admissionVerdict: status === 'denied-admission' ? 'denied' : 'not-evaluated',
    policyVersion: policy.policyVersion,
    promptComposition: [],
    sensitivityClass,
    status,
    reasons: [{ step: status === 'denied-admission' ? 'admission-denied' : 'fail-closed', code: `override:${status}`, message: rationale }],
    contextEstimateTokens,
    demotions: [],
    admissionResults: [],
  };
}

/**
 * t9 fix-round (Sol review HIGH-2): resolves an override's `(model, lane)`
 * pair into a vetted `RoutingCandidate` and runs it through the SAME §15
 * hard-constraint filter, sensitivity-class allowlist, and budget admission
 * check a routed decision's candidate walk already goes through
 * (decision.ts's `decideRouting`) -- "a human override does not get to
 * violate a §15 hard rule." Cooldown is deliberately NOT checked here (out
 * of this fix's scope: an explicit override is a human choosing to dispatch
 * through a specific lane right now, which is a different judgment call than
 * the automatic-fallback reliability signal cooldowns exist to enforce).
 *
 * Returns either a vetted `RoutingCandidate` ready to become an 'override'
 * decision, or a `RoutingDecision`-shaped block explaining exactly which
 * check failed (constraint id, allowlist, or admission verdict named in the
 * message) -- never a silent pass-through of an unvalidated pair.
 */
function resolveAndValidateOverrideCandidate(args: {
  db: Database.Database;
  policy: RoutingPolicyDocument;
  override: DispatchRoutingOverride;
  taskClass: string | null;
  sensitivityClass: RoutingDataClassification;
  contextEstimateTokens: number;
  buildId: string | null;
  /** Sol review H2 residue: the SAME resolved stage `computeKeyAndDecision`
   * uses for the routed path's admission call (`chatRequest.stage ?? 'chat'`,
   * resolved once by the caller) -- previously this function hardcoded
   * `'chat'` internally regardless of what stage the request actually named,
   * so a non-chat-stage override was always priced/ceilinged against the
   * wrong stage's spend. */
  stage: string;
  clock: Date;
}): { ok: true; candidate: RoutingCandidate } | { ok: false; decision: RoutingDecision } {
  const { db, policy, override, taskClass, sensitivityClass, contextEstimateTokens, buildId, stage, clock } = args;

  const candidate = findCandidateByModelAndLane(policy, override.model, override.lane);
  if (!candidate) {
    return {
      ok: false,
      decision: syntheticBlockedDecision(
        policy,
        sensitivityClass,
        contextEstimateTokens,
        'error',
        `override names model "${override.model}" on lane "${override.lane}", which is not a recognized (model, lane) pair anywhere in policy version ${policy.policyVersion} -- cannot validate against §15 hard constraints or the "${sensitivityClass}" allowlist without a known candidate; refusing to dispatch an unverified pair.`,
      ),
    };
  }

  const { survivors: afterConstraints, removed: constraintRemovals } = filterByHardConstraints(
    [candidate],
    policy.hardConstraints,
  );
  if (afterConstraints.length === 0) {
    const reason = constraintRemovals[0]?.message ?? 'removed by a §15 hard constraint.';
    return {
      ok: false,
      decision: syntheticBlockedDecision(
        policy,
        sensitivityClass,
        contextEstimateTokens,
        'fail-closed-stop',
        `override to "${override.model}" on lane "${override.lane}" violates a §15 hard rule: ${reason}`,
      ),
    };
  }

  const classAllowlist = policy.dataClassificationAllowlists.find((a) => a.classification === sensitivityClass) ?? null;
  const { survivors: afterClass, removed: classRemovals } = filterByDataClassification(
    afterConstraints,
    classAllowlist,
    sensitivityClass,
  );
  if (afterClass.length === 0) {
    const reason = classRemovals[0]?.message ?? `not in the "${sensitivityClass}" allowlist.`;
    return {
      ok: false,
      decision: syntheticBlockedDecision(
        policy,
        sensitivityClass,
        contextEstimateTokens,
        'fail-closed-stop',
        `override to "${override.model}" on lane "${override.lane}" violates the "${sensitivityClass}" data-classification allowlist: ${reason}`,
      ),
    };
  }

  const [dayStartMs, dayEndMs] = utcDayWindowMs(clock);
  const admissionResult = evaluateAdmission({
    policy,
    stage,
    taskClass,
    candidate,
    contextEstimateTokens,
    buildId,
    spendLookup: buildSpendLookup(db, policy, buildId, stage, dayStartMs, dayEndMs),
    now: clock,
  });
  // Sol review HIGH-2, corrected by the H2 residue: "an over-budget override
  // is denied like any candidate" means EXACTLY the same admission gate the
  // routed path applies -- decision.ts's own candidate walk treats ANY
  // non-'admit' verdict, including 'not-evaluated', as "this candidate does
  // not clear admission" (it moves on to the next candidate, and pure
  // not-evaluated exhaustion still terminates the routed decision as
  // 'fail-closed-stop', never a silent admit). An override has no fallback
  // candidate to move on to, so the equivalent fail-closed behavior here is
  // to block outright: an unpriced override model does not get a pass a
  // routed candidate would never get either.
  if (admissionResult.verdict !== 'admit') {
    const isUnpriced = admissionResult.verdict === 'not-evaluated';
    return {
      ok: false,
      decision: syntheticBlockedDecision(
        policy,
        sensitivityClass,
        contextEstimateTokens,
        isUnpriced ? 'fail-closed-stop' : 'denied-admission',
        isUnpriced
          ? `override to "${override.model}" on lane "${override.lane}" could not be evaluated for budget admission (no usable price row for stage "${stage}"): ${admissionResult.reason} -- a fail-closed non-selection, never a silent admit.`
          : `override to "${override.model}" on lane "${override.lane}" was denied by budget admission control: ${admissionResult.reason}`,
      ),
    };
  }

  return { ok: true, candidate };
}

/** t9 fix-round (Sol review HIGH-1): a routed/override decision naming a
 * DIFFERENT runtime than the one the caller actually selected (`def.id` in
 * server.ts, threaded through as `chatRequest.runtimeDefault.runtimeId`)
 * cannot be honored -- swapping the underlying CLI/runtime this deep in
 * dispatch would require re-selecting the runtime def far earlier in the
 * chat-dispatch function (a baseline control-flow change this integration's
 * additive hook cannot make). Rather than silently proceeding with the
 * PRE-routing resolution (a real divergence between what was recorded as
 * "routed" and what actually ran), this blocks outright. */
function crossRuntimeBlockedResult(args: {
  policy: RoutingPolicyDocument;
  candidateRuntimeId: string;
  candidateModel: string;
  sensitivityClass: RoutingDataClassification;
  contextEstimateTokens: number;
  expectedRuntimeId: string;
}): ResolveDispatchRoutingResult {
  const { policy, candidateRuntimeId, candidateModel, sensitivityClass, contextEstimateTokens, expectedRuntimeId } = args;
  const rationale = `decision selected runtime "${candidateRuntimeId}" (model "${candidateModel}"), but this dispatch already selected runtime "${expectedRuntimeId}" -- cross-runtime substitution is not supported by this integration; refusing to dispatch a decision this request cannot honor.`;
  const blockedDecision = syntheticBlockedDecision(policy, sensitivityClass, contextEstimateTokens, 'error', rationale);
  return {
    mode: 'blocked',
    decision: blockedDecision,
    recordedIntent: null,
    blocked: { code: 'routing-error', message: rationale, decision: blockedDecision },
  };
}

/** t9 fix-round (Sol review MED-8): a candidate whose PRD-sourced
 * `dispatchValidation.slugRecheckAtDispatch` flag is set (e.g.
 * deepseek-v4-flash, "live-probed... must be rechecked at dispatch time")
 * gets a dispatch-time recheck before its decision is finalized.
 *
 * HONEST BOUNDARY: this module has no live provider API to probe against at
 * dispatch time (plan §3.1's binding point is a policy/telemetry layer, not
 * a network egress point) -- a real live-provider-catalog recheck is future
 * work this layer cannot honestly claim to do. A content-PRESENCE check
 * against the same policy object a candidate was just resolved FROM would
 * be tautological -- every candidate this module ever produces is sourced
 * from that exact policy, by construction, so "is this model named
 * somewhere in the policy I just found it in" can never fail. What this
 * CAN honestly check without a network call is slug FORMAT: the same
 * CLI-arg-safety shape `apps/daemon/src/runtimes/models.ts`'s
 * `sanitizeCustomModel` enforces for a raw user-typed model id (non-empty,
 * no whitespace/control characters, bounded length). This is real,
 * non-tautological signal for an OVERRIDE (whose model string is arbitrary
 * caller input) and a legitimate hygiene check for a policy-authored
 * candidate too.
 */
function isWellFormedModelSlug(model: string): boolean {
  return model.length > 0 && model.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(model);
}

/** Whether `decision` (a real `decideRouting` output) carries the
 * `dispatch-validation:<model>` reason `decideRouting` pushes for any
 * candidate flagged `dispatchValidation.slugRecheckAtDispatch` -- see
 * decision.ts's own comment on that reason ("the dispatch layer must
 * re-verify this slug before spawning; not evaluated here"). This module IS
 * that dispatch layer. */
function decisionNeedsSlugRecheck(decision: RoutingDecision): boolean {
  return decision.reasons.some(
    (r) => r.step === 'selection' && r.code === `dispatch-validation:${decision.modelFlag}`,
  );
}

/**
 * Decides HOW this dispatch resolves its model/lane before spawn (plan
 * §3.1's binding point), per WR-routing.md's "Routing-key fallback
 * (normative)" table:
 *
 *   - `chatRequest.routingOverride` present -> resolves it into a vetted
 *     policy candidate (HIGH-2) -> `'override'` on success; blocked on an
 *     unresolvable pair, a §15/allowlist/admission violation, a
 *     cross-runtime mismatch, or a failed slug recheck.
 *   - `chatRequest.taskClass` present -> runs the real decision engine.
 *     `'ok'` (and same-runtime, and slug-recheck-clean) -> `'routed'`.
 *     `'fail-closed-stop'` / `'denied-admission'` / `'error'` / a
 *     cross-runtime mismatch / a failed slug recheck -> `'blocked'` (plan
 *     §3.2 L2: never falls through).
 *   - Otherwise (no taskClass, no override) -> `'runtime-default'`
 *     (WR-routing.md Fallback B: general chat keeps the runtime's own
 *     default and records the decision as such).
 */
export function resolveDispatchRouting(input: ResolveDispatchRoutingInput): ResolveDispatchRoutingResult {
  const { db, policy, chatRequest, projectContext, clock } = input;
  const sensitivityClass: RoutingDataClassification = chatRequest.sensitivityClass ?? 'client-confidential';
  const stage = chatRequest.stage ?? 'chat';
  const buildId = chatRequest.buildId ?? projectContext.buildId ?? null;
  const templateId = chatRequest.templateId ?? null;
  const designSystem = chatRequest.designSystemId ?? null;

  const override = chatRequest.routingOverride ?? null;
  if (override && override.model.trim().length > 0 && override.lane.trim().length > 0) {
    const contextEstimateTokens = resolveContextEstimateTokens(chatRequest);
    const wouldHaveBeenDecision = computeKeyAndDecision({ db, policy, chatRequest, projectContext, clock });

    const resolved = resolveAndValidateOverrideCandidate({
      db,
      policy,
      override,
      taskClass: chatRequest.taskClass ?? null,
      sensitivityClass,
      contextEstimateTokens,
      buildId,
      stage,
      clock,
    });
    if (!resolved.ok) {
      return {
        mode: 'blocked',
        decision: resolved.decision,
        recordedIntent: null,
        blocked: {
          code: resolved.decision.status === 'error' ? 'routing-error' : (resolved.decision.status as 'fail-closed-stop' | 'denied-admission'),
          message: resolved.decision.rationale,
          decision: resolved.decision,
        },
      };
    }
    const { candidate } = resolved;

    if (candidate.runtimeId !== chatRequest.runtimeDefault.runtimeId) {
      return crossRuntimeBlockedResult({
        policy,
        candidateRuntimeId: candidate.runtimeId,
        candidateModel: candidate.model,
        sensitivityClass,
        contextEstimateTokens,
        expectedRuntimeId: chatRequest.runtimeDefault.runtimeId,
      });
    }

    if (candidate.dispatchValidation?.slugRecheckAtDispatch && !isWellFormedModelSlug(candidate.model)) {
      const rationale = `override candidate "${candidate.model}" carries dispatchValidation.slugRecheckAtDispatch and failed its dispatch-time slug-format recheck -- refusing to dispatch a malformed slug.`;
      const blockedDecision = syntheticBlockedDecision(policy, sensitivityClass, contextEstimateTokens, 'error', rationale);
      return { mode: 'blocked', decision: blockedDecision, recordedIntent: null, blocked: { code: 'routing-error', message: rationale, decision: blockedDecision } };
    }

    const reason = override.reason.trim().length > 0 ? override.reason.trim() : 'no reason given';
    const decision = buildDecisionFromCandidate(
      candidate,
      policy,
      sensitivityClass,
      contextEstimateTokens,
      `user override to ${candidate.model} on lane "${candidate.lane}" (vetted against §15/allowlist/admission): ${reason}.`,
      `dispatch overridden by explicit caller request, vetted through the SAME §15 hard-constraint/data-classification/admission filters a routed decision uses: ${reason}.`,
    );
    const recordedIntent: RecordedDispatchIntent = {
      projectId: projectContext.projectId,
      buildId,
      stage,
      templateId,
      designSystem,
      routedModel: candidate.model,
      routedLane: candidate.lane,
      sensitivityClass,
      policyVersion: policy.policyVersion,
      mode: 'override',
    };
    return { mode: 'override', decision, wouldHaveBeenDecision, recordedIntent };
  }

  const decision = computeKeyAndDecision({ db, policy, chatRequest, projectContext, clock });

  if (decision === null) {
    // WR-routing.md Fallback B: no §2/§15 identity to route against at all
    // -- keep the caller's own runtime default, record the decision as
    // 'runtime-default' (never as an 'error').
    const recordedIntent: RecordedDispatchIntent = {
      projectId: projectContext.projectId,
      buildId,
      stage,
      templateId,
      designSystem,
      routedModel: chatRequest.runtimeDefault.model,
      routedLane: chatRequest.runtimeDefault.lane,
      sensitivityClass,
      policyVersion: policy.policyVersion,
      mode: 'runtime-default',
    };
    return { mode: 'runtime-default', decision: null, recordedIntent };
  }

  if (decision.status === 'fail-closed-stop' || decision.status === 'denied-admission' || decision.status === 'error') {
    return blockedResultFor(decision);
  }

  // t9 fix-round (Sol review HIGH-1): a routed decision naming a runtime
  // other than the one this dispatch already selected cannot be honored --
  // block rather than silently keep the pre-routing resolution.
  if (decision.runtimeId !== chatRequest.runtimeDefault.runtimeId) {
    return crossRuntimeBlockedResult({
      policy,
      candidateRuntimeId: decision.runtimeId,
      candidateModel: decision.modelFlag,
      sensitivityClass: decision.sensitivityClass,
      contextEstimateTokens: decision.contextEstimateTokens,
      expectedRuntimeId: chatRequest.runtimeDefault.runtimeId,
    });
  }

  // t9 fix-round (Sol review MED-8): the slug recheck decision.ts flagged
  // but deliberately left unevaluated ("not evaluated here... the dispatch
  // layer must re-verify") -- this IS that layer.
  if (decisionNeedsSlugRecheck(decision) && !isWellFormedModelSlug(decision.modelFlag)) {
    const rationale = `routed candidate "${decision.modelFlag}" carries dispatchValidation.slugRecheckAtDispatch and failed its dispatch-time slug-format recheck -- refusing to dispatch a malformed slug.`;
    const blockedDecision = syntheticBlockedDecision(policy, decision.sensitivityClass, decision.contextEstimateTokens, 'error', rationale);
    return { mode: 'blocked', decision: blockedDecision, recordedIntent: null, blocked: { code: 'routing-error', message: rationale, decision: blockedDecision } };
  }

  const recordedIntent: RecordedDispatchIntent = {
    projectId: projectContext.projectId,
    buildId,
    stage,
    templateId,
    designSystem,
    routedModel: decision.modelFlag,
    routedLane: decision.lane,
    sensitivityClass: decision.sensitivityClass,
    policyVersion: decision.policyVersion,
    mode: 'routed',
  };
  return { mode: 'routed', decision, recordedIntent };
}

// ---------------------------------------------------------------------------
// recordDispatchIntent
// ---------------------------------------------------------------------------

/** Writes the PRE-SPAWN telemetry row skeleton -- the routed side of the
 * routed-vs-observed pair (plan §3.1/§3.2 L5). The observed side
 * (`observedModel`/`observedLane`/usage/gate outcomes) stays null/zeroed
 * until `reconcilePostRun` fills it once the run reports back. Never called
 * for a `'blocked'` `resolveDispatchRouting` result -- see
 * `RecordedDispatchIntent`'s own doc comment. */
export function recordDispatchIntent(
  db: Database.Database,
  runId: string,
  attempt: number,
  resolved: RecordedDispatchIntent,
): void {
  ensureRoutingTelemetryTable(db);
  const nowIso = new Date().toISOString();
  const row: StoredRoutingTelemetryRow = {
    runId,
    attempt,
    projectId: resolved.projectId,
    buildId: resolved.buildId,
    stage: resolved.stage,
    templateId: resolved.templateId,
    designSystem: resolved.designSystem,
    routedModel: resolved.routedModel,
    observedModel: null,
    routedLane: resolved.routedLane,
    observedLane: null,
    tokens: { input: 0, output: 0, cacheReadInput: 0 },
    cacheHits: 0,
    latencyMs: 0,
    costUsd: 0,
    costEstimated: true,
    gateOutcomes: {},
    escalated: false,
    policyVersion: resolved.policyVersion,
    createdAt: nowIso,
    recordedAt: nowIso,
  };
  recordRoutingTelemetry(db, row);
}

// ---------------------------------------------------------------------------
// reconcilePostRun
// ---------------------------------------------------------------------------

/** Failure categories treated as an observed-reliability signal worth
 * feeding into t7's cooldowns (plan §3.2 L1: "observed throttles... advance
 * the [fallback] chain"; plan §3.1: "spawn error/throttle categories"). A
 * narrower set than the full `TrackingRunFailureCategory` taxonomy on
 * purpose -- `auth`/`insufficient_balance`/`entitlement_required`/
 * `prompt_too_large`/`empty_output`/`tool_error`/`user_cancel` are real
 * failures, but none of them is evidence that THIS lane/runtime is
 * currently unreliable (an expired API key is a credential problem, not a
 * throttle); counting them toward a cooldown would demote a perfectly
 * healthy lane for an unrelated reason. */
const COOLDOWN_RECORDABLE_FAILURE_CATEGORIES: ReadonlySet<TrackingRunFailureCategory> = new Set([
  'rate_limit',
  'upstream_unavailable',
  'timeout',
  'process_exit',
  'model_unavailable',
]);

/** t9 fix-round (Sol review MED-6): the actual terminal state of the run/
 * attempt this reconciliation covers. `'succeeded'` is the ONLY outcome that
 * clears a cooldown -- a cancellation or an unclassified terminal state is
 * NOT evidence the lane/runtime is healthy, and treating it as a clean
 * success (the pre-fix-round behavior, keyed off `!failureCategory` alone)
 * could clear a cooldown a genuine, still-unresolved reliability problem
 * earned. `'failed'` is the only outcome that records a failure (still
 * gated on `failureCategory` being in `COOLDOWN_RECORDABLE_FAILURE_
 * CATEGORIES`). `'canceled'`/`'unknown'` touch neither -- there is no
 * reliability signal to draw from a run the user stopped or whose outcome
 * this caller cannot classify. */
export type ReconcileTerminalOutcome = 'succeeded' | 'failed' | 'canceled' | 'unknown';

export interface ReconcilePostRunObserved {
  observedModel: string | null;
  observedLane: string | null;
  tokens?: { input: number; output: number; cacheReadInput: number };
  cacheHits?: number;
  latencyMs?: number;
  costUsd?: number;
  costEstimated?: boolean;
  escalated?: boolean;
  /** See `ReconcileTerminalOutcome`'s own doc comment -- required, not
   * inferred from `failureCategory`, so a caller must make an explicit
   * claim about how the run/attempt actually ended. */
  terminalOutcome: ReconcileTerminalOutcome;
  /**
   * The runtime this run actually dispatched through -- required to
   * attribute an observed failure/success to the right (runtime, lane)
   * cooldown scope (t7's `recordObservedFailure`/`clearOnSuccess`, both
   * keyed on `(runtimeId, lane)`). Omitted means the cooldown side effect
   * is skipped entirely; the reconciliation itself still runs regardless.
   */
  runtimeId?: string | null;
  /** Only meaningful when `terminalOutcome === 'failed'`; ignored otherwise. */
  failureCategory?: TrackingRunFailureCategory | null;
  /**
   * Side-effect kinds this run performed (plan §3.1: db-migration/
   * git-push/network-call/supabase-change -> non-redispatchable). GOVERNANCE
   * NOTE (t9): the daemon has no existing classifier that maps a run's
   * activity onto this closed vocabulary today -- `apps/daemon/src/
   * runtimes/run-lifecycle-analytics.ts`'s side-effect ledger tracks
   * artifact/preview FILE PATHS, not external side-effect CATEGORIES, and
   * `apps/daemon/src/runtimes/**` is outside this wave's lease regardless.
   * This field exists so the wiring is real and testable the moment such a
   * classifier exists; server.ts's t9 wiring does not populate it yet (see
   * this task's report's governance-amendment entry).
   */
  sideEffectKinds?: RoutingSideEffectKind[];
  /** Injected clock, same discipline as `resolveDispatchRouting`'s. */
  now: Date;
}

export interface ReconcilePostRunResult {
  /** `null` when no pre-spawn intent row exists for `(runId, attempt)` --
   * e.g. a run that never went through `recordDispatchIntent` (predates
   * this wiring, or was blocked before ever recording an intent). Never
   * throws in this case: reconciliation is a best-effort enrichment step,
   * not a hard dependency a run's own success/failure should hinge on. */
  reconciliation: RoutingReconciliation | null;
  recordedFailure: boolean;
  clearedCooldown: boolean;
  markedSideEffectKinds: RoutingSideEffectKind[];
}

/** Fills the OBSERVED side of an already-recorded telemetry row once the run
 * reports back (plan §3.1: "usage arrives post-run, sometimes estimated"),
 * computes routed-vs-observed divergence, and feeds the two safety signals
 * plan §3.2 L1/§3.1 describe: observed spawn-error/throttle failures into
 * reliability cooldowns, and any performed external side effect into the
 * non-redispatchable marking. Also called at a RETRYABLE attempt's own
 * failure boundary (apps/daemon/src/server.ts's `finishWithRetryDecision`,
 * before a same-agent retry is scheduled), not only at the run's final
 * terminal state -- see `ReconcileTerminalOutcome`'s doc comment (Sol
 * review MED-5/MED-6) for why an attempt that fails and is then retried
 * must record its OWN failure before the retry's eventual success is ever
 * allowed to clear it. */
export function reconcilePostRun(
  db: Database.Database,
  runId: string,
  attempt: number,
  observed: ReconcilePostRunObserved,
): ReconcilePostRunResult {
  ensureRoutingTelemetryTable(db);
  const existing = getRoutingTelemetryByRunId(db, runId, attempt);
  if (!existing) {
    return { reconciliation: null, recordedFailure: false, clearedCooldown: false, markedSideEffectKinds: [] };
  }

  const merged: StoredRoutingTelemetryRow = {
    ...existing,
    observedModel: observed.observedModel ?? existing.observedModel,
    observedLane: observed.observedLane ?? existing.observedLane,
    tokens: observed.tokens ?? existing.tokens,
    cacheHits: observed.cacheHits ?? existing.cacheHits,
    latencyMs: observed.latencyMs ?? existing.latencyMs,
    costUsd: observed.costUsd ?? existing.costUsd,
    costEstimated: observed.costEstimated ?? existing.costEstimated,
    escalated: observed.escalated ?? existing.escalated,
    recordedAt: observed.now.toISOString(),
  };
  recordRoutingTelemetry(db, merged);

  const reconciliation = reconcileRoutedVsObserved(merged);

  let recordedFailure = false;
  let clearedCooldown = false;
  if (observed.runtimeId) {
    const lane = observed.observedLane ?? existing.routedLane;
    if (
      observed.terminalOutcome === 'failed' &&
      observed.failureCategory &&
      COOLDOWN_RECORDABLE_FAILURE_CATEGORIES.has(observed.failureCategory)
    ) {
      recordObservedFailure(db, observed.runtimeId, lane, observed.failureCategory, observed.now);
      recordedFailure = true;
    } else if (observed.terminalOutcome === 'succeeded') {
      clearOnSuccess(db, observed.runtimeId, lane, observed.now);
      clearedCooldown = true;
    }
    // 'canceled' / 'unknown' -> touch neither (Sol review MED-6): no
    // reliability signal to draw from a run the user stopped or whose
    // outcome this caller cannot classify.
  }

  let markedSideEffectKinds: RoutingSideEffectKind[] = [];
  if (observed.sideEffectKinds && observed.sideEffectKinds.length > 0) {
    markRunSideEffects(db, runId, observed.sideEffectKinds, observed.now);
    markedSideEffectKinds = observed.sideEffectKinds;
  }

  return { reconciliation, recordedFailure, clearedCooldown, markedSideEffectKinds };
}

// ---------------------------------------------------------------------------
// computeRoutingRates
// ---------------------------------------------------------------------------

/** Every lane named anywhere in the policy's `laneChains` (both as a
 * from-lane key and as a chain member) -- the "known lane universe" used to
 * seed `computeRoutingRates`'s `laneMeters` so it is non-empty even against
 * a brand-new daemon data dir with zero routed runs yet (CWR-P2-4 requires
 * a non-empty `laneMeters` object from a bare `od route --json`). */
function allKnownLanes(policy: RoutingPolicyDocument): string[] {
  const lanes = new Set<string>();
  for (const [lane, chain] of Object.entries(policy.laneChains)) {
    lanes.add(lane);
    for (const l of chain) lanes.add(l);
  }
  return [...lanes];
}

/** Sentinel stage `POST /api/routing/gates/run` writes for a STANDALONE gate
 * probe with no real dispatch behind it (routes/routing.ts's
 * `runIdSynthetic` path, `routedModel`/`routedLane: 'none'`). Never a real
 * dispatch stage -- `policy.stageVocabulary` does not (and must not) contain
 * it, so it safely partitions "real dispatch row" from "synthetic gate-
 * cascade probe row" without any additional column (Sol review MED-7). */
const GATE_CASCADE_PROBE_STAGE = 'gates-run';

function sumAggregateField(
  aggregates: ReturnType<typeof computeStageAggregates>,
  field: 'runs' | 'escalated' | 'gated' | 'gatedPass',
): number {
  return aggregates.reduce((sum, a) => sum + a[field], 0);
}

/** The escalation-rate + gate-pass-rate (overall AND by stage/template) +
 * per-lane-meter snapshot plan §5's P2 gate requires to be "visible" --
 * GET /api/routing/rates and `od route [rates] --json` both return this
 * exact shape (`RoutingRatesResponse`). Loads the policy itself (rather than
 * taking it as a parameter) so this function's signature matches this
 * task's brief exactly (`computeRoutingRates(db, window)`); every other
 * exported function in this module that also needs the policy receives it
 * as an argument instead, because THOSE call sites already have a
 * request-scoped policy load (server.ts resolves one policy per dispatch);
 * this one does not.
 *
 * t9 fix-round (Sol review MED-7): the top-level `totalRuns`/
 * `escalationRate`/`passRate` are computed ONLY over rows whose stage is
 * NOT `GATE_CASCADE_PROBE_STAGE` -- real dispatch rows only, never
 * conflated with the synthetic gate-cascade probe rows `POST
 * /api/routing/gates/run` writes when no real dispatch backs the call. The
 * gate-cascade rollup is reported separately via `gateCascadeRuns`/
 * `gateCascadeEscalationRate`/`gateCascadePassRate`. `byStage` is
 * unaffected (per-stage breakdown was never the conflation site -- a
 * `'gates-run'` bucket there is already correctly isolated by stage).
 */
export function computeRoutingRates(db: Database.Database, windowMs?: number): RoutingRatesResponse {
  const policy = loadRoutingPolicy();

  const laneMeters: Record<string, LaneMeter> = {};
  for (const lane of allKnownLanes(policy)) laneMeters[lane] = emptyLaneMeter(lane);
  for (const meter of computeLaneMeters(db, windowMs)) laneMeters[meter.lane] = meter;

  const stageAggs = computeStageAggregates(db, windowMs);
  const byStage: RoutingRatesByStage[] = stageAggs.map((a) => ({
    stage: a.stage,
    templateId: a.templateId,
    runs: a.runs,
    escalationRate: a.runs > 0 ? a.escalated / a.runs : 0,
    passRate: a.gated > 0 ? a.gatedPass / a.gated : 0,
  }));

  const dispatchAggs = stageAggs.filter((a) => a.stage !== GATE_CASCADE_PROBE_STAGE);
  const gateCascadeAggs = stageAggs.filter((a) => a.stage === GATE_CASCADE_PROBE_STAGE);

  const totalRuns = sumAggregateField(dispatchAggs, 'runs');
  const totalEscalated = sumAggregateField(dispatchAggs, 'escalated');
  const totalGated = sumAggregateField(dispatchAggs, 'gated');
  const totalGatedPass = sumAggregateField(dispatchAggs, 'gatedPass');

  const gateCascadeRuns = sumAggregateField(gateCascadeAggs, 'runs');
  const gateCascadeEscalated = sumAggregateField(gateCascadeAggs, 'escalated');
  const gateCascadeGated = sumAggregateField(gateCascadeAggs, 'gated');
  const gateCascadeGatedPass = sumAggregateField(gateCascadeAggs, 'gatedPass');

  return {
    windowMs: windowMs ?? null,
    totalRuns,
    escalationRate: totalRuns > 0 ? totalEscalated / totalRuns : 0,
    passRate: totalGated > 0 ? totalGatedPass / totalGated : 0,
    gateCascadeRuns,
    gateCascadeEscalationRate: gateCascadeRuns > 0 ? gateCascadeEscalated / gateCascadeRuns : 0,
    gateCascadePassRate: gateCascadeGated > 0 ? gateCascadeGatedPass / gateCascadeGated : 0,
    laneMeters,
    byStage,
  };
}
