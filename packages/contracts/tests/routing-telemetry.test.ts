import { describe, expect, it } from 'vitest';
import {
  emptyLaneMeter,
  isLaneMeter,
  isRoutingMetersResponse,
  isRoutingTelemetryListResponse,
  isRoutingTelemetryRow,
  isStoredRoutingTelemetryRow,
  type RoutingTelemetryRow,
  type StoredRoutingTelemetryRow,
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

  // --- Sol review MED-5: semantic validation, not just shape -------------

  it('rejects an empty runId', () => {
    expect(isRoutingTelemetryRow({ ...ROW, runId: '' })).toBe(false);
  });

  it('rejects an empty stage', () => {
    expect(isRoutingTelemetryRow({ ...ROW, stage: '' })).toBe(false);
  });

  it('rejects an empty routedLane', () => {
    expect(isRoutingTelemetryRow({ ...ROW, routedLane: '' })).toBe(false);
  });

  it('rejects an empty non-null observedModel (empty string is not the same as the "not yet reported" null sentinel)', () => {
    expect(isRoutingTelemetryRow({ ...ROW, observedModel: '' })).toBe(false);
  });

  it('rejects a negative token count', () => {
    expect(isRoutingTelemetryRow({ ...ROW, tokens: { input: -1, output: 50, cacheReadInput: 0 } })).toBe(false);
  });

  it('rejects a non-finite token count', () => {
    expect(isRoutingTelemetryRow({ ...ROW, tokens: { input: Number.NaN, output: 50, cacheReadInput: 0 } })).toBe(false);
    expect(isRoutingTelemetryRow({ ...ROW, tokens: { input: Number.POSITIVE_INFINITY, output: 50, cacheReadInput: 0 } })).toBe(false);
  });

  it('rejects a negative costUsd', () => {
    expect(isRoutingTelemetryRow({ ...ROW, costUsd: -0.01 })).toBe(false);
  });

  it('rejects a negative latencyMs', () => {
    expect(isRoutingTelemetryRow({ ...ROW, latencyMs: -1 })).toBe(false);
  });

  it('rejects a negative cacheHits', () => {
    expect(isRoutingTelemetryRow({ ...ROW, cacheHits: -1 })).toBe(false);
  });

  it('rejects a negative policyVersion', () => {
    expect(isRoutingTelemetryRow({ ...ROW, policyVersion: -1 })).toBe(false);
  });

  it('rejects an invalid createdAt timestamp', () => {
    expect(isRoutingTelemetryRow({ ...ROW, createdAt: 'not-a-date' })).toBe(false);
    expect(isRoutingTelemetryRow({ ...ROW, createdAt: '' })).toBe(false);
  });

  it('rejects an invalid recordedAt timestamp', () => {
    expect(isRoutingTelemetryRow({ ...ROW, recordedAt: 'not-a-date' })).toBe(false);
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
      cost: 'exact',
      throttleEvents: 0,
      attributedRuns: 0,
      attribution: 'none',
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
        cost: 'exact',
        throttleEvents: 0,
        attributedRuns: 0,
        attribution: 'none',
      }),
    ).toBe(false);
  });

  it('rejects a lane meter missing the L5 aggregate fields (tokens/costUsd/cost/throttleEvents)', () => {
    expect(
      isLaneMeter({ lane: 'x', runsRouted: 0, runsObserved: 0, escalationRate: 0, passRate: 0 }),
    ).toBe(false);
  });

  it('rejects a lane meter with a cost value outside the closed tri-state enum (Sol HIGH-3)', () => {
    expect(isLaneMeter({ ...emptyLaneMeter('x'), cost: 'unknown' })).toBe(false);
  });

  it('accepts every legal cost tri-state value, including "mixed"', () => {
    expect(isLaneMeter({ ...emptyLaneMeter('x'), cost: 'mixed' })).toBe(true);
    expect(isLaneMeter({ ...emptyLaneMeter('x'), cost: 'estimated' })).toBe(true);
  });

  it('rejects a lane meter missing attributedRuns/attribution (Sol HIGH-2)', () => {
    const { attributedRuns: _a, ...withoutAttributedRuns } = emptyLaneMeter('x');
    expect(isLaneMeter(withoutAttributedRuns)).toBe(false);
    const { attribution: _b, ...withoutAttribution } = emptyLaneMeter('x');
    expect(isLaneMeter(withoutAttribution)).toBe(false);
  });

  it('rejects an attribution value outside the closed enum', () => {
    expect(isLaneMeter({ ...emptyLaneMeter('x'), attribution: 'guessed' })).toBe(false);
  });
});

describe('isStoredRoutingTelemetryRow / isRoutingTelemetryListResponse', () => {
  const STORED_ROW: StoredRoutingTelemetryRow = { ...ROW, projectId: 'proj-1', attempt: 0, buildId: 'build-1' };

  it('accepts a well-formed stored row (RoutingTelemetryRow + projectId + attempt)', () => {
    expect(isStoredRoutingTelemetryRow(STORED_ROW)).toBe(true);
  });

  it('accepts a second-attempt row (Sol MED-4: attempt > 0 is legal, not just the default)', () => {
    expect(isStoredRoutingTelemetryRow({ ...STORED_ROW, attempt: 1 })).toBe(true);
  });

  it('rejects a row missing projectId -- projectId is one of the two fields storage adds on top of the wire row', () => {
    expect(isStoredRoutingTelemetryRow(ROW)).toBe(false);
  });

  it('rejects an empty projectId', () => {
    expect(isStoredRoutingTelemetryRow({ ...STORED_ROW, projectId: '' })).toBe(false);
  });

  it('rejects a row missing attempt', () => {
    const { attempt: _drop, ...missing } = STORED_ROW;
    expect(isStoredRoutingTelemetryRow(missing)).toBe(false);
  });

  it('rejects a negative attempt', () => {
    expect(isStoredRoutingTelemetryRow({ ...STORED_ROW, attempt: -1 })).toBe(false);
  });

  it('rejects a non-integer attempt', () => {
    expect(isStoredRoutingTelemetryRow({ ...STORED_ROW, attempt: 1.5 })).toBe(false);
  });

  it('accepts a null buildId (t6: non-build-scoped work, e.g. general chat, has no build identity)', () => {
    expect(isStoredRoutingTelemetryRow({ ...STORED_ROW, buildId: null })).toBe(true);
  });

  it('rejects a row missing buildId entirely (t6 addition)', () => {
    const { buildId: _drop, ...missing } = STORED_ROW;
    expect(isStoredRoutingTelemetryRow(missing)).toBe(false);
  });

  it('rejects an empty-string buildId', () => {
    expect(isStoredRoutingTelemetryRow({ ...STORED_ROW, buildId: '' })).toBe(false);
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
