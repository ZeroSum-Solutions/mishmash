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
  // token-distill is deliberately excluded from this generic loop: its row
  // declares primary=deepseek-v4-flash (metered, tier 2) BEFORE
  // burst=kimi-k3 (prepaid, tier 1) -- a non-monotonic transport-tier
  // declaration order that MED-2's tier-sort (see the dedicated describe
  // block below) intentionally overrides even absent any throttling. Every
  // OTHER real task class's row already declares candidates in
  // tier-ascending order, so this is the one real-policy exception.
  const distinctTaskClasses = [
    ...new Set(realPolicy.modelTable.map((entry) => entry.match.taskClass).filter((v): v is string => v !== undefined)),
  ].filter((taskClass) => taskClass !== 'token-distill');

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

  it('token-distill resolves burst (kimi-k3/moonshot, prepaid) ahead of the row-declared primary (deepseek/metered) -- transport tier wins over declaration order', () => {
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor(),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'token-distill',
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe('moonshotai/kimi-k3');
    expect(decision.lane).toBe('moonshot');
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
      stageVocabulary: ['chat'],
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

  it('fallback C (non-web pipeline-internal templateId, its own GRANULAR ingestion stage) resolves via taskClass -- Sol review HIGH-1', () => {
    // WR-routing.md's Fallback C: ingestion work keys on its OWN granular
    // pipeline stage ("classify/extract/distill/verify/register"), never
    // the coarse "ingestion" bucket -- 'classify' has no budgetCeilings
    // entry at all, so this only routes if stageVocabulary (not
    // budgetCeilings' keys) is what the engine validates against.
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor({ templateId: 'ingest-classify-pipeline-run-7', buildClass: null, stage: 'classify', contextEstimateTokens: 900 }),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'token-distill',
    });
    expect(decision.status).toBe('ok');
    // MED-2's transport-tier sort: burst (kimi-k3/moonshot, prepaid) beats
    // the row-declared primary (deepseek/metered) once nothing is throttled.
    expect(decision.modelFlag).toBe('moonshotai/kimi-k3');
  });

  it('a granular ingestion stage with no per-stage cost-ceiling entry is still ROUTABLE (Sol review HIGH-1: routability != cost-ceiling presence)', () => {
    for (const subStage of ['classify', 'extract', 'distill', 'verify', 'register']) {
      const decision = decideRouting({
        policy: realPolicy,
        key: keyFor({ stage: subStage }),
        sensitivityClass: 'public',
        laneMeters: [],
        taskClass: 'token-distill',
      });
      expect(decision.status).toBe('ok');
    }
  });
});

describe('decideRouting -- contextMaxTokens / minContextTokens bounds', () => {
  function contextBoundPolicy(): RoutingPolicyDocument {
    return {
      policyVersion: 1,
      stageVocabulary: ['chat'],
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

// ---- Sol review fix-commit red tests (LOW-6: written first, per the
// coordinator's instruction, before the corresponding fixes below) --------

describe('decideRouting -- transport-tier demotion order (Sol review MED-2)', () => {
  function tierFixturePolicy(): RoutingPolicyDocument {
    return {
      policyVersion: 1,
      stageVocabulary: ['chat'],
      modelTable: [
        {
          match: { taskClass: 'tier-test' },
          primary: { runtimeId: 'metered-runtime', model: 'metered-primary', effort: 'inherit', lane: 'deepseek-direct', transport: 'metered-api', modelFamily: 'deepseek' },
          burst: { runtimeId: 'prepaid-runtime', model: 'prepaid-burst', effort: 'inherit', lane: 'moonshot', transport: 'prepaid', modelFamily: 'moonshot' },
          cheap: { runtimeId: 'sub-runtime', model: 'sub-cheap', effort: 'inherit', lane: 'claude-code-oauth', transport: 'subscription-oauth', modelFamily: 'anthropic' },
        },
      ],
      hardConstraints: [],
      laneChains: {
        'claude-code-oauth': ['claude-code-oauth', 'nous', 'moonshot', 'deepseek-direct', 'openrouter'],
        moonshot: ['moonshot', 'deepseek-direct', 'openrouter'],
        'deepseek-direct': ['deepseek-direct', 'openrouter'],
      },
      dataClassificationAllowlists: [
        { classification: 'public', allowedLanes: ['claude-code-oauth', 'moonshot', 'deepseek-direct'], failClosed: true },
      ],
      sonnetPriceRows: [],
      budgetCeilings: { perStageEstimatedCostUsd: { chat: 0.5 }, perBuildCapUsd: 1, perDayCapUsd: 1, meteredKillSwitch: false },
    };
  }

  it('with nothing throttled, still prefers the subscription-tier candidate declared LAST in the row over the metered/prepaid ones declared first', () => {
    const decision = decideRouting({
      policy: tierFixturePolicy(),
      key: keyFor(),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'tier-test',
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe('sub-cheap');
    expect(decision.lane).toBe('claude-code-oauth');
  });

  it("Sol's literal scenario: throttled subscription primary + available subscription burst + available prepaid cheap -> the subscription burst, never nous", () => {
    const policy: RoutingPolicyDocument = {
      ...tierFixturePolicy(),
      modelTable: [
        {
          match: { taskClass: 'tier-test-2' },
          primary: { runtimeId: 'r1', model: 'sub-primary', effort: 'inherit', lane: 'claude-code-oauth', transport: 'subscription-oauth', modelFamily: 'anthropic' },
          burst: { runtimeId: 'r2', model: 'sub-burst', effort: 'inherit', lane: 'codex-oauth', transport: 'subscription-oauth', modelFamily: 'openai' },
          cheap: { runtimeId: 'r3', model: 'prepaid-cheap', effort: 'inherit', lane: 'nous', transport: 'prepaid', modelFamily: 'xai' },
        },
      ],
      dataClassificationAllowlists: [
        { classification: 'public', allowedLanes: ['claude-code-oauth', 'codex-oauth', 'nous'], failClosed: true },
      ],
    };
    const decision = decideRouting({
      policy,
      key: keyFor(),
      sensitivityClass: 'public',
      laneMeters: [throttled('claude-code-oauth', 3)],
      taskClass: 'tier-test-2',
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe('sub-burst');
    expect(decision.lane).toBe('codex-oauth');
    expect(decision.lane).not.toBe('nous');
  });
});

describe('decideRouting -- hard constraint requiredLane (Sol review MED-3)', () => {
  it('removes a grok candidate dispatched on the wrong prepaid lane (moonshot instead of nous), falling to a compliant burst', () => {
    const policy: RoutingPolicyDocument = {
      policyVersion: 1,
      stageVocabulary: ['chat'],
      modelTable: [
        {
          match: { taskClass: 'grok-test' },
          primary: { runtimeId: 'grok-build', model: 'grok-4.5', effort: 'inherit', lane: 'moonshot', transport: 'prepaid', modelFamily: 'xai' },
          burst: { runtimeId: 'claude', model: 'claude-haiku-4-5', effort: 'inherit', lane: 'claude-code-oauth', transport: 'subscription-oauth', modelFamily: 'anthropic' },
        },
      ],
      hardConstraints: [
        {
          id: 'grok-nous-only',
          description: 'grok dispatches only via nous',
          modelFamily: 'xai',
          forbiddenTransports: ['subscription-oauth', 'metered-api', 'local'],
          requiredLane: 'nous',
        },
      ],
      laneChains: {},
      dataClassificationAllowlists: [{ classification: 'public', allowedLanes: ['moonshot', 'claude-code-oauth'], failClosed: true }],
      sonnetPriceRows: [],
      budgetCeilings: { perStageEstimatedCostUsd: { chat: 0.5 }, perBuildCapUsd: 1, perDayCapUsd: 1, meteredKillSwitch: false },
    };
    const decision = decideRouting({
      policy,
      key: keyFor(),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'grok-test',
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe('claude-haiku-4-5');
    expect(decision.reasons.some((r) => r.step === 'hard-constraint-filter' && r.code === 'constraint:grok-nous-only')).toBe(true);
  });
});

describe('decideRouting -- assignment pin edge cases (Sol review, LOW-6)', () => {
  it('an unresolved assignment pin (no modelTable candidate anywhere shares its model+lane) is a typed error, never a fabricated candidate', () => {
    const policy: RoutingPolicyDocument = {
      policyVersion: 1,
      stageVocabulary: ['chat'],
      modelTable: [],
      hardConstraints: [],
      programAssignments: [{ taskSelector: 'ghost-selector', model: 'ghost-model', requiredLane: 'nous', note: 'test fixture only' }],
      laneChains: {},
      dataClassificationAllowlists: [{ classification: 'public', allowedLanes: [], failClosed: true }],
      sonnetPriceRows: [],
      budgetCeilings: { perStageEstimatedCostUsd: { chat: 0.5 }, perBuildCapUsd: 1, perDayCapUsd: 1, meteredKillSwitch: false },
    };
    const decision = decideRouting({
      policy,
      key: keyFor(),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'ghost-selector',
    });
    expect(decision.status).toBe('error');
    expect(decision.modelFlag).not.toBe('ghost-model');
    expect(decision.reasons.some((r) => r.code === 'assignment-unresolved:ghost-selector')).toBe(true);
  });

  it('an assignment pin resolved but then filtered by the sensitivity class fails closed, never dispatches the confidentiality-violating pin', () => {
    // scoped-implementation pins deepseek-v4-flash/deepseek-direct (metered)
    // -- entirely outside the client-confidential allowlist.
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor(),
      sensitivityClass: 'client-confidential',
      laneMeters: [],
      taskClass: 'scoped-implementation',
    });
    expect(decision.status).toBe('fail-closed-stop');
    expect(decision.modelFlag).not.toBe('deepseek-v4-flash');
    expect(decision.reasons.some((r) => r.step === 'program-assignment' && r.code === 'assignment:scoped-implementation')).toBe(true);
    expect(decision.reasons.some((r) => r.step === 'data-classification-filter')).toBe(true);
    expect(decision.reasons.some((r) => r.step === 'fail-closed')).toBe(true);
  });
});

describe('decideRouting -- invalid core input fails closed, never open (Sol review MED-4)', () => {
  it('a NaN laneMeter throttleEvents count is a typed error, never "ok" (NaN > threshold is always false -- the fail-open bug)', () => {
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor(),
      sensitivityClass: 'public',
      laneMeters: [{ ...emptyLaneMeter('claude-code-oauth'), throttleEvents: NaN }],
      taskClass: 'mechanical-batch',
    });
    expect(decision.status).toBe('error');
    expect(decision.reasons.some((r) => r.step === 'error' && (r.code ?? '').startsWith('invalid-input'))).toBe(true);
    expect(decision.modelFlag).not.toBe('claude-haiku-4-5');
  });

  it('a NaN key.contextEstimateTokens is a typed error, never "ok"', () => {
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor({ contextEstimateTokens: NaN }),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'mechanical-batch',
    });
    expect(decision.status).toBe('error');
  });

  it('an Infinity key.contextEstimateTokens is a typed error, never "ok"', () => {
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor({ contextEstimateTokens: Infinity }),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'mechanical-batch',
    });
    expect(decision.status).toBe('error');
  });

  it('a negative maxThrottleEvents is a typed error, never "ok"', () => {
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor(),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'mechanical-batch',
      maxThrottleEvents: -1,
    });
    expect(decision.status).toBe('error');
  });

  it('a fractional maxThrottleEvents is a typed error, never "ok"', () => {
    const decision = decideRouting({
      policy: realPolicy,
      key: keyFor(),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'mechanical-batch',
      maxThrottleEvents: 1.5,
    });
    expect(decision.status).toBe('error');
  });
});

describe('estimatePromptTokens', () => {
  it('estimates roughly chars/4, documented as a v1 heuristic', () => {
    expect(estimatePromptTokens('')).toBe(0);
    expect(estimatePromptTokens('abcd')).toBe(1);
    expect(estimatePromptTokens('a'.repeat(40))).toBe(10);
  });
});

describe('decideRouting -- admission control integration (t6)', () => {
  function admissionFixturePolicy(overrides: Partial<RoutingPolicyDocument> = {}): RoutingPolicyDocument {
    return {
      policyVersion: 1,
      stageVocabulary: ['chat'],
      modelTable: [
        {
          match: { taskClass: 'test-class' },
          primary: { runtimeId: 'claude', model: 'claude-opus-5', effort: 'inherit', lane: 'claude-code-oauth', transport: 'subscription-oauth', modelFamily: 'anthropic' },
          cheap: { runtimeId: 'claude', model: 'claude-haiku-4-5', effort: 'inherit', lane: 'claude-code-oauth', transport: 'subscription-oauth', modelFamily: 'anthropic' },
        },
      ],
      hardConstraints: [],
      laneChains: {},
      dataClassificationAllowlists: [{ classification: 'public', allowedLanes: ['claude-code-oauth'], failClosed: true }],
      sonnetPriceRows: [],
      otherModelPriceRows: [
        { model: 'claude-opus-5', inputPerMillion: 5, outputPerMillion: 25 },
        { model: 'claude-haiku-4-5', inputPerMillion: 1, outputPerMillion: 5 },
      ],
      budgetCeilings: { perStageEstimatedCostUsd: { chat: 1 }, perBuildCapUsd: 100, perDayCapUsd: 100, meteredKillSwitch: false, outputTokenBound: { default: 0 } },
      ...overrides,
    };
  }

  const NO_SPEND = { stageSpentUsd: 0, buildSpentUsd: 0, daySpentUsd: 0 };

  it('omitting the admission input reproduces the exact pre-t6 behavior (not-evaluated, empty admissionResults)', () => {
    const decision = decideRouting({
      policy: admissionFixturePolicy(),
      key: keyFor({ contextEstimateTokens: 900_000 }), // opus-5 alone would cost $4.50 -- way over the $1 stage ceiling
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'test-class',
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe('claude-opus-5');
    expect(decision.admissionVerdict).toBe('not-evaluated');
    expect(decision.admissionResults).toEqual([]);
  });

  it('an admitted candidate wins: primary denied by the stage ceiling falls through to the cheap candidate that still fits', () => {
    const decision = decideRouting({
      policy: admissionFixturePolicy(),
      // At 300k tokens, opus-5 (input $5/M) estimates to $1.50 -- over the
      // $1 stage ceiling -- while haiku-4-5 (input $1/M) estimates to $0.30,
      // still under it.
      key: keyFor({ contextEstimateTokens: 300_000 }),
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'test-class',
      admission: { buildId: 'build-1', spendLookup: NO_SPEND, now: new Date('2026-08-05T00:00:00.000Z') },
    });
    expect(decision.status).toBe('ok');
    expect(decision.modelFlag).toBe('claude-haiku-4-5');
    expect(decision.admissionVerdict).toBe('admitted');
    expect(decision.admissionResults.map((r) => [r.model, r.verdict])).toEqual([
      ['claude-opus-5', 'deny-stage-ceiling'],
      ['claude-haiku-4-5', 'admit'],
    ]);
    expect(decision.reasons.some((r) => r.step === 'admission-denied' && r.code?.includes('claude-opus-5'))).toBe(true);
  });

  it('all candidates denied by admission (none throttled) -> status "denied-admission", carrying per-candidate denial reasons', () => {
    const decision = decideRouting({
      policy: admissionFixturePolicy({ budgetCeilings: { perStageEstimatedCostUsd: { chat: 0.01 }, perBuildCapUsd: 100, perDayCapUsd: 100, meteredKillSwitch: false, outputTokenBound: { default: 0 } } }),
      key: keyFor({ contextEstimateTokens: 300_000 }), // both candidates blow the $0.01 stage ceiling
      sensitivityClass: 'public',
      laneMeters: [],
      taskClass: 'test-class',
      admission: { buildId: 'build-1', spendLookup: NO_SPEND, now: new Date('2026-08-05T00:00:00.000Z') },
    });
    expect(decision.status).toBe('denied-admission');
    expect(decision.admissionVerdict).toBe('denied');
    expect(decision.runtimeId).toBe('none');
    expect(decision.admissionResults).toHaveLength(2);
    expect(decision.admissionResults.every((r) => r.verdict === 'deny-stage-ceiling')).toBe(true);
  });

  it('fail-closed-stop takes precedence when every candidate is throttled and NONE ever reaches admission', () => {
    const decision = decideRouting({
      policy: admissionFixturePolicy(),
      key: keyFor({ contextEstimateTokens: 0 }),
      sensitivityClass: 'public',
      laneMeters: [throttled('claude-code-oauth', 5)], // both candidates share this lane
      taskClass: 'test-class',
      admission: { buildId: 'build-1', spendLookup: NO_SPEND, now: new Date('2026-08-05T00:00:00.000Z') },
    });
    expect(decision.status).toBe('fail-closed-stop');
    expect(decision.admissionResults).toEqual([]);
  });

  // Sol review MED-3 (fix-round): a MIX of throttled-and-denied candidates
  // must report fail-closed-stop (the more conservative, human-surfaced
  // signal), not denied-admission -- while still retaining whatever
  // admissionResults WERE collected before the throttle was hit.
  it('MED-3: a mix of throttled + admission-denied candidates reports fail-closed-stop, with admissionResults retained', () => {
    const mixedPolicy: RoutingPolicyDocument = {
      policyVersion: 1,
      stageVocabulary: ['chat'],
      modelTable: [
        {
          match: { taskClass: 'mixed-class' },
          primary: { runtimeId: 'claude', model: 'claude-opus-5', effort: 'inherit', lane: 'claude-code-oauth', transport: 'subscription-oauth', modelFamily: 'anthropic' },
          cheap: { runtimeId: 'kimi', model: 'moonshotai/kimi-k3', effort: 'inherit', lane: 'moonshot', transport: 'prepaid', modelFamily: 'moonshot' },
        },
      ],
      hardConstraints: [],
      laneChains: {},
      dataClassificationAllowlists: [{ classification: 'public', allowedLanes: ['claude-code-oauth', 'moonshot'], failClosed: true }],
      sonnetPriceRows: [],
      otherModelPriceRows: [{ model: 'claude-opus-5', inputPerMillion: 5, outputPerMillion: 25 }],
      budgetCeilings: { perStageEstimatedCostUsd: { chat: 0.01 }, perBuildCapUsd: 100, perDayCapUsd: 100, meteredKillSwitch: false, outputTokenBound: { default: 0 } },
    };
    const decision = decideRouting({
      policy: mixedPolicy,
      // opus-5 (tier0, tried first) blows the tiny $0.01 stage ceiling --
      // reaches admission and is denied. kimi-k3 (tier1, tried second) is
      // never evaluated for admission because its lane is throttled first.
      key: keyFor({ contextEstimateTokens: 1_000_000 }),
      sensitivityClass: 'public',
      laneMeters: [throttled('moonshot', 5)],
      taskClass: 'mixed-class',
      admission: { buildId: 'build-1', spendLookup: NO_SPEND, now: new Date('2026-08-05T00:00:00.000Z') },
    });
    expect(decision.status).toBe('fail-closed-stop');
    expect(decision.runtimeId).toBe('none');
    expect(decision.demotions).toHaveLength(1); // kimi-k3's lane was throttled
    expect(decision.admissionResults).toHaveLength(1); // only opus-5 ever reached admission
    expect(decision.admissionResults[0]).toMatchObject({ model: 'claude-opus-5', verdict: 'deny-stage-ceiling' });
    // admissionVerdict reflects that every candidate which DID reach
    // admission was denied, even though the terminal status is
    // fail-closed-stop (throttling, not admission, drove the final call).
    expect(decision.admissionVerdict).toBe('denied');
  });
});
