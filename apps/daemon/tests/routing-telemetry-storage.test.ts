// L5 telemetry storage (WR wave, P1 tranche -- plan §3.2 L5). Table
// creation idempotence, record+list round-trip with a complete row, and
// guard rejection of an incomplete row. Isolation pattern mirrors
// db-intent-signals.test.ts: a fresh mkdtemp data dir per test, openDatabase
// against it, closeDatabase() + rmSync in afterEach.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StoredRoutingTelemetryRow } from '@open-design/contracts';

import { closeDatabase, openDatabase } from '../src/db.js';
import {
  computeBuildSpendUsd,
  computeDaySpendUsd,
  ensureRoutingTelemetryTable,
  getRoutingTelemetryByRunId,
  listRoutingTelemetry,
  listRoutingTelemetryAttempts,
  recordRoutingTelemetry,
} from '../src/routing/telemetry.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-telemetry-'));
});

afterEach(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

function completeRow(overrides: Partial<StoredRoutingTelemetryRow> = {}): StoredRoutingTelemetryRow {
  return {
    runId: 'run-1',
    projectId: 'proj-1',
    attempt: 0,
    buildId: null,
    stage: 'section-component-codegen',
    templateId: 'saas-landing',
    designSystem: 'ds-1',
    routedModel: 'claude-sonnet-5',
    observedModel: 'claude-sonnet-5',
    routedLane: 'claude-code-oauth',
    observedLane: 'claude-code-oauth',
    tokens: { input: 1000, output: 500, cacheReadInput: 200 },
    cacheHits: 3,
    latencyMs: 4200,
    costUsd: 0.021,
    costEstimated: true,
    gateOutcomes: { typescript: 'pass', eslint: 'pass' },
    escalated: false,
    policyVersion: 1,
    createdAt: '2026-08-05T00:00:00.000Z',
    recordedAt: '2026-08-05T00:00:05.000Z',
    ...overrides,
  };
}

describe('ensureRoutingTelemetryTable', () => {
  it('is idempotent -- calling it twice on the same connection does not throw or duplicate schema', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    expect(() => ensureRoutingTelemetryTable(db)).not.toThrow();
    expect(() => ensureRoutingTelemetryTable(db)).not.toThrow();
    const tableCount = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'routing_telemetry'`)
        .get() as { n: number }
    ).n;
    expect(tableCount).toBe(1);
  });

  it('self-heals an old-shape table (commit 9bd640e45: run_id-only PK, no attempt column) -- migrates existing rows to attempt=0 and leaves the table writable (Sol MED-4, fix round 2)', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });

    // Manually create the OLD pre-attempt shape this module shipped with
    // before MED-4's fix, and seed a row the way that era's
    // recordRoutingTelemetry would have written it.
    db.exec(`
      CREATE TABLE routing_telemetry (
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
    db.prepare(
      `INSERT INTO routing_telemetry
         (run_id, project_id, stage, template_id, design_system, routed_model,
          observed_model, routed_lane, observed_lane, tokens_input, tokens_output,
          tokens_cache_read_input, cache_hits, latency_ms, cost_usd, cost_estimated,
          gate_outcomes_json, escalated, policy_version, created_at, recorded_at)
       VALUES (@runId, @projectId, @stage, @templateId, @designSystem, @routedModel,
               @observedModel, @routedLane, @observedLane, @tokensInput, @tokensOutput,
               @tokensCacheReadInput, @cacheHits, @latencyMs, @costUsd, @costEstimated,
               @gateOutcomesJson, @escalated, @policyVersion, @createdAt, @recordedAt)`,
    ).run({
      runId: 'pre-existing-run',
      projectId: 'proj-1',
      stage: 'chat',
      templateId: null,
      designSystem: null,
      routedModel: 'claude-sonnet-5',
      observedModel: 'claude-sonnet-5',
      routedLane: 'claude-code-oauth',
      observedLane: 'claude-code-oauth',
      tokensInput: 10,
      tokensOutput: 5,
      tokensCacheReadInput: 0,
      cacheHits: 0,
      latencyMs: 500,
      costUsd: 0.01,
      costEstimated: 1,
      gateOutcomesJson: '{}',
      escalated: 0,
      policyVersion: 1,
      createdAt: '2026-08-05T00:00:00.000Z',
      recordedAt: '2026-08-05T00:00:00.000Z',
    });

    // Would throw "no column named attempt" before this table existed in
    // the old shape, since PRAGMA table_info would find no attempt column
    // and the migration path is exactly what's under test here.
    expect(() => ensureRoutingTelemetryTable(db)).not.toThrow();

    const columns = db.prepare(`PRAGMA table_info(routing_telemetry)`).all() as Array<{ name: string }>;
    expect(columns.some((c) => c.name === 'attempt')).toBe(true);

    // The pre-existing row survived the migration, backfilled to attempt 0.
    const migrated = getRoutingTelemetryByRunId(db, 'pre-existing-run', 0);
    expect(migrated).not.toBeNull();
    expect(migrated?.attempt).toBe(0);
    expect(migrated?.routedModel).toBe('claude-sonnet-5');

    // New writes (including a second attempt) work against the migrated table.
    expect(() =>
      recordRoutingTelemetry(db, completeRow({ runId: 'pre-existing-run', attempt: 1, routedLane: 'codex-oauth' })),
    ).not.toThrow();
    const attempts = listRoutingTelemetryAttempts(db, 'pre-existing-run');
    expect(attempts.map((r) => r.attempt)).toEqual([0, 1]);

    // Idempotent: a second ensure call against the now-current-shape table
    // is a no-op, not a re-migration.
    expect(() => ensureRoutingTelemetryTable(db)).not.toThrow();
    expect(listRoutingTelemetryAttempts(db, 'pre-existing-run')).toHaveLength(2);
  });

  // Sol review MED-6 (fix-round, admission control): the P1-shape table
  // (has `attempt`, predates t6's `build_id` column) is a DIFFERENT
  // intermediate shape than the pre-attempt shape above -- a real dev data
  // dir created against this exact repo shape before t6 landed. Verifies
  // `migrateMissingBuildIdColumn`'s narrower `ALTER TABLE ... ADD COLUMN`
  // path (not the full rebuild-and-copy the pre-attempt migration needs),
  // and that the backfilled NULL buildId behaves correctly in BOTH spend
  // aggregations: included in day-spend (no buildId filter) and excluded
  // from any specific build's spend (`build_id = ?` never matches NULL).
  it('self-heals a P1-shape table (attempt present, build_id absent) -- ALTER TABLE backfills NULL buildId, day-spend includes it, build-spend excludes it, and subsequent writes succeed', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });

    // Manually create the exact P1 shape this module shipped with before
    // t6 added build_id: attempt present (PK is run_id+attempt), no
    // build_id column at all.
    db.exec(`
      CREATE TABLE routing_telemetry (
        run_id TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
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
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (run_id, attempt)
      )
    `);
    db.prepare(
      `INSERT INTO routing_telemetry
         (run_id, attempt, project_id, stage, template_id, design_system, routed_model,
          observed_model, routed_lane, observed_lane, tokens_input, tokens_output,
          tokens_cache_read_input, cache_hits, latency_ms, cost_usd, cost_estimated,
          gate_outcomes_json, escalated, policy_version, created_at, recorded_at)
       VALUES (@runId, 0, @projectId, @stage, @templateId, @designSystem, @routedModel,
               @observedModel, @routedLane, @observedLane, @tokensInput, @tokensOutput,
               @tokensCacheReadInput, @cacheHits, @latencyMs, @costUsd, @costEstimated,
               @gateOutcomesJson, @escalated, @policyVersion, @createdAt, @recordedAt)`,
    ).run({
      runId: 'p1-shape-run',
      projectId: 'proj-1',
      stage: 'chat',
      templateId: null,
      designSystem: null,
      routedModel: 'claude-sonnet-5',
      observedModel: 'claude-sonnet-5',
      routedLane: 'claude-code-oauth',
      observedLane: 'claude-code-oauth',
      tokensInput: 10,
      tokensOutput: 5,
      tokensCacheReadInput: 0,
      cacheHits: 0,
      latencyMs: 500,
      costUsd: 2.5,
      costEstimated: 0,
      gateOutcomesJson: '{}',
      escalated: 0,
      policyVersion: 1,
      createdAt: '2026-08-05T12:00:00.000Z',
      recordedAt: '2026-08-05T12:00:00.000Z',
    });

    // Would throw "no column named build_id" before this fix -- the
    // narrower ALTER TABLE path is exactly what's under test here.
    expect(() => ensureRoutingTelemetryTable(db)).not.toThrow();

    const columns = db.prepare(`PRAGMA table_info(routing_telemetry)`).all() as Array<{ name: string }>;
    expect(columns.some((c) => c.name === 'build_id')).toBe(true);

    // The pre-existing row survived the migration, backfilled to a NULL buildId.
    const migrated = getRoutingTelemetryByRunId(db, 'p1-shape-run', 0);
    expect(migrated).not.toBeNull();
    expect(migrated?.buildId).toBeNull();
    expect(migrated?.costUsd).toBeCloseTo(2.5, 10);

    // Day-spend has no buildId filter -- the backfilled-NULL row is included.
    const dayStart = Date.parse('2026-08-05T00:00:00.000Z');
    const dayEnd = Date.parse('2026-08-06T00:00:00.000Z');
    const daySnapshot = computeDaySpendUsd(db, dayStart, dayEnd);
    expect(daySnapshot.totalCostUsd).toBeCloseTo(2.5, 10);
    expect(daySnapshot.rowCount).toBe(1);

    // Build-spend filters on an exact buildId string -- NULL never matches,
    // so the backfilled row is correctly excluded from every build's total.
    expect(computeBuildSpendUsd(db, 'any-build-id')).toEqual({ totalCostUsd: 0, rowCount: 0, cost: 'exact' });

    // New writes (a real buildId this time) succeed against the migrated table.
    expect(() =>
      recordRoutingTelemetry(db, completeRow({ runId: 'p1-shape-run', attempt: 1, buildId: 'build-after-migration' })),
    ).not.toThrow();
    const afterMigrationRow = getRoutingTelemetryByRunId(db, 'p1-shape-run', 1);
    expect(afterMigrationRow?.buildId).toBe('build-after-migration');
    expect(computeBuildSpendUsd(db, 'build-after-migration').rowCount).toBe(1);
  });
});

describe('recordRoutingTelemetry + listRoutingTelemetry round-trip', () => {
  it('records a COMPLETE row (every field non-null where required) and reads it back unchanged', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    const row = completeRow();
    recordRoutingTelemetry(db, row);

    const fetched = getRoutingTelemetryByRunId(db, 'run-1');
    expect(fetched).toEqual(row);

    const listed = listRoutingTelemetry(db, { projectId: 'proj-1' });
    expect(listed.total).toBe(1);
    expect(listed.rows).toEqual([row]);
    expect(listed.limit).toBeGreaterThan(0);
    expect(listed.offset).toBe(0);
  });

  it('is idempotent per (run id, attempt) -- a second write for the same runId+attempt (e.g. observed fields arriving post-run) replaces the row in place, not a second row', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(db, completeRow({ observedModel: null, observedLane: null }));
    recordRoutingTelemetry(db, completeRow({ observedModel: 'claude-sonnet-5', observedLane: 'claude-code-oauth' }));

    const listed = listRoutingTelemetry(db, { runId: 'run-1' });
    expect(listed.total).toBe(1);
    expect(listed.rows[0]?.observedModel).toBe('claude-sonnet-5');
    expect(listed.rows[0]?.observedLane).toBe('claude-code-oauth');
  });

  it('preserves BOTH attempts of a retried run -- a run-boundary escalation must not erase the first attempt\'s outcome (Sol MED-4)', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    const firstAttempt = completeRow({
      attempt: 0,
      routedLane: 'claude-code-oauth',
      observedLane: 'claude-code-oauth',
      escalated: true, // this attempt is what triggered the escalation
    });
    const secondAttempt = completeRow({
      attempt: 1,
      routedLane: 'codex-oauth',
      observedLane: 'codex-oauth',
      escalated: false,
    });
    recordRoutingTelemetry(db, firstAttempt);
    recordRoutingTelemetry(db, secondAttempt);

    // Both rows survive independently -- neither overwrote the other.
    expect(getRoutingTelemetryByRunId(db, 'run-1', 0)).toEqual(firstAttempt);
    expect(getRoutingTelemetryByRunId(db, 'run-1', 1)).toEqual(secondAttempt);

    const attempts = listRoutingTelemetryAttempts(db, 'run-1');
    expect(attempts).toHaveLength(2);
    expect(attempts.map((r) => r.attempt)).toEqual([0, 1]);
    expect(attempts[0]?.routedLane).toBe('claude-code-oauth');
    expect(attempts[1]?.routedLane).toBe('codex-oauth');

    // listRoutingTelemetry (unscoped by attempt) also returns both.
    expect(listRoutingTelemetry(db, { runId: 'run-1' }).total).toBe(2);
  });

  it('getRoutingTelemetryByRunId defaults to attempt 0 when not specified', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(db, completeRow({ attempt: 0, routedLane: 'claude-code-oauth' }));
    recordRoutingTelemetry(db, completeRow({ attempt: 1, routedLane: 'codex-oauth' }));
    expect(getRoutingTelemetryByRunId(db, 'run-1')?.routedLane).toBe('claude-code-oauth');
  });

  it('supports observedModel/observedLane null before the run reports back (plan §3.1 post-run reconciliation)', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    const row = completeRow({ runId: 'run-2', observedModel: null, observedLane: null });
    recordRoutingTelemetry(db, row);
    expect(getRoutingTelemetryByRunId(db, 'run-2')).toEqual(row);
  });

  it('filters listRoutingTelemetry by projectId/runId/stage and paginates with limit/offset', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(db, completeRow({ runId: 'run-a', projectId: 'proj-a', stage: 'chat' }));
    recordRoutingTelemetry(db, completeRow({ runId: 'run-b', projectId: 'proj-a', stage: 'section-component-codegen' }));
    recordRoutingTelemetry(db, completeRow({ runId: 'run-c', projectId: 'proj-b', stage: 'chat' }));

    expect(listRoutingTelemetry(db, { projectId: 'proj-a' }).total).toBe(2);
    expect(listRoutingTelemetry(db, { projectId: 'proj-b' }).total).toBe(1);
    expect(listRoutingTelemetry(db, { runId: 'run-b' }).rows.map((r) => r.runId)).toEqual(['run-b']);
    expect(listRoutingTelemetry(db, { stage: 'chat' }).total).toBe(2);

    const page1 = listRoutingTelemetry(db, {}, { limit: 1, offset: 0 });
    const page2 = listRoutingTelemetry(db, {}, { limit: 1, offset: 1 });
    expect(page1.rows).toHaveLength(1);
    expect(page2.rows).toHaveLength(1);
    expect(page1.rows[0]?.runId).not.toBe(page2.rows[0]?.runId);
    expect(page1.total).toBe(3);
    expect(page2.total).toBe(3);
  });

  it('filters listRoutingTelemetry by a createdAt time range (sinceMs/untilMs)', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(db, completeRow({ runId: 'run-old', createdAt: '2026-01-01T00:00:00.000Z' }));
    recordRoutingTelemetry(db, completeRow({ runId: 'run-new', createdAt: '2026-08-05T00:00:00.000Z' }));

    const inRange = listRoutingTelemetry(db, {
      sinceMs: Date.parse('2026-06-01T00:00:00.000Z'),
      untilMs: Date.parse('2026-09-01T00:00:00.000Z'),
    });
    expect(inRange.rows.map((r) => r.runId)).toEqual(['run-new']);
  });
});

describe('recordRoutingTelemetry guard rejection', () => {
  it('rejects (throws) an incomplete row missing a required field instead of silently persisting it', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    const { policyVersion: _drop, ...incomplete } = completeRow();
    expect(() => recordRoutingTelemetry(db, incomplete as unknown as StoredRoutingTelemetryRow)).toThrow();
    expect(listRoutingTelemetry(db, {}).total).toBe(0);
  });

  it('rejects a row missing projectId (the field storage adds on top of the wire RoutingTelemetryRow)', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    const { projectId: _drop, ...incomplete } = completeRow();
    expect(() => recordRoutingTelemetry(db, incomplete as unknown as StoredRoutingTelemetryRow)).toThrow();
  });

  it('rejects a row with a malformed gateOutcomes value outside the closed RoutingGateOutcome enum', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    const bad = completeRow({ gateOutcomes: { lighthouse: 'maybe' } as never });
    expect(() => recordRoutingTelemetry(db, bad)).toThrow();
  });

  it('rejects a negative attempt', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    expect(() => recordRoutingTelemetry(db, completeRow({ attempt: -1 }))).toThrow();
  });

  it('rejects an empty runId (Sol MED-5 semantic validation)', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    expect(() => recordRoutingTelemetry(db, completeRow({ runId: '' }))).toThrow();
  });

  it('rejects a negative costUsd (Sol MED-5 semantic validation)', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    expect(() => recordRoutingTelemetry(db, completeRow({ costUsd: -1 }))).toThrow();
  });

  it('rejects an invalid createdAt timestamp (Sol MED-5 semantic validation)', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    expect(() => recordRoutingTelemetry(db, completeRow({ createdAt: 'not-a-date' }))).toThrow();
  });
});
