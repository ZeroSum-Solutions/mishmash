// Routing telemetry contract (WR wave, P0 skeleton -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.2 L5). Per-run telemetry
// row shape (stage, template, design system, routed-vs-observed model AND
// lane, tokens, cache hits, latency, cost, gate outcomes, escalation) and
// the per-lane meter shape both endpoints/CLI subcommands in this wave
// return. Durable persistence (SQLite) and real gate-outcome content land
// in later WR tranches -- see docs/plans/waves/WR-routing.md's Tranche
// register (CWR-P1-2 for the telemetry row, CWR-P2-4 for lane meters).
import { isPlainObject } from './routing-policy.js';

export type RoutingGateOutcome = 'pass' | 'fail' | 'blocked-on-founder';

const ROUTING_GATE_OUTCOMES: readonly RoutingGateOutcome[] = ['pass', 'fail', 'blocked-on-founder'];

export interface RoutingTelemetryTokenCounts {
  input: number;
  output: number;
  cacheReadInput: number;
}

/** One row per run: what was *routed* versus what actually *ran* -- the
 * dataset plan §3.2 L5 says is "the only path to ever justifying learned
 * routing." Both the model AND the lane get a routed-vs-observed pair:
 * `routedModel`/`observedModel` were already here; `routedLane` records
 * which lane the policy picked, and `observedLane` (nullable, same
 * post-run-arrival reason as `observedModel`) records which lane the run
 * actually went through, so a lane-level fallback (plan §3.2 L1) is
 * traceable the same way a model substitution already is. */
export interface RoutingTelemetryRow {
  runId: string;
  stage: string;
  templateId: string | null;
  designSystem: string | null;
  routedModel: string;
  /** Null until the run reports back (usage arrives post-run, plan §3.1). */
  observedModel: string | null;
  routedLane: string;
  /** Null until the run reports back, same as observedModel. */
  observedLane: string | null;
  tokens: RoutingTelemetryTokenCounts;
  cacheHits: number;
  latencyMs: number;
  costUsd: number;
  /** True when `costUsd` is a pre-run estimate rather than a billed figure
   * (mirrors the usage meter's `pricingVersion` uncertainty pattern). */
  costEstimated: boolean;
  gateOutcomes: Record<string, RoutingGateOutcome>;
  escalated: boolean;
  /** The RoutingPolicyDocument#policyVersion this run was routed under. */
  policyVersion: number;
  createdAt: string;
  recordedAt: string;
}

/** Per-lane rollup -- plan §5/fix-round-1 HIGH-6's "lane meter closure",
 * exposed through `/api/routing/meters` and `od route meters --json`. */
export interface LaneMeter {
  lane: string;
  runsRouted: number;
  runsObserved: number;
  escalationRate: number;
  passRate: number;
}

function isRoutingTelemetryTokenCounts(value: unknown): value is RoutingTelemetryTokenCounts {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.input === 'number' &&
    typeof value.output === 'number' &&
    typeof value.cacheReadInput === 'number'
  );
}

/** Rejects a `gateOutcomes` that is an array (arrays are `typeof ===
 * 'object'` too, so a naive object-shape check would wrongly accept one)
 * and validates every value against the closed RoutingGateOutcome enum --
 * an arbitrary string is not a legal gate outcome. */
function isGateOutcomesRecord(value: unknown): value is Record<string, RoutingGateOutcome> {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(
    (v) => typeof v === 'string' && (ROUTING_GATE_OUTCOMES as readonly string[]).includes(v),
  );
}

export function isRoutingTelemetryRow(value: unknown): value is RoutingTelemetryRow {
  if (!isPlainObject(value)) return false;
  const row = value;
  return (
    typeof row.runId === 'string' &&
    typeof row.stage === 'string' &&
    (row.templateId === null || typeof row.templateId === 'string') &&
    (row.designSystem === null || typeof row.designSystem === 'string') &&
    typeof row.routedModel === 'string' &&
    (row.observedModel === null || typeof row.observedModel === 'string') &&
    typeof row.routedLane === 'string' &&
    (row.observedLane === null || typeof row.observedLane === 'string') &&
    isRoutingTelemetryTokenCounts(row.tokens) &&
    typeof row.cacheHits === 'number' &&
    typeof row.latencyMs === 'number' &&
    typeof row.costUsd === 'number' &&
    typeof row.costEstimated === 'boolean' &&
    isGateOutcomesRecord(row.gateOutcomes) &&
    typeof row.escalated === 'boolean' &&
    typeof row.policyVersion === 'number' &&
    typeof row.createdAt === 'string' &&
    typeof row.recordedAt === 'string'
  );
}

export function isLaneMeter(value: unknown): value is LaneMeter {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.lane === 'string' &&
    typeof value.runsRouted === 'number' &&
    typeof value.runsObserved === 'number' &&
    typeof value.escalationRate === 'number' &&
    typeof value.passRate === 'number'
  );
}

/** Placeholder lane meter for a lane with no routed runs yet -- used by the
 * P0 daemon stub so `/api/routing/meters` returns a well-shaped empty array
 * rather than `null`/`undefined`. */
export function emptyLaneMeter(lane: string): LaneMeter {
  return { lane, runsRouted: 0, runsObserved: 0, escalationRate: 0, passRate: 0 };
}

/** Response envelope for GET /api/routing/meters -- shared by the route
 * handler and RoutingPanel so neither side locally recreates a partial type
 * (AGENTS.md's contracts rule). */
export interface RoutingMetersResponse {
  laneMeters: LaneMeter[];
}

export function isRoutingMetersResponse(value: unknown): value is RoutingMetersResponse {
  return isPlainObject(value) && Array.isArray(value.laneMeters) && value.laneMeters.every(isLaneMeter);
}
