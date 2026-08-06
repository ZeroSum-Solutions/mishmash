// L5 telemetry: SQLite storage, lane meters, and routed-vs-observed
// reconciliation (WR wave, P1 tranche -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.2 L5, §3.1).
//
// Follows apps/daemon/src/runtimes/usage-tracking.ts's SQLite pattern
// EXACTLY: a dedicated table this module owns outright (not a new column
// on a shared table), idempotent per-run-id upsert (a retried/resumed run
// replaces its own prior row instead of accumulating duplicates), and no
// pragma of its own -- WAL mode is already set once, globally, by
// db.ts's openDatabase() on the single shared connection every caller
// hands this module. `ensureRoutingTelemetryTable` mirrors
// `ensureUsageTable`'s shape; `recordRoutingTelemetry` mirrors
// `recordRunUsage`'s upsert; `listRoutingTelemetry` mirrors
// `listProjectRunUsage`.
//
// Scope discipline (WR t4): storage + query + reconciliation only. Nothing
// here calls recordRoutingTelemetry from a real dispatch or run-finalize
// path -- that wiring is t9's job -- and there is no admission-control
// logic here (t6).
import type Database from 'better-sqlite3';
import {
  emptyLaneMeter,
  isStoredRoutingTelemetryRow,
  type LaneMeter,
  type RoutingGateOutcome,
  type RoutingTelemetryListResponse,
  type RoutingTelemetryRow,
  type StoredRoutingTelemetryRow,
} from '@open-design/contracts';

export function ensureRoutingTelemetryTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS routing_telemetry (
      run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      template_id TEXT,
      design_system TEXT,
      routed_model TEXT NOT NULL,
      observed_model TEXT,
      routed_lane TEXT NOT NULL,
      observed_lane TEXT,
      tokens_input INTEGER NOT NULL,
      tokens_output INTEGER NOT NULL,
      tokens_cache_read_input INTEGER NOT NULL,
      cache_hits INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      cost_estimated INTEGER NOT NULL,
      gate_outcomes_json TEXT NOT NULL,
      escalated INTEGER NOT NULL,
      policy_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_routing_telemetry_project_id ON routing_telemetry(project_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_routing_telemetry_stage ON routing_telemetry(stage)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_routing_telemetry_created_at ON routing_telemetry(created_at)`);
}

/** Idempotent per run id, exactly like `recordRunUsage` -- a row written at
 * dispatch time (observedModel/observedLane null) and later updated once
 * usage arrives post-run (plan §3.1) replaces itself in place rather than
 * accumulating a second row for the same run. Throws on a row that fails
 * the contracts guard: a malformed telemetry row must fail loudly, not
 * silently persist a shape the reconciliation/meter readers below cannot
 * trust (mirrors routing/policy.ts's loadRoutingPolicy fail-loud stance). */
export function recordRoutingTelemetry(db: Database.Database, row: StoredRoutingTelemetryRow): void {
  if (!isStoredRoutingTelemetryRow(row)) {
    throw new Error(
      `invalid routing telemetry row for run ${String((row as { runId?: unknown } | null)?.runId)}: failed isStoredRoutingTelemetryRow guard`,
    );
  }
  db.prepare(
    `INSERT INTO routing_telemetry
       (run_id, project_id, stage, template_id, design_system, routed_model,
        observed_model, routed_lane, observed_lane, tokens_input, tokens_output,
        tokens_cache_read_input, cache_hits, latency_ms, cost_usd, cost_estimated,
        gate_outcomes_json, escalated, policy_version, created_at, recorded_at)
     VALUES (@runId, @projectId, @stage, @templateId, @designSystem, @routedModel,
             @observedModel, @routedLane, @observedLane, @tokensInput, @tokensOutput,
             @tokensCacheReadInput, @cacheHits, @latencyMs, @costUsd, @costEstimated,
             @gateOutcomesJson, @escalated, @policyVersion, @createdAt, @recordedAt)
     ON CONFLICT(run_id) DO UPDATE SET
       project_id = excluded.project_id,
       stage = excluded.stage,
       template_id = excluded.template_id,
       design_system = excluded.design_system,
       routed_model = excluded.routed_model,
       observed_model = excluded.observed_model,
       routed_lane = excluded.routed_lane,
       observed_lane = excluded.observed_lane,
       tokens_input = excluded.tokens_input,
       tokens_output = excluded.tokens_output,
       tokens_cache_read_input = excluded.tokens_cache_read_input,
       cache_hits = excluded.cache_hits,
       latency_ms = excluded.latency_ms,
       cost_usd = excluded.cost_usd,
       cost_estimated = excluded.cost_estimated,
       gate_outcomes_json = excluded.gate_outcomes_json,
       escalated = excluded.escalated,
       policy_version = excluded.policy_version,
       created_at = excluded.created_at,
       recorded_at = excluded.recorded_at`,
  ).run(rowToParams(row));
}

interface RoutingTelemetryDbRow {
  run_id: string;
  project_id: string;
  stage: string;
  template_id: string | null;
  design_system: string | null;
  routed_model: string;
  observed_model: string | null;
  routed_lane: string;
  observed_lane: string | null;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read_input: number;
  cache_hits: number;
  latency_ms: number;
  cost_usd: number;
  cost_estimated: number;
  gate_outcomes_json: string;
  escalated: number;
  policy_version: number;
  created_at: string;
  recorded_at: string;
}

function rowToParams(row: StoredRoutingTelemetryRow) {
  return {
    runId: row.runId,
    projectId: row.projectId,
    stage: row.stage,
    templateId: row.templateId,
    designSystem: row.designSystem,
    routedModel: row.routedModel,
    observedModel: row.observedModel,
    routedLane: row.routedLane,
    observedLane: row.observedLane,
    tokensInput: row.tokens.input,
    tokensOutput: row.tokens.output,
    tokensCacheReadInput: row.tokens.cacheReadInput,
    cacheHits: row.cacheHits,
    latencyMs: row.latencyMs,
    costUsd: row.costUsd,
    costEstimated: row.costEstimated ? 1 : 0,
    gateOutcomesJson: JSON.stringify(row.gateOutcomes),
    escalated: row.escalated ? 1 : 0,
    policyVersion: row.policyVersion,
    createdAt: row.createdAt,
    recordedAt: row.recordedAt,
  };
}

function dbRowToStored(row: RoutingTelemetryDbRow): StoredRoutingTelemetryRow {
  let gateOutcomes: Record<string, RoutingGateOutcome> = {};
  try {
    const parsed: unknown = JSON.parse(row.gate_outcomes_json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      gateOutcomes = parsed as Record<string, RoutingGateOutcome>;
    }
  } catch {
    gateOutcomes = {};
  }
  return {
    runId: row.run_id,
    projectId: row.project_id,
    stage: row.stage,
    templateId: row.template_id,
    designSystem: row.design_system,
    routedModel: row.routed_model,
    observedModel: row.observed_model,
    routedLane: row.routed_lane,
    observedLane: row.observed_lane,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      cacheReadInput: row.tokens_cache_read_input,
    },
    cacheHits: row.cache_hits,
    latencyMs: row.latency_ms,
    costUsd: row.cost_usd,
    costEstimated: row.cost_estimated === 1,
    gateOutcomes,
    escalated: row.escalated === 1,
    policyVersion: row.policy_version,
    createdAt: row.created_at,
    recordedAt: row.recorded_at,
  };
}

const ROUTING_TELEMETRY_SELECT_COLS = `run_id, project_id, stage, template_id, design_system, routed_model,
  observed_model, routed_lane, observed_lane, tokens_input, tokens_output,
  tokens_cache_read_input, cache_hits, latency_ms, cost_usd, cost_estimated,
  gate_outcomes_json, escalated, policy_version, created_at, recorded_at`;

export function getRoutingTelemetryByRunId(
  db: Database.Database,
  runId: string,
): StoredRoutingTelemetryRow | null {
  const row = db
    .prepare(`SELECT ${ROUTING_TELEMETRY_SELECT_COLS} FROM routing_telemetry WHERE run_id = ?`)
    .get(runId) as RoutingTelemetryDbRow | undefined;
  return row ? dbRowToStored(row) : null;
}

export interface RoutingTelemetryFilters {
  projectId?: string | undefined;
  runId?: string | undefined;
  stage?: string | undefined;
  /** Inclusive lower bound on `createdAt`, epoch milliseconds. */
  sinceMs?: number | undefined;
  /** Inclusive upper bound on `createdAt`, epoch milliseconds. */
  untilMs?: number | undefined;
}

export interface RoutingTelemetryPagination {
  limit?: number | undefined;
  offset?: number | undefined;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 500;

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIST_LIMIT);
}

function buildFilterClause(filters: RoutingTelemetryFilters): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.projectId !== undefined) {
    clauses.push('project_id = ?');
    params.push(filters.projectId);
  }
  if (filters.runId !== undefined) {
    clauses.push('run_id = ?');
    params.push(filters.runId);
  }
  if (filters.stage !== undefined) {
    clauses.push('stage = ?');
    params.push(filters.stage);
  }
  if (filters.sinceMs !== undefined) {
    clauses.push('created_at >= ?');
    params.push(new Date(filters.sinceMs).toISOString());
  }
  if (filters.untilMs !== undefined) {
    clauses.push('created_at <= ?');
    params.push(new Date(filters.untilMs).toISOString());
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/** Filtered, paginated read of the telemetry table -- plan §3.2 L5's
 * "weekly policy review" purpose, and the storage side of the optional
 * GET /api/routing/telemetry surface. `total` is the full match count
 * before `limit`/`offset`, so a caller can page without a second request. */
export function listRoutingTelemetry(
  db: Database.Database,
  filters: RoutingTelemetryFilters = {},
  pagination: RoutingTelemetryPagination = {},
): RoutingTelemetryListResponse {
  const limit = clampLimit(pagination.limit);
  const offset = Math.max(0, Math.floor(pagination.offset ?? 0));
  const { where, params } = buildFilterClause(filters);
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM routing_telemetry ${where}`).get(...params) as { n: number }
  ).n;
  const dbRows = db
    .prepare(
      `SELECT ${ROUTING_TELEMETRY_SELECT_COLS}
         FROM routing_telemetry
         ${where}
        ORDER BY created_at DESC, run_id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as RoutingTelemetryDbRow[];
  return { rows: dbRows.map(dbRowToStored), total, limit, offset };
}

/** Unpaginated internal read used only by `computeLaneMeters` -- lane
 * aggregation needs every matching row, not a page of them. */
function fetchRowsForAggregation(db: Database.Database, windowMs: number | undefined): StoredRoutingTelemetryRow[] {
  const filters: RoutingTelemetryFilters =
    windowMs !== undefined ? { sinceMs: Date.now() - windowMs } : {};
  const { where, params } = buildFilterClause(filters);
  const dbRows = db
    .prepare(`SELECT ${ROUTING_TELEMETRY_SELECT_COLS} FROM routing_telemetry ${where}`)
    .all(...params) as RoutingTelemetryDbRow[];
  return dbRows.map(dbRowToStored);
}

interface LaneAccumulator {
  runsRouted: number;
  runsObserved: number;
  escalatedCount: number;
  gatedCount: number;
  gatedPassCount: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheReadInput: number;
  costUsd: number;
  costEstimated: boolean;
  throttleEvents: number;
}

function newAccumulator(): LaneAccumulator {
  return {
    runsRouted: 0,
    runsObserved: 0,
    escalatedCount: 0,
    gatedCount: 0,
    gatedPassCount: 0,
    tokensInput: 0,
    tokensOutput: 0,
    tokensCacheReadInput: 0,
    costUsd: 0,
    costEstimated: true,
    throttleEvents: 0,
  };
}

function allGatesPass(gateOutcomes: Record<string, RoutingGateOutcome>): boolean {
  const outcomes = Object.values(gateOutcomes);
  return outcomes.length > 0 && outcomes.every((outcome) => outcome === 'pass');
}

/** Aggregates observed usage per lane over the trailing `windowMs`
 * (omit for all-time) -- plan §3.2 L5: tokens, estimated cost, run counts,
 * and throttle events per lane, the dataset the weekly policy review reads
 * ("stage escalation rate above its alarm -> fix the table"). A lane
 * appears in the result if it was ever routed to OR ever observed
 * (fallback target), even if the two never coincide for a given run --
 * this is exactly the lane-level fallback plan §3.1 says must be
 * traceable. Lanes are returned sorted by id for a stable response shape. */
export function computeLaneMeters(db: Database.Database, windowMs?: number): LaneMeter[] {
  const rows = fetchRowsForAggregation(db, windowMs);
  const byLane = new Map<string, LaneAccumulator>();
  const accFor = (lane: string): LaneAccumulator => {
    let acc = byLane.get(lane);
    if (!acc) {
      acc = newAccumulator();
      byLane.set(lane, acc);
    }
    return acc;
  };

  for (const row of rows) {
    const routed = accFor(row.routedLane);
    routed.runsRouted += 1;
    routed.tokensInput += row.tokens.input;
    routed.tokensOutput += row.tokens.output;
    routed.tokensCacheReadInput += row.tokens.cacheReadInput;
    routed.costUsd += row.costUsd;
    routed.costEstimated = routed.costEstimated && row.costEstimated;
    if (row.escalated) {
      routed.escalatedCount += 1;
      routed.throttleEvents += 1;
    }
    if (Object.keys(row.gateOutcomes).length > 0) {
      routed.gatedCount += 1;
      if (allGatesPass(row.gateOutcomes)) routed.gatedPassCount += 1;
    }
    if (row.observedLane !== null) {
      accFor(row.observedLane).runsObserved += 1;
    }
  }

  return [...byLane.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lane, acc]) => {
      const meter: LaneMeter = {
        ...emptyLaneMeter(lane),
        runsRouted: acc.runsRouted,
        runsObserved: acc.runsObserved,
        escalationRate: acc.runsRouted > 0 ? acc.escalatedCount / acc.runsRouted : 0,
        passRate: acc.gatedCount > 0 ? acc.gatedPassCount / acc.gatedCount : 0,
        tokens: {
          input: acc.tokensInput,
          output: acc.tokensOutput,
          cacheReadInput: acc.tokensCacheReadInput,
        },
        costUsd: acc.costUsd,
        costEstimated: acc.costEstimated,
        throttleEvents: acc.throttleEvents,
      };
      return meter;
    });
}

export type RoutingReconciliationStatus = 'match' | 'model-divergence' | 'lane-divergence' | 'unverified';

/** Divergence flag + reason for one telemetry row's routed-vs-observed pair
 * (plan §3.1: "post-run usage reconciliation that flags runs whose
 * observed usage diverges from the routed intent"). */
export interface RoutingReconciliation {
  status: RoutingReconciliationStatus;
  divergent: boolean;
  reason: string;
}

type RoutingReconcileInput = Pick<RoutingTelemetryRow, 'routedModel' | 'observedModel' | 'routedLane' | 'observedLane'>;

/**
 * Deliberate parallel to packages/contracts/src/api/model-routing.ts's
 * `computeModelRoutingDisplayState` -- NOT imported or modified here.
 * That function answers a different question at a different layer
 * (requested vs. resolved vs. reported, for one run's model identity, at
 * the W1 usage-tracking layer). This answers "routed vs. observed" for a
 * telemetry row, across BOTH model and lane, at the WR routing layer. The
 * shared idea is precedence, not code: a detected divergence is reported
 * immediately, even if the other axis hasn't reported back yet, and only
 * full, unanimous confirmation earns the non-divergent terminal state --
 * anything short of that (including a legitimately-not-arrived-yet
 * observation) is `'unverified'`, per this module's brief: "observed
 * unavailable => 'unverified', not a divergence."
 */
function reconcileRow(row: RoutingReconcileInput): RoutingReconciliation {
  if (row.observedModel !== null && row.observedModel !== row.routedModel) {
    return {
      status: 'model-divergence',
      divergent: true,
      reason: `routed model "${row.routedModel}" but observed "${row.observedModel}"`,
    };
  }
  if (row.observedLane !== null && row.observedLane !== row.routedLane) {
    return {
      status: 'lane-divergence',
      divergent: true,
      reason: `routed lane "${row.routedLane}" but observed "${row.observedLane}"`,
    };
  }
  if (row.observedModel !== null && row.observedLane !== null) {
    return {
      status: 'match',
      divergent: false,
      reason: 'observed model and lane both confirm the routed decision',
    };
  }
  return {
    status: 'unverified',
    divergent: false,
    reason: "observed model/lane not yet reported -- usage arrives post-run (plan §3.1)",
  };
}

export function reconcileRoutedVsObserved(row: RoutingReconcileInput): RoutingReconciliation;
export function reconcileRoutedVsObserved(db: Database.Database, runId: string): RoutingReconciliation | null;
export function reconcileRoutedVsObserved(
  arg: RoutingReconcileInput | Database.Database,
  runId?: string,
): RoutingReconciliation | null {
  if (typeof runId === 'string') {
    const row = getRoutingTelemetryByRunId(arg as Database.Database, runId);
    return row ? reconcileRow(row) : null;
  }
  return reconcileRow(arg as RoutingReconcileInput);
}
