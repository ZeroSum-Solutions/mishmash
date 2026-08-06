// Routing decision + routing-key contracts (WR wave, P0 skeleton -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.1). The routing-key
// fallback shapes below are frozen normatively in
// docs/plans/waves/WR-routing.md's "Routing-key fallback (normative)"
// section; this file only expresses that shape as a type, it does not
// implement the fallback classification logic itself -- that is dispatch
// logic and lands in a later WR tranche (P2).

/**
 * key = (templateId | NONE) x (buildClass | NONE) x stage x
 * tokenizer-estimated context of the composed prompt x lane meters
 *
 * `templateId` and `buildClass` are independently nullable (see
 * WR-routing.md's fallback table): a `ClientWebsiteBrief`-backed build has
 * both; non-brief templated work has only `templateId`; general chat and
 * non-web work (ingestion, mobile) have neither.
 */
export interface RoutingKey {
  templateId: string | null;
  buildClass: string | null;
  /** Plan §3.3 stage vocabulary; never null. For non-web work (ingestion,
   * mobile) this is that pipeline's own stage vocabulary, not the web build
   * stage list -- see WR-routing.md's Fallback C. */
  stage: string;
  /** Tokenizer-estimated context of the composed prompt -- plan §3.1: "not
   * file-plan size." */
  contextEstimateTokens: number;
  /** Lane meter snapshot consulted at decision time, keyed by lane id. */
  laneMeters: Record<string, number>;
}

/**
 * Fail-closed admission result (plan §3.2 L2: "if all allowed lanes for a
 * [data] class are exhausted, the run stops and surfaces to the human; it
 * never falls through to a provider outside the class allowlist"). A P0
 * stub decision always reports 'admitted' with a placeholder rationale;
 * real admission control is P2 (CWR-P2-2).
 */
export type RoutingAdmissionVerdict = 'admitted' | 'denied' | 'blocked-on-founder';

/** The router's dispatch-time decision -- binds `(runtime, model flag,
 * effort, lane, prompt composition)` before spawn (plan §3.1). */
export interface RoutingDecision {
  runtimeId: string;
  modelFlag: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh';
  lane: string;
  rationale: string;
  admissionVerdict: RoutingAdmissionVerdict;
  /** The RoutingPolicyDocument#policyVersion this decision was made under. */
  policyVersion: number;
}

export function isRoutingKey(value: unknown): value is RoutingKey {
  if (value === null || typeof value !== 'object') return false;
  const key = value as Record<string, unknown>;
  return (
    (key.templateId === null || typeof key.templateId === 'string') &&
    (key.buildClass === null || typeof key.buildClass === 'string') &&
    typeof key.stage === 'string' &&
    typeof key.contextEstimateTokens === 'number' &&
    typeof key.laneMeters === 'object' &&
    key.laneMeters !== null &&
    !Array.isArray(key.laneMeters)
  );
}

const ROUTING_ADMISSION_VERDICTS: readonly RoutingAdmissionVerdict[] = [
  'admitted',
  'denied',
  'blocked-on-founder',
];

export function isRoutingDecision(value: unknown): value is RoutingDecision {
  if (value === null || typeof value !== 'object') return false;
  const decision = value as Record<string, unknown>;
  return (
    typeof decision.runtimeId === 'string' &&
    typeof decision.modelFlag === 'string' &&
    typeof decision.effort === 'string' &&
    typeof decision.lane === 'string' &&
    typeof decision.rationale === 'string' &&
    typeof decision.admissionVerdict === 'string' &&
    (ROUTING_ADMISSION_VERDICTS as readonly string[]).includes(decision.admissionVerdict) &&
    typeof decision.policyVersion === 'number'
  );
}
