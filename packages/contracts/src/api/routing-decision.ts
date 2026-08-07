// Routing decision + routing-key contracts (WR wave, P0 skeleton -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.1). The routing-key
// fallback shapes below are frozen normatively in
// docs/plans/waves/WR-routing.md's "Routing-key fallback (normative)"
// section; this file only expresses that shape as a type, it does not
// implement the fallback classification logic itself -- that is dispatch
// logic and lands in a later WR tranche (P2).
import {
  isFiniteNonNegativeInteger,
  isPlainObject,
  type RoutingDataClassification,
  type RoutingEffort,
} from './routing-policy.js';

/**
 * key = (templateId | NONE) x (buildClass | NONE) x stage x
 * tokenizer-estimated context of the composed prompt x lane meters
 *
 * Modeled as a discriminated union on `buildClass` rather than two
 * independently-nullable fields: WR-routing.md's frozen fallback table
 * defines exactly four shapes, and every one of them has `buildClass ===
 * null` UNLESS `templateId` is also present (a `ClientWebsiteBrief`-backed
 * build always carries both). The one combination the table never
 * defines -- `buildClass` present with no owning `templateId` -- is
 * structurally unrepresentable here, not just guarded against at runtime.
 */
export interface RoutingKeyWithBuildClass {
  /** Primary shape: a ClientWebsiteBrief-backed build. */
  templateId: string;
  buildClass: string;
  /** Plan §3.3 stage vocabulary; never null. */
  stage: string;
  /** Tokenizer-estimated context of the composed prompt -- plan §3.1: "not
   * file-plan size." */
  contextEstimateTokens: number;
  /** Lane meter snapshot consulted at decision time, keyed by lane id. */
  laneMeters: Record<string, number>;
}

export interface RoutingKeyWithoutBuildClass {
  /**
   * Fallback A (a template selected outside a brief) when non-null;
   * fallback B (general chat) when null; fallback C (non-brief, non-web
   * work -- ingestion/mobile) covers both, since its templateId is "NONE
   * (or a pipeline-internal id, never the web template enum)" per
   * WR-routing.md -- that "never the web template enum" distinction is a
   * provenance rule for whoever constructs the key, not a shape this type
   * can express.
   */
  templateId: string | null;
  buildClass: null;
  /** For non-web work (ingestion, mobile) this is that pipeline's own stage
   * vocabulary, not the web build stage list -- see WR-routing.md's
   * Fallback C. */
  stage: string;
  contextEstimateTokens: number;
  laneMeters: Record<string, number>;
}

export type RoutingKey = RoutingKeyWithBuildClass | RoutingKeyWithoutBuildClass;

/**
 * Coarse summary of `RoutingDecision#admissionResults` (t6, plan §3.2 L2/L4):
 * `'admitted'` once the selected candidate itself passed admission,
 * `'denied'` once every candidate that reached admission evaluation was
 * denied -- usually paired with `status: 'denied-admission'`, but ALSO set
 * when `status: 'fail-closed-stop'` resulted from a MIX of throttled and
 * admission-denied candidates (Sol review MED-3: the terminal status
 * conservatively reports throttling as the more severe cause, but
 * `admissionVerdict` still honestly reflects that every candidate which DID
 * reach admission was denied). `'not-evaluated'` when admission was never
 * engaged for this call, or every candidate was thrown out by throttling
 * before any of them ever reached admission (see `admissionResults`'s own
 * doc comment) -- `decideRouting`'s optional `admission` input controls
 * whether admission is engaged at all. `'blocked-on-founder'` is reserved
 * for a human-escalation outcome no current caller produces yet.
 */
export type RoutingAdmissionVerdict = 'admitted' | 'denied' | 'blocked-on-founder' | 'not-evaluated';

/**
 * Bug fix (t5): this array used to omit `'inherit'`, even though
 * `RoutingEffort` (imported above from routing-policy.ts) has always
 * included it and the vast majority of v1 policy candidates (CWR-P1-1) carry
 * exactly that value. A real decision built from `decideRouting`
 * (apps/daemon/src/routing/decision.ts) passes a candidate's own `effort`
 * straight through -- "candidate's effort or 'inherit' passthrough" per this
 * task's brief -- so a decision honestly reporting `'inherit'` must not fail
 * its own shape guard. Harmless at P0 because the stub decision always used
 * a concrete value ('medium'/'low'); load-bearing now that real candidates
 * flow through.
 */
const ROUTING_EFFORTS: readonly RoutingEffort[] = ['low', 'medium', 'high', 'xhigh', 'inherit'];

const ROUTING_ADMISSION_VERDICTS_ALL: readonly RoutingAdmissionVerdict[] = [
  'admitted',
  'denied',
  'blocked-on-founder',
  'not-evaluated',
];

/**
 * One evaluated step of the decision algorithm (apps/daemon/src/routing/
 * decision.ts) -- the "why this model" surface (plan §3.1). `code` is an
 * optional machine-checkable narrowing id (a hard constraint's `id`, a data
 * classification, `unknown-stage:<value>`, etc.) so a test or a UI can key
 * off WHICH rule fired without parsing `message` prose; `message` is always
 * a complete human sentence on its own.
 */
export type RoutingDecisionReasonStep =
  | 'stage-validation'
  | 'model-table-match'
  | 'program-assignment'
  | 'hard-constraint-filter'
  | 'data-classification-filter'
  | 'lane-throttle-demotion'
  /** t7 (plan §3.2 L1 reliability): a candidate demoted because its
   * runtime OR lane is in an active persisted cooldown (apps/daemon/src/
   * routing/reliability.ts) -- kept distinct from `lane-throttle-demotion`
   * (an in-window LaneMeter observation) because the two are different
   * signal sources with different lifetimes, per this task's own brief
   * ("cooldown and throttle reasons distinct"). */
  | 'lane-cooldown-demotion'
  | 'admission-denied'
  | 'fail-closed'
  | 'selection'
  | 'error';

const ROUTING_DECISION_REASON_STEPS: readonly RoutingDecisionReasonStep[] = [
  'stage-validation',
  'model-table-match',
  'program-assignment',
  'hard-constraint-filter',
  'data-classification-filter',
  'lane-throttle-demotion',
  'lane-cooldown-demotion',
  'admission-denied',
  'fail-closed',
  'selection',
  'error',
];

export interface RoutingDecisionReason {
  step: RoutingDecisionReasonStep;
  message: string;
  code?: string;
}

function isRoutingDecisionReason(value: unknown): value is RoutingDecisionReason {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.step === 'string' &&
    (ROUTING_DECISION_REASON_STEPS as readonly string[]).includes(value.step) &&
    typeof value.message === 'string' &&
    (value.code === undefined || typeof value.code === 'string')
  );
}

/** One lane-availability demotion (plan §3.1 L1: "observed throttles...
 * advance the chain"). `toLane` is null when demotion exhausted the
 * candidate list with nowhere left to advance to (the fail-closed case). */
export interface RoutingLaneDemotion {
  fromLane: string;
  toLane: string | null;
  reason: string;
}

function isRoutingLaneDemotion(value: unknown): value is RoutingLaneDemotion {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.fromLane === 'string' &&
    (value.toLane === null || typeof value.toLane === 'string') &&
    typeof value.reason === 'string'
  );
}

/**
 * First-class decision outcome (plan §3.2 L2's fail-closed requirement):
 * `'ok'` -- a real candidate was selected. `'fail-closed-stop'` -- filtering
 * and/or lane-throttle demotion exhausted every candidate for the
 * sensitivity class; the run stops and surfaces to a human, it never falls
 * through to an out-of-class candidate. `'error'` -- a structural problem
 * with the routing key itself (an unknown stage, or no §2/§15 match at all)
 * that has nothing to do with lane availability or data classification.
 * `'denied-admission'` (t6, plan §3.1/§3.2 L4 admission control): every
 * candidate that survived hard-constraint/classification filtering AND
 * lane-throttle demotion was still denied by budget admission control (a
 * stage/build/day ceiling or the metered kill-switch) -- distinct from
 * `'fail-closed-stop'`, which is reserved for classification/throttle
 * exhaustion where admission was never even reached for any candidate (see
 * `decideRouting`'s own doc comment on why `'fail-closed-stop'` keeps
 * precedence there).
 */
export type RoutingDecisionStatus = 'ok' | 'fail-closed-stop' | 'error' | 'denied-admission';

const ROUTING_DECISION_STATUSES: readonly RoutingDecisionStatus[] = ['ok', 'fail-closed-stop', 'error', 'denied-admission'];

/**
 * Granular per-candidate admission-control outcome (t6, plan §3.1/§3.2 L4)
 * -- distinct from the coarse `RoutingAdmissionVerdict` below (which is
 * `RoutingDecision#admissionVerdict`'s admitted/denied/blocked-on-founder/
 * not-evaluated summary): this is what
 * `apps/daemon/src/routing/admission.ts`'s pure `evaluateAdmission` actually
 * returns for ONE candidate, naming exactly which ceiling denied it (or that
 * cost admission could not be evaluated at all, e.g. no price row for the
 * candidate's model -- "never a silent admit").
 */
export type RoutingAdmissionCandidateVerdict =
  | 'admit'
  | 'deny-stage-ceiling'
  | 'deny-build-cap'
  | 'deny-day-cap'
  | 'deny-metered-killswitch'
  | 'not-evaluated';

const ROUTING_ADMISSION_CANDIDATE_VERDICTS: readonly RoutingAdmissionCandidateVerdict[] = [
  'admit',
  'deny-stage-ceiling',
  'deny-build-cap',
  'deny-day-cap',
  'deny-metered-killswitch',
  'not-evaluated',
];

/** One evaluated candidate's admission outcome -- carried on
 * `RoutingDecision#admissionResults` (t6) so the preview endpoint, `od route
 * preview --json`, and RoutingPanel can all show exactly which candidates
 * were considered for budget admission and why each one won or lost,
 * without re-deriving it from the generic `reasons` trail. */
export interface RoutingAdmissionCandidateResult {
  runtimeId: string;
  model: string;
  lane: string;
  verdict: RoutingAdmissionCandidateVerdict;
  /** Null only when `verdict === 'not-evaluated'` because no price row
   * exists for this candidate's model (e.g. Kimi K3, which plan §2 gives no
   * per-token price for) -- never a fabricated number. */
  estimatedCostUsd: number | null;
  reason: string;
}

/**
 * Sol review MED-5 (fix-round, admission control): a shape-only
 * `typeof === 'number'` check accepted a negative or `NaN` cost, AND
 * accepted a `null`/non-null cost on ANY verdict regardless of which one --
 * so a malformed `{ verdict: 'admit', estimatedCostUsd: null }` (a
 * "silent admit" with no cost backing it, exactly the failure mode
 * `evaluateAdmission` itself is built never to produce) passed this guard.
 * The invariant this now enforces: `verdict === 'not-evaluated'` IFF
 * `estimatedCostUsd === null` -- every other verdict (`admit` and every
 * `deny-*`) MUST carry a finite, nonnegative real cost figure.
 */
function isRoutingAdmissionCandidateResult(value: unknown): value is RoutingAdmissionCandidateResult {
  if (!isPlainObject(value)) return false;
  if (
    typeof value.runtimeId !== 'string' ||
    typeof value.model !== 'string' ||
    typeof value.lane !== 'string' ||
    typeof value.verdict !== 'string' ||
    !(ROUTING_ADMISSION_CANDIDATE_VERDICTS as readonly string[]).includes(value.verdict) ||
    typeof value.reason !== 'string'
  ) {
    return false;
  }
  const costIsNull = value.estimatedCostUsd === null;
  const costIsValidNumber =
    typeof value.estimatedCostUsd === 'number' && Number.isFinite(value.estimatedCostUsd) && value.estimatedCostUsd >= 0;
  if (!costIsNull && !costIsValidNumber) return false;
  const isNotEvaluated = value.verdict === 'not-evaluated';
  return isNotEvaluated === costIsNull;
}

function isRoutingAdmissionCandidateResultArray(value: unknown): value is RoutingAdmissionCandidateResult[] {
  return Array.isArray(value) && value.every(isRoutingAdmissionCandidateResult);
}

/** One named part of the composed prompt, in composition order -- e.g.
 * `{ part: 'system' }`, `{ part: 'design-tokens' }`, `{ part: 'brief' }`.
 * Plan §3.1: the binding point is dispatch time, "(runtime, model flag,
 * effort, lane, prompt composition)" bound together before spawn. Kept as a
 * list of small records (not a flat string[]) so a later tranche can attach
 * per-part accounting (e.g. `estimatedTokens`) without a breaking shape
 * change. */
export interface RoutingPromptCompositionPart {
  part: string;
  /** Tokenizer-estimated size of this part alone, if known. */
  estimatedTokens?: number;
}

export type RoutingPromptComposition = RoutingPromptCompositionPart[];

/** The router's dispatch-time decision -- binds `(runtime, model flag,
 * effort, lane, prompt composition)` before spawn (plan §3.1), plus the
 * data-sensitivity class the admission-control layer's allowlist check
 * (plan §3.2 L2) is keyed on. */
export interface RoutingDecision {
  runtimeId: string;
  modelFlag: string;
  effort: RoutingEffort;
  lane: string;
  rationale: string;
  admissionVerdict: RoutingAdmissionVerdict;
  /** The RoutingPolicyDocument#policyVersion this decision was made under. */
  policyVersion: number;
  promptComposition: RoutingPromptComposition;
  /** plan §3.2 L2: every dispatch carries a sensitivity class; each class
   * has a provider allowlist enforced by admission control. Shared with
   * RoutingPolicyDataClassAllowlist#classification in routing-policy.ts. */
  sensitivityClass: RoutingDataClassification;
  /** First-class outcome of the decision algorithm (t5) -- see
   * RoutingDecisionStatus's own doc comment. */
  status: RoutingDecisionStatus;
  /** Structured "why this model" trail: one entry per evaluated step
   * (matched row, assignment pin, filtered candidates + why, meter
   * demotions, final selection), in evaluation order. `rationale` above
   * stays the one-line human summary; this is the full evidence behind it. */
  reasons: RoutingDecisionReason[];
  /** Echoes RoutingKey#contextEstimateTokens -- carried on the decision too
   * (not just the key) so a consumer that only persists/displays the
   * decision still has it without also keeping the key around. */
  contextEstimateTokens: number;
  /** Every lane-throttle demotion the decision algorithm applied while
   * walking the candidate list, in the order they occurred. Empty when the
   * head candidate was available and no demotion was needed. */
  demotions: RoutingLaneDemotion[];
  /** t6 (plan §3.1/§3.2 L4 admission control): every candidate the engine
   * actually evaluated for budget admission, in evaluation order -- empty
   * when admission was never engaged for this call (the pre-t6 behavior:
   * `decideRouting` was invoked without its optional `admission` input, or
   * every candidate was thrown out by lane-throttle demotion before any of
   * them reached admission evaluation). Always present (never omitted) so a
   * consumer never has to distinguish "not evaluated" from "field absent." */
  admissionResults: RoutingAdmissionCandidateResult[];
}

function isRoutingPromptCompositionPart(value: unknown): value is RoutingPromptCompositionPart {
  if (!isPlainObject(value)) return false;
  if (typeof value.part !== 'string') return false;
  if (value.estimatedTokens !== undefined && typeof value.estimatedTokens !== 'number') return false;
  return true;
}

function isRoutingPromptComposition(value: unknown): value is RoutingPromptComposition {
  return Array.isArray(value) && value.every(isRoutingPromptCompositionPart);
}

const ROUTING_DATA_CLASSIFICATIONS: readonly RoutingDataClassification[] = [
  'client-confidential',
  'internal',
  'public',
];

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isPlainObject(value) && Object.values(value).every((v) => typeof v === 'number');
}

/** Validates every field of a RoutingKey, including that the discriminated
 * union's forbidden shape -- `buildClass` present with `templateId` null --
 * is rejected at the value level too, not only unrepresentable in the type. */
export function isRoutingKey(value: unknown): value is RoutingKey {
  if (!isPlainObject(value)) return false;
  const key = value;
  if (typeof key.stage !== 'string') return false;
  // Sol review MED-4: a token count is a nonnegative integer, never
  // NaN/Infinity/negative/fractional -- see isFiniteNonNegativeInteger's
  // own doc comment for why a plain `typeof === 'number'` check is unsafe
  // here (NaN IS `typeof 'number'`).
  if (!isFiniteNonNegativeInteger(key.contextEstimateTokens)) return false;
  if (!isNumberRecord(key.laneMeters)) return false;

  if (key.buildClass === null) {
    return key.templateId === null || typeof key.templateId === 'string';
  }
  // buildClass is present: only valid when templateId is also a non-null
  // string (the primary shape) -- templateId: null + buildClass: string is
  // the one forbidden combination WR-routing.md's fallback table never
  // defines.
  return typeof key.buildClass === 'string' && typeof key.templateId === 'string';
}

function isRoutingDecisionReasonArray(value: unknown): value is RoutingDecisionReason[] {
  return Array.isArray(value) && value.every(isRoutingDecisionReason);
}

function isRoutingLaneDemotionArray(value: unknown): value is RoutingLaneDemotion[] {
  return Array.isArray(value) && value.every(isRoutingLaneDemotion);
}

export function isRoutingDecision(value: unknown): value is RoutingDecision {
  if (!isPlainObject(value)) return false;
  const decision = value;
  return (
    typeof decision.runtimeId === 'string' &&
    typeof decision.modelFlag === 'string' &&
    typeof decision.effort === 'string' &&
    (ROUTING_EFFORTS as readonly string[]).includes(decision.effort) &&
    typeof decision.lane === 'string' &&
    typeof decision.rationale === 'string' &&
    typeof decision.admissionVerdict === 'string' &&
    (ROUTING_ADMISSION_VERDICTS_ALL as readonly string[]).includes(decision.admissionVerdict) &&
    typeof decision.policyVersion === 'number' &&
    isRoutingPromptComposition(decision.promptComposition) &&
    typeof decision.sensitivityClass === 'string' &&
    (ROUTING_DATA_CLASSIFICATIONS as readonly string[]).includes(decision.sensitivityClass) &&
    typeof decision.status === 'string' &&
    (ROUTING_DECISION_STATUSES as readonly string[]).includes(decision.status) &&
    isRoutingDecisionReasonArray(decision.reasons) &&
    isFiniteNonNegativeInteger(decision.contextEstimateTokens) &&
    isRoutingLaneDemotionArray(decision.demotions) &&
    isRoutingAdmissionCandidateResultArray(decision.admissionResults)
  );
}

/** Response envelope for GET /api/routing/decision/preview -- shared by the
 * route handler and RoutingPanel so neither side locally recreates a
 * partial type (AGENTS.md's contracts rule). */
export interface RoutingDecisionPreviewResponse {
  key: RoutingKey;
  decision: RoutingDecision;
}

export function isRoutingDecisionPreviewResponse(value: unknown): value is RoutingDecisionPreviewResponse {
  return isPlainObject(value) && isRoutingKey(value.key) && isRoutingDecision(value.decision);
}

// ---------------------------------------------------------------------------
// Dispatch override request (t9 fix-round, Sol review MED-3)
//
// TEMPORARY HOME: this is the wire shape for a future `ChatRequest#
// routingOverride` field. It cannot be declared on `ChatRequest` itself yet
// because `packages/contracts/src/api/chat.ts` is OUTSIDE this wave's lease
// (docs/plans/waves/WR-routing.md's "Lease" section grants only
// routing-policy.ts/routing-decision.ts/routing-telemetry.ts/index.ts under
// packages/contracts/src/api). `apps/daemon/src/server.ts`'s chat-dispatch
// wiring reads a raw chat-body field permissively and validates it against
// `isRoutingOverrideRequest` before it ever reaches
// `apps/daemon/src/routing/dispatch.ts`'s `resolveDispatchRouting` -- a
// malformed shape is rejected with a typed error at that boundary, never
// silently passed through. Once a governance amendment lands this field on
// `ChatRequest` (see this wave's task reports for the exact edit shape),
// `ChatRequest#routingOverride` should reference this type directly instead
// of `chat.ts` inventing a parallel shape.
// ---------------------------------------------------------------------------

export interface RoutingOverrideRequest {
  model: string;
  lane: string;
  reason: string;
}

/** `model`/`lane` must be non-empty (an empty override is indistinguishable
 * from "no override" and would otherwise silently no-op downstream);
 * `reason` may be empty (`resolveDispatchRouting` substitutes "no reason
 * given" for display, but an override's validity never depends on WHY). */
export function isRoutingOverrideRequest(value: unknown): value is RoutingOverrideRequest {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.model === 'string' &&
    value.model.trim().length > 0 &&
    typeof value.lane === 'string' &&
    value.lane.trim().length > 0 &&
    typeof value.reason === 'string'
  );
}

// ---------------------------------------------------------------------------
// Routing-blocked error detail (t9 fix-round, Sol review MED-4)
//
// `apps/daemon/src/routing/dispatch.ts`'s `DispatchBlockedError#code` reuses
// this exact closed set (imported, not redeclared) so the daemon's SSE/
// status error payload for a blocked dispatch carries a TYPED detail object
// from a leased DTO instead of an ad-hoc inline shape. This object rides in
// `ApiError#details` (a generic `JsonValue` field `errors.ts` already
// exposes).
//
// The accompanying `ApiErrorCode` is `'ROUTING_BLOCKED'`. Both halves of that
// took a governance amendment, because `packages/contracts/src/errors.ts` and
// the daemon's emission sites were outside this wave's lease: t9 shipped the
// interim `'FORBIDDEN'` code, Amendment 1 (2026-08-06) added the
// `'ROUTING_BLOCKED'` member, and Amendment 2 (2026-08-07) granted the two
// `apps/daemon/src/server.ts` literals that actually emit it. `'FORBIDDEN'`
// was only ever a stand-in: it means an authorization refusal, whereas a
// blocked dispatch is a caller who IS entitled to the operation being stopped
// by policy. `statusForError` maps the code to 422.
// ---------------------------------------------------------------------------

export type RoutingBlockedCode = 'fail-closed-stop' | 'denied-admission' | 'routing-error';

const ROUTING_BLOCKED_CODES: readonly RoutingBlockedCode[] = ['fail-closed-stop', 'denied-admission', 'routing-error'];

export interface RoutingBlockedErrorDetail {
  kind: 'routing-blocked';
  code: RoutingBlockedCode;
  rationale: string;
}

export function isRoutingBlockedErrorDetail(value: unknown): value is RoutingBlockedErrorDetail {
  if (!isPlainObject(value)) return false;
  return (
    value.kind === 'routing-blocked' &&
    typeof value.code === 'string' &&
    (ROUTING_BLOCKED_CODES as readonly string[]).includes(value.code) &&
    typeof value.rationale === 'string'
  );
}
