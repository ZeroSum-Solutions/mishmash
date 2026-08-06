import { describe, expect, it } from 'vitest';
import {
  isRoutingDecision,
  isRoutingKey,
  type RoutingDecision,
  type RoutingKey,
} from '../src/api/routing-decision';

// Type-shape coverage for the P0 routing-decision contract (WR wave
// skeleton). Real dispatch-time decision logic and admission control land in
// a later tranche (CWR-P2-1/CWR-P2-2) -- this only pins the DTO shape,
// including the routing-key fallback's independently-nullable
// templateId/buildClass (docs/plans/waves/WR-routing.md's "Routing-key
// fallback (normative)").

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

  it('rejects non-object input', () => {
    expect(isRoutingKey(null)).toBe(false);
    expect(isRoutingKey('nope')).toBe(false);
  });
});

describe('isRoutingDecision', () => {
  it('accepts a well-formed decision (the P0 stub shape)', () => {
    const decision: RoutingDecision = {
      runtimeId: 'stub-runtime',
      modelFlag: 'default',
      effort: 'medium',
      lane: 'stub-lane',
      rationale: 'policy-stub-v0',
      admissionVerdict: 'admitted',
      policyVersion: 0,
    };
    expect(isRoutingDecision(decision)).toBe(true);
  });

  it('accepts every admission verdict, including the fail-closed blocked-on-founder state', () => {
    for (const admissionVerdict of ['admitted', 'denied', 'blocked-on-founder'] as const) {
      expect(
        isRoutingDecision({
          runtimeId: 'r',
          modelFlag: 'm',
          effort: 'low',
          lane: 'l',
          rationale: 'x',
          admissionVerdict,
          policyVersion: 1,
        }),
      ).toBe(true);
    }
  });

  it('rejects an unrecognized admission verdict', () => {
    expect(
      isRoutingDecision({
        runtimeId: 'r',
        modelFlag: 'm',
        effort: 'low',
        lane: 'l',
        rationale: 'x',
        admissionVerdict: 'maybe',
        policyVersion: 1,
      }),
    ).toBe(false);
  });

  it('rejects a decision missing a required field', () => {
    expect(
      isRoutingDecision({
        runtimeId: 'r',
        modelFlag: 'm',
        effort: 'low',
        lane: 'l',
        admissionVerdict: 'admitted',
        policyVersion: 1,
      }),
    ).toBe(false);
  });
});
