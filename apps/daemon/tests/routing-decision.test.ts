// Table-driven coverage for the pure advisory decision engine (WR wave, P2
// tranche -- plan docs/plans/2026-08-05-model-routing-system.md §3.1/§3.2 L2,
// §2). `decideRouting` is pure (no I/O), so every case here builds its
// inputs in memory -- no daemon boot, no SQLite. Cases against the REAL
// shipped policy (apps/daemon/src/routing/routing-policy.json, loaded via
// loadRoutingPolicy()) prove the engine resolves actual §2/§15 content
// correctly; cases against a small synthetic fixture policy isolate a
// single mechanism (hard-constraint filtering, contextMaxTokens bounds)
// that the real policy doesn't happen to exercise on its own.

import { describe, expect, it } from 'vitest';
import type { LaneMeter, RoutingKey, RoutingPolicyDocument } from '@open-design/contracts';
import { emptyLaneMeter } from '@open-design/contracts';

import { decideRouting, estimatePromptTokens } from '../src/routing/decision.js';
import { loadRoutingPolicy } from '../src/routing/policy.js';

const realPolicy = loadRoutingPolicy();

function keyFor(overrides: Partial<RoutingKey> = {}): RoutingKey {
  return {
    templateId: null,
    buildClass: null,
    stage: 'chat',
    contextEstimateTokens: 0,
    laneMeters: {},
    ...overrides,
  } as RoutingKey;
}

function throttled(lane: string, throttleEvents: number): LaneMeter {
  return { ...emptyLaneMeter(lane), throttleEvents };
}

describe('decideRouting -- §2 task-class resolution against the real policy', () => {
  const distinctTaskClasses = [...new Set(realPolicy.modelTable.map((entry) => entry.match.taskClass).filter((v): v is string => v !== undefined))];

  it('has more than one §2 task class to iterate (sanity: the real policy is loaded, not an empty stub)', () => {
    expect(distinctTaskClasses.length).toBeGreaterThan(0);
  });

  it.each(distinctTaskClasses)('resolves the primary candidate for taskClass "%s" (sensitivityClass=public, no throttling)', (taskClass) => {
    const firstRow = realPolicy.modelTable.find((entry) => entry.match.taskClass === taskClass)!;
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor(),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass,
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe(firstRow.primary.model);
    expect(decision.lane).toBe(firstRow.primary.lane);
    expect(decision.admissionVerdict).toBe('not-evaluated');
    expect(decision.contextEstimateTokens).toBe(0);
  });
});

describe('decideRouting -- §15 program-assignment pin', () => {
  it('pins grok-4.5 through the nous lane for the product-architecture-adversary selector', () => {
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor(),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'product-architecture-adversary',
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe('grok-4.5');
    expect(decision.lane).toBe('nous');
    expect(decision.reasons.some((r) => r.step === 'program-assignment' && r.code === 'assignment:product-architecture-adversary')).toBe(true);
  });

  it('pins claude-fable-5 through Claude Code OAuth for the long-horizon-prd-review selector', () => {
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor(),
      sensitivityClass: 'client-confidential',
      laneMeters: [],
      taskClass: 'long-horizon-prd-review',
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe('claude-fable-5');
    expect(decision.lane).toBe('claude-code-oauth');
    expect(decision.reasons.some((r) => r.step === 'program-assignment' && r.code === 'assignment:long-horizon-prd-review')).toBe(true);
  });
});

describe('decideRouting -- constraint filtering', () => {
  function fixturePolicy(overrides: Partial<RoutingPolicyDocument> = {}): RoutingPolicyDocument {
    return {
      policyVersion: 1,
      modelTable: [
        {
          match: { taskClass: 'test-class' },
          primary: { runtimeId: 'claude', model: 'claude-sonnet-5', effort: 'inherit', lane: 'nous', transport: 'prepaid', modelFamily: 'anthropic' },
          burst: { runtimeId: 'claude', model: 'claude-haiku-4-5', effort: 'inherit', lane: 'claude-code-oauth', transport: 'subscription-oauth', modelFamily: 'anthropic' },
        },
      ],
      hardConstraints: [
        {
          id: 'no-anthropic-prepaid',
          description: 'anthropic models may only dispatch via subscription-oauth',
          modelFamily: 'anthropic',
          forbiddenTransports: ['prepaid', 'metered-api'],
          allowedTransports: ['subscription-oauth'],
        },
      ],
      laneChains: {},
      dataClassificationAllowlists: [{ classification: 'public', allowedLanes: ['nous', 'claude-code-oauth'], failClosed: true }],
      sonnetPriceRows: [],
      budgetCeilings: { perStageEstimatedCostUsd: { chat: 0.5 }, perBuildCapUsd: 1, perDayCapUsd: 1, meteredKillSwitch: false },
      ...overrides,
    };
  }

  it('removes an anthropic candidate dispatched on a forbidden (prepaid) transport, falling to the compliant burst candidate', () => {
    const decision = decideRouting({
      policy: fixturePolicy(),
      key: keyFor(),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'test-class',
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe('claude-haiku-4-5');
    expect(decision.lane).toBe('claude-code-oauth');
    expect(
      decision.reasons.some((r) => r.step === 'hard-constraint-filter' && r.code === 'constraint:no-anthropic-prepaid'),
    ).toBe(true);
  });
});

describe('decideRouting -- data-classification filtering', () => {
  it('client-confidential strips the non-subscription cheap candidate but keeps the subscription primary', () => {
    // mechanical-batch (real policy): primary claude-haiku-4-5/claude-code-oauth
    // (subscription), burst gpt-5.6-luna/codex-oauth (subscription), cheap
    // deepseek-v4-flash/deepseek-direct (metered -- outside the
    // client-confidential allowlist).
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor(),
      sensitivityClass: 'client-confidential',
      laneMeters: [],
      taskClass: 'mechanical-batch',
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe('claude-haiku-4-5');
    expect(
      decision.reasons.some(
        (r) => r.step === 'data-classification-filter' && r.message.includes('deepseek-v4-flash'),
      ),
    ).toBe(true);
  });
});

describe('decideRouting -- FAIL-CLOSED', () => {
  it('client-confidential + every subscription lane throttled -> fail-closed-stop, never a metered fallback', () => {
    // mechanical-batch: primary+burst are both subscription lanes (survive
    // the client-confidential filter); cheap (deepseek, metered) is
    // filtered OUT by classification. Throttling both survivors must NOT
    // reach for the filtered-out metered cheap candidate.
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor(),
      sensitivityClass: 'client-confidential',
      laneMeters: [throttled('claude-code-oauth', 5), throttled('codex-oauth', 3)],
      taskClass: 'mechanical-batch',
    });
    expect(decision.status).toBe('fail-closed-stop');
    expect(decision.modelFlag).not.toBe('deepseek-v4-flash');
    expect(decision.lane).not.toBe('deepseek-direct');
    expect(decision.reasons.some((r) => r.step === 'fail-closed')).toBe(true);
  });

  it('reports fail-closed-stop when the sensitivity class has no allowlist entry in the policy at all', () => {
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor(),
      // Cast through unknown: proving the runtime guard, not just the type.
      sensitivityClass: 'nonexistent-class' as unknown as 'public',
      laneMeters: [],
      taskClass: 'mechanical-batch',
    });
    expect(decision.status).toBe('fail-closed-stop');
  });
});

describe('decideRouting -- throttle demotion', () => {
  it('demotes a throttled primary lane to burst and records the demotion', () => {
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor(),
      sensitivityClass: 'public',
      laneMeters: [throttled('claude-code-oauth', 1)],
      taskClass: 'mechanical-batch',
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe('gpt-5.6-luna');
    expect(decision.lane).toBe('codex-oauth');
    expect(decision.demotions).toEqual([
      { fromLane: 'claude-code-oauth', toLane: 'codex-oauth', reason: expect.stringContaining('throttle event') },
    ]);
    expect(decision.reasons.some((r) => r.step === 'lane-throttle-demotion' && r.code === 'throttled:claude-code-oauth')).toBe(true);
  });

  it('a throttleEvents count at or below maxThrottleEvents does not demote', () => {
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor(),
      sensitivityClass: 'public',
      laneMeters: [throttled('claude-code-oauth', 2)],
      taskClass: 'mechanical-batch',
      maxThrottleEvents: 2,
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe('claude-haiku-4-5');
    expect(decision.demotions).toEqual([]);
  });
});

describe('decideRouting -- unknown stage', () => {
  it('returns a typed error decision for a stage outside the closed vocabulary, never a fallback row', () => {
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor({ stage: 'made-up-stage' }),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'mechanical-batch',
    });
    expect(decision.status).toBe('error');
    expect(decision.reasons.some((r) => r.code === 'unknown-stage:made-up-stage')).toBe(true);
    // Never silently falls through to mechanical-batch's real primary.
    expect(decision.modelFlag).not.toBe('claude-haiku-4-5');
  });
});

describe('decideRouting -- all 4 routing-key shapes', () => {
  it('primary shape (templateId + buildClass) resolves when taskClass matches', () => {
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor({ templateId: 'brief-template', buildClass: 'landing-page', stage: 'section-fanout', contextEstimateTokens: 1200 }),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'section-component-codegen',
    });
    expect(decision.status).toBe('ok');
    expect(decision.contextEstimateTokens).toBe(1200);
  });

  it('fallback A (templateId, no buildClass) resolves the same way once a taskClass is supplied', () => {
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor({ templateId: 'saved-prompt-template', buildClass: null, stage: 'chat' }),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'mechanical-batch',
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe('claude-haiku-4-5');
  });

  it('fallback B (general chat, no templateId/buildClass/taskClass) is an honest typed error, not a fabricated default', () => {
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor({ stage: 'chat' }),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: null,
    });
    expect(decision.status).toBe('error');
    expect(decision.reasons.some((r) => r.code === 'no-candidates')).toBe(true);
  });

  it('fallback C (non-web pipeline-internal templateId, its own stage) resolves via taskClass', () => {
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor({ templateId: 'ingest-classify-pipeline-run-7', buildClass: null, stage: 'ingestion', contextEstimateTokens: 900 }),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'token-distill',
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe('deepseek-v4-flash');
  });
});

describe('decideRouting -- contextMaxTokens / minContextTokens bounds', () => {
  function contextBoundPolicy(): RoutingPolicyDocument {
    return {
      policyVersion: 1,
      modelTable: [
        {
          match: { taskClass: 'ctx-test', maxContextTokens: 1000 },
          primary: { runtimeId: 'small-runtime', model: 'small-context-model', effort: 'inherit', lane: 'claude-code-oauth', transport: 'subscription-oauth', modelFamily: 'anthropic' },
        },
        {
          match: { taskClass: 'ctx-test', minContextTokens: 1000 },
          primary: { runtimeId: 'large-runtime', model: 'large-context-model', effort: 'inherit', lane: 'agy', transport: 'subscription-oauth', modelFamily: 'google' },
        },
      ],
      hardConstraints: [],
      laneChains: {},
      dataClassificationAllowlists: [{ classification: 'public', allowedLanes: ['claude-code-oauth', 'agy'], failClosed: true }],
      sonnetPriceRows: [],
      budgetCeilings: { perStageEstimatedCostUsd: { chat: 0.5 }, perBuildCapUsd: 1, perDayCapUsd: 1, meteredKillSwitch: false },
    };
  }

  it('below the 1000-token boundary resolves the small-context row', () => {
    const decision = decideRouting({
      policy: contextBoundPolicy(),
      key: keyFor({ contextEstimateTokens: 500 }),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'ctx-test',
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe('small-context-model');
  });

  it('at/above the 1000-token boundary resolves the large-context row (maxContextTokens is exclusive)', () => {
    const decision = decideRouting({
      policy: contextBoundPolicy(),
      key: keyFor({ contextEstimateTokens: 1500 }),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'ctx-test',
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe('large-context-model');
  });
});

describe('estimatePromptTokens', () => {
  it('estimates roughly chars/4, documented as a v1 heuristic', () => {
    expect(estimatePromptTokens('')).toBe(0);
    expect(estimatePromptTokens('abcd')).toBe(1);
    expect(estimatePromptTokens('a'.repeat(40))).toBe(10);
  });
});
