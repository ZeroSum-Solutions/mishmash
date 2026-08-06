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
  computeLaneMeters,
  ensureRoutingTelemetryTable,
  getRoutingTelemetryByRunId,
  listRoutingTelemetry,
  reconcileRoutedVsObserved,
  recordRoutingTelemetry,
  type RoutingReconciliation,
  type RoutingReconciliationStatus,
  type RoutingTelemetryFilters,
  type RoutingTelemetryPagination,
} from './telemetry.js';
