import { describe, expect, it } from 'vitest';
import {
  emptyLaneMeter,
  isLaneMeter,
  isRoutingTelemetryRow,
  type RoutingTelemetryRow,
} from '../src/api/routing-telemetry';

// Type-shape coverage for the P0 routing-telemetry contract (WR wave
// skeleton). Durable persistence and real gate-outcome content land in a
// later tranche (CWR-P1-2) -- this only pins the DTO shape, including the
// routed-vs-observed model distinction plan §3.2 L5 requires.

const ROW: RoutingTelemetryRow = {
  runId: 'run-1',
  stage: 'chat',
  templateId: null,
  designSystem: null,
  routedModel: 'claude-sonnet-5',
  observedModel: 'claude-sonnet-5',
  tokens: { input: 100, output: 50, cacheReadInput: 0 },
  cacheHits: 0,
  latencyMs: 1200,
  costUsd: 0.01,
  costEstimated: false,
  gateOutcomes: {},
  escalated: false,
  createdAt: '2026-08-05T00:00:00.000Z',
  recordedAt: '2026-08-05T00:00:05.000Z',
};

describe('isRoutingTelemetryRow', () => {
  it('accepts a well-formed row', () => {
    expect(isRoutingTelemetryRow(ROW)).toBe(true);
  });

  it('accepts a routed-but-not-yet-observed row (observedModel null before the run reports back)', () => {
    expect(isRoutingTelemetryRow({ ...ROW, observedModel: null })).toBe(true);
  });

  it('distinguishes routed from observed model -- both fields are independently present', () => {
    const diverged = { ...ROW, routedModel: 'claude-sonnet-5', observedModel: 'claude-opus-5' };
    expect(isRoutingTelemetryRow(diverged)).toBe(true);
    expect(diverged.routedModel).not.toBe(diverged.observedModel);
  });

  it('rejects a row with a malformed tokens sub-object', () => {
    expect(isRoutingTelemetryRow({ ...ROW, tokens: { input: 100 } })).toBe(false);
  });

  it('rejects a row missing costEstimated', () => {
    const { costEstimated: _drop, ...rest } = ROW;
    expect(isRoutingTelemetryRow(rest)).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(isRoutingTelemetryRow(null)).toBe(false);
  });
});

describe('isLaneMeter / emptyLaneMeter', () => {
  it('emptyLaneMeter produces a well-shaped, all-zero meter for a fresh lane', () => {
    const meter = emptyLaneMeter('claude-code-oauth');
    expect(isLaneMeter(meter)).toBe(true);
    expect(meter).toEqual({
      lane: 'claude-code-oauth',
      runsRouted: 0,
      runsObserved: 0,
      escalationRate: 0,
      passRate: 0,
    });
  });

  it('rejects a meter missing a required numeric field', () => {
    expect(isLaneMeter({ lane: 'x', runsRouted: 0, runsObserved: 0, escalationRate: 0 })).toBe(false);
  });
});
