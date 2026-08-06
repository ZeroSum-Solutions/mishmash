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
 * Fail-closed admission result (plan §3.2 L2: "if all allowed lanes for a
 * [data] class are exhausted, the run stops and surfaces to the human; it
 * never falls through to a provider outside the class allowlist"). A P0
 * stub decision always reports 'admitted' with a placeholder rationale;
 * real admission control is P2 (CWR-P2-2).
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
 */
export type RoutingDecisionStatus = 'ok' | 'fail-closed-stop' | 'error';

const ROUTING_DECISION_STATUSES: readonly RoutingDecisionStatus[] = ['ok', 'fail-closed-stop', 'error'];

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
    isRoutingLaneDemotionArray(decision.demotions)
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
