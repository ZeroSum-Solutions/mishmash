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
 * exposed through `/api/routing/meters` and `od route meters --json`.
 *
 * `tokens`/`costUsd`/`costEstimated`/`throttleEvents` were added in the L5
 * storage tranche (plan §3.2 L5: "the router recommends... this dataset is
 * the only path to ever justifying learned routing") once real telemetry
 * rows existed to aggregate -- the P0 skeleton only had the four
 * pass/escalation-rate fields because there was no row content yet to sum. */
export interface LaneMeter {
  lane: string;
  runsRouted: number;
  runsObserved: number;
  escalationRate: number;
  passRate: number;
  /** Sum of every row's `tokens` routed to this lane in the aggregation
   * window (see `computeLaneMeters` in apps/daemon/src/routing/telemetry.ts). */
  tokens: RoutingTelemetryTokenCounts;
  /** Sum of every row's `costUsd` routed to this lane in the window. */
  costUsd: number;
  /** True only when every row contributing to `costUsd` had
   * `costEstimated: true` -- false the moment even one contributing row
   * carries a billed (non-estimated) figure. Mirrors `run_usage`'s own
   * `pricingVersion` honesty rule (usage-tracking.ts): never report a
   * confident-looking total that actually mixes estimates with real
   * invoices. Vacuously `true` for a lane with zero routed rows. */
  costEstimated: boolean;
  /** Count of rows routed to this lane whose `escalated` flag is true --
   * plan §3.1 L1's "observed throttles (429s, stream stalls) advance the
   * [fallback] chain," counted per lane so a lane's reliability is
   * visible on its own meter, not just folded into `escalationRate`. */
  throttleEvents: number;
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
    typeof value.passRate === 'number' &&
    isRoutingTelemetryTokenCounts(value.tokens) &&
    typeof value.costUsd === 'number' &&
    typeof value.costEstimated === 'boolean' &&
    typeof value.throttleEvents === 'number'
  );
}

/** Placeholder lane meter for a lane with no routed runs yet -- used by the
 * P0 daemon stub (and by `computeLaneMeters` for a lane it has never seen a
 * row for) so `/api/routing/meters` returns a well-shaped empty array
 * rather than `null`/`undefined`. */
export function emptyLaneMeter(lane: string): LaneMeter {
  return {
    lane,
    runsRouted: 0,
    runsObserved: 0,
    escalationRate: 0,
    passRate: 0,
    tokens: { input: 0, output: 0, cacheReadInput: 0 },
    costUsd: 0,
    costEstimated: true,
    throttleEvents: 0,
  };
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

/** A `RoutingTelemetryRow` as actually persisted (L5 storage tranche): every
 * stored row belongs to a project, the same way `run_usage`'s
 * `StoredRunUsageRecord` adds `projectId` on top of the daemon's in-memory
 * `RunUsageRecord` (usage-tracking.ts) rather than widening the base
 * content type. Kept as a strict extension (not a change to
 * `RoutingTelemetryRow`'s own fields) so the P0 wire shape stays exactly
 * what CWR-P1-2's existing contract test already pins. */
export interface StoredRoutingTelemetryRow extends RoutingTelemetryRow {
  projectId: string;
}

export function isStoredRoutingTelemetryRow(value: unknown): value is StoredRoutingTelemetryRow {
  return isRoutingTelemetryRow(value) && typeof (value as { projectId?: unknown }).projectId === 'string';
}

/** Response envelope for GET /api/routing/telemetry -- a filtered, paginated
 * read of the L5 storage table (plan §3.2 L5's "weekly policy review"
 * purpose). `total` is the full match count before `limit`/`offset` were
 * applied, so a caller can page without a second count query. */
export interface RoutingTelemetryListResponse {
  rows: StoredRoutingTelemetryRow[];
  total: number;
  limit: number;
  offset: number;
}

export function isRoutingTelemetryListResponse(value: unknown): value is RoutingTelemetryListResponse {
  return (
    isPlainObject(value) &&
    Array.isArray(value.rows) &&
    value.rows.every(isStoredRoutingTelemetryRow) &&
    typeof value.total === 'number' &&
    typeof value.limit === 'number' &&
    typeof value.offset === 'number'
  );
}
