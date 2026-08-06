// Routing decision + routing-key contracts (WR wave, P0 skeleton -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.1). The routing-key
// fallback shapes below are frozen normatively in
// docs/plans/waves/WR-routing.md's "Routing-key fallback (normative)"
// section; this file only expresses that shape as a type, it does not
// implement the fallback classification logic itself -- that is dispatch
// logic and lands in a later WR tranche (P2).
import { isPlainObject, type RoutingDataClassification, type RoutingEffort } from './routing-policy.js';

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
export type RoutingAdmissionVerdict = 'admitted' | 'denied' | 'blocked-on-founder';

const ROUTING_EFFORTS: readonly RoutingEffort[] = ['low', 'medium', 'high', 'xhigh'];

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
  if (typeof key.contextEstimateTokens !== 'number') return false;
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

const ROUTING_ADMISSION_VERDICTS: readonly RoutingAdmissionVerdict[] = [
  'admitted',
  'denied',
  'blocked-on-founder',
];

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
    (ROUTING_ADMISSION_VERDICTS as readonly string[]).includes(decision.admissionVerdict) &&
    typeof decision.policyVersion === 'number' &&
    isRoutingPromptComposition(decision.promptComposition) &&
    typeof decision.sensitivityClass === 'string' &&
    (ROUTING_DATA_CLASSIFICATIONS as readonly string[]).includes(decision.sensitivityClass)
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
