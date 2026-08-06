import { describe, expect, it } from 'vitest';
import {
  isRoutingDecision,
  isRoutingDecisionPreviewResponse,
  isRoutingKey,
  type RoutingDecision,
  type RoutingKey,
} from '../src/api/routing-decision';

// Type-shape coverage for the P0 routing-decision contract (WR wave
// skeleton). Real dispatch-time decision logic and admission control land in
// a later tranche (CWR-P2-1/CWR-P2-2) -- this only pins the DTO shape,
// including the routing-key fallback's frozen shapes
// (docs/plans/waves/WR-routing.md's "Routing-key fallback (normative)")
// modeled as a discriminated union (Sol review finding HIGH-1) rather than
// two independently-nullable fields.

const BASE_DECISION_FIELDS = {
  runtimeId: 'stub-runtime',
  modelFlag: 'default',
  lane: 'stub-lane',
  rationale: 'policy-stub-v0',
  admissionVerdict: 'admitted' as const,
  policyVersion: 0,
  promptComposition: [{ part: 'system' }, { part: 'brief', estimatedTokens: 400 }],
  sensitivityClass: 'client-confidential' as const,
  status: 'ok' as const,
  reasons: [{ step: 'selection' as const, message: 'selected default on stub-lane.' }],
  contextEstimateTokens: 0,
  demotions: [],
};

describe('isRoutingKey', () => {
  it('accepts the primary shape: a ClientWebsiteBrief-backed build (both present)', () => {
    const key: RoutingKey = {
      templateId: 'brief-template',
      buildClass: 'landing-page',
      stage: 'art-direction',
      contextEstimateTokens: 1200,
      laneMeters: { 'claude-code-oauth': 0.4 },
    };
    expect(isRoutingKey(key)).toBe(true);
  });

  it('accepts fallback A: a template selected with no brief (buildClass null)', () => {
    const key: RoutingKey = {
      templateId: 'saved-prompt-template',
      buildClass: null,
      stage: 'prototype',
      contextEstimateTokens: 400,
      laneMeters: {},
    };
    expect(isRoutingKey(key)).toBe(true);
  });

  it('accepts fallback B: general chat (both null)', () => {
    const key: RoutingKey = {
      templateId: null,
      buildClass: null,
      stage: 'chat',
      contextEstimateTokens: 50,
      laneMeters: {},
    };
    expect(isRoutingKey(key)).toBe(true);
  });

  it('accepts fallback C: a non-web pipeline-internal templateId with no buildClass', () => {
    const key: RoutingKey = {
      templateId: 'ingest-classify-pipeline-run-7',
      buildClass: null,
      stage: 'classify',
      contextEstimateTokens: 900,
      laneMeters: {},
    };
    expect(isRoutingKey(key)).toBe(true);
  });

  it('rejects the one forbidden shape: buildClass present with templateId null (HIGH-1 negative test)', () => {
    // TypeScript already makes this shape unrepresentable as a RoutingKey
    // literal (compile error if written as a typed variable); the guard
    // must also reject it at the value level for data that arrives
    // untyped over the wire (e.g. a query-string-constructed key).
    const forbidden = {
      templateId: null,
      buildClass: 'landing-page',
      stage: 'art-direction',
      contextEstimateTokens: 1200,
      laneMeters: {},
    };
    expect(isRoutingKey(forbidden)).toBe(false);
  });

  it('rejects a laneMeters that is an array instead of a keyed map', () => {
    expect(
      isRoutingKey({
        templateId: null,
        buildClass: null,
        stage: 'chat',
        contextEstimateTokens: 0,
        laneMeters: [],
      }),
    ).toBe(false);
  });

  it('rejects a laneMeters with a non-numeric value', () => {
    expect(
      isRoutingKey({
        templateId: null,
        buildClass: null,
        stage: 'chat',
        contextEstimateTokens: 0,
        laneMeters: { 'claude-code-oauth': 'high' },
      }),
    ).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(isRoutingKey(null)).toBe(false);
    expect(isRoutingKey('nope')).toBe(false);
  });
});

describe('isRoutingDecision', () => {
  it('accepts a well-formed decision (the P0 stub shape)', () => {
    const decision: RoutingDecision = { ...BASE_DECISION_FIELDS, effort: 'medium' };
    expect(isRoutingDecision(decision)).toBe(true);
  });

  it('accepts every admission verdict, including the fail-closed blocked-on-founder state and the t5 not-evaluated placeholder', () => {
    for (const admissionVerdict of ['admitted', 'denied', 'blocked-on-founder', 'not-evaluated'] as const) {
      expect(isRoutingDecision({ ...BASE_DECISION_FIELDS, effort: 'low', admissionVerdict })).toBe(true);
    }
  });

  it('accepts every effort value including "inherit" (t5 bug fix: the old ROUTING_EFFORTS guard omitted it)', () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'inherit'] as const) {
      expect(isRoutingDecision({ ...BASE_DECISION_FIELDS, effort })).toBe(true);
    }
  });

  it('accepts every decision status', () => {
    for (const status of ['ok', 'fail-closed-stop', 'error'] as const) {
      expect(isRoutingDecision({ ...BASE_DECISION_FIELDS, effort: 'low', status })).toBe(true);
    }
  });

  it('rejects an unrecognized status', () => {
    expect(isRoutingDecision({ ...BASE_DECISION_FIELDS, effort: 'low', status: 'pending' })).toBe(false);
  });

  it('accepts a reasons entry with an optional code, and rejects one with an unrecognized step', () => {
    const withCode = { ...BASE_DECISION_FIELDS, effort: 'low' as const, reasons: [{ step: 'fail-closed', message: 'x', code: 'class-exhausted:internal' }] };
    expect(isRoutingDecision(withCode)).toBe(true);
    const badStep = { ...BASE_DECISION_FIELDS, effort: 'low' as const, reasons: [{ step: 'not-a-real-step', message: 'x' }] };
    expect(isRoutingDecision(badStep)).toBe(false);
  });

  it('rejects a reasons entry missing message', () => {
    expect(isRoutingDecision({ ...BASE_DECISION_FIELDS, effort: 'low', reasons: [{ step: 'selection' }] })).toBe(false);
  });

  it('accepts demotions with a null toLane (exhausted) and rejects a malformed demotion entry', () => {
    const withDemotion = {
      ...BASE_DECISION_FIELDS,
      effort: 'low' as const,
      demotions: [{ fromLane: 'claude-code-oauth', toLane: null, reason: 'throttled' }],
    };
    expect(isRoutingDecision(withDemotion)).toBe(true);
    const malformed = { ...BASE_DECISION_FIELDS, effort: 'low' as const, demotions: [{ fromLane: 'x' }] };
    expect(isRoutingDecision(malformed)).toBe(false);
  });

  it('rejects a non-numeric contextEstimateTokens', () => {
    expect(isRoutingDecision({ ...BASE_DECISION_FIELDS, effort: 'low', contextEstimateTokens: '400' })).toBe(false);
  });

  it('accepts every data classification', () => {
    for (const sensitivityClass of ['client-confidential', 'internal', 'public'] as const) {
      expect(isRoutingDecision({ ...BASE_DECISION_FIELDS, effort: 'low', sensitivityClass })).toBe(true);
    }
  });

  it('rejects an unrecognized admission verdict', () => {
    expect(isRoutingDecision({ ...BASE_DECISION_FIELDS, effort: 'low', admissionVerdict: 'maybe' })).toBe(false);
  });

  it('rejects an arbitrary (non-enum) effort string', () => {
    expect(isRoutingDecision({ ...BASE_DECISION_FIELDS, effort: 'ludicrous' })).toBe(false);
  });

  it('rejects an unrecognized sensitivityClass', () => {
    expect(isRoutingDecision({ ...BASE_DECISION_FIELDS, effort: 'low', sensitivityClass: 'top-secret' })).toBe(false);
  });

  it('rejects a promptComposition that is not an array', () => {
    expect(isRoutingDecision({ ...BASE_DECISION_FIELDS, effort: 'low', promptComposition: { part: 'system' } })).toBe(false);
  });

  it('rejects a promptComposition entry missing its required part field', () => {
    expect(isRoutingDecision({ ...BASE_DECISION_FIELDS, effort: 'low', promptComposition: [{ estimatedTokens: 10 }] })).toBe(false);
  });

  it('rejects a promptComposition entry with a non-numeric estimatedTokens', () => {
    expect(
      isRoutingDecision({
        ...BASE_DECISION_FIELDS,
        effort: 'low',
        promptComposition: [{ part: 'system', estimatedTokens: 'many' }],
      }),
    ).toBe(false);
  });

  it('rejects a decision missing a required field', () => {
    const { rationale: _drop, ...missing } = { ...BASE_DECISION_FIELDS, effort: 'low' as const };
    expect(isRoutingDecision(missing)).toBe(false);
  });

  it('rejects a decision missing sensitivityClass entirely', () => {
    const { sensitivityClass: _drop, ...missing } = { ...BASE_DECISION_FIELDS, effort: 'low' as const };
    expect(isRoutingDecision(missing)).toBe(false);
  });
});

describe('isRoutingDecisionPreviewResponse', () => {
  it('accepts the GET /api/routing/decision/preview envelope shape', () => {
    const key: RoutingKey = { templateId: null, buildClass: null, stage: 'chat', contextEstimateTokens: 0, laneMeters: {} };
    const decision: RoutingDecision = { ...BASE_DECISION_FIELDS, effort: 'medium' };
    expect(isRoutingDecisionPreviewResponse({ key, decision })).toBe(true);
  });

  it('rejects an envelope whose key is the forbidden build-class-only shape', () => {
    const decision: RoutingDecision = { ...BASE_DECISION_FIELDS, effort: 'medium' };
    expect(
      isRoutingDecisionPreviewResponse({
        key: { templateId: null, buildClass: 'landing-page', stage: 'chat', contextEstimateTokens: 0, laneMeters: {} },
        decision,
      }),
    ).toBe(false);
  });
});
