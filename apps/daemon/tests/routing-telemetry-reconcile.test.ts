// Routed-vs-observed reconciliation (WR wave, P1 tranche -- plan §3.1:
// "post-run usage reconciliation that flags runs whose observed usage
// diverges from the routed intent"). Covers both call forms
// (reconcileRoutedVsObserved(row) and reconcileRoutedVsObserved(db, runId))
// and the four semantic cases: match, model-divergence, lane-divergence,
// and observed-unavailable -> 'unverified' (not a divergence).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StoredRoutingTelemetryRow } from '@open-design/contracts';

import { closeDatabase, openDatabase } from '../src/db.js';
import {
  ensureRoutingTelemetryTable,
  reconcileRoutedVsObserved,
  recordRoutingTelemetry,
} from '../src/routing/telemetry.js';

function row(overrides: Partial<StoredRoutingTelemetryRow> = {}): StoredRoutingTelemetryRow {
  return {
    runId: 'run-1',
    projectId: 'proj-1',
    attempt: 0,
    buildId: null,
    stage: 'chat',
    templateId: null,
    designSystem: null,
    routedModel: 'claude-sonnet-5',
    observedModel: 'claude-sonnet-5',
    routedLane: 'claude-code-oauth',
    observedLane: 'claude-code-oauth',
    tokens: { input: 100, output: 50, cacheReadInput: 0 },
    cacheHits: 0,
    latencyMs: 1000,
    costUsd: 0.01,
    costEstimated: true,
    gateOutcomes: {},
    escalated: false,
    policyVersion: 1,
    createdAt: '2026-08-05T00:00:00.000Z',
    recordedAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('reconcileRoutedVsObserved(row) -- pure row form', () => {
  it('reports "match" when observed model AND lane both confirm the routed decision', () => {
    const result = reconcileRoutedVsObserved(row());
    expect(result).toMatchObject({
      status: 'match',
      divergent: false,
      modelDivergence: false,
      laneDivergence: false,
    });
    expect(result.reason).toMatch(/confirm/i);
  });

  it('reports "model-divergence" when observedModel differs from routedModel', () => {
    const result = reconcileRoutedVsObserved(
      row({ routedModel: 'claude-sonnet-5', observedModel: 'claude-opus-5' }),
    );
    expect(result).toMatchObject({
      status: 'model-divergence',
      divergent: true,
      modelDivergence: true,
      laneDivergence: false,
    });
    expect(result.reason).toContain('claude-sonnet-5');
    expect(result.reason).toContain('claude-opus-5');
  });

  it('reports "lane-divergence" when observedLane differs from routedLane, even though the model matches', () => {
    const result = reconcileRoutedVsObserved(
      row({ routedLane: 'claude-code-oauth', observedLane: 'openrouter' }),
    );
    expect(result).toMatchObject({
      status: 'lane-divergence',
      divergent: true,
      modelDivergence: false,
      laneDivergence: true,
    });
    expect(result.reason).toContain('claude-code-oauth');
    expect(result.reason).toContain('openrouter');
  });

  it('reports "unverified" (NOT a divergence) when observed model/lane have not arrived yet', () => {
    const result = reconcileRoutedVsObserved(row({ observedModel: null, observedLane: null }));
    expect(result).toMatchObject({
      status: 'unverified',
      divergent: false,
      modelDivergence: false,
      laneDivergence: false,
    });
  });

  it('reports "unverified" when only one of observedModel/observedLane has arrived and it matches so far', () => {
    const result = reconcileRoutedVsObserved(row({ observedModel: 'claude-sonnet-5', observedLane: null }));
    expect(result).toMatchObject({ status: 'unverified', divergent: false });
  });

  it('prioritizes a real divergence over "unverified" even when the OTHER axis has not arrived yet', () => {
    // observedLane is still null (not yet reported), but the model that HAS
    // reported back already disagrees -- that is actionable now, not
    // something to defer as merely "unverified".
    const result = reconcileRoutedVsObserved(
      row({ routedModel: 'claude-sonnet-5', observedModel: 'claude-opus-5', observedLane: null }),
    );
    expect(result).toMatchObject({ status: 'model-divergence', divergent: true, modelDivergence: true, laneDivergence: false });
  });

  // --- Sol review MED-6: independent axis flags --------------------------
  it('exposes BOTH modelDivergence AND laneDivergence when both axes diverge simultaneously, even though status names only one (precedence is for display, not for hiding the other axis)', () => {
    const result = reconcileRoutedVsObserved(
      row({
        routedModel: 'claude-sonnet-5',
        observedModel: 'claude-opus-5',
        routedLane: 'claude-code-oauth',
        observedLane: 'openrouter',
      }),
    );
    // status/display precedence still picks model-divergence first...
    expect(result.status).toBe('model-divergence');
    // ...but BOTH flags are true, so a per-axis consumer is never fooled
    // into thinking the lane matched just because status only named the model.
    expect(result.modelDivergence).toBe(true);
    expect(result.laneDivergence).toBe(true);
    expect(result.divergent).toBe(true);
  });
});

describe('reconcileRoutedVsObserved(db, runId) -- db-lookup form', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-reconcile-'));
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reconciles a persisted row by runId', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(
      db,
      row({ runId: 'run-x', routedModel: 'claude-sonnet-5', observedModel: 'claude-opus-5' }),
    );

    const result = reconcileRoutedVsObserved(db, 'run-x');
    expect(result).toMatchObject({ status: 'model-divergence', divergent: true });
  });

  it('returns null for a runId with no telemetry row', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    expect(reconcileRoutedVsObserved(db, 'no-such-run')).toBeNull();
  });
});
