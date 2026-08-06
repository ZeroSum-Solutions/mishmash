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
