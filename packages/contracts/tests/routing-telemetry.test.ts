import { describe, expect, it } from 'vitest';
import {
  emptyLaneMeter,
  isLaneMeter,
  isRoutingMetersResponse,
  isRoutingTelemetryListResponse,
  isRoutingTelemetryRow,
  isStoredRoutingTelemetryRow,
  type RoutingTelemetryRow,
} from '../src/api/routing-telemetry';

// Type-shape coverage for the P0 routing-telemetry contract (WR wave
// skeleton). Durable persistence and real gate-outcome content land in a
// later tranche (CWR-P1-2) -- this only pins the DTO shape, including the
// routed-vs-observed distinction plan §3.2 L5 requires for BOTH model and
// lane (Sol review finding HIGH-3), and the run's policyVersion.

const ROW: RoutingTelemetryRow = {
  runId: 'run-1',
  stage: 'chat',
  templateId: null,
  designSystem: null,
  routedModel: 'claude-sonnet-5',
  observedModel: 'claude-sonnet-5',
  routedLane: 'claude-code-oauth',
  observedLane: 'claude-code-oauth',
  tokens: { input: 100, output: 50, cacheReadInput: 0 },
  cacheHits: 0,
  latencyMs: 1200,
  costUsd: 0.01,
  costEstimated: false,
  gateOutcomes: {},
  escalated: false,
  policyVersion: 0,
  createdAt: '2026-08-05T00:00:00.000Z',
  recordedAt: '2026-08-05T00:00:05.000Z',
};

describe('isRoutingTelemetryRow', () => {
  it('accepts a well-formed row', () => {
    expect(isRoutingTelemetryRow(ROW)).toBe(true);
  });

  it('accepts a routed-but-not-yet-observed row (observedModel/observedLane null before the run reports back)', () => {
    expect(isRoutingTelemetryRow({ ...ROW, observedModel: null, observedLane: null })).toBe(true);
  });

  it('distinguishes routed from observed model -- both fields are independently present', () => {
    const diverged = { ...ROW, routedModel: 'claude-sonnet-5', observedModel: 'claude-opus-5' };
    expect(isRoutingTelemetryRow(diverged)).toBe(true);
    expect(diverged.routedModel).not.toBe(diverged.observedModel);
  });

  it('distinguishes routed from observed lane -- a lane-level fallback is traceable the same way a model substitution is', () => {
    const diverged = { ...ROW, routedLane: 'claude-code-oauth', observedLane: 'openrouter-fallback' };
    expect(isRoutingTelemetryRow(diverged)).toBe(true);
    expect(diverged.routedLane).not.toBe(diverged.observedLane);
  });

  it('rejects a row missing routedLane', () => {
    const { routedLane: _drop, ...missing } = ROW;
    expect(isRoutingTelemetryRow(missing)).toBe(false);
  });

  it('rejects a row missing policyVersion', () => {
    const { policyVersion: _drop, ...missing } = ROW;
    expect(isRoutingTelemetryRow(missing)).toBe(false);
  });

  it('rejects a row with a malformed tokens sub-object', () => {
    expect(isRoutingTelemetryRow({ ...ROW, tokens: { input: 100 } })).toBe(false);
  });

  it('rejects a row missing costEstimated', () => {
    const { costEstimated: _drop, ...rest } = ROW;
    expect(isRoutingTelemetryRow(rest)).toBe(false);
  });

  it('rejects a gateOutcomes that is an array rather than a keyed map (MED-5 negative test)', () => {
    // Arrays are `typeof === 'object'` too -- a naive container-type check
    // would wrongly accept this.
    expect(isRoutingTelemetryRow({ ...ROW, gateOutcomes: ['pass', 'fail'] })).toBe(false);
  });

  it('rejects a gateOutcomes value outside the closed RoutingGateOutcome enum', () => {
    expect(isRoutingTelemetryRow({ ...ROW, gateOutcomes: { lighthouse: 'maybe' } })).toBe(false);
  });

  it('accepts every legal gateOutcomes value, including blocked-on-founder', () => {
    expect(isRoutingTelemetryRow({ ...ROW, gateOutcomes: { lighthouse: 'pass', axe: 'fail', 'ssim-baseline': 'blocked-on-founder' } })).toBe(true);
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
      tokens: { input: 0, output: 0, cacheReadInput: 0 },
      costUsd: 0,
      costEstimated: true,
      throttleEvents: 0,
    });
  });

  it('rejects a meter missing a required numeric field', () => {
    expect(isLaneMeter({ lane: 'x', runsRouted: 0, runsObserved: 0, escalationRate: 0 })).toBe(false);
  });

  it('rejects a meter with a non-numeric field (nonnumeric meters, MED-5 negative test)', () => {
    expect(
      isLaneMeter({
        lane: 'x',
        runsRouted: 0,
        runsObserved: 0,
        escalationRate: 0,
        passRate: 'high',
        tokens: { input: 0, output: 0, cacheReadInput: 0 },
        costUsd: 0,
        costEstimated: true,
        throttleEvents: 0,
      }),
    ).toBe(false);
  });

  it('rejects a lane meter missing the L5 aggregate fields (tokens/costUsd/costEstimated/throttleEvents)', () => {
    expect(
      isLaneMeter({ lane: 'x', runsRouted: 0, runsObserved: 0, escalationRate: 0, passRate: 0 }),
    ).toBe(false);
  });
});

describe('isStoredRoutingTelemetryRow / isRoutingTelemetryListResponse', () => {
  const STORED_ROW = { ...ROW, projectId: 'proj-1' };

  it('accepts a well-formed stored row (RoutingTelemetryRow + projectId)', () => {
    expect(isStoredRoutingTelemetryRow(STORED_ROW)).toBe(true);
  });

  it('rejects a row missing projectId -- projectId is the one field storage adds on top of the wire row', () => {
    expect(isStoredRoutingTelemetryRow(ROW)).toBe(false);
  });

  it('accepts a well-shaped RoutingTelemetryListResponse envelope, including an empty page', () => {
    expect(isRoutingTelemetryListResponse({ rows: [STORED_ROW], total: 1, limit: 50, offset: 0 })).toBe(true);
    expect(isRoutingTelemetryListResponse({ rows: [], total: 0, limit: 50, offset: 0 })).toBe(true);
  });

  it('rejects an envelope whose rows contain a malformed entry', () => {
    expect(isRoutingTelemetryListResponse({ rows: [ROW], total: 1, limit: 50, offset: 0 })).toBe(false);
  });
});

describe('isRoutingMetersResponse', () => {
  it('accepts the GET /api/routing/meters envelope shape, including a non-empty laneMeters array', () => {
    expect(isRoutingMetersResponse({ laneMeters: [emptyLaneMeter('claude-code-oauth')] })).toBe(true);
    expect(isRoutingMetersResponse({ laneMeters: [] })).toBe(true);
  });

  it('rejects an envelope whose laneMeters contains a malformed entry', () => {
    expect(isRoutingMetersResponse({ laneMeters: [{ lane: 'x' }] })).toBe(false);
  });
});
