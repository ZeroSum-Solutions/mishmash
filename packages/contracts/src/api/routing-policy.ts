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

/**
 * `'inherit'` (Sol review MED-2a) means the plan's §2 table names this model
 * for this cell but does not name an effort -- the candidate defers to the
 * runtime's own default rather than this policy inventing one. Only cells
 * the plan states an effort for (verbatim, e.g. "Opus 5 (high)") carry a
 * concrete `RoutingEffort` value; every other candidate in the v1 content
 * uses `'inherit'`.
 */
export type RoutingEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'inherit';

const ROUTING_EFFORTS: readonly RoutingEffort[] = ['low', 'medium', 'high', 'xhigh', 'inherit'];

/**
 * Every lane plan §2/PRD §15 actually name for in-program dispatch: the
 * three subscription pools ("Lane realism": "subscription lanes (Claude
 * Max, Codex, `agy`)"), the two prepaid lanes ("subscription -> prepaid
 * (Nous, Moonshot)"), and the two metered lanes ("metered (DeepSeek direct,
 * OpenRouter)"). `claude-code-oauth` (not `claude-max-oauth`) matches the
 * exact term WR-routing.md's Review protocol and this program's PRD §15
 * both use ("Claude Code OAuth (Max)" / "Claude Code OAuth only").
 */
export type RoutingLaneId =
  | 'claude-code-oauth'
  | 'codex-oauth'
  | 'agy'
  | 'nous'
  | 'moonshot'
  | 'deepseek-direct'
  | 'openrouter';

const ROUTING_LANE_IDS: readonly RoutingLaneId[] = [
  'claude-code-oauth',
  'codex-oauth',
  'agy',
  'nous',
  'moonshot',
  'deepseek-direct',
  'openrouter',
];

/** The billing/access mechanism a lane uses -- what a hard constraint like
 * PRD §15's "no Anthropic model may use API credits, Nous, or OpenRouter"
 * actually forbids is a transport, not a lane name (`nous` IS the
 * transport `prepaid`'s named instance, so the constraint reads as
 * "anthropic + prepaid|metered-api forbidden", not a lane-string match). */
export type RoutingTransport = 'subscription-oauth' | 'prepaid' | 'metered-api' | 'local';

const ROUTING_TRANSPORTS: readonly RoutingTransport[] = [
  'subscription-oauth',
  'prepaid',
  'metered-api',
  'local',
];

/** The model vendor family a candidate's `model` belongs to -- what
 * RoutingPolicyHardConstraint#modelFamily is actually compared against. */
export type RoutingModelFamily = 'anthropic' | 'openai' | 'google' | 'xai' | 'deepseek' | 'moonshot' | 'other';

const ROUTING_MODEL_FAMILIES: readonly RoutingModelFamily[] = [
  'anthropic',
  'openai',
  'google',
  'xai',
  'deepseek',
  'moonshot',
  'other',
];

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

/**
 * One resolvable dispatch target: a runtime CLI, a model flag, and an
 * effort level -- three of the four `(runtime, model flag, effort, lane)`
 * binding-time fields RoutingDecision carries (plan §3.1). `lane` IS
 * duplicated here (not merely "derived from runtimeId" as the P0 draft
 * assumed): a hard constraint like PRD §15's forbidden-transport rule must
 * be evaluable directly from a candidate's own fields, and `runtimeId` (a
 * free-form CLI identifier, e.g. `claude-code`) does not by itself carry a
 * closed transport/lane classification the admission-control layer can
 * check against `RoutingPolicyHardConstraint#forbiddenTransports`.
 * `modelFamily` is likewise carried per candidate, not re-derived from
 * `model`'s free-form string, for the same reason.
 */
export interface RoutingCandidate {
  runtimeId: string;
  model: string;
  effort: RoutingEffort;
  lane: RoutingLaneId;
  transport: RoutingTransport;
  modelFamily: RoutingModelFamily;
  /** PRD §15's "scoped implementation" bullet: `deepseek-v4-flash`'s exact
   * slug "was live-probed on 2026-08-03 and must be rechecked at dispatch
   * time" -- not a one-time policy fact, a per-dispatch validation
   * requirement. Optional so every other candidate (which the PRD does not
   * flag this way) stays unaffected. */
  dispatchValidation?: { slugRecheckAtDispatch: boolean };
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
  /** Optional free-text row annotation -- t3 (v1 policy content) uses this
   * for runtime-model-id mapping caveats (e.g. a plan model name vs. the
   * actual runtime def's curated id string) and schema-limit disclosures
   * (e.g. a plan cell naming two required parallel models where this row
   * shape only carries one `primary`). Never machine-evaluated; a human/
   * review-time aid only. */
  notes?: string;
  /** A plan §2 cell can name a built-in TOOL (e.g. "WebSearch" for the
   * research row's burst/alt), not a dispatchable model/runtime -- every
   * `RoutingCandidate` requires runtimeId+model+lane+transport+modelFamily,
   * which a tool has none of. Rather than silently dropping that cell (Sol
   * review MED-2b), it is carried here as its own typed list so the plan
   * content is not lost to a schema mismatch. */
  toolTargets?: Array<{ kind: 'tool'; id: string }>;
  /** Machine-evaluable form of plan §2's review-panel merge rule (Grok F11):
   * "any-veto on deterministic-check failures; for stochastic findings,
   * two-of-three agreement escalates to human." Optional -- only the
   * review-panel row(s) set it; the P2 admission-control/gate-runner layer
   * (out of this tranche's scope) is what actually evaluates it. */
  mergeRule?: { deterministicFailures: string; stochasticFindings: string };
}

/** A priced model, carried with the effective date it started applying --
 * plan §3.2 L2: "Both Sonnet prices carried with an effective date." */
export interface RoutingPolicyPriceRow {
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  /** ISO 8601 date the price took effect. Optional (Sol review MED-3b): the
   * plan sources a dated boundary ONLY for the two Sonnet 5 rows
   * (2026-08-31); every other §2-verified price is a current anchor with no
   * stated onset date, and inventing one would misrepresent it as sourced.
   * Both `sonnetPriceRows` entries keep a concrete date; `otherModelPriceRows`
   * entries omit it. */
  effectiveDate?: string;
  /** plan §2: Gemini 3.1 Pro "doubling >200k" -- a priced model whose rate
   * changes past a context-length threshold. Optional; only Gemini's row
   * sets it. */
  thresholdedPricing?: { thresholdTokens: number; multiplier: number };
}

/** Data classification is part of the policy (plan §3.2 L2, Sol v2-HIGH-1):
 * every dispatch carries a sensitivity class, and each class has a provider
 * allowlist. Fallback for an exhausted class is fail-closed by construction
 * (see RoutingAdmissionVerdict in routing-decision.ts) -- never expressed
 * here as a "next allowed lane" field. */
export interface RoutingPolicyDataClassAllowlist {
  classification: RoutingDataClassification;
  allowedLanes: string[];
  /** Fail-closed semantics (plan §3.2 L2, Sol v2-HIGH-1): when every lane in
   * `allowedLanes` is exhausted, the run stops and surfaces to a human --
   * it never falls through to a lane outside this list. Optional (not every
   * historical fixture sets it) so the P0 skeleton's minimal fixtures keep
   * validating; the v1 policy content sets it `true` on every class it
   * ships, and the drift test asserts that explicitly. */
  failClosed?: boolean;
}

/**
 * A hard rule the drift-failing policy test enforces (plan §3.2 L2's
 * `check-context-isolation`-style test) -- machine-evaluable, not prose:
 * PRD §15's "no Anthropic model may use API credits, Nous, or OpenRouter
 * for this program" is expressed as `{ modelFamily: 'anthropic',
 * forbiddenTransports: ['prepaid', 'metered-api'] }` (Nous/OpenRouter are
 * `prepaid`/`metered-api` RoutingTransport instances, not lane strings --
 * see RoutingCandidate's own doc comment), which the P2 admission-control
 * layer can evaluate directly against a candidate's own `modelFamily` +
 * `transport` fields instead of parsing `description`. `modelFamily` and
 * `forbiddenTransports` share RoutingCandidate's closed unions so a
 * constraint can never name a family/transport no candidate could ever
 * carry.
 */
export interface RoutingPolicyHardConstraint {
  id: string;
  description: string;
  modelFamily: RoutingModelFamily;
  forbiddenTransports: RoutingTransport[];
  /**
   * Sol review MED-1b: a positive allowlist is STRONGER than
   * `forbiddenTransports` alone -- `forbiddenTransports` only bans the
   * transports it names (PRD §15's list happens to omit `local`, leaving a
   * gap), while `allowedTransports`, when present, means every transport
   * NOT in this list is forbidden, closing that gap by construction. Used
   * for PRD §15's "Claude Code OAuth only" requirement on anthropic models:
   * `allowedTransports: ['subscription-oauth']`. Optional -- most
   * constraints only need the negative form.
   */
  allowedTransports?: RoutingTransport[];
}

/** plan §3.1/§3.2 L4: pre-run estimated-cost ceiling per stage, per-build
 * and per-day caps checked at every dispatch, and a metered-lane hard
 * kill-switch flag. */
export interface RoutingPolicyBudgetCeilings {
  perStageEstimatedCostUsd: Record<string, number>;
  perBuildCapUsd: number;
  perDayCapUsd: number;
  meteredKillSwitch: boolean;
  /** Optional free-text disclosure. t3's v1 content uses this to flag that
   * the ceiling values are conservative operator-tunable placeholders --
   * the plan names no binding dollar figures, only the ceiling mechanism
   * itself (plan §3.1/§3.2 L4). Never machine-evaluated. */
  notes?: string;
}

/**
 * One of PRD §15's five exact process-role assignments for THIS program's
 * own meta-development (reviewing/building the routing capability itself),
 * distinct from the §2 end-user task-class `modelTable` (Sol review MED-1a).
 * §15 names a role, a specific model, and a required lane verbatim -- e.g.
 * "Code adversary: Opus 5 through Claude Code OAuth only" -- and this shape
 * carries that assignment exactly rather than folding it into a `modelTable`
 * row's `taskClass`, which would blur two different concepts the plan
 * treats as distinct. §15's sixth bullet ("Mechanical verification:
 * deterministic scripts and tests, not model judgment") has no model to
 * assign and is represented instead by the
 * `prd-15-mechanical-verification-deterministic-only` hard constraint.
 */
export interface RoutingPolicyProgramAssignment {
  taskSelector: string;
  model: string;
  requiredLane: RoutingLaneId;
  note: string;
  /** Mirrors RoutingCandidate#dispatchValidation -- set on the
   * "scoped-implementation" assignment (deepseek-v4-flash), whose exact
   * slug PRD §15 requires rechecking at dispatch time. Optional; the other
   * four assignments don't carry this concern. */
  dispatchValidation?: { slugRecheckAtDispatch: boolean };
}

export interface RoutingPolicyDocument {
  /** Bumped on every policy revision; carried through to every
   * RoutingDecision/telemetry row so a dispatch is traceable to the policy
   * that produced it. */
  policyVersion: number;
  modelTable: RoutingPolicyModelTableEntry[];
  hardConstraints: RoutingPolicyHardConstraint[];
  /** PRD §15's five exact process-role assignments (Sol review MED-1a) --
   * see RoutingPolicyProgramAssignment's doc comment for why these are kept
   * separate from `modelTable`. Optional so the P0 stub and older fixtures
   * keep validating without it. */
  programAssignments?: RoutingPolicyProgramAssignment[];
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
  /** Every other §2-verified priced model this policy references (Opus 5,
   * Haiku 4.5, Fable 5, GPT-5.6 Sol/Terra/Luna, Gemini 3.1 Pro, Grok 4.5,
   * DeepSeek V4-Flash, Kimi K3). Kept separate from `sonnetPriceRows`
   * (whose type/doc comment scope it specifically to the two dated Sonnet
   * rows) rather than repurposing that field for a shape it was not named
   * for. Optional so the P0 stub and older fixtures keep validating without
   * it. */
  otherModelPriceRows?: RoutingPolicyPriceRow[];
  budgetCeilings: RoutingPolicyBudgetCeilings;
  /** Top-level free-text caveats that don't fit a single row/field: open
   * questions carried over from the plan (e.g. unconfirmed Nous-hosted Grok
   * availability), runtime-model-id mapping notes that apply document-wide,
   * and schema-limit disclosures. Never machine-evaluated -- a human/review
   * aid only, same spirit as the per-row `notes` fields above. */
  notes?: string[];
}

function isThresholdedPricing(value: unknown): value is { thresholdTokens: number; multiplier: number } {
  if (!isPlainObject(value)) return false;
  return isFiniteNumber(value.thresholdTokens) && isFiniteNumber(value.multiplier);
}

function isRoutingPolicyPriceRow(value: unknown): value is RoutingPolicyPriceRow {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.model === 'string' &&
    isFiniteNumber(value.inputPerMillion) &&
    isFiniteNumber(value.outputPerMillion) &&
    (value.effectiveDate === undefined || typeof value.effectiveDate === 'string') &&
    (value.thresholdedPricing === undefined || isThresholdedPricing(value.thresholdedPricing))
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

function isDispatchValidation(value: unknown): value is { slugRecheckAtDispatch: boolean } {
  return isPlainObject(value) && typeof value.slugRecheckAtDispatch === 'boolean';
}

function isRoutingCandidate(value: unknown): value is RoutingCandidate {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.runtimeId === 'string' &&
    typeof value.model === 'string' &&
    typeof value.effort === 'string' &&
    (ROUTING_EFFORTS as readonly string[]).includes(value.effort) &&
    typeof value.lane === 'string' &&
    (ROUTING_LANE_IDS as readonly string[]).includes(value.lane) &&
    typeof value.transport === 'string' &&
    (ROUTING_TRANSPORTS as readonly string[]).includes(value.transport) &&
    typeof value.modelFamily === 'string' &&
    (ROUTING_MODEL_FAMILIES as readonly string[]).includes(value.modelFamily) &&
    (value.dispatchValidation === undefined || isDispatchValidation(value.dispatchValidation))
  );
}

function isToolTargets(value: unknown): value is Array<{ kind: 'tool'; id: string }> {
  return (
    Array.isArray(value) &&
    value.every((v) => isPlainObject(v) && v.kind === 'tool' && typeof v.id === 'string')
  );
}

function isMergeRule(value: unknown): value is { deterministicFailures: string; stochasticFindings: string } {
  if (!isPlainObject(value)) return false;
  return typeof value.deterministicFailures === 'string' && typeof value.stochasticFindings === 'string';
}

function isRoutingPolicyModelTableEntry(value: unknown): value is RoutingPolicyModelTableEntry {
  if (!isPlainObject(value)) return false;
  if (!isRoutingMatchRule(value.match)) return false;
  if (!isRoutingCandidate(value.primary)) return false;
  if (value.burst !== undefined && !isRoutingCandidate(value.burst)) return false;
  if (value.cheap !== undefined && !isRoutingCandidate(value.cheap)) return false;
  if (value.notes !== undefined && typeof value.notes !== 'string') return false;
  if (value.toolTargets !== undefined && !isToolTargets(value.toolTargets)) return false;
  if (value.mergeRule !== undefined && !isMergeRule(value.mergeRule)) return false;
  return true;
}

function isRoutingTransportArray(value: unknown): value is RoutingTransport[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && (ROUTING_TRANSPORTS as readonly string[]).includes(v));
}

function isRoutingPolicyHardConstraint(value: unknown): value is RoutingPolicyHardConstraint {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.description === 'string' &&
    typeof value.modelFamily === 'string' &&
    (ROUTING_MODEL_FAMILIES as readonly string[]).includes(value.modelFamily) &&
    isRoutingTransportArray(value.forbiddenTransports) &&
    (value.allowedTransports === undefined || isRoutingTransportArray(value.allowedTransports))
  );
}

function isRoutingPolicyDataClassAllowlist(value: unknown): value is RoutingPolicyDataClassAllowlist {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.classification === 'string' &&
    (ROUTING_DATA_CLASSIFICATIONS as readonly string[]).includes(value.classification) &&
    isStringArray(value.allowedLanes) &&
    (value.failClosed === undefined || typeof value.failClosed === 'boolean')
  );
}

function isRoutingPolicyProgramAssignment(value: unknown): value is RoutingPolicyProgramAssignment {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.taskSelector === 'string' &&
    typeof value.model === 'string' &&
    typeof value.requiredLane === 'string' &&
    (ROUTING_LANE_IDS as readonly string[]).includes(value.requiredLane) &&
    typeof value.note === 'string' &&
    (value.dispatchValidation === undefined || isDispatchValidation(value.dispatchValidation))
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
    typeof value.meteredKillSwitch === 'boolean' &&
    (value.notes === undefined || typeof value.notes === 'string')
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
    (doc.programAssignments === undefined ||
      (Array.isArray(doc.programAssignments) && doc.programAssignments.every(isRoutingPolicyProgramAssignment))) &&
    isLaneChains(doc.laneChains) &&
    Array.isArray(doc.dataClassificationAllowlists) &&
    doc.dataClassificationAllowlists.every(isRoutingPolicyDataClassAllowlist) &&
    Array.isArray(doc.sonnetPriceRows) &&
    doc.sonnetPriceRows.every(isRoutingPolicyPriceRow) &&
    (doc.otherModelPriceRows === undefined ||
      (Array.isArray(doc.otherModelPriceRows) && doc.otherModelPriceRows.every(isRoutingPolicyPriceRow))) &&
    isRoutingPolicyBudgetCeilings(doc.budgetCeilings) &&
    (doc.notes === undefined || isStringArray(doc.notes))
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
