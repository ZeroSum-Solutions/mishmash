// Routing telemetry contract (WR wave, P0 skeleton -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.2 L5). Per-run telemetry
// row shape (stage, template, design system, routed-vs-observed model AND
// lane, tokens, cache hits, latency, cost, gate outcomes, escalation) and
// the per-lane meter shape both endpoints/CLI subcommands in this wave
// return. Durable persistence (SQLite) and real gate-outcome content land
// in later WR tranches -- see docs/plans/waves/WR-routing.md's Tranche
// register (CWR-P1-2 for the telemetry row, CWR-P2-4 for lane meters).
import { isFiniteNonNegativeInteger, isPlainObject } from './routing-policy.js';

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
 * Sol review (t4 fix commit) HIGH-2/HIGH-3: usage/cost/gate/escalation
 * metrics are attributed to whichever lane a row's `observedLane ??
 * routedLane` names -- NOT unconditionally to `routedLane` -- because a row
 * whose run actually executed on a different (fallback) lane must not have
 * its cost/tokens/escalation counted against the lane it was merely
 * *routed* to. `runsRouted`/`runsObserved` stay pure routing-decision /
 * confirmed-observation counts (unaffected by attribution); `attributedRuns`
 * is the new denominator for `escalationRate`/`passRate`/the summed
 * metrics, and `attribution` records which rule(s) produced it. */
export interface LaneMeter {
  lane: string;
  /** Count of rows whose ROUTING decision targeted this lane, regardless of
   * where the run's metrics ended up attributed. */
  runsRouted: number;
  /** Count of rows whose CONFIRMED `observedLane` is this lane (null
   * observedLane rows are never counted here, even when they fall back to
   * this lane for attribution -- see `attributedRuns`). */
  runsObserved: number;
  /** escalatedCount / attributedRuns for rows attributed to this lane (0
   * when attributedRuns is 0). */
  escalationRate: number;
  /** gatedPassCount / gatedCount for rows attributed to this lane that
   * carried at least one gate outcome (0 when none did). */
  passRate: number;
  /** Sum of every ATTRIBUTED row's `tokens` for this lane in the
   * aggregation window (see `computeLaneMeters` in
   * apps/daemon/src/routing/telemetry.ts). */
  tokens: RoutingTelemetryTokenCounts;
  /** Sum of every ATTRIBUTED row's `costUsd` for this lane in the window. */
  costUsd: number;
  /** Tri-state, replacing a plain boolean (Sol HIGH-3): a lane's cost total
   * can legitimately mix billed and estimated rows, and collapsing that to
   * `costEstimated: false` on the first exact row silently hid the estimate
   * still baked into the sum. `'exact'` only when every attributed row was
   * billed, `'estimated'` only when every attributed row was a pre-run
   * estimate, `'mixed'` when both occurred, and `'exact'` (vacuously) for a
   * lane with zero attributed rows -- mirrors `run_usage`'s own
   * `pricingVersion` honesty rule (usage-tracking.ts) one step further. */
  cost: 'exact' | 'estimated' | 'mixed';
  /** Count of ATTRIBUTED rows whose `escalated` flag is true -- plan §3.1
   * L1's "observed throttles (429s, stream stalls) advance the [fallback]
   * chain," counted per lane so a lane's reliability is visible on its own
   * meter, not just folded into `escalationRate`. */
  throttleEvents: number;
  /** Count of rows whose usage/cost/gates/escalations are actually charged
   * to this lane (`observedLane ?? routedLane === lane`) -- the denominator
   * `escalationRate`/`passRate`/the summed fields above are computed over.
   * Distinct from `runsRouted` precisely when a row's observed lane
   * diverges from its routed lane. */
  attributedRuns: number;
  /** Which rule produced `attributedRuns`' metrics: `'observed'` when every
   * attributed row had a confirmed, non-null `observedLane` naming this
   * lane; `'routed-fallback'` when every attributed row instead fell back
   * to this lane because `observedLane` was still null; `'mixed'` when
   * both kinds contributed; `'none'` when this lane has zero attributed
   * rows (it may still have `runsRouted`/`runsObserved` activity). */
  attribution: 'observed' | 'routed-fallback' | 'mixed' | 'none';
}

function isRoutingTelemetryTokenCounts(value: unknown): value is RoutingTelemetryTokenCounts {
  if (!isPlainObject(value)) return false;
  return (
    isNonNegativeFiniteNumber(value.input) &&
    isNonNegativeFiniteNumber(value.output) &&
    isNonNegativeFiniteNumber(value.cacheReadInput)
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

// ---- Semantic validation helpers (Sol review MED-5) ------------------------
//
// A shape-only guard (`typeof x === 'string'`) accepted an empty runId, a
// negative token count, or an unparseable timestamp as a "valid" row --
// each of those corrupts downstream aggregation/reconciliation silently
// (an empty-string lane id collapsing into another lane's bucket, a
// negative cost inverting a sum, an invalid timestamp sorting outside its
// real window). These helpers turn that into a rejected row instead.

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Accepts only a value `Date.parse` can resolve to a real instant --
 * rejects non-strings, empty strings, and non-date text (`Date.parse`
 * returns `NaN` for those) as well as literal `NaN`/`Infinity` timestamps. */
function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

export function isRoutingTelemetryRow(value: unknown): value is RoutingTelemetryRow {
  if (!isPlainObject(value)) return false;
  const row = value;
  return (
    isNonEmptyString(row.runId) &&
    isNonEmptyString(row.stage) &&
    (row.templateId === null || isNonEmptyString(row.templateId)) &&
    (row.designSystem === null || isNonEmptyString(row.designSystem)) &&
    isNonEmptyString(row.routedModel) &&
    (row.observedModel === null || isNonEmptyString(row.observedModel)) &&
    isNonEmptyString(row.routedLane) &&
    (row.observedLane === null || isNonEmptyString(row.observedLane)) &&
    isRoutingTelemetryTokenCounts(row.tokens) &&
    isNonNegativeFiniteNumber(row.cacheHits) &&
    isNonNegativeFiniteNumber(row.latencyMs) &&
    isNonNegativeFiniteNumber(row.costUsd) &&
    typeof row.costEstimated === 'boolean' &&
    isGateOutcomesRecord(row.gateOutcomes) &&
    typeof row.escalated === 'boolean' &&
    isNonNegativeFiniteNumber(row.policyVersion) &&
    isValidTimestamp(row.createdAt) &&
    isValidTimestamp(row.recordedAt)
  );
}

export function isLaneMeter(value: unknown): value is LaneMeter {
  if (!isPlainObject(value)) return false;
  const COST_STATES = ['exact', 'estimated', 'mixed'] as const;
  const ATTRIBUTION_STATES = ['observed', 'routed-fallback', 'mixed', 'none'] as const;
  return (
    typeof value.lane === 'string' &&
    typeof value.runsRouted === 'number' &&
    typeof value.runsObserved === 'number' &&
    typeof value.escalationRate === 'number' &&
    typeof value.passRate === 'number' &&
    isRoutingTelemetryTokenCounts(value.tokens) &&
    typeof value.costUsd === 'number' &&
    typeof value.cost === 'string' &&
    (COST_STATES as readonly string[]).includes(value.cost) &&
    // Sol review MED-4: a throttle-event TALLY must be a nonnegative
    // integer -- NaN is `typeof 'number'` too, and a NaN threshold silently
    // fails OPEN in decision.ts's `throttleEvents > maxThrottleEvents` check
    // (comparisons against NaN are always false).
    isFiniteNonNegativeInteger(value.throttleEvents) &&
    typeof value.attributedRuns === 'number' &&
    typeof value.attribution === 'string' &&
    (ATTRIBUTION_STATES as readonly string[]).includes(value.attribution)
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
    cost: 'exact',
    throttleEvents: 0,
    attributedRuns: 0,
    attribution: 'none',
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
 * what CWR-P1-2's existing contract test already pins.
 *
 * `attempt` (Sol review MED-4): a run-boundary escalation/retry (plan
 * §3.1: "run-boundary cascade... fresh context on escalation") re-dispatches
 * the SAME logical run under a new attempt rather than mutating history in
 * place -- storage keys on `(runId, attempt)`, not `runId` alone, so a
 * retried run's FIRST attempt's routed-vs-observed outcome survives instead
 * of being silently overwritten by the second. `0` is the first attempt. */
export interface StoredRoutingTelemetryRow extends RoutingTelemetryRow {
  projectId: string;
  attempt: number;
}

export function isStoredRoutingTelemetryRow(value: unknown): value is StoredRoutingTelemetryRow {
  if (!isRoutingTelemetryRow(value)) return false;
  const row = value as { projectId?: unknown; attempt?: unknown };
  return (
    isNonEmptyString(row.projectId) &&
    typeof row.attempt === 'number' &&
    Number.isInteger(row.attempt) &&
    row.attempt >= 0
  );
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
