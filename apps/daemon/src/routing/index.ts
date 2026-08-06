// Routing module surface (WR wave, P0 skeleton -- plan §3.4 capability
// closure). `apps/daemon/src/routes/routing.ts` is the only consumer today;
// real dispatch-time routing (P2) and telemetry persistence (P1) land in
// later WR tranches -- see docs/plans/waves/WR-routing.md's Tranche register.

export { currentRoutingPolicyVersion, loadRoutingPolicy } from './policy.js';

// Advisory decision engine (WR wave, P2 tranche -- plan §3.1/§3.2 L2, §2).
// See decision.ts's own header for the full selection-algorithm rationale.
export { decideRouting, estimatePromptTokens, type DecideRoutingInput } from './decision.js';

// L5 telemetry (WR wave, P1 tranche -- plan §3.2 L5, §3.1). See
// telemetry.ts's own header for the full design rationale.
export {
  computeBuildSpendUsd,
  computeDaySpendUsd,
  computeStageSpendUsd,
  computeLaneMeters,
  ensureRoutingTelemetryTable,
  getRoutingTelemetryByRunId,
  listRoutingTelemetry,
  reconcileRoutedVsObserved,
  recordRoutingTelemetry,
  type RoutingReconciliation,
  type RoutingReconciliationStatus,
  type RoutingSpendSnapshot,
  type RoutingTelemetryFilters,
  type RoutingTelemetryPagination,
} from './telemetry.js';

// L4 admission control (WR wave, P2 tranche -- plan §3.1 budget bullet,
// §3.2 L4). See admission.ts's own header for the full rationale.
export {
  admitsUnderCap,
  estimatedRunCostUsd,
  evaluateAdmission,
  headroomFractionOf,
  maxVariationFanout,
  runawayLimitsFor,
  RoutingAdmissionInputError,
  type AdmissionSpendLookup,
  type EvaluateAdmissionInput,
} from './admission.js';

// L1 reliability layer (WR wave, P2 tranche -- plan §3.2 L1 + §3.1
// side-effect redispatch limits). See reliability.ts's own header for the
// full rationale (storage design, cooldown policy, non-redispatchable
// marking).
export {
  clearOnSuccess,
  computeCooldownStatuses,
  computeCooldownWindowMs,
  DEFAULT_COOLDOWN_CONFIG,
  ensureRoutingCooldownsTable,
  ensureRoutingRunSideEffectsTable,
  findActiveCooldown,
  getCooldownRecord,
  getRunRedispatchability,
  getRunSideEffectKinds,
  isInCooldown,
  isRedispatchable,
  laneFallbackChain,
  markRunSideEffects,
  nextLaneInChain,
  recordObservedFailure,
  resolveCooldownConfig,
  type CooldownCheck,
  type CooldownRecord,
  type RunRedispatchability,
} from './reliability.js';

// L3 deterministic gate runner + cascade classification (WR wave, t8 --
// plan §3.2 L3). See gates.ts's own header for the full class split
// (deterministic cascade triggers vs stochastic advisory-only) and the
// "unavailable over reimplementation" discipline every gate follows.
export {
  advanceGateCascadeState,
  baselineState,
  classifyCascadeTrigger,
  DEFAULT_SSIM_FLOOR,
  DETERMINISTIC_GATE_DEFINITIONS,
  DETERMINISTIC_GATE_IDS,
  ensureGateCascadeStateTable,
  ensureSsimBaselinesTable,
  GATE_REGISTRY,
  GateClassificationError,
  GateRunnerInputError,
  GateSelectionError,
  getGateCascadeState,
  invalidateSsimBaseline,
  recordBootstrapBaseline,
  recordGateOutcomes,
  runGates,
  runNegativeControlCheck,
  SsimLifecycleError,
  STOCHASTIC_GATE_DEFINITIONS,
  STOCHASTIC_GATE_IDS,
  type CascadeClassification,
  type ClassifyCascadeTriggerInput,
  type DeterministicGateDefinition,
  type DeterministicGateId,
  type DeterministicGateResult,
  type EscalationTier,
  type GateCascadeState,
  type GateClass,
  type GateContext,
  type GateDefinition,
  type GateExecutionStatus,
  type GateId,
  type GateResult,
  type NegativeControlCheckResult,
  type RecordBootstrapBaselineInput,
  type RunGatesOptions,
  type RunNegativeControlCheckInput,
  type SsimLifecycleState,
  type StochasticGateDefinition,
  type StochasticGateId,
  type StochasticGateResult,
} from './gates.js';
