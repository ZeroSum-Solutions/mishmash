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
 * Sol review MED-4 (t5 fix commit): a plain `typeof x === 'number'` (or even
 * `Number.isFinite`) check accepts a NEGATIVE or FRACTIONAL value for a
 * quantity that can only ever be a whole count -- a context-token bound, a
 * token estimate, a throttle-event tally. That gap is more than cosmetic:
 * `NaN` itself is `typeof 'number'`, and a NaN threshold silently fails OPEN
 * in a comparison (`NaN > 0` is `false`), which is exactly the "is this lane
 * throttled" check in apps/daemon/src/routing/decision.ts. Shared here (not
 * duplicated per contract file) so `RoutingMatchRule#{min,max}ContextTokens`
 * (this file), `RoutingKey#contextEstimateTokens`/`RoutingDecision#
 * contextEstimateTokens` (routing-decision.ts), and `LaneMeter#
 * throttleEvents` (routing-telemetry.ts) all reject NaN/Infinity/negative/
 * fractional values the same way. Deliberately NOT applied to money fields
 * (`inputPerMillion`, `costUsd`, ...), which are legitimately fractional.
 */
export function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
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

/**
 * t7 (WR wave, plan §3.2 L1 reliability): the two independent axes a
 * cooldown can be scoped to -- a runtime CLI identifier (RoutingCandidate#
 * runtimeId, e.g. "claude-code") or a lane (RoutingLaneId). Plan §3.2 L1:
 * "per-runtime observed-failure cooldowns... lane-ordered fallback chains."
 * A runtime failing across every lane and a single lane failing across
 * every runtime are two different reliability signals, so
 * `apps/daemon/src/routing/reliability.ts` tracks cooldown state
 * independently per scope rather than folding both into one axis.
 */
export type RoutingCooldownScopeType = 'runtime' | 'lane';

const ROUTING_COOLDOWN_SCOPE_TYPES: readonly RoutingCooldownScopeType[] = ['runtime', 'lane'];

export interface RoutingCooldownScope {
  type: RoutingCooldownScopeType;
  id: string;
}

/**
 * A cooldown scope's current status -- the plain-data snapshot shape both
 * `decideRouting`'s optional `cooldown` input (apps/daemon/src/routing/
 * decision.ts, t7) and `/api/routing/meters`'s additive `cooldowns` field
 * (routing-telemetry.ts) consume, mirroring how `laneMeters`/`admission.
 * spendLookup` already arrive at the decision engine as caller-computed
 * arguments rather than live queries. `consecutiveFailures`/`category` read
 * `0`/`null` for a scope reliability.ts has never recorded a failure for.
 */
export interface RoutingCooldownStatus {
  scopeType: RoutingCooldownScopeType;
  scopeId: string;
  inCooldown: boolean;
  /** Milliseconds remaining until the cooldown window elapses; `0` once
   * elapsed or when never in cooldown. */
  remainingMs: number;
  consecutiveFailures: number;
  /** The most recent observed-failure category -- reuses
   * `TrackingRunFailureCategory` (packages/contracts/src/analytics), the
   * SAME taxonomy `apps/daemon/src/run-retry-policy.ts` already classifies
   * intra-run failures into (t7 CONSUMES that vocabulary, never invents a
   * second one); kept as a plain `string` here so this contract file does
   * not need an analytics-module dependency for a display-only field.
   * `null` for a scope with no recorded failures. */
  category: string | null;
  reason: string;
}

function isRoutingCooldownScopeType(value: unknown): value is RoutingCooldownScopeType {
  return typeof value === 'string' && (ROUTING_COOLDOWN_SCOPE_TYPES as readonly string[]).includes(value);
}

export function isRoutingCooldownStatus(value: unknown): value is RoutingCooldownStatus {
  if (!isPlainObject(value)) return false;
  return (
    isRoutingCooldownScopeType(value.scopeType) &&
    typeof value.scopeId === 'string' &&
    value.scopeId.length > 0 &&
    typeof value.inCooldown === 'boolean' &&
    isFiniteNonNegativeInteger(value.remainingMs) &&
    isFiniteNonNegativeInteger(value.consecutiveFailures) &&
    (value.category === null || typeof value.category === 'string') &&
    typeof value.reason === 'string'
  );
}

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
  /**
   * plan §2: Gemini 3.1 Pro "doubling >200k" -- a priced model whose rate
   * changes past a context-length threshold. Optional; only Gemini's row
   * sets it.
   *
   * Boundary is EXCLUSIVE (Sol review LOW-8): a composed context of exactly
   * `thresholdTokens` prices at the base rate; `multiplier` applies only
   * when the actual token count is STRICTLY GREATER than `thresholdTokens`
   * (`apps/daemon/src/routing/admission.ts`'s `estimatedRunCostUsd`:
   * `contextEstimateTokens > thresholdedPricing.thresholdTokens`). The
   * multiplier scales BOTH `inputPerMillion` and `outputPerMillion` once
   * priced -- Gemini's real long-context surcharge applies symmetrically to
   * both directions, not just input.
   */
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
  /**
   * Lane-level teeth (Sol review MED-3, t5 fix commit): transport alone
   * cannot express PRD §15's "Grok 4.5 dispatches only through the prepaid
   * Nous Portal lane in-program" -- `moonshot` is ALSO `prepaid`, so a
   * transport-only constraint would happily admit a Grok candidate routed
   * through Moonshot instead of Nous. When set, a candidate whose
   * `modelFamily` matches this constraint MUST use exactly this lane; any
   * other lane is removed by the filter step regardless of its transport.
   * Optional -- most constraints only need the transport-level form above.
   */
  requiredLane?: RoutingLaneId;
}

/** plan §3.1/§3.2 L4: stream-level runaway heuristics -- CONFIG only. This
 * type round-trips policy -> `runawayLimitsFor` accessor
 * (apps/daemon/src/routing/admission.ts, t6); actually killing a run whose
 * context is growing too fast, whose wall clock exceeded its ceiling, or
 * whose retry count exceeded its ceiling is t9's dispatch-wiring job, not
 * evaluated anywhere in this tranche. Every field optional -- a stage (or
 * the `'default'` fallback key on `RoutingPolicyBudgetCeilings#runawayLimits`)
 * may set only the heuristics that apply to it. */
export interface RoutingPolicyRunawayLimits {
  /** Alarm threshold for composed-context growth, in tokens/minute. */
  contextGrowthAlarmTokensPerMin?: number;
  /** Wall-clock ceiling for a single run, in milliseconds. */
  wallClockCeilingMs?: number;
  /** Max same-run retries before treating the run as runaway. */
  retryCeiling?: number;
}

/**
 * Sol review HIGH-1 (fix-round, admission control): a pre-run cost estimate
 * that prices ONLY the known input-context tokens systematically
 * underprices every candidate whose output rate is materially higher than
 * its input rate (2-6x is typical across the priced models this policy
 * carries) -- a run that generates a long response is charged as if it
 * generated none. There is no real pre-run output-token count anywhere in
 * the routing key, so this bounds the estimate instead of guessing a
 * ratio: `min(contextEstimateTokens, bound)`, where `bound` is this
 * operator-tunable conservative default (or a per-taskClass override for a
 * task class whose typical output shape differs materially, e.g. a review
 * panel producing much shorter output than the context it read). `default:
 * 32_000` is chosen because it roughly matches the largest single-response
 * output ceiling most of this policy's priced runtimes advertise -- a
 * genuinely long, multi-turn conversation's cumulative output is a
 * DIFFERENT concern (already covered by the per-build/per-day caps), not
 * this per-dispatch estimate.
 */
export interface RoutingPolicyOutputTokenBound {
  /** Fallback bound (tokens) when no `perTaskClass` entry applies. */
  default: number;
  /** Optional per-taskClass override of `default`. */
  perTaskClass?: Record<string, number>;
}

/** plan §3.1/§3.2 L4: pre-run estimated-cost ceiling per stage, per-build
 * and per-day caps checked at every dispatch, and a metered-lane hard
 * kill-switch flag. */
export interface RoutingPolicyBudgetCeilings {
  perStageEstimatedCostUsd: Record<string, number>;
  perBuildCapUsd: number;
  perDayCapUsd: number;
  meteredKillSwitch: boolean;
  /**
   * t6 addition (plan §3.1 "conservative headroom margin against provider
   * billing lag", Grok F15): a fraction in `[0, 1)` shaved off every cap
   * BEFORE comparison (`effectiveCap = cap * (1 - headroomFraction)`) --
   * billed usage can arrive after a dispatch already ran, so admission
   * control treats each cap as slightly smaller than its nominal value.
   * Optional so the P0/P1 fixtures and every pre-t6 policy document keep
   * validating without it; `apps/daemon/src/routing/admission.ts` treats an
   * absent value as `0` (no margin), never as "not evaluated" -- this is a
   * tunable safety margin, not a required config surface.
   */
  headroomFraction?: number;
  /**
   * t6 addition (plan §3.1/§3.2 L4 "stream-level runaway heuristics
   * (context-growth alarm, wall-clock ceiling, retry ceiling)") -- CONFIG
   * only, keyed by stage id, with an optional `'default'` key used when a
   * routable stage has no stage-specific entry. See
   * RoutingPolicyRunawayLimits's own doc comment for the enforcement
   * boundary. Optional for the same backward-compatibility reason as
   * `headroomFraction`.
   */
  runawayLimits?: Record<string, RoutingPolicyRunawayLimits>;
  /**
   * Sol review HIGH-1 (fix-round, admission control): see
   * RoutingPolicyOutputTokenBound's own doc comment. Optional so every
   * pre-fix-round policy document/fixture keeps validating without it --
   * `apps/daemon/src/routing/admission.ts`'s cost estimator falls back to
   * its own hardcoded conservative default (documented there) when this
   * field is entirely absent, so absence is never "output is free."
   */
  outputTokenBound?: RoutingPolicyOutputTokenBound;
  /** Optional free-text disclosure. t3's v1 content uses this to flag that
   * the ceiling values are conservative operator-tunable placeholders --
   * the plan names no binding dollar figures, only the ceiling mechanism
   * itself (plan §3.1/§3.2 L4). Never machine-evaluated. */
  notes?: string;
}

/**
 * plan §3.2 L1: "per-runtime observed-failure cooldowns... exponential
 * backoff." Operator-tunable exponential-backoff parameters --
 * `apps/daemon/src/routing/reliability.ts`'s cooldown-window computation
 * consumes these exactly the way `admission.ts` consumes
 * `RoutingPolicyOutputTokenBound`: `windowMs = min(baseMs *
 * factor^(consecutiveFailures - 1), maxMs)`. t7 addition, optional on
 * `RoutingPolicyDocument` so every pre-t7 policy document/fixture keeps
 * validating without it -- reliability.ts falls back to its own hardcoded
 * conservative default (documented there) when this field is entirely
 * absent, mirroring `outputTokenBound`'s own absence contract.
 */
export interface RoutingPolicyCooldownConfig {
  /** Cooldown window (ms) after the FIRST observed failure
   * (consecutiveFailures === 1). */
  baseMs: number;
  /** Multiplier applied per additional consecutive failure. */
  factor: number;
  /** Hard cap on the cooldown window regardless of how many consecutive
   * failures have accumulated. */
  maxMs: number;
  /** Optional free-text disclosure, same spirit as
   * `RoutingPolicyBudgetCeilings#notes` -- t7's v1 values are conservative
   * operator-tunable placeholders, not plan-sourced figures. */
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
  /**
   * The CLOSED set of legal `RoutingKey#stage` values (Sol review HIGH-1, t5
   * fix commit) -- the engine (apps/daemon/src/routing/decision.ts) rejects
   * any `key.stage` outside this list with a typed 'error' decision. This is
   * DELIBERATELY separate from `budgetCeilings.perStageEstimatedCostUsd`'s
   * keys: that record is a cost-ceiling lookup that only needs a *coarse*
   * bucket per pipeline phase, while this vocabulary must also carry the
   * WR-routing.md "Routing-key fallback (normative)" Fallback-C GRANULAR
   * ingestion stage keys (`classify`/`extract`/`distill`/`verify`/
   * `register`) so that work is routable even though no per-sub-stage
   * budget ceiling exists for it yet (admission control, t6, is what
   * eventually enforces a budget -- routability and budget-ceiling
   * presence are two different questions). A stage present here with no
   * matching `budgetCeilings` entry is valid and ROUTABLE; the reverse
   * (a `budgetCeilings` key outside this vocabulary) is a policy bug the
   * drift test also checks.
   */
  stageVocabulary: string[];
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
  /** t7 addition (plan §3.2 L1): optional so every pre-t7 policy document/
   * fixture keeps validating without it -- see RoutingPolicyCooldownConfig's
   * own doc comment for the fallback-default contract. */
  cooldownPolicy?: RoutingPolicyCooldownConfig;
  /** Top-level free-text caveats that don't fit a single row/field: open
   * questions carried over from the plan (e.g. unconfirmed Nous-hosted Grok
   * availability), runtime-model-id mapping notes that apply document-wide,
   * and schema-limit disclosures. Never machine-evaluated -- a human/review
   * aid only, same spirit as the per-row `notes` fields above. */
  notes?: string[];
}

/** Sol review MED-4: a rate can never be negative (a `-$1/M` row is a policy
 * typo, not a real price), and `isFiniteNumber` alone let one through. */
function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Sol review MED-4: a `thresholdedPricing.multiplier` of `0` or negative
 * would zero out or invert the priced rate past the threshold, which is
 * never a legitimate "doubling past 200k" style rule -- only a positive
 * multiplier is accepted. */
function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Sol review MED-4/M4: `effectiveDate` is read at admission time
 * (apps/daemon/src/routing/admission.ts's `findPriceRow`) as a date-ONLY
 * value (every real row this policy carries is `YYYY-MM-DD`, never a
 * time-of-day) -- a bare `Date.parse` is too permissive two different ways:
 *   1. It accepts non-ISO shapes entirely (`Date.parse('August 31, 2026')`
 *      resolves to a real instant), which would silently accept a format
 *      this field was never meant to carry.
 *   2. Per ECMA-262's Date Time String Format, an ISO-shaped string with an
 *      out-of-range CALENDAR field (`2026-02-30`) does not reliably return
 *      `NaN` -- Node's engine rolls it over into the next real date
 *      (`2026-02-30` -> `2026-03-02`) instead of rejecting it.
 * This first enforces the exact `YYYY-MM-DD` shape via regex, then
 * round-trips through `Date.UTC` at midnight and compares the ISO date
 * portion back against the original string -- a rolled-over invalid
 * calendar date parses to SOME real instant, just never the one whose ISO
 * representation matches the literal input, which is exactly what the
 * round-trip catches.
 */
function isIsoDateOnlyString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === value;
}

function isThresholdedPricing(value: unknown): value is { thresholdTokens: number; multiplier: number } {
  if (!isPlainObject(value)) return false;
  return isFiniteNonNegativeInteger(value.thresholdTokens) && isPositiveFiniteNumber(value.multiplier);
}

function isRoutingPolicyPriceRow(value: unknown): value is RoutingPolicyPriceRow {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.model === 'string' &&
    isNonNegativeFiniteNumber(value.inputPerMillion) &&
    isNonNegativeFiniteNumber(value.outputPerMillion) &&
    (value.effectiveDate === undefined || isIsoDateOnlyString(value.effectiveDate)) &&
    (value.thresholdedPricing === undefined || isThresholdedPricing(value.thresholdedPricing))
  );
}

function isRoutingMatchRule(value: unknown): value is RoutingMatchRule {
  if (!isPlainObject(value)) return false;
  const optionalString = (v: unknown) => v === undefined || typeof v === 'string';
  // Sol review MED-4: these are token-count THRESHOLDS, not arbitrary
  // numbers -- a fractional or negative bound is a policy-authoring bug,
  // not a value the engine's [min, max) comparison can honor sensibly.
  const optionalNonNegativeInteger = (v: unknown) => v === undefined || isFiniteNonNegativeInteger(v);
  return (
    optionalString(value.taskClass) &&
    optionalString(value.stage) &&
    optionalString(value.templateId) &&
    optionalNonNegativeInteger(value.minContextTokens) &&
    optionalNonNegativeInteger(value.maxContextTokens)
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
    (value.allowedTransports === undefined || isRoutingTransportArray(value.allowedTransports)) &&
    (value.requiredLane === undefined ||
      (typeof value.requiredLane === 'string' && (ROUTING_LANE_IDS as readonly string[]).includes(value.requiredLane)))
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

function isRoutingPolicyRunawayLimits(value: unknown): value is RoutingPolicyRunawayLimits {
  if (!isPlainObject(value)) return false;
  const optionalNonNegativeInteger = (v: unknown) => v === undefined || isFiniteNonNegativeInteger(v);
  return (
    optionalNonNegativeInteger(value.contextGrowthAlarmTokensPerMin) &&
    optionalNonNegativeInteger(value.wallClockCeilingMs) &&
    optionalNonNegativeInteger(value.retryCeiling)
  );
}

function isRunawayLimitsRecord(value: unknown): value is Record<string, RoutingPolicyRunawayLimits> {
  return isPlainObject(value) && Object.values(value).every(isRoutingPolicyRunawayLimits);
}

function isNonNegativeIntegerRecord(value: unknown): value is Record<string, number> {
  return isPlainObject(value) && Object.values(value).every(isFiniteNonNegativeInteger);
}

function isRoutingPolicyOutputTokenBound(value: unknown): value is RoutingPolicyOutputTokenBound {
  if (!isPlainObject(value)) return false;
  return (
    isFiniteNonNegativeInteger(value.default) &&
    (value.perTaskClass === undefined || isNonNegativeIntegerRecord(value.perTaskClass))
  );
}

function isRoutingPolicyBudgetCeilings(value: unknown): value is RoutingPolicyBudgetCeilings {
  if (!isPlainObject(value)) return false;
  return (
    isNumberRecord(value.perStageEstimatedCostUsd) &&
    isFiniteNumber(value.perBuildCapUsd) &&
    isFiniteNumber(value.perDayCapUsd) &&
    typeof value.meteredKillSwitch === 'boolean' &&
    (value.headroomFraction === undefined ||
      (isFiniteNumber(value.headroomFraction) && value.headroomFraction >= 0 && value.headroomFraction < 1)) &&
    (value.runawayLimits === undefined || isRunawayLimitsRecord(value.runawayLimits)) &&
    (value.outputTokenBound === undefined || isRoutingPolicyOutputTokenBound(value.outputTokenBound)) &&
    (value.notes === undefined || typeof value.notes === 'string')
  );
}

/** t7: `baseMs`/`maxMs` are millisecond DURATIONS (nonnegative integers,
 * same discipline as `RoutingPolicyRunawayLimits#wallClockCeilingMs`);
 * `factor` is a multiplier that must be strictly positive (a zero or
 * negative factor would zero out or invert the exponential growth this
 * config exists to produce -- the same reasoning as
 * `isThresholdedPricing`'s `multiplier` check above). */
function isRoutingPolicyCooldownConfig(value: unknown): value is RoutingPolicyCooldownConfig {
  if (!isPlainObject(value)) return false;
  return (
    isFiniteNonNegativeInteger(value.baseMs) &&
    isPositiveFiniteNumber(value.factor) &&
    isFiniteNonNegativeInteger(value.maxMs) &&
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
    isStringArray(doc.stageVocabulary) &&
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
    (doc.cooldownPolicy === undefined || isRoutingPolicyCooldownConfig(doc.cooldownPolicy)) &&
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
