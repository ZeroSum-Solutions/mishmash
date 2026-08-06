// Routing policy document contract (WR wave, P0 skeleton -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.2 L2, PRD §15).
//
// This is the DTO shape only. `apps/daemon/src/routing/routing-policy.json`
// (P0) ships a minimal empty-but-typed stub against this shape; the real
// model table content and the drift-failing policy test land in a later WR
// tranche -- see docs/plans/waves/WR-routing.md's Tranche register
// (CWR-P1-1).

/** Structural guard shared across the routing-*.ts contract files: a plain
 * JSON object (not null, not an array). Exported so routing-decision.ts and
 * routing-telemetry.ts reuse it instead of recreating it -- this wave's
 * lease only grants these three contract files, not a new shared-utils
 * file, so this is the closest thing to one. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Shared array-of-strings guard -- see isPlainObject's doc comment for why
 * it lives here rather than a dedicated utils file. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * plan §3.2 L2: "Data classification is part of the policy" -- every
 * dispatch carries a sensitivity class, and each class has a provider
 * allowlist. Shared with RoutingDecision#sensitivityClass in
 * routing-decision.ts so both sides of the admission-control check use the
 * identical literal union.
 */
export type RoutingDataClassification = 'client-confidential' | 'internal' | 'public';

const ROUTING_DATA_CLASSIFICATIONS: readonly RoutingDataClassification[] = [
  'client-confidential',
  'internal',
  'public',
];

export type RoutingEffort = 'low' | 'medium' | 'high' | 'xhigh';

const ROUTING_EFFORTS: readonly RoutingEffort[] = ['low', 'medium', 'high', 'xhigh'];

/** A routing-key predicate: every present field must match for this
 * candidate list to apply. `undefined` fields are wildcards. Context-size
 * thresholds compare against RoutingKey#contextEstimateTokens as
 * `[minContextTokens, maxContextTokens)`. */
export interface RoutingMatchRule {
  taskClass?: string;
  stage?: string;
  templateId?: string;
  minContextTokens?: number;
  maxContextTokens?: number;
}

/** One resolvable dispatch target: a runtime CLI, a model flag, and an
 * effort level -- three of the four `(runtime, model flag, effort, lane)`
 * binding-time fields RoutingDecision carries (plan §3.1); `lane` is
 * derived from `runtimeId` at dispatch time, not duplicated here. */
export interface RoutingCandidate {
  runtimeId: string;
  model: string;
  effort: RoutingEffort;
}

/**
 * One row of the §2 model table: an ordered candidate list for a matched
 * routing key -- `primary` is tried first, `burst` next (e.g. under
 * load/backoff), `cheap` as a budget-forced fallback (plan §3.2 L1's
 * lane-ordered fallback chains + L4 budget governor). Replaces a flat "one
 * model per task class" row so the policy can express real fallback order
 * per match.
 */
export interface RoutingPolicyModelTableEntry {
  match: RoutingMatchRule;
  primary: RoutingCandidate;
  burst?: RoutingCandidate;
  cheap?: RoutingCandidate;
}

/** A priced model, carried with the effective date it started applying --
 * plan §3.2 L2: "Both Sonnet prices carried with an effective date." */
export interface RoutingPolicyPriceRow {
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  /** ISO 8601 date the price took effect. */
  effectiveDate: string;
}

/** Data classification is part of the policy (plan §3.2 L2, Sol v2-HIGH-1):
 * every dispatch carries a sensitivity class, and each class has a provider
 * allowlist. Fallback for an exhausted class is fail-closed by construction
 * (see RoutingAdmissionVerdict in routing-decision.ts) -- never expressed
 * here as a "next allowed lane" field. */
export interface RoutingPolicyDataClassAllowlist {
  classification: RoutingDataClassification;
  allowedLanes: string[];
}

/**
 * A hard rule the drift-failing policy test enforces (plan §3.2 L2's
 * `check-context-isolation`-style test) -- machine-evaluable, not prose:
 * PRD §15's "no Anthropic model may use API credits, Nous, or OpenRouter
 * for this program" is expressed as `{ modelFamily: 'anthropic',
 * forbiddenTransports: ['api-credits', 'nous', 'openrouter'] }`, which the
 * P2 admission-control layer can evaluate directly against a candidate's
 * `(model, transport)` pair instead of parsing `description`.
 */
export interface RoutingPolicyHardConstraint {
  id: string;
  description: string;
  modelFamily: string;
  forbiddenTransports: string[];
}

/** plan §3.1/§3.2 L4: pre-run estimated-cost ceiling per stage, per-build
 * and per-day caps checked at every dispatch, and a metered-lane hard
 * kill-switch flag. */
export interface RoutingPolicyBudgetCeilings {
  perStageEstimatedCostUsd: Record<string, number>;
  perBuildCapUsd: number;
  perDayCapUsd: number;
  meteredKillSwitch: boolean;
}

export interface RoutingPolicyDocument {
  /** Bumped on every policy revision; carried through to every
   * RoutingDecision/telemetry row so a dispatch is traceable to the policy
   * that produced it. */
  policyVersion: number;
  modelTable: RoutingPolicyModelTableEntry[];
  hardConstraints: RoutingPolicyHardConstraint[];
  /** Per-runtime fallback chain (plan §3.2 L1), keyed by lane id. */
  laneChains: Record<string, string[]>;
  dataClassificationAllowlists: RoutingPolicyDataClassAllowlist[];
  /**
   * Both Sonnet price rows (current + the post-2026-08-31 price), each with
   * its own effective date. A later tranche's drift test is the place that
   * enforces "exactly two, in effective-date order" -- this type stays a
   * plain array so the P0 stub can ship empty-but-typed (t3 fills content).
   */
  sonnetPriceRows: RoutingPolicyPriceRow[];
  budgetCeilings: RoutingPolicyBudgetCeilings;
}

function isRoutingPolicyPriceRow(value: unknown): value is RoutingPolicyPriceRow {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.model === 'string' &&
    isFiniteNumber(value.inputPerMillion) &&
    isFiniteNumber(value.outputPerMillion) &&
    typeof value.effectiveDate === 'string'
  );
}

function isRoutingMatchRule(value: unknown): value is RoutingMatchRule {
  if (!isPlainObject(value)) return false;
  const optionalString = (v: unknown) => v === undefined || typeof v === 'string';
  const optionalNumber = (v: unknown) => v === undefined || isFiniteNumber(v);
  return (
    optionalString(value.taskClass) &&
    optionalString(value.stage) &&
    optionalString(value.templateId) &&
    optionalNumber(value.minContextTokens) &&
    optionalNumber(value.maxContextTokens)
  );
}

function isRoutingCandidate(value: unknown): value is RoutingCandidate {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.runtimeId === 'string' &&
    typeof value.model === 'string' &&
    typeof value.effort === 'string' &&
    (ROUTING_EFFORTS as readonly string[]).includes(value.effort)
  );
}

function isRoutingPolicyModelTableEntry(value: unknown): value is RoutingPolicyModelTableEntry {
  if (!isPlainObject(value)) return false;
  if (!isRoutingMatchRule(value.match)) return false;
  if (!isRoutingCandidate(value.primary)) return false;
  if (value.burst !== undefined && !isRoutingCandidate(value.burst)) return false;
  if (value.cheap !== undefined && !isRoutingCandidate(value.cheap)) return false;
  return true;
}

function isRoutingPolicyHardConstraint(value: unknown): value is RoutingPolicyHardConstraint {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.description === 'string' &&
    typeof value.modelFamily === 'string' &&
    isStringArray(value.forbiddenTransports)
  );
}

function isRoutingPolicyDataClassAllowlist(value: unknown): value is RoutingPolicyDataClassAllowlist {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.classification === 'string' &&
    (ROUTING_DATA_CLASSIFICATIONS as readonly string[]).includes(value.classification) &&
    isStringArray(value.allowedLanes)
  );
}

function isLaneChains(value: unknown): value is Record<string, string[]> {
  return isPlainObject(value) && Object.values(value).every(isStringArray);
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isPlainObject(value) && Object.values(value).every(isFiniteNumber);
}

function isRoutingPolicyBudgetCeilings(value: unknown): value is RoutingPolicyBudgetCeilings {
  if (!isPlainObject(value)) return false;
  return (
    isNumberRecord(value.perStageEstimatedCostUsd) &&
    isFiniteNumber(value.perBuildCapUsd) &&
    isFiniteNumber(value.perDayCapUsd) &&
    typeof value.meteredKillSwitch === 'boolean'
  );
}

/** Structural shape guard for a loaded `routing-policy.json` -- validates
 * every top-level field, every array entry, and every record value (not
 * just the container types), so a malformed nested row (e.g. a candidate
 * with an unrecognized `effort` string, or `laneChains` whose value isn't a
 * string array) is rejected rather than silently passed through. Does not
 * validate cross-field semantics (e.g. "every match rule's taskClass is
 * actually used somewhere"); that is the later drift-failing policy test's
 * job (CWR-P1-1), not this shape guard's. */
export function isRoutingPolicyDocument(value: unknown): value is RoutingPolicyDocument {
  if (!isPlainObject(value)) return false;
  const doc = value;
  return (
    isFiniteNumber(doc.policyVersion) &&
    Array.isArray(doc.modelTable) &&
    doc.modelTable.every(isRoutingPolicyModelTableEntry) &&
    Array.isArray(doc.hardConstraints) &&
    doc.hardConstraints.every(isRoutingPolicyHardConstraint) &&
    isLaneChains(doc.laneChains) &&
    Array.isArray(doc.dataClassificationAllowlists) &&
    doc.dataClassificationAllowlists.every(isRoutingPolicyDataClassAllowlist) &&
    Array.isArray(doc.sonnetPriceRows) &&
    doc.sonnetPriceRows.every(isRoutingPolicyPriceRow) &&
    isRoutingPolicyBudgetCeilings(doc.budgetCeilings)
  );
}

/** Response envelope for GET /api/routing/policy -- shared by the route
 * handler and RoutingPanel so neither side locally recreates a partial type
 * (AGENTS.md's contracts rule). */
export interface RoutingPolicyResponse {
  policy: RoutingPolicyDocument;
  policyVersion: number;
}

export function isRoutingPolicyResponse(value: unknown): value is RoutingPolicyResponse {
  return isPlainObject(value) && isRoutingPolicyDocument(value.policy) && isFiniteNumber(value.policyVersion);
}
