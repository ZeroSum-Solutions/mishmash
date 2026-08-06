// L5 lane-meter aggregation (WR wave, P1 tranche -- plan §3.2 L5:
// "aggregates observed usage per lane... tokens, estimated cost, run
// counts, throttle events"). Seeds rows across multiple lanes and asserts
// computeLaneMeters' per-lane rollup, including the trailing-window filter
// and the Sol-review attribution fix (HIGH-2: metrics follow `observedLane
// ?? routedLane`, not unconditionally `routedLane`) and cost tri-state
// (HIGH-3: `cost: 'exact' | 'estimated' | 'mixed'`).

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
    attempt: 0,
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

    // Sol HIGH-2: run 'b' was ROUTED to claude-code-oauth but OBSERVED on
    // codex-oauth -- its tokens/cost/escalation/gate outcome must be
    // charged to codex-oauth, not claude-code-oauth, even though
    // claude-code-oauth's `runsRouted` still counts it as a routing
    // decision.
    const claudeLane = byLane.get('claude-code-oauth');
    expect(claudeLane).toBeDefined();
    expect(claudeLane).toMatchObject({
      runsRouted: 2, // both a and b were ROUTED here
      runsObserved: 1, // only a was CONFIRMED observed here
      attributedRuns: 1, // only a's metrics are charged here (b moved to codex-oauth)
      escalationRate: 0, // a alone, not escalated
      passRate: 1, // a alone, gated + passed
      tokens: { input: 100, output: 50, cacheReadInput: 10 }, // a's tokens ONLY -- b's excluded
      cost: 'estimated', // a alone contributed, and a was an estimate
      throttleEvents: 0,
      attribution: 'observed',
    });
    expect(claudeLane?.costUsd).toBeCloseTo(0.01, 10);

    // codex-oauth was never ROUTED to, but b's divergent observation makes
    // it the ATTRIBUTION target for b's entire metric set.
    const codexLane = byLane.get('codex-oauth');
    expect(codexLane).toBeDefined();
    expect(codexLane).toMatchObject({
      runsRouted: 0,
      runsObserved: 1,
      attributedRuns: 1,
      escalationRate: 1, // b alone, escalated
      passRate: 0, // b alone, gated + failed
      tokens: { input: 200, output: 100, cacheReadInput: 0 }, // b's tokens, moved here
      cost: 'exact', // b was billed, not estimated
      throttleEvents: 1,
      attribution: 'observed',
    });
    expect(codexLane?.costUsd).toBeCloseTo(0.02, 10);

    const moonshotLane = byLane.get('moonshot');
    expect(moonshotLane).toBeDefined();
    expect(moonshotLane).toMatchObject({
      runsRouted: 1,
      runsObserved: 1,
      attributedRuns: 1,
      escalationRate: 0,
      passRate: 0, // no gate outcomes recorded for this run -> excluded from the pass-rate denominator
      cost: 'estimated',
      throttleEvents: 0,
      attribution: 'observed',
    });
  });

  it('falls back to routedLane for attribution when observedLane has not arrived yet, and marks attribution "routed-fallback"', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(
      db,
      row({
        runId: 'd',
        routedLane: 'nous',
        observedLane: null,
        tokens: { input: 10, output: 5, cacheReadInput: 0 },
        costUsd: 0.005,
        costEstimated: true,
        escalated: false,
        gateOutcomes: {},
      }),
    );

    const meters = computeLaneMeters(db);
    const nousLane = meters.find((m) => m.lane === 'nous');
    expect(nousLane).toMatchObject({
      runsRouted: 1,
      runsObserved: 0, // never confirmed
      attributedRuns: 1, // still attributed here, via fallback
      tokens: { input: 10, output: 5, cacheReadInput: 0 },
      cost: 'estimated',
      attribution: 'routed-fallback',
    });
    expect(nousLane?.costUsd).toBeCloseTo(0.005, 10);
  });

  it('reports cost:"mixed" and attribution:"mixed" when a lane accumulates both exact+estimated and observed+fallback rows (Sol HIGH-2/HIGH-3, exact numbers)', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(
      db,
      row({
        runId: 'e',
        routedLane: 'kimi',
        observedLane: 'kimi', // confirmed observation
        tokens: { input: 1, output: 1, cacheReadInput: 0 },
        costUsd: 0.1,
        costEstimated: false, // billed/exact
        escalated: false,
        gateOutcomes: {},
      }),
    );
    recordRoutingTelemetry(
      db,
      row({
        runId: 'f',
        routedLane: 'kimi',
        observedLane: null, // not yet observed -> falls back to routedLane
        tokens: { input: 2, output: 2, cacheReadInput: 0 },
        costUsd: 0.2,
        costEstimated: true, // pre-run estimate
        escalated: true,
        gateOutcomes: { lighthouse: 'pass' },
      }),
    );

    const meters = computeLaneMeters(db);
    const kimiLane = meters.find((m) => m.lane === 'kimi');
    expect(kimiLane).toMatchObject({
      runsRouted: 2,
      runsObserved: 1, // only 'e' confirmed
      attributedRuns: 2, // both attribute here ('e' observed, 'f' fallback)
      escalationRate: 0.5, // 1 of 2 attributed runs ('f') escalated
      passRate: 1, // 1 of 1 GATED attributed runs passed ('e' carries no gate outcomes)
      tokens: { input: 3, output: 3, cacheReadInput: 0 },
      cost: 'mixed', // 'e' exact + 'f' estimated
      throttleEvents: 1,
      attribution: 'mixed', // 'e' observed + 'f' routed-fallback
    });
    // 0.1 + 0.2 is not exactly representable in binary floating point.
    expect(kimiLane?.costUsd).toBeCloseTo(0.3, 10);
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

  it('aggregates across every attempt of a retried run (Sol MED-4)', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(
      db,
      row({
        runId: 'retry-run',
        attempt: 0,
        routedLane: 'claude-code-oauth',
        observedLane: 'claude-code-oauth',
        tokens: { input: 10, output: 10, cacheReadInput: 0 },
        costUsd: 0.01,
      }),
    );
    recordRoutingTelemetry(
      db,
      row({
        runId: 'retry-run',
        attempt: 1,
        routedLane: 'codex-oauth',
        observedLane: 'codex-oauth',
        tokens: { input: 20, output: 20, cacheReadInput: 0 },
        costUsd: 0.02,
      }),
    );

    const meters = computeLaneMeters(db);
    expect(meters.find((m) => m.lane === 'claude-code-oauth')?.attributedRuns).toBe(1);
    expect(meters.find((m) => m.lane === 'codex-oauth')?.attributedRuns).toBe(1);
  });

  it('returns an empty array for a database with no telemetry rows yet', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    expect(computeLaneMeters(db)).toEqual([]);
  });
});
