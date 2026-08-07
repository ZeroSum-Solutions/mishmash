// L5 telemetry: SQLite storage, lane meters, and routed-vs-observed
// reconciliation (WR wave, P1 tranche -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.2 L5, §3.1).
//
// Follows apps/daemon/src/runtimes/usage-tracking.ts's SQLite pattern
// EXACTLY where the two concepts actually match: a dedicated table this
// module owns outright (not a new column on a shared table), no pragma of
// its own -- WAL mode is already set once, globally, by db.ts's
// openDatabase() on the single shared connection every caller hands this
// module. `ensureRoutingTelemetryTable` mirrors `ensureUsageTable`'s shape;
// `listRoutingTelemetry` mirrors `listProjectRunUsage`.
//
// One deliberate departure from usage-tracking.ts (Sol review MED-4): a
// run-boundary escalation/retry re-dispatches the SAME logical run under a
// new attempt (plan §3.1: "run-boundary cascade... fresh context on
// escalation"), and escalation analysis is itself a §3.2 L5 purpose -- so
// unlike `run_usage`'s "last write wins" run-id-only key (which is correct
// for a cost total that should only ever reflect the CURRENT run), this
// table keys on `(run_id, attempt)` so a retried run's first attempt
// survives its own replacement rather than being silently overwritten.
//
// Scope discipline (WR t4): storage + query + reconciliation only. Nothing
// here calls recordRoutingTelemetry from a real dispatch or run-finalize
// path -- that wiring is t9's job -- and there is no admission-control
// logic here (t6).
import type Database from 'better-sqlite3';
import {
  isStoredRoutingTelemetryRow,
  type LaneMeter,
  type RoutingGateOutcome,
  type RoutingTelemetryListResponse,
  type RoutingTelemetryRow,
  type StoredRoutingTelemetryRow,
} from '@open-design/contracts';

const ROUTING_TELEMETRY_CURRENT_SHAPE_DDL = `
    CREATE TABLE IF NOT EXISTS routing_telemetry (
      run_id TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      project_id TEXT NOT NULL,
      build_id TEXT,
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
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (run_id, attempt)
    )
`;

/** Sol review MED-4 (fix round 2): `CREATE TABLE IF NOT EXISTS` alone is a
 * no-op against a table that already exists in the OLD pre-attempt shape
 * (`run_id TEXT PRIMARY KEY`, no `attempt` column) -- the shape this same
 * module shipped as of commit `9bd640e45`. That schema never reached
 * `main`, but a daemon data dir created against it (e.g. a long-running
 * dev instance on this branch) would otherwise have every subsequent
 * `recordRoutingTelemetry` call fail with "no column named attempt".
 * Detects that exact case via `PRAGMA table_info` and rebuild-migrates in
 * place: new-shape table -> copy every existing row in with `attempt = 0`
 * (the only attempt an old-shape row could ever represent) -> drop the old
 * table -> rename, all inside one transaction so a crash mid-migration
 * cannot leave the database in a table-less state. */
function migrateOldShapeRoutingTelemetryTable(db: Database.Database): void {
  const tableExists = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'routing_telemetry'`)
      .get() as { n: number }
  ).n;
  if (tableExists === 0) return; // nothing to migrate -- the CREATE below makes the current shape fresh.

  const columns = db.prepare(`PRAGMA table_info(routing_telemetry)`).all() as Array<{ name: string }>;
  const hasAttemptColumn = columns.some((c) => c.name === 'attempt');
  if (hasAttemptColumn) return; // already current shape.

  const migrate = db.transaction(() => {
    // Defensive: a prior migration attempt that crashed mid-way could have
    // left a stale scratch table around -- clear it before rebuilding so
    // this migration is itself idempotent/retriable.
    db.exec(`DROP TABLE IF EXISTS routing_telemetry_migrated`);
    db.exec(ROUTING_TELEMETRY_CURRENT_SHAPE_DDL.replace('routing_telemetry', 'routing_telemetry_migrated'));
    db.exec(`
      INSERT INTO routing_telemetry_migrated
        (run_id, attempt, project_id, build_id, stage, template_id, design_system, routed_model,
         observed_model, routed_lane, observed_lane, tokens_input, tokens_output,
         tokens_cache_read_input, cache_hits, latency_ms, cost_usd, cost_estimated,
         gate_outcomes_json, escalated, policy_version, created_at, recorded_at)
      SELECT run_id, 0, project_id, NULL, stage, template_id, design_system, routed_model,
         observed_model, routed_lane, observed_lane, tokens_input, tokens_output,
         tokens_cache_read_input, cache_hits, latency_ms, cost_usd, cost_estimated,
         gate_outcomes_json, escalated, policy_version, created_at, recorded_at
        FROM routing_telemetry
    `);
    db.exec(`DROP TABLE routing_telemetry`);
    db.exec(`ALTER TABLE routing_telemetry_migrated RENAME TO routing_telemetry`);
  });
  migrate();
}

/** t6 addition: a data dir created against the P1-shape table (has `attempt`
 * but predates this tranche's `build_id` column) needs a narrower migration
 * than `migrateOldShapeRoutingTelemetryTable` -- `build_id` never
 * participates in the primary key, so a plain `ALTER TABLE ... ADD COLUMN`
 * (nullable, no default needed) is sufficient; no rebuild-and-copy dance.
 * No-ops when the table doesn't exist yet (the fresh CREATE below already
 * ships the column) or already has it. */
function migrateMissingBuildIdColumn(db: Database.Database): void {
  const tableExists = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'routing_telemetry'`)
      .get() as { n: number }
  ).n;
  if (tableExists === 0) return;
  const columns = db.prepare(`PRAGMA table_info(routing_telemetry)`).all() as Array<{ name: string }>;
  const hasBuildIdColumn = columns.some((c) => c.name === 'build_id');
  if (hasBuildIdColumn) return;
  db.exec(`ALTER TABLE routing_telemetry ADD COLUMN build_id TEXT`);
}

export function ensureRoutingTelemetryTable(db: Database.Database): void {
  migrateOldShapeRoutingTelemetryTable(db);
  migrateMissingBuildIdColumn(db);
  db.exec(ROUTING_TELEMETRY_CURRENT_SHAPE_DDL);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_routing_telemetry_project_id ON routing_telemetry(project_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_routing_telemetry_stage ON routing_telemetry(stage)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_routing_telemetry_created_at ON routing_telemetry(created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_routing_telemetry_build_id ON routing_telemetry(build_id)`);
}

/** Idempotent per `(run_id, attempt)` -- a row written at dispatch time
 * (observedModel/observedLane null) and later updated once usage arrives
 * post-run (plan §3.1) for the SAME attempt replaces itself in place, but a
 * new attempt number (a run-boundary retry/escalation) inserts a sibling
 * row rather than clobbering the prior attempt's outcome (Sol review
 * MED-4). Throws on a row that fails the contracts guard: a malformed
 * telemetry row must fail loudly, not silently persist a shape the
 * reconciliation/meter readers below cannot trust (mirrors
 * routing/policy.ts's loadRoutingPolicy fail-loud stance). */
export function recordRoutingTelemetry(db: Database.Database, row: StoredRoutingTelemetryRow): void {
  if (!isStoredRoutingTelemetryRow(row)) {
    throw new Error(
      `invalid routing telemetry row for run ${String((row as { runId?: unknown } | null)?.runId)}: failed isStoredRoutingTelemetryRow guard`,
    );
  }
  db.prepare(
    `INSERT INTO routing_telemetry
       (run_id, attempt, project_id, build_id, stage, template_id, design_system, routed_model,
        observed_model, routed_lane, observed_lane, tokens_input, tokens_output,
        tokens_cache_read_input, cache_hits, latency_ms, cost_usd, cost_estimated,
        gate_outcomes_json, escalated, policy_version, created_at, recorded_at)
     VALUES (@runId, @attempt, @projectId, @buildId, @stage, @templateId, @designSystem, @routedModel,
             @observedModel, @routedLane, @observedLane, @tokensInput, @tokensOutput,
             @tokensCacheReadInput, @cacheHits, @latencyMs, @costUsd, @costEstimated,
             @gateOutcomesJson, @escalated, @policyVersion, @createdAt, @recordedAt)
     ON CONFLICT(run_id, attempt) DO UPDATE SET
       project_id = excluded.project_id,
       build_id = excluded.build_id,
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

/**
 * t8 addition (plan §3.2 L3, deterministic gate runner): patches ONLY the
 * `gate_outcomes_json` (and, since the MED-4 fix-round, `escalated`) columns
 * of an ALREADY-RECORDED telemetry row -- L3 gates run after dispatch-time
 * telemetry is written (`recordRoutingTelemetry` establishes the row via the
 * dispatch path), so this is a targeted UPDATE, not a second full-row
 * INSERT..ON CONFLICT DO UPDATE round trip (which would also require
 * re-supplying every other column this caller has no reason to know at
 * gate-run time).
 *
 * Sol review MED-4 (fix-round): a gate cascade attached to an EXISTING
 * dispatch row (the `runIdSynthetic: false` path in routes/routing.ts) used
 * to update only `gate_outcomes_json`, never `escalated` -- the caller's own
 * `classifyCascadeTrigger` verdict was computed and used to advance the
 * server-side cascade tier, but never actually reached the telemetry row
 * `computeRoutingRates`' escalation-rate aggregation reads, so real
 * gate-driven escalations on an attached run silently never counted. `SET
 * escalated = MAX(escalated, @escalated)` (SQLite booleans are 0/1
 * integers) is a single atomic UPDATE alongside `gate_outcomes_json`, and is
 * monotonic ONE-WAY -- `/gates/run` may be called more than once against the
 * same `(runId, attempt)` as a cascade climbs tiers, and a later call that
 * itself does not escalate (e.g. already at the frontier tier) must never
 * un-mark a row an earlier call in the same attempt legitimately escalated.
 *
 * Throws when no row exists for `(runId, attempt)`: recording gate outcomes
 * for a run that was never routed/recorded is a caller bug, not a silent
 * no-op -- mirrors `recordRoutingTelemetry`'s and `loadRoutingPolicy`'s own
 * fail-loud stance elsewhere in this package ("never a silent pass, never a
 * fake pass" extends to "never a silent no-write" here).
 *
 * `apps/daemon/src/routing/gates.ts`'s `recordGateOutcomes` is the only
 * caller -- it maps a run's `GateResult[]` into the `Record<string,
 * RoutingGateOutcome>` shape this function persists.
 */
export function updateGateOutcomes(
  db: Database.Database,
  runId: string,
  attempt: number,
  gateOutcomes: Record<string, RoutingGateOutcome>,
  escalated: boolean,
): void {
  ensureRoutingTelemetryTable(db);
  const result = db
    .prepare(
      `UPDATE routing_telemetry SET gate_outcomes_json = @gateOutcomesJson, escalated = MAX(escalated, @escalated) WHERE run_id = @runId AND attempt = @attempt`,
    )
    .run({ gateOutcomesJson: JSON.stringify(gateOutcomes), escalated: escalated ? 1 : 0, runId, attempt });
  if (result.changes === 0) {
    throw new Error(
      `updateGateOutcomes: no routing_telemetry row for (runId=${runId}, attempt=${attempt}) -- record the routing telemetry row (recordRoutingTelemetry) before recording gate outcomes.`,
    );
  }
}

interface RoutingTelemetryDbRow {
  run_id: string;
  attempt: number;
  project_id: string;
  build_id: string | null;
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
    attempt: row.attempt,
    projectId: row.projectId,
    buildId: row.buildId,
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
    attempt: row.attempt,
    projectId: row.project_id,
    buildId: row.build_id,
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

const ROUTING_TELEMETRY_SELECT_COLS = `run_id, attempt, project_id, build_id, stage, template_id, design_system, routed_model,
  observed_model, routed_lane, observed_lane, tokens_input, tokens_output,
  tokens_cache_read_input, cache_hits, latency_ms, cost_usd, cost_estimated,
  gate_outcomes_json, escalated, policy_version, created_at, recorded_at`;

/** Reads one specific attempt of a run (default: attempt 0, the first
 * dispatch). Use `listRoutingTelemetryAttempts` to read every attempt a
 * run has accumulated. */
export function getRoutingTelemetryByRunId(
  db: Database.Database,
  runId: string,
  attempt: number = 0,
): StoredRoutingTelemetryRow | null {
  const row = db
    .prepare(`SELECT ${ROUTING_TELEMETRY_SELECT_COLS} FROM routing_telemetry WHERE run_id = ? AND attempt = ?`)
    .get(runId, attempt) as RoutingTelemetryDbRow | undefined;
  return row ? dbRowToStored(row) : null;
}

/** Every attempt recorded for a run, ordered oldest attempt first -- the
 * escalation-analysis read path MED-4 exists for (plan §3.2 L5: "the only
 * path to ever justifying learned routing" needs to see what the FIRST
 * attempt actually did, not just the attempt that happened to land last). */
export function listRoutingTelemetryAttempts(db: Database.Database, runId: string): StoredRoutingTelemetryRow[] {
  const dbRows = db
    .prepare(`SELECT ${ROUTING_TELEMETRY_SELECT_COLS} FROM routing_telemetry WHERE run_id = ? ORDER BY attempt ASC`)
    .all(runId) as RoutingTelemetryDbRow[];
  return dbRows.map(dbRowToStored);
}

export interface RoutingTelemetryFilters {
  projectId?: string | undefined;
  /** t6 addition: narrows to one build's rows -- the axis
   * `computeBuildSpendUsd` filters on for admission control's per-build cap
   * lookup. See `StoredRoutingTelemetryRow#buildId`'s own doc comment for
   * why this is a distinct identifier from `projectId`/`runId`. */
  buildId?: string | undefined;
  runId?: string | undefined;
  /** Narrows to one specific attempt; omit to match every attempt of a run
   * (the default for both `listRoutingTelemetry` and lane-meter
   * aggregation, per MED-4: meters must sum across attempts). */
  attempt?: number | undefined;
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
  if (filters.buildId !== undefined) {
    clauses.push('build_id = ?');
    params.push(filters.buildId);
  }
  if (filters.runId !== undefined) {
    clauses.push('run_id = ?');
    params.push(filters.runId);
  }
  if (filters.attempt !== undefined) {
    clauses.push('attempt = ?');
    params.push(filters.attempt);
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
 * before `limit`/`offset`, so a caller can page without a second request.
 * Every attempt of a matching run is included unless `filters.attempt`
 * narrows to one. */
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
        ORDER BY created_at DESC, run_id DESC, attempt DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as RoutingTelemetryDbRow[];
  return { rows: dbRows.map(dbRowToStored), total, limit, offset };
}

/** Unpaginated internal read used only by `computeLaneMeters` -- lane
 * aggregation needs every matching row (every attempt included, MED-4), not
 * a page of them. */
function fetchRowsForAggregation(db: Database.Database, windowMs: number | undefined): StoredRoutingTelemetryRow[] {
  const filters: RoutingTelemetryFilters =
    windowMs !== undefined ? { sinceMs: Date.now() - windowMs } : {};
  const { where, params } = buildFilterClause(filters);
  const dbRows = db
    .prepare(`SELECT ${ROUTING_TELEMETRY_SELECT_COLS} FROM routing_telemetry ${where}`)
    .all(...params) as RoutingTelemetryDbRow[];
  return dbRows.map(dbRowToStored);
}

/**
 * Sol review HIGH-2/HIGH-3 (t4 fix commit): a row's usage/cost/gate/
 * escalation metrics belong to whichever lane actually ran the work, not
 * unconditionally to `routedLane`. `routedLane`/`runsRouted` still track
 * pure routing INTENT (unaffected here); a separate accumulator tracks
 * what got ATTRIBUTED to this lane, keyed by `observedLane ?? routedLane`
 * (fall back to the routed lane only when nothing has been observed yet).
 */
interface LaneAccumulator {
  runsRouted: number;
  runsObserved: number;
  attributedRuns: number;
  attributedEscalated: number;
  attributedGated: number;
  attributedGatedPass: number;
  attributedTokensInput: number;
  attributedTokensOutput: number;
  attributedTokensCacheReadInput: number;
  attributedCostUsd: number;
  /** Whether any attributed row was billed (`costEstimated: false`) /
   * a pre-run estimate (`costEstimated: true`) -- both starting `false`
   * (nothing seen yet) so a lane with zero attributed rows reports the
   * vacuous `'exact'` default via `emptyLaneMeter`-equivalent logic below,
   * not a fabricated 'mixed'/'estimated' claim about rows that don't exist. */
  sawExactCost: boolean;
  sawEstimatedCost: boolean;
  /** Which attribution rule(s) actually contributed a row to this
   * accumulator -- `'observed'` (a confirmed, non-null `observedLane`
   * named this lane) vs `'routed-fallback'` (the row's `observedLane` was
   * still null, so it fell back to `routedLane`). */
  sawObservedAttribution: boolean;
  sawFallbackAttribution: boolean;
}

function newAccumulator(): LaneAccumulator {
  return {
    runsRouted: 0,
    runsObserved: 0,
    attributedRuns: 0,
    attributedEscalated: 0,
    attributedGated: 0,
    attributedGatedPass: 0,
    attributedTokensInput: 0,
    attributedTokensOutput: 0,
    attributedTokensCacheReadInput: 0,
    attributedCostUsd: 0,
    sawExactCost: false,
    sawEstimatedCost: false,
    sawObservedAttribution: false,
    sawFallbackAttribution: false,
  };
}

/**
 * t8 fix-round (Sol MED-8): `'unavailable'` (tool not installed/configured)
 * and `'skipped-not-applicable'` (the gate genuinely does not apply) are
 * NOT failures -- a row whose only gate outcome is `'unavailable'` was
 * never actually gated on anything, and must not count against a lane's
 * pass rate at all. The ORIGINAL version below treated any non-'pass'
 * value (including these two) as "this row failed its gates," which
 * silently penalized a lane every time an inapplicable/unconfigured tool
 * happened to be in the outcome map -- exactly backwards from "pass rate
 * over applicable deterministic gates only."
 */
function applicableGateOutcomes(gateOutcomes: Record<string, RoutingGateOutcome>): RoutingGateOutcome[] {
  return Object.values(gateOutcomes).filter((outcome) => outcome !== 'unavailable' && outcome !== 'skipped-not-applicable');
}

function allApplicableGatesPass(gateOutcomes: Record<string, RoutingGateOutcome>): boolean {
  const applicable = applicableGateOutcomes(gateOutcomes);
  return applicable.length > 0 && applicable.every((outcome) => outcome === 'pass');
}

function resolveCostTriState(acc: LaneAccumulator): LaneMeter['cost'] {
  if (acc.sawExactCost && acc.sawEstimatedCost) return 'mixed';
  if (acc.sawExactCost) return 'exact';
  if (acc.sawEstimatedCost) return 'estimated';
  return 'exact'; // vacuous default for a lane with zero attributed rows
}

function resolveAttribution(acc: LaneAccumulator): LaneMeter['attribution'] {
  if (acc.sawObservedAttribution && acc.sawFallbackAttribution) return 'mixed';
  if (acc.sawObservedAttribution) return 'observed';
  if (acc.sawFallbackAttribution) return 'routed-fallback';
  return 'none';
}

/** Aggregates observed usage per lane over the trailing `windowMs`
 * (omit for all-time; every attempt of every matching run is included,
 * MED-4) -- plan §3.2 L5: tokens, estimated cost, run counts, and throttle
 * events per lane, the dataset the weekly policy review reads ("stage
 * escalation rate above its alarm -> fix the table"). A lane appears in the
 * result if it was ever routed to, ever observed, OR ever the attribution
 * target for another lane's fallback, even if these never coincide for a
 * given run -- this is exactly the lane-level fallback plan §3.1 says must
 * be traceable. Lanes are returned sorted by id for a stable response shape. */
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
    // Routing INTENT: unconditional, always the routed lane.
    accFor(row.routedLane).runsRouted += 1;

    // Confirmed observation count: only when observedLane actually arrived.
    if (row.observedLane !== null) {
      accFor(row.observedLane).runsObserved += 1;
    }

    // ATTRIBUTION (HIGH-2): usage/cost/gates/escalations belong to whichever
    // lane actually ran the work -- observedLane when confirmed, routedLane
    // only as a not-yet-observed fallback.
    const attributionLane = row.observedLane ?? row.routedLane;
    const attributed = accFor(attributionLane);
    attributed.attributedRuns += 1;
    attributed.attributedTokensInput += row.tokens.input;
    attributed.attributedTokensOutput += row.tokens.output;
    attributed.attributedTokensCacheReadInput += row.tokens.cacheReadInput;
    attributed.attributedCostUsd += row.costUsd;
    if (row.costEstimated) attributed.sawEstimatedCost = true;
    else attributed.sawExactCost = true;
    if (row.observedLane !== null) attributed.sawObservedAttribution = true;
    else attributed.sawFallbackAttribution = true;
    if (row.escalated) attributed.attributedEscalated += 1;
    // t8 fix-round (Sol MED-8): denominator is APPLICABLE gate outcomes
    // only (excludes 'unavailable'/'skipped-not-applicable') -- see
    // applicableGateOutcomes'/allApplicableGatesPass's own doc comments.
    if (applicableGateOutcomes(row.gateOutcomes).length > 0) {
      attributed.attributedGated += 1;
      if (allApplicableGatesPass(row.gateOutcomes)) attributed.attributedGatedPass += 1;
    }
  }

  return [...byLane.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lane, acc]) => {
      const meter: LaneMeter = {
        lane,
        runsRouted: acc.runsRouted,
        runsObserved: acc.runsObserved,
        escalationRate: acc.attributedRuns > 0 ? acc.attributedEscalated / acc.attributedRuns : 0,
        passRate: acc.attributedGated > 0 ? acc.attributedGatedPass / acc.attributedGated : 0,
        tokens: {
          input: acc.attributedTokensInput,
          output: acc.attributedTokensOutput,
          cacheReadInput: acc.attributedTokensCacheReadInput,
        },
        costUsd: acc.attributedCostUsd,
        cost: resolveCostTriState(acc),
        throttleEvents: acc.attributedEscalated,
        attributedRuns: acc.attributedRuns,
        attribution: resolveAttribution(acc),
      };
      return meter;
    });
}

// ---------------------------------------------------------------------------
// Per-stage/template rate rollup (t9, plan §5 P2 gate: "escalation/pass
// rates visible"). `computeLaneMeters` above slices by LANE; the P2 gate
// also wants that same escalation/pass signal sliced by (stage, templateId)
// so a weekly policy review can see "which STAGE is escalating" rather than
// only "which LANE is escalating" (plan §3.2 L5: "stage escalation rate
// above its alarm -> fix the table"). Reuses the exact same
// applicable-gate-outcome rules `computeLaneMeters` already applies (t8
// fix-round: 'unavailable'/'skipped-not-applicable' never count as gated)
// so the two rollups can never silently disagree on what "gated" means.
// ---------------------------------------------------------------------------

export interface RoutingStageAggregate {
  stage: string;
  templateId: string | null;
  runs: number;
  escalated: number;
  gated: number;
  gatedPass: number;
}

export function computeStageAggregates(db: Database.Database, windowMs?: number): RoutingStageAggregate[] {
  const rows = fetchRowsForAggregation(db, windowMs);
  const byKey = new Map<string, RoutingStageAggregate>();
  for (const row of rows) {
    // NUL-joined key: a stage id and a template id can each independently
    // contain any printable character a caller supplies, so a plain `-`/`:`
    // join could collide (stage "a-b" + templateId "c" vs stage "a" +
    // templateId "b-c"). The U+0000 separator never appears in either field
    // in practice (both come from closed policy vocabulary / slug-shaped
    // ids) and is never itself ambiguous with real content.
    const key = `${row.stage} ${row.templateId ?? ''}`;
    let acc = byKey.get(key);
    if (!acc) {
      acc = { stage: row.stage, templateId: row.templateId, runs: 0, escalated: 0, gated: 0, gatedPass: 0 };
      byKey.set(key, acc);
    }
    acc.runs += 1;
    if (row.escalated) acc.escalated += 1;
    const applicable = applicableGateOutcomes(row.gateOutcomes);
    if (applicable.length > 0) {
      acc.gated += 1;
      if (allApplicableGatesPass(row.gateOutcomes)) acc.gatedPass += 1;
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.stage.localeCompare(b.stage) || (a.templateId ?? '').localeCompare(b.templateId ?? ''),
  );
}

// ---------------------------------------------------------------------------
// Spend lookup (t6, plan §3.1/§3.2 L4 admission control): "per-build and
// per-day caps checked at every dispatch" needs a sum of estimated+exact
// costs per buildId/day from this table -- daemon-side aggregation that
// `apps/daemon/src/routing/admission.ts`'s pure `evaluateAdmission` consumes
// as a plain `{ buildSpentUsd, daySpentUsd }` argument (that module never
// touches SQLite itself, same "arrives as a plain argument" discipline
// decision.ts uses for lane meters). Deliberately a NARROWER aggregation
// than `computeLaneMeters` -- it sums `cost_usd` unconditionally (both
// estimated and exact rows mix into one running total, per this task's own
// brief: "estimated+exact mixing") rather than attributing by lane, and
// reports which rule produced the total via the same cost tri-state
// `LaneMeter#cost` already uses, for the same reason: a caller must be able
// to tell "this total includes at least one pre-run estimate" from "every
// dollar here is billed."
// ---------------------------------------------------------------------------

export interface RoutingSpendSnapshot {
  totalCostUsd: number;
  rowCount: number;
  cost: 'exact' | 'estimated' | 'mixed';
}

function emptySpendSnapshot(): RoutingSpendSnapshot {
  return { totalCostUsd: 0, rowCount: 0, cost: 'exact' };
}

function sumSpendRows(db: Database.Database, whereClause: string, params: readonly unknown[]): RoutingSpendSnapshot {
  const rows = db
    .prepare(`SELECT cost_usd, cost_estimated FROM routing_telemetry ${whereClause}`)
    .all(...params) as Array<{ cost_usd: number; cost_estimated: number }>;
  if (rows.length === 0) return emptySpendSnapshot();
  let totalCostUsd = 0;
  let sawExact = false;
  let sawEstimated = false;
  for (const row of rows) {
    totalCostUsd += row.cost_usd;
    if (row.cost_estimated === 1) sawEstimated = true;
    else sawExact = true;
  }
  const cost: RoutingSpendSnapshot['cost'] = sawExact && sawEstimated ? 'mixed' : sawEstimated ? 'estimated' : 'exact';
  return { totalCostUsd, rowCount: rows.length, cost };
}

/** Sum of every attempt's `costUsd` (estimated+exact mixed) across every row
 * whose `buildId` matches -- the per-build cap lookup admission control
 * checks at every dispatch. `0`/empty when the build has no rows yet (a
 * brand-new build, or work whose routing key never carried a buildId). */
export function computeBuildSpendUsd(db: Database.Database, buildId: string): RoutingSpendSnapshot {
  return sumSpendRows(db, 'WHERE build_id = ?', [buildId]);
}

/**
 * Sol review HIGH-2 (fix-round, admission control): the per-STAGE ceiling
 * ("deny dispatch if lane meter + estimate exceeds cap", plan §3.1) was
 * being checked against a hardcoded `0` prior spend, so a stage that had
 * already accumulated 90% of its cap across earlier attempts/retries
 * within the SAME build would still admit a dispatch whose own estimate
 * alone fit the raw cap. Sums every attempt's `costUsd` (estimated+exact
 * mixed) across every row matching BOTH `buildId` AND `stage` (rows carry
 * `stage` already) -- the stage-spend snapshot `evaluateAdmission` now
 * compares against the (headroomed) per-stage ceiling. `0`/empty for a
 * stage this build has no rows for yet.
 */
export function computeStageSpendUsd(db: Database.Database, buildId: string, stage: string): RoutingSpendSnapshot {
  return sumSpendRows(db, 'WHERE build_id = ? AND stage = ?', [buildId, stage]);
}

/** Sum of every attempt's `costUsd` (estimated+exact mixed) across every row
 * whose `createdAt` falls in `[dayStartMs, dayEndMsExclusive)` -- the
 * per-day cap lookup admission control checks at every dispatch. Bounds are
 * epoch milliseconds so the caller owns the calendar-day/timezone policy
 * (this function has no opinion on what "a day" means); `dayEndMsExclusive`
 * is exclusive so back-to-back day windows never double-count a boundary
 * row. */
export function computeDaySpendUsd(db: Database.Database, dayStartMs: number, dayEndMsExclusive: number): RoutingSpendSnapshot {
  return sumSpendRows(db, 'WHERE created_at >= ? AND created_at < ?', [
    new Date(dayStartMs).toISOString(),
    new Date(dayEndMsExclusive).toISOString(),
  ]);
}

export type RoutingReconciliationStatus = 'match' | 'model-divergence' | 'lane-divergence' | 'unverified';

/** Divergence flags + reason for one telemetry row's routed-vs-observed
 * pair (plan §3.1: "post-run usage reconciliation that flags runs whose
 * observed usage diverges from the routed intent").
 *
 * Sol review MED-6: `modelDivergence`/`laneDivergence` are independent --
 * both can be `true` at once (both axes diverged), and `status` alone
 * (chosen by precedence, model wins display) would mask that. Consumers
 * that only need "is anything wrong" read `divergent`; consumers doing
 * per-axis analysis read the two flags directly instead of re-deriving them
 * from `status`/`reason` text. */
export interface RoutingReconciliation {
  status: RoutingReconciliationStatus;
  /** True when the observed model differs from the routed model (only ever
   * true once `observedModel` has actually arrived). */
  modelDivergence: boolean;
  /** True when the observed lane differs from the routed lane (only ever
   * true once `observedLane` has actually arrived). */
  laneDivergence: boolean;
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
 * shared idea is precedence, not code: `status` reports the higher-priority
 * divergence first (model over lane) for display, even if the other axis
 * hasn't reported back yet, and only full, unanimous confirmation earns the
 * non-divergent terminal state -- anything short of that (including a
 * legitimately-not-arrived-yet observation) is `'unverified'`, per this
 * module's brief: "observed unavailable => 'unverified', not a divergence."
 * `modelDivergence`/`laneDivergence` are computed independently of that
 * precedence (MED-6) so a caller can see both axes even when `status` only
 * names one.
 */
function reconcileRow(row: RoutingReconcileInput): RoutingReconciliation {
  const modelDivergence = row.observedModel !== null && row.observedModel !== row.routedModel;
  const laneDivergence = row.observedLane !== null && row.observedLane !== row.routedLane;
  const divergent = modelDivergence || laneDivergence;

  if (modelDivergence) {
    return {
      status: 'model-divergence',
      modelDivergence,
      laneDivergence,
      divergent,
      reason: `routed model "${row.routedModel}" but observed "${row.observedModel}"`,
    };
  }
  if (laneDivergence) {
    return {
      status: 'lane-divergence',
      modelDivergence,
      laneDivergence,
      divergent,
      reason: `routed lane "${row.routedLane}" but observed "${row.observedLane}"`,
    };
  }
  if (row.observedModel !== null && row.observedLane !== null) {
    return {
      status: 'match',
      modelDivergence,
      laneDivergence,
      divergent,
      reason: 'observed model and lane both confirm the routed decision',
    };
  }
  return {
    status: 'unverified',
    modelDivergence,
    laneDivergence,
    divergent,
    reason: "observed model/lane not yet reported -- usage arrives post-run (plan §3.1)",
  };
}

export function reconcileRoutedVsObserved(row: RoutingReconcileInput): RoutingReconciliation;
export function reconcileRoutedVsObserved(
  db: Database.Database,
  runId: string,
  attempt?: number,
): RoutingReconciliation | null;
export function reconcileRoutedVsObserved(
  arg: RoutingReconcileInput | Database.Database,
  runId?: string,
  attempt: number = 0,
): RoutingReconciliation | null {
  if (typeof runId === 'string') {
    const row = getRoutingTelemetryByRunId(arg as Database.Database, runId, attempt);
    return row ? reconcileRow(row) : null;
  }
  return reconcileRow(arg as RoutingReconcileInput);
}
