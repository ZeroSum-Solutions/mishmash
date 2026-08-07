// L1 reliability layer (WR wave, P2 tranche -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.2 L1 + §3.1 side-effect
// redispatch limits).
//
// Three independent responsibilities, all pure state + evaluation + surface
// wiring -- no dispatch/spawn wiring here (t9's job wires
// `recordObservedFailure` to real spawn/stream events):
//
//   1. Per-runtime AND per-lane observed-failure cooldowns with exponential
//      backoff, built on what CLIs actually expose (spawn errors, auth
//      probe failures, stream-detected throttles -- plan §3.2 L1, NOT
//      LiteLLM API-health semantics, Grok F8) -- the SAME
//      `TrackingRunFailureCategory` taxonomy `run-retry-policy.ts` already
//      classifies intra-run failures into (imported from
//      `@open-design/contracts/analytics`, never duplicated or altered:
//      this task's own Discipline section forbids touching that file).
//   2. Lane-ordered fallback chain lookup over `policy.laneChains` (plan
//      §3.2 L1) -- a thin accessor, not a second copy of the tier logic
//      decision.ts already encodes in its own `TRANSPORT_TIER` map (exported
//      from decision.ts and cross-checked against `policy.laneChains`'
//      ordering by this module's own test file, rather than re-derived here
//      at runtime: `policy.laneChains` is already authored in tier order by
//      construction, so there is nothing this module needs to recompute).
//   3. Non-redispatchable side-effect marking (plan §3.1): a run that
//      performed an external side effect (db-migration, git-push,
//      network-call, supabase-change) is never automatically re-run;
//      escalation for it surfaces `requiresHumanAck: true`.
//
// Storage design (plan brief: "pick what fits the existing shape best and
// justify in a comment"):
//
//   - Cooldown state -> a DEDICATED table (`routing_cooldowns`), not a new
//     `routing_telemetry` column. Cooldown state is keyed by SCOPE
//     (runtime id or lane id) and is a single evolving row per scope --
//     "how many consecutive failures has this scope seen, and when was the
//     most recent one" -- which has no natural home on a table whose
//     primary key is `(run_id, attempt)` (telemetry.ts's own header). Two
//     failures observed by the SAME runtime across two DIFFERENT runs must
//     update the SAME cooldown row, which a per-run-keyed column could
//     never express without a cross-row aggregation query on every read.
//   - Non-redispatchable marking -> ALSO a dedicated table
//     (`routing_run_side_effects`), keyed by `run_id` alone (not
//     `(run_id, attempt)`): a run's redispatchability is a property of the
//     LOGICAL run, not a single attempt -- once ANY attempt performs an
//     external side effect, every future escalation of that run is
//     non-redispatchable, regardless of which attempt number eventually
//     tries to redispatch it. Folding this onto `routing_telemetry` would
//     force picking one arbitrary attempt row to carry the flag (which one
//     performed the side effect is exactly the ambiguity a per-run table
//     avoids) or spreading it across every attempt row inconsistently.
//   - Both are brand-new tables this tranche introduces (no prior WR
//     tranche shipped either shape), so unlike telemetry.ts's
//     `migrateOldShapeRoutingTelemetryTable`/`migrateMissingBuildIdColumn`
//     dance, there is no pre-existing shape to migrate from -- `CREATE
//     TABLE IF NOT EXISTS` is sufficient on its own.
//
// Scope discipline: pure state + evaluation + surfaces only. No dispatch/
// spawn wiring (t9's job). `run-retry-policy.ts` (intra-run retry) is not
// modified, imported for mutation, or duplicated -- only its
// `TrackingRunFailureCategory` taxonomy is reused as this layer's own
// `category` vocabulary, per this task's Discipline section.
import type Database from 'better-sqlite3';
import type { TrackingRunFailureCategory } from '@open-design/contracts/analytics';
import {
  isRoutingSideEffectKind,
  type RoutingCooldownScope,
  type RoutingCooldownScopeType,
  type RoutingCooldownStatus,
  type RoutingPolicyCooldownConfig,
  type RoutingPolicyDocument,
  type RoutingSideEffectKind,
} from '@open-design/contracts';

// ---------------------------------------------------------------------------
// Cooldown state -- SQLite storage (routing_cooldowns)
// ---------------------------------------------------------------------------

const ROUTING_COOLDOWNS_DDL = `
    CREATE TABLE IF NOT EXISTS routing_cooldowns (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      category TEXT,
      consecutive_failures INTEGER NOT NULL,
      last_failure_at TEXT,
      last_success_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_type, scope_id)
    )
`;

export function ensureRoutingCooldownsTable(db: Database.Database): void {
  db.exec(ROUTING_COOLDOWNS_DDL);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_routing_cooldowns_scope_type ON routing_cooldowns(scope_type)`);
}

/**
 * t7 fix-round (Sol LOW-8): a clear, named failure for a read path called
 * against a db that never had its table migrated -- distinct from letting
 * `better-sqlite3`'s own `SqliteError: no such table: X` surface unadorned
 * (still fails loudly, just without the actionable "call ensure...Table at
 * startup" pointer). Table creation belongs ONLY at daemon startup
 * (`apps/daemon/src/server.ts`) and in test setups that need one -- NOT
 * self-ensured on this hot read path (see `computeCooldownStatuses`'s own
 * comment for why that self-ensure was removed).
 */
function assertTableExists(db: Database.Database, tableName: string, callerFnName: string): void {
  const exists = (
    db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName) as { n: number }
  ).n;
  if (exists === 0) {
    throw new Error(
      `${callerFnName}: table "${tableName}" does not exist -- call ensureRoutingCooldownsTable(db) at daemon startup (or in this test's setup) before calling ${callerFnName}.`,
    );
  }
}

interface RoutingCooldownDbRow {
  scope_type: RoutingCooldownScopeType;
  scope_id: string;
  category: string | null;
  consecutive_failures: number;
  last_failure_at: string | null;
  last_success_at: string | null;
  updated_at: string;
}

/** In-memory shape of one cooldown scope's state -- what `isInCooldown`'s
 * pure core actually evaluates against a clock. `lastFailureAtMs` is the
 * anchor the exponential window is measured from; see its own doc comment
 * for why it can be non-null even when `consecutiveFailures` has since been
 * reset to `0` (harmless, because the pure check short-circuits on
 * `consecutiveFailures <= 0` first). */
export interface CooldownRecord {
  scopeType: RoutingCooldownScopeType;
  scopeId: string;
  category: string | null;
  consecutiveFailures: number;
  /** Epoch ms of the failure that most recently changed
   * `consecutiveFailures`. `null` only for a scope that has never recorded
   * a failure at all. */
  lastFailureAtMs: number | null;
}

export interface CooldownCheck {
  inCooldown: boolean;
  remainingMs: number;
  reason: string;
}

/** Fallback used whenever `policy.cooldownPolicy` is entirely absent (an
 * older or hand-authored policy document that predates this tranche) --
 * NEVER used when the policy DOES configure `cooldownPolicy`; that config
 * always wins (see `resolveCooldownConfig`). 5s base window, doubling per
 * consecutive failure, capped at 5 minutes -- conservative, operator-tunable
 * placeholders (this task's own brief), not plan-sourced figures.
 */
export const DEFAULT_COOLDOWN_CONFIG: RoutingPolicyCooldownConfig = {
  baseMs: 5_000,
  factor: 2,
  maxMs: 300_000,
  notes: 'apps/daemon/src/routing/reliability.ts hardcoded default -- used whenever routing-policy.json omits cooldownPolicy.',
};

export function resolveCooldownConfig(policy: RoutingPolicyDocument): RoutingPolicyCooldownConfig {
  return policy.cooldownPolicy ?? DEFAULT_COOLDOWN_CONFIG;
}

/**
 * `windowMs = min(baseMs * factor^(consecutiveFailures - 1), maxMs)`, `0`
 * for `consecutiveFailures <= 0` (no window to speak of). Pure arithmetic,
 * no clock involved -- `isInCooldown` below is the only place this combines
 * with an injected `now`.
 *
 * t7 fix-round (Sol MED-5): `Math.round` at the very end -- `factor` may be
 * a fractional operator-tunable value (e.g. `1.5`), and `baseMs *
 * factor^n` for a fractional `factor` is generally NOT an integer. A
 * fractional millisecond window is meaningless (every consumer -- the
 * expiry-instant arithmetic below, `RoutingCooldownStatus#remainingMs` --
 * treats this as a whole-millisecond duration), so this rounds once, here,
 * rather than leaving every caller to remember to. Rounds AFTER the
 * `Math.min` cap so a rounded-up raw value can never exceed the (already
 * integer, per policy validation) `maxMs` cap.
 */
export function computeCooldownWindowMs(consecutiveFailures: number, config: RoutingPolicyCooldownConfig): number {
  if (!Number.isFinite(consecutiveFailures) || consecutiveFailures <= 0) return 0;
  const raw = config.baseMs * config.factor ** (Math.floor(consecutiveFailures) - 1);
  return Math.round(Math.min(raw, config.maxMs));
}

function scopeLabel(scopeType: RoutingCooldownScopeType, scopeId: string): string {
  return `${scopeType}:${scopeId}`;
}

function isInCooldownCore(record: CooldownRecord | null, config: RoutingPolicyCooldownConfig, now: Date): CooldownCheck {
  if (!record || record.consecutiveFailures <= 0 || record.lastFailureAtMs === null || !Number.isFinite(record.lastFailureAtMs)) {
    return {
      inCooldown: false,
      remainingMs: 0,
      reason: record
        ? `scope "${scopeLabel(record.scopeType, record.scopeId)}" has no active cooldown -- no consecutive observed failures recorded.`
        : 'scope has no active cooldown -- no observed-failure record exists for it at all.',
    };
  }
  const windowMs = computeCooldownWindowMs(record.consecutiveFailures, config);
  const expiresAtMs = record.lastFailureAtMs + windowMs;
  const nowMs = now.getTime();
  // Boundary (this task's test matrix, "isInCooldown boundary (exactly at
  // expiry)"): strictly less-than -- at the exact expiry instant the window
  // has elapsed, matching the same EXCLUSIVE-upper-bound convention
  // admission.ts's `thresholdedPricing` boundary already uses ("only
  // STRICTLY GREATER triggers").
  const inCooldown = nowMs < expiresAtMs;
  const remainingMs = inCooldown ? expiresAtMs - nowMs : 0;
  return {
    inCooldown,
    remainingMs,
    reason: inCooldown
      ? `scope "${scopeLabel(record.scopeType, record.scopeId)}" is in cooldown: ${record.consecutiveFailures} consecutive observed failure(s) (last category "${record.category ?? 'unknown'}"), ${windowMs}ms window, ${remainingMs}ms remaining.`
      : `scope "${scopeLabel(record.scopeType, record.scopeId)}"'s ${windowMs}ms cooldown window (after ${record.consecutiveFailures} consecutive failure(s)) has elapsed.`,
  };
}

/**
 * Whether a scope is currently in cooldown -- the pure core (record + config
 * + injected clock, no I/O) for unit testing without SQLite, and a
 * convenience DB-backed overload that looks the record up first, mirroring
 * `telemetry.ts`'s `reconcileRoutedVsObserved` dual-signature pattern
 * exactly (a pure form over an already-fetched value, and a DB form that
 * fetches then delegates to it).
 */
export function isInCooldown(record: CooldownRecord | null, config: RoutingPolicyCooldownConfig, now: Date): CooldownCheck;
export function isInCooldown(
  db: Database.Database,
  scope: RoutingCooldownScope,
  config: RoutingPolicyCooldownConfig,
  now: Date,
): CooldownCheck;
export function isInCooldown(
  arg1: CooldownRecord | null | Database.Database,
  arg2: RoutingPolicyCooldownConfig | RoutingCooldownScope,
  arg3: Date | RoutingPolicyCooldownConfig,
  arg4?: Date,
): CooldownCheck {
  if (arg4 !== undefined) {
    const db = arg1 as Database.Database;
    const scope = arg2 as RoutingCooldownScope;
    const config = arg3 as RoutingPolicyCooldownConfig;
    const record = getCooldownRecord(db, scope.type, scope.id);
    return isInCooldownCore(record, config, arg4);
  }
  return isInCooldownCore(arg1 as CooldownRecord | null, arg2 as RoutingPolicyCooldownConfig, arg3 as Date);
}

export function getCooldownRecord(db: Database.Database, scopeType: RoutingCooldownScopeType, scopeId: string): CooldownRecord | null {
  const row = db
    .prepare(
      `SELECT scope_type, scope_id, category, consecutive_failures, last_failure_at
         FROM routing_cooldowns WHERE scope_type = ? AND scope_id = ?`,
    )
    .get(scopeType, scopeId) as
    | Pick<RoutingCooldownDbRow, 'scope_type' | 'scope_id' | 'category' | 'consecutive_failures' | 'last_failure_at'>
    | undefined;
  if (!row) return null;
  return {
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    category: row.category,
    consecutiveFailures: row.consecutive_failures,
    lastFailureAtMs: row.last_failure_at !== null ? Date.parse(row.last_failure_at) : null,
  };
}

function upsertFailure(db: Database.Database, scopeType: RoutingCooldownScopeType, scopeId: string, category: TrackingRunFailureCategory, nowIso: string): void {
  // `consecutive_failures + 1` references the EXISTING row's column, not
  // `excluded` (which is always the fixed literal `1` from the insert
  // values) -- the standard SQLite upsert-increment shape.
  db.prepare(
    `INSERT INTO routing_cooldowns (scope_type, scope_id, category, consecutive_failures, last_failure_at, last_success_at, updated_at)
       VALUES (@scopeType, @scopeId, @category, 1, @now, NULL, @now)
       ON CONFLICT(scope_type, scope_id) DO UPDATE SET
         category = excluded.category,
         consecutive_failures = routing_cooldowns.consecutive_failures + 1,
         last_failure_at = excluded.last_failure_at,
         updated_at = excluded.updated_at`,
  ).run({ scopeType, scopeId, category, now: nowIso });
}

function resetScope(db: Database.Database, scopeType: RoutingCooldownScopeType, scopeId: string, nowIso: string): void {
  db.prepare(
    `INSERT INTO routing_cooldowns (scope_type, scope_id, category, consecutive_failures, last_failure_at, last_success_at, updated_at)
       VALUES (@scopeType, @scopeId, NULL, 0, NULL, @now, @now)
       ON CONFLICT(scope_type, scope_id) DO UPDATE SET
         consecutive_failures = 0,
         last_success_at = excluded.last_success_at,
         updated_at = excluded.updated_at`,
  ).run({ scopeType, scopeId, now: nowIso });
}

/**
 * Records one observed failure (spawn error, auth probe failure,
 * stream-detected throttle -- plan §3.2 L1) against BOTH the runtime and the
 * lane it happened on, independently (this task's own brief: "per-runtime
 * AND per-lane... recordObservedFailure(runtimeId, lane, category, clock)").
 * A runtime failing across every lane it is tried on and a single lane
 * failing across every runtime routed through it are different reliability
 * signals, so each scope's `consecutive_failures` counter advances on its
 * own -- see this module's header for the full storage rationale. `now` is
 * an injected clock (never `Date.now()` inside this pure-adjacent module).
 */
export function recordObservedFailure(
  db: Database.Database,
  runtimeId: string,
  lane: string,
  category: TrackingRunFailureCategory,
  now: Date,
): void {
  const nowIso = now.toISOString();
  upsertFailure(db, 'runtime', runtimeId, category, nowIso);
  upsertFailure(db, 'lane', lane, category, nowIso);
}

/**
 * Resets BOTH the runtime's and the lane's consecutive-failure count to `0`
 * (this task's own brief: "clearOnSuccess semantics (success resets
 * consecutive-failure count)"), mirroring `recordObservedFailure`'s exact
 * (runtimeId, lane, now) shape so a caller reports success against the same
 * pair it reports failure against.
 */
export function clearOnSuccess(db: Database.Database, runtimeId: string, lane: string, now: Date): void {
  const nowIso = now.toISOString();
  resetScope(db, 'runtime', runtimeId, nowIso);
  resetScope(db, 'lane', lane, nowIso);
}

/** Every scope with at least one recorded consecutive failure (whether or
 * not its window has since elapsed) -- the dataset `/api/routing/meters`'
 * additive `cooldowns` field and `od route meters` surface. A scope that has
 * never failed, or was reset to `0` via `clearOnSuccess` and never failed
 * again, does not appear -- an empty meter list is exactly as meaningful as
 * an empty `laneMeters` list (nothing to report), not a fabricated
 * always-healthy row per known lane/runtime. */
export function computeCooldownStatuses(db: Database.Database, config: RoutingPolicyCooldownConfig, now: Date): RoutingCooldownStatus[] {
  // t7 fix-round (Sol LOW-8): SELECT-only -- this is a hot read path (the
  // live `/api/routing/meters` route and the decision-preview route both
  // call it on every request), and a DDL statement (even a cheap `CREATE
  // TABLE IF NOT EXISTS`) does not belong on a read path a caller might
  // invoke thousands of times a minute. Table creation is the sole
  // responsibility of `apps/daemon/src/server.ts`'s startup sequence (and,
  // in tests, whichever setup constructs the db) -- see
  // `assertTableExists`'s own doc comment for the resulting failure mode.
  assertTableExists(db, 'routing_cooldowns', 'computeCooldownStatuses');
  const rows = db
    .prepare(
      `SELECT scope_type, scope_id, category, consecutive_failures, last_failure_at
         FROM routing_cooldowns
        WHERE consecutive_failures > 0
        ORDER BY scope_type ASC, scope_id ASC`,
    )
    .all() as Array<Pick<RoutingCooldownDbRow, 'scope_type' | 'scope_id' | 'category' | 'consecutive_failures' | 'last_failure_at'>>;
  return rows.map((row) => {
    const record: CooldownRecord = {
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      category: row.category,
      consecutiveFailures: row.consecutive_failures,
      lastFailureAtMs: row.last_failure_at !== null ? Date.parse(row.last_failure_at) : null,
    };
    const check = isInCooldownCore(record, config, now);
    return {
      scopeType: record.scopeType,
      scopeId: record.scopeId,
      inCooldown: check.inCooldown,
      remainingMs: check.remainingMs,
      consecutiveFailures: record.consecutiveFailures,
      category: record.category,
      reason: check.reason,
    };
  });
}

/**
 * Pure candidate-side lookup over an already-computed `RoutingCooldownStatus`
 * snapshot (the same "arrives as a plain argument" discipline `decision.ts`
 * already uses for `laneMeters`/`admission.spendLookup`) -- checks the
 * candidate's runtime first, then its lane, returning the first active
 * cooldown found (runtime takes precedence purely as a stable, documented
 * tie-break; a candidate rarely trips both at once). `null` when neither
 * scope is currently in cooldown. Consumed by
 * `apps/daemon/src/routing/decision.ts`'s optional `cooldown` input.
 */
export function findActiveCooldown(
  statuses: RoutingCooldownStatus[],
  candidate: { runtimeId: string; lane: string },
): RoutingCooldownStatus | null {
  const runtimeHit = statuses.find((s) => s.scopeType === 'runtime' && s.scopeId === candidate.runtimeId && s.inCooldown);
  if (runtimeHit) return runtimeHit;
  return statuses.find((s) => s.scopeType === 'lane' && s.scopeId === candidate.lane && s.inCooldown) ?? null;
}

// ---------------------------------------------------------------------------
// Lane-ordered fallback chain (plan §3.2 L1)
// ---------------------------------------------------------------------------

/**
 * The lane subscription->prepaid->metered fallback chain rooted at
 * `fromLane`, EXCLUDING `fromLane` itself. `policy.laneChains[fromLane]`
 * always lists `fromLane` first by construction (routing-policy.json's own
 * shape -- e.g. `"claude-code-oauth": ["claude-code-oauth", "nous",
 * "moonshot", "deepseek-direct", "openrouter"]`), so this is just
 * `.slice(1)` -- no separate tier map to duplicate here (see this module's
 * header: `TRANSPORT_TIER`, decision.ts's own tier map, is exported and
 * cross-checked against this exact ordering by this module's test file
 * instead of being re-imported into a runtime code path that does not need
 * it). `[]` for an unknown lane (no chain entry) or a lane already at the
 * end of its own chain.
 */
export function laneFallbackChain(policy: RoutingPolicyDocument, fromLane: string): string[] {
  return (policy.laneChains[fromLane] ?? []).slice(1);
}

/** The single next lane in `fromLane`'s fallback chain, or `null` at the end
 * of the chain / for an unknown lane. */
export function nextLaneInChain(policy: RoutingPolicyDocument, fromLane: string): string | null {
  return laneFallbackChain(policy, fromLane)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Non-redispatchable side-effect marking (plan §3.1)
// ---------------------------------------------------------------------------

/**
 * t7 fix-round (Sol MED-4): normalized to ONE ROW PER (run_id, kind), not a
 * single `kinds_json` blob column. The original blob shape required
 * `markRunSideEffects` to READ the current JSON array, merge the new kinds
 * in, and WRITE the merged array back -- a read/merge/overwrite cycle that
 * loses an update whenever two connections race it: both read the same
 * "before" state, both compute a merge that's missing the other's kind, and
 * whichever write lands second silently discards the first connection's
 * kind. Normalizing to one row per kind makes every write an independent
 * `INSERT OR IGNORE` keyed on `(run_id, kind)` -- monotonic BY
 * CONSTRUCTION: two connections marking DIFFERENT kinds for the same run
 * each insert their own row and never touch the other's, and two
 * connections racing to mark the SAME kind both succeed (`OR IGNORE` turns
 * the second, redundant insert into a no-op) rather than one silently
 * overwriting the other. There is deliberately no UPDATE/DELETE path here --
 * once a row exists, it exists forever (plan §3.1: "never automatic
 * re-run"), so there is no unmark operation to race against in the first
 * place.
 *
 * This table was introduced in this same tranche and has never landed to
 * `main` in its previous (`kinds_json` blob) shape, so this is a direct
 * schema replacement, not a migration -- `ensureRoutingRunSideEffectsTable`
 * stays idempotent (`CREATE TABLE IF NOT EXISTS`) the same way it always
 * has; there is no legacy shape to detect or rebuild-copy away from (unlike
 * `telemetry.ts`'s `migrateOldShapeRoutingTelemetryTable`, which exists
 * precisely because ITS old shape once shipped as far as a dev data dir).
 */
const ROUTING_RUN_SIDE_EFFECTS_DDL = `
    CREATE TABLE IF NOT EXISTS routing_run_side_effects (
      run_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      marked_at TEXT NOT NULL,
      PRIMARY KEY (run_id, kind)
    )
`;

export function ensureRoutingRunSideEffectsTable(db: Database.Database): void {
  db.exec(ROUTING_RUN_SIDE_EFFECTS_DDL);
}

/**
 * t7 fix-round (Sol HIGH-1): the three states a run's persisted side-effect
 * record can actually be in -- `'none'` (no row at all, the common case for
 * a run that never performed a side effect), `'valid'` (every persisted
 * `kind` value passes the closed `RoutingSideEffectKind` vocabulary), and
 * `'corrupt'` (at least one persisted row's `kind` does NOT pass -- e.g. a
 * raw SQL seed, a future migration bug, on-disk corruption). The ORIGINAL
 * (pre-fix-round) `getRunSideEffectKinds` silently `.filter()`ed out any
 * unrecognized value, which meant a corrupted record with e.g. a single
 * garbled row read back as `[]` -- INDISTINGUISHABLE from "no side effect
 * ever happened," which is exactly backwards: an integrity failure on a
 * SAFETY record (plan §3.1's "escalation... requires human acknowledgment,
 * never automatic re-run") must fail CLOSED (non-redispatchable), never
 * silently fail open into "safe to re-run."
 *
 * Every persisted row's `kind` is validated by `markRunSideEffects` before
 * it is ever written (`isRoutingSideEffectKind` filters the input), so
 * `'corrupt'` is reachable ONLY by a write that bypassed that function
 * entirely (a raw SQL insert, e.g. `routing-reliability.test.ts`'s HIGH-1
 * coverage) -- normal operation can never produce it, which is exactly why
 * a caller must not treat its absence as a real guarantee.
 */
type SideEffectState =
  | { status: 'none' }
  | { status: 'valid'; kinds: RoutingSideEffectKind[] }
  | { status: 'corrupt'; kinds: RoutingSideEffectKind[] };

interface SideEffectRawRow {
  kind: string;
}

/**
 * t7 fix-round (Sol HIGH-1): reads every persisted `kind` row for `runId`
 * and partitions them by validity -- see `SideEffectState`'s own doc
 * comment for why a single invalid row corrupts the WHOLE run's status
 * rather than being silently dropped alongside the valid ones. Note that
 * under the normalized (run_id, kind) schema (Sol MED-4), "a malformed
 * `kinds_json` blob" and "a row carrying an unrecognized `kind` string" are
 * the SAME failure mode -- there is no longer a JSON blob to garble
 * independently of its contents, so a raw-SQL-seeded garbage string (e.g.
 * `'{not json'`) and a raw-SQL-seeded plausible-but-wrong string (e.g.
 * `'unknown-kind'`) both fail the identical `isRoutingSideEffectKind` check
 * and both route through this one branch -- this is intentional
 * consolidation, not an accidental narrowing of what HIGH-1 originally
 * described against the pre-MED-4 blob shape.
 */
function readSideEffectState(db: Database.Database, runId: string): SideEffectState {
  const rawRows = db.prepare(`SELECT kind FROM routing_run_side_effects WHERE run_id = ?`).all(runId) as SideEffectRawRow[];
  if (rawRows.length === 0) return { status: 'none' };
  const kinds: RoutingSideEffectKind[] = [];
  let corrupt = false;
  for (const rawRow of rawRows) {
    if (isRoutingSideEffectKind(rawRow.kind)) kinds.push(rawRow.kind);
    else corrupt = true;
  }
  return corrupt ? { status: 'corrupt', kinds } : { status: 'valid', kinds };
}

/** The valid `RoutingSideEffectKind`s persisted for `runId` -- keeps the
 * pre-fix-round read API shape (Sol MED-4's "keep the read API shape")
 * despite the underlying storage/corruption-detection changes underneath
 * it. Returns the valid subset even in the `'corrupt'` case (visibility
 * into what WAS recorded, alongside the corruption) rather than `[]` --
 * callers that need the fail-closed verdict use `isRedispatchable`/
 * `getRunRedispatchability` instead of trying to infer it from this list. */
export function getRunSideEffectKinds(db: Database.Database, runId: string): RoutingSideEffectKind[] {
  const state = readSideEffectState(db, runId);
  return state.status === 'none' ? [] : state.kinds;
}

/**
 * Marks a run as having performed one or more external side effects (plan
 * §3.1: db-migration, git-push, network-call, supabase-change) -- ACCUMULATES
 * across calls (a run-boundary escalation/retry may discover a new side
 * effect on a later attempt; once ANY attempt records one, the run stays
 * non-redispatchable) via `INSERT OR IGNORE` per `(run_id, kind)` row (Sol
 * MED-4) rather than a read/merge/overwrite cycle -- see the DDL's own doc
 * comment for why that makes concurrent callers safe by construction. Any
 * kind failing the closed `RoutingSideEffectKind` vocabulary is silently
 * dropped (never persisted as an unvalidated string) -- the ONLY way an
 * invalid `kind` value ever reaches storage is by bypassing this function
 * (see `SideEffectState`'s own doc comment); calling with zero valid kinds
 * is a no-op -- there is nothing to record, and the run stays redispatchable.
 */
export function markRunSideEffects(db: Database.Database, runId: string, kinds: RoutingSideEffectKind[], now: Date): void {
  const validKinds = kinds.filter(isRoutingSideEffectKind);
  if (validKinds.length === 0) return;
  const nowIso = now.toISOString();
  const insertOne = db.prepare(`INSERT OR IGNORE INTO routing_run_side_effects (run_id, kind, marked_at) VALUES (?, ?, ?)`);
  const insertAll = db.transaction((rowsToInsert: RoutingSideEffectKind[]) => {
    for (const kind of rowsToInsert) insertOne.run(runId, kind, nowIso);
  });
  insertAll(validKinds);
}

/** `true` when `runId` has never had a side effect recorded against it AND
 * its record is not corrupt -- the redispatch-eligibility check plan §3.1
 * requires before any run-boundary escalation re-dispatches a run. t7
 * fix-round (Sol HIGH-1): a `'corrupt'` record returns `false` -- an
 * integrity failure on this safety record must fail CLOSED, never be
 * silently treated as "no side effect ever happened." */
export function isRedispatchable(db: Database.Database, runId: string): boolean {
  const state = readSideEffectState(db, runId);
  if (state.status === 'none') return true;
  if (state.status === 'corrupt') return false;
  return state.kinds.length === 0;
}

/** Full redispatchability status for one run -- `requiresHumanAck` is the
 * exact inverse of `redispatchable`, carried as its own named field (plan
 * §3.1: "escalation for those requires human acknowledgment, never
 * automatic re-run") rather than making every caller re-derive it, the same
 * "never distinguish absent from empty" spirit as
 * `RoutingDecision#admissionResults`. `reason` is a machine-checkable code
 * for the corrupt case specifically (Sol HIGH-1: literal
 * `'corrupt-side-effect-record'`, testable via `toBe`), and a short
 * human-readable sentence for the two normal cases. */
export interface RunRedispatchability {
  runId: string;
  redispatchable: boolean;
  sideEffectKinds: RoutingSideEffectKind[];
  requiresHumanAck: boolean;
  reason: string;
}

export function getRunRedispatchability(db: Database.Database, runId: string): RunRedispatchability {
  const state = readSideEffectState(db, runId);
  if (state.status === 'none') {
    return { runId, redispatchable: true, sideEffectKinds: [], requiresHumanAck: false, reason: 'no side effects recorded for this run.' };
  }
  if (state.status === 'corrupt') {
    // Fails CLOSED regardless of whatever valid kinds also happen to be
    // present alongside the corrupt row(s) -- an integrity failure on this
    // record can never be partially trusted.
    return {
      runId,
      redispatchable: false,
      sideEffectKinds: state.kinds,
      requiresHumanAck: true,
      reason: 'corrupt-side-effect-record',
    };
  }
  const redispatchable = state.kinds.length === 0;
  return {
    runId,
    redispatchable,
    sideEffectKinds: state.kinds,
    requiresHumanAck: !redispatchable,
    reason: redispatchable
      ? 'no side effects recorded for this run.'
      : `run recorded external side effect(s): ${state.kinds.join(', ')}.`,
  };
}
