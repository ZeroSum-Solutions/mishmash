// L5 lane-meter aggregation (WR wave, P1 tranche -- plan §3.2 L5:
// "aggregates observed usage per lane... tokens, estimated cost, run
// counts, throttle events"). Seeds rows across multiple lanes and asserts
// computeLaneMeters' per-lane rollup, including the trailing-window filter.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StoredRoutingTelemetryRow } from '@open-design/contracts';

import { closeDatabase, openDatabase } from '../src/db.js';
import { computeLaneMeters, ensureRoutingTelemetryTable, recordRoutingTelemetry } from '../src/routing/telemetry.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-meters-'));
});

afterEach(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

function row(overrides: Partial<StoredRoutingTelemetryRow>): StoredRoutingTelemetryRow {
  return {
    runId: 'run-1',
    projectId: 'proj-1',
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

describe('computeLaneMeters', () => {
  it('aggregates run counts, tokens, cost, and throttle events per lane across multiple lanes', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);

    recordRoutingTelemetry(
      db,
      row({
        runId: 'a',
        routedLane: 'claude-code-oauth',
        observedLane: 'claude-code-oauth',
        tokens: { input: 100, output: 50, cacheReadInput: 10 },
        costUsd: 0.01,
        costEstimated: true,
        escalated: false,
        gateOutcomes: { typescript: 'pass' },
      }),
    );
    recordRoutingTelemetry(
      db,
      row({
        runId: 'b',
        routedLane: 'claude-code-oauth',
        // Lane-level fallback: routed to claude-code-oauth, actually ran on codex-oauth.
        observedLane: 'codex-oauth',
        tokens: { input: 200, output: 100, cacheReadInput: 0 },
        costUsd: 0.02,
        costEstimated: false,
        escalated: true,
        gateOutcomes: { typescript: 'fail' },
      }),
    );
    recordRoutingTelemetry(
      db,
      row({
        runId: 'c',
        routedLane: 'moonshot',
        observedLane: 'moonshot',
        tokens: { input: 50, output: 25, cacheReadInput: 5 },
        costUsd: 0.001,
        costEstimated: true,
        escalated: false,
        gateOutcomes: {},
      }),
    );

    const meters = computeLaneMeters(db);
    const byLane = new Map(meters.map((m) => [m.lane, m]));

    const claudeLane = byLane.get('claude-code-oauth');
    expect(claudeLane).toBeDefined();
    expect(claudeLane).toMatchObject({
      runsRouted: 2,
      runsObserved: 1, // only run 'a' actually observed on this lane
      escalationRate: 0.5, // 1 of 2 routed runs escalated
      passRate: 0.5, // 1 of 2 gated runs passed ('a' pass, 'b' fail)
      tokens: { input: 300, output: 150, cacheReadInput: 10 },
      costEstimated: false, // run 'b' was not estimated -> lane total is not purely estimated
      throttleEvents: 1,
    });
    // Sum of 0.01 + 0.02 is not exactly representable in binary floating
    // point -- assert numerically rather than with strict equality.
    expect(claudeLane?.costUsd).toBeCloseTo(0.03, 10);

    // codex-oauth was never routed to directly, but was observed once (run 'b's fallback target).
    const codexLane = byLane.get('codex-oauth');
    expect(codexLane).toBeDefined();
    expect(codexLane).toMatchObject({ runsRouted: 0, runsObserved: 1 });

    const moonshotLane = byLane.get('moonshot');
    expect(moonshotLane).toBeDefined();
    expect(moonshotLane).toMatchObject({
      runsRouted: 1,
      runsObserved: 1,
      escalationRate: 0,
      passRate: 0, // no gate outcomes recorded for this run -> excluded from the pass-rate denominator
      costEstimated: true,
      throttleEvents: 0,
    });
  });

  it('scopes aggregation to the trailing windowMs, excluding older rows', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);

    const now = Date.now();
    const old = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
    const recent = new Date(now - 60 * 60 * 1000).toISOString(); // 1 hour ago

    recordRoutingTelemetry(db, row({ runId: 'old-run', routedLane: 'claude-code-oauth', createdAt: old }));
    recordRoutingTelemetry(db, row({ runId: 'recent-run', routedLane: 'claude-code-oauth', createdAt: recent }));

    const allTime = computeLaneMeters(db);
    expect(allTime.find((m) => m.lane === 'claude-code-oauth')?.runsRouted).toBe(2);

    const windowed = computeLaneMeters(db, 24 * 60 * 60 * 1000); // trailing 24h
    expect(windowed.find((m) => m.lane === 'claude-code-oauth')?.runsRouted).toBe(1);
  });

  it('returns an empty array for a database with no telemetry rows yet', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    expect(computeLaneMeters(db)).toEqual([]);
  });
});
