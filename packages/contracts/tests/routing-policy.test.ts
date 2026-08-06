import { describe, expect, it } from 'vitest';
import {
  isPlainObject,
  isRoutingCooldownStatus,
  isRoutingPolicyDocument,
  isRoutingPolicyResponse,
  isStringArray,
  type RoutingCandidate,
  type RoutingCooldownStatus,
  type RoutingPolicyDocument,
  type RoutingPolicyHardConstraint,
} from '../src/api/routing-policy';

// Type-shape coverage for the P0 routing-policy contract (WR wave skeleton).
// Real policy content and the drift-failing policy test land in a later
// tranche (CWR-P1-1) -- this only pins the DTO shape itself, but validates
// it deeply: every array entry and record value, not just container types
// (Sol review finding HIGH-2/MED-5).

const EMPTY_POLICY: RoutingPolicyDocument = {
  policyVersion: 0,
  stageVocabulary: [],
  modelTable: [],
  hardConstraints: [],
  laneChains: {},
  dataClassificationAllowlists: [],
  sonnetPriceRows: [],
  budgetCeilings: {
    perStageEstimatedCostUsd: {},
    perBuildCapUsd: 0,
    perDayCapUsd: 0,
    meteredKillSwitch: false,
  },
};

const ANTHROPIC_CANDIDATE: RoutingCandidate = {
  runtimeId: 'claude-code',
  model: 'claude-sonnet-5',
  effort: 'medium',
  lane: 'claude-code-oauth',
  transport: 'subscription-oauth',
  modelFamily: 'anthropic',
};

const PRD_15_HARD_CONSTRAINT: RoutingPolicyHardConstraint = {
  id: 'prd-15-no-anthropic-api-credits',
  description: 'no Anthropic model may use API credits, Nous, or OpenRouter for this program',
  modelFamily: 'anthropic',
  forbiddenTransports: ['prepaid', 'metered-api'],
};

const POPULATED: RoutingPolicyDocument = {
  policyVersion: 1,
  stageVocabulary: ['chat', 'art-direction'],
  modelTable: [
    {
      match: { taskClass: 'chat', stage: 'chat', minContextTokens: 0, maxContextTokens: 8000 },
      primary: ANTHROPIC_CANDIDATE,
      burst: { runtimeId: 'claude-code', model: 'claude-opus-5', effort: 'high', lane: 'claude-code-oauth', transport: 'subscription-oauth', modelFamily: 'anthropic' },
      cheap: { runtimeId: 'claude-code', model: 'claude-haiku-4-5', effort: 'low', lane: 'claude-code-oauth', transport: 'subscription-oauth', modelFamily: 'anthropic' },
    },
  ],
  hardConstraints: [PRD_15_HARD_CONSTRAINT],
  laneChains: { 'claude-code-oauth': ['claude-code-oauth'] },
  dataClassificationAllowlists: [{ classification: 'client-confidential', allowedLanes: ['claude-code-oauth'] }],
  sonnetPriceRows: [
    { model: 'claude-sonnet-5', inputPerMillion: 2, outputPerMillion: 10, effectiveDate: '2026-01-01' },
    { model: 'claude-sonnet-5', inputPerMillion: 3, outputPerMillion: 15, effectiveDate: '2026-08-31' },
  ],
  budgetCeilings: {
    perStageEstimatedCostUsd: { chat: 0.5, 'art-direction': 2 },
    perBuildCapUsd: 25,
    perDayCapUsd: 200,
    meteredKillSwitch: true,
  },
};

describe('isRoutingPolicyDocument', () => {
  it('accepts the minimal empty-but-typed P0 stub shape', () => {
    expect(isRoutingPolicyDocument(EMPTY_POLICY)).toBe(true);
  });

  it('accepts a fully populated document -- match rules, ordered candidates, machine-evaluable constraints, budget ceilings, both Sonnet price rows', () => {
    expect(isRoutingPolicyDocument(POPULATED)).toBe(true);
  });

  it('rejects a document missing a required section', () => {
    const { modelTable: _drop, ...missingModelTable } = EMPTY_POLICY;
    expect(isRoutingPolicyDocument(missingModelTable)).toBe(false);
  });

  it('rejects a document missing stageVocabulary (Sol review HIGH-1, t5 fix commit)', () => {
    const { stageVocabulary: _drop, ...missingStageVocabulary } = EMPTY_POLICY;
    expect(isRoutingPolicyDocument(missingStageVocabulary)).toBe(false);
  });

  it('rejects a stageVocabulary that is not a string array', () => {
    expect(isRoutingPolicyDocument({ ...EMPTY_POLICY, stageVocabulary: [1, 2] })).toBe(false);
    expect(isRoutingPolicyDocument({ ...EMPTY_POLICY, stageVocabulary: 'chat' })).toBe(false);
  });

  it('accepts a hard constraint carrying requiredLane, and rejects an unrecognized lane value (Sol review MED-3, t5 fix commit)', () => {
    const withRequiredLane = {
      ...EMPTY_POLICY,
      hardConstraints: [{ ...PRD_15_HARD_CONSTRAINT, modelFamily: 'xai' as const, requiredLane: 'nous' as const }],
    };
    expect(isRoutingPolicyDocument(withRequiredLane)).toBe(true);
    const malformedLane = {
      ...EMPTY_POLICY,
      hardConstraints: [{ ...PRD_15_HARD_CONSTRAINT, modelFamily: 'xai' as const, requiredLane: 'not-a-real-lane' }],
    };
    expect(isRoutingPolicyDocument(malformedLane)).toBe(false);
  });

  it('rejects a laneChains that is an array instead of a keyed map', () => {
    expect(isRoutingPolicyDocument({ ...EMPTY_POLICY, laneChains: [] })).toBe(false);
  });

  it('rejects a laneChains value that is not a string array', () => {
    expect(isRoutingPolicyDocument({ ...EMPTY_POLICY, laneChains: { x: [1, 2] } })).toBe(false);
    expect(isRoutingPolicyDocument({ ...EMPTY_POLICY, laneChains: { x: 'not-an-array' } })).toBe(false);
  });

  it('accepts a price row with no effectiveDate -- optional (Sol review MED-3b: not every §2-verified price has a plan-sourced onset date)', () => {
    const accepted = {
      ...EMPTY_POLICY,
      sonnetPriceRows: [{ model: 'claude-sonnet-5', inputPerMillion: 2, outputPerMillion: 10 }],
    };
    expect(isRoutingPolicyDocument(accepted)).toBe(true);
  });

  it('rejects a malformed price row (wrong type for effectiveDate)', () => {
    const malformed = {
      ...EMPTY_POLICY,
      sonnetPriceRows: [{ model: 'claude-sonnet-5', inputPerMillion: 2, outputPerMillion: 10, effectiveDate: 20260831 }],
    };
    expect(isRoutingPolicyDocument(malformed)).toBe(false);
  });

  // Sol review MED-4 (fix-round, admission control): price validation must
  // be nonnegative-finite rates, a positive threshold multiplier, a
  // nonnegative-integer threshold, and an ISO-parseable effectiveDate.
  it('rejects a negative inputPerMillion or outputPerMillion rate', () => {
    expect(
      isRoutingPolicyDocument({ ...EMPTY_POLICY, sonnetPriceRows: [{ model: 'claude-sonnet-5', inputPerMillion: -2, outputPerMillion: 10 }] }),
    ).toBe(false);
    expect(
      isRoutingPolicyDocument({ ...EMPTY_POLICY, sonnetPriceRows: [{ model: 'claude-sonnet-5', inputPerMillion: 2, outputPerMillion: -10 }] }),
    ).toBe(false);
  });

  it('accepts a zero-rate price row -- nonnegative allows exactly 0, only negative is rejected', () => {
    expect(
      isRoutingPolicyDocument({ ...EMPTY_POLICY, sonnetPriceRows: [{ model: 'claude-sonnet-5', inputPerMillion: 0, outputPerMillion: 0 }] }),
    ).toBe(true);
  });

  it('rejects an unparseable effectiveDate string (Date.parse would return NaN)', () => {
    expect(
      isRoutingPolicyDocument({
        ...EMPTY_POLICY,
        sonnetPriceRows: [{ model: 'claude-sonnet-5', inputPerMillion: 2, outputPerMillion: 10, effectiveDate: 'not-a-date' }],
      }),
    ).toBe(false);
  });

  it('rejects an empty-string effectiveDate', () => {
    expect(
      isRoutingPolicyDocument({
        ...EMPTY_POLICY,
        sonnetPriceRows: [{ model: 'claude-sonnet-5', inputPerMillion: 2, outputPerMillion: 10, effectiveDate: '' }],
      }),
    ).toBe(false);
  });

  // Sol review M4 (fix-round): a bare Date.parse is too permissive two
  // ways -- it accepts non-ISO shapes, and per ECMA-262 an ISO-shaped
  // string with an out-of-range calendar field (month/day) rolls over into
  // a different real date instead of failing. Both must be rejected.
  it('rejects an out-of-range calendar date that Date.parse would silently roll over (2026-13-45)', () => {
    expect(
      isRoutingPolicyDocument({
        ...EMPTY_POLICY,
        sonnetPriceRows: [{ model: 'claude-sonnet-5', inputPerMillion: 2, outputPerMillion: 10, effectiveDate: '2026-13-45' }],
      }),
    ).toBe(false);
  });

  it('rejects an out-of-range day-of-month that Date.parse would silently roll over into the next month (2026-02-30)', () => {
    expect(
      isRoutingPolicyDocument({
        ...EMPTY_POLICY,
        sonnetPriceRows: [{ model: 'claude-sonnet-5', inputPerMillion: 2, outputPerMillion: 10, effectiveDate: '2026-02-30' }],
      }),
    ).toBe(false);
  });

  it('rejects a non-ISO date shape Date.parse would otherwise accept ("August 31, 2026")', () => {
    expect(
      isRoutingPolicyDocument({
        ...EMPTY_POLICY,
        sonnetPriceRows: [{ model: 'claude-sonnet-5', inputPerMillion: 2, outputPerMillion: 10, effectiveDate: 'August 31, 2026' }],
      }),
    ).toBe(false);
  });

  it('accepts the two real Sonnet effectiveDates this policy actually ships (2026-01-01, 2026-08-31)', () => {
    expect(
      isRoutingPolicyDocument({
        ...EMPTY_POLICY,
        sonnetPriceRows: [
          { model: 'claude-sonnet-5', inputPerMillion: 2, outputPerMillion: 10, effectiveDate: '2026-01-01' },
          { model: 'claude-sonnet-5', inputPerMillion: 3, outputPerMillion: 15, effectiveDate: '2026-08-31' },
        ],
      }),
    ).toBe(true);
  });

  it('rejects thresholdedPricing with a zero or negative multiplier', () => {
    expect(
      isRoutingPolicyDocument({
        ...EMPTY_POLICY,
        otherModelPriceRows: [{ model: 'x', inputPerMillion: 2, outputPerMillion: 12, thresholdedPricing: { thresholdTokens: 200000, multiplier: 0 } }],
      }),
    ).toBe(false);
    expect(
      isRoutingPolicyDocument({
        ...EMPTY_POLICY,
        otherModelPriceRows: [{ model: 'x', inputPerMillion: 2, outputPerMillion: 12, thresholdedPricing: { thresholdTokens: 200000, multiplier: -2 } }],
      }),
    ).toBe(false);
  });

  it('rejects thresholdedPricing with a fractional or negative thresholdTokens', () => {
    expect(
      isRoutingPolicyDocument({
        ...EMPTY_POLICY,
        otherModelPriceRows: [{ model: 'x', inputPerMillion: 2, outputPerMillion: 12, thresholdedPricing: { thresholdTokens: 200000.5, multiplier: 2 } }],
      }),
    ).toBe(false);
    expect(
      isRoutingPolicyDocument({
        ...EMPTY_POLICY,
        otherModelPriceRows: [{ model: 'x', inputPerMillion: 2, outputPerMillion: 12, thresholdedPricing: { thresholdTokens: -1, multiplier: 2 } }],
      }),
    ).toBe(false);
  });

  it('accepts thresholdedPricing with a positive multiplier and nonnegative integer threshold', () => {
    expect(
      isRoutingPolicyDocument({
        ...EMPTY_POLICY,
        otherModelPriceRows: [{ model: 'x', inputPerMillion: 2, outputPerMillion: 12, thresholdedPricing: { thresholdTokens: 200000, multiplier: 2 } }],
      }),
    ).toBe(true);
  });

  // t6 fix-round HIGH-1: RoutingPolicyOutputTokenBound guard coverage.
  it('accepts budgetCeilings.outputTokenBound with just a default, and with a perTaskClass override', () => {
    const withDefault = { ...EMPTY_POLICY, budgetCeilings: { ...EMPTY_POLICY.budgetCeilings, outputTokenBound: { default: 32000 } } };
    expect(isRoutingPolicyDocument(withDefault)).toBe(true);
    const withOverride = {
      ...EMPTY_POLICY,
      budgetCeilings: { ...EMPTY_POLICY.budgetCeilings, outputTokenBound: { default: 32000, perTaskClass: { chat: 4000 } } },
    };
    expect(isRoutingPolicyDocument(withOverride)).toBe(true);
  });

  it('rejects outputTokenBound.default missing, negative, or fractional', () => {
    expect(isRoutingPolicyDocument({ ...EMPTY_POLICY, budgetCeilings: { ...EMPTY_POLICY.budgetCeilings, outputTokenBound: {} } })).toBe(false);
    expect(
      isRoutingPolicyDocument({ ...EMPTY_POLICY, budgetCeilings: { ...EMPTY_POLICY.budgetCeilings, outputTokenBound: { default: -1 } } }),
    ).toBe(false);
    expect(
      isRoutingPolicyDocument({ ...EMPTY_POLICY, budgetCeilings: { ...EMPTY_POLICY.budgetCeilings, outputTokenBound: { default: 1.5 } } }),
    ).toBe(false);
  });

  it('rejects a perTaskClass override with a non-nonnegative-integer value', () => {
    expect(
      isRoutingPolicyDocument({
        ...EMPTY_POLICY,
        budgetCeilings: { ...EMPTY_POLICY.budgetCeilings, outputTokenBound: { default: 32000, perTaskClass: { chat: -1 } } },
      }),
    ).toBe(false);
  });

  it('rejects a modelTable candidate with an arbitrary (non-enum) effort string', () => {
    const malformed = {
      ...EMPTY_POLICY,
      modelTable: [
        {
          match: {},
          primary: { runtimeId: 'claude-code', model: 'claude-sonnet-5', effort: 'ludicrous' },
        },
      ],
    };
    expect(isRoutingPolicyDocument(malformed)).toBe(false);
  });

  it('rejects a candidate with an unrecognized lane', () => {
    const malformed = {
      ...EMPTY_POLICY,
      modelTable: [{ match: {}, primary: { ...ANTHROPIC_CANDIDATE, lane: 'some-random-lane' } }],
    };
    expect(isRoutingPolicyDocument(malformed)).toBe(false);
  });

  it('rejects a candidate with an unrecognized transport', () => {
    const malformed = {
      ...EMPTY_POLICY,
      modelTable: [{ match: {}, primary: { ...ANTHROPIC_CANDIDATE, transport: 'carrier-pigeon' } }],
    };
    expect(isRoutingPolicyDocument(malformed)).toBe(false);
  });

  it('rejects a candidate with an unrecognized modelFamily', () => {
    const malformed = {
      ...EMPTY_POLICY,
      modelTable: [{ match: {}, primary: { ...ANTHROPIC_CANDIDATE, modelFamily: 'skynet' } }],
    };
    expect(isRoutingPolicyDocument(malformed)).toBe(false);
  });

  it('rejects a modelTable entry missing its required primary candidate', () => {
    const malformed = { ...EMPTY_POLICY, modelTable: [{ match: {} }] };
    expect(isRoutingPolicyDocument(malformed)).toBe(false);
  });

  it('rejects a modelTable entry whose optional burst/cheap candidate is malformed', () => {
    const malformed = {
      ...EMPTY_POLICY,
      modelTable: [
        {
          match: {},
          primary: { runtimeId: 'r', model: 'm', effort: 'low' },
          burst: { runtimeId: 'r', model: 'm' }, // missing effort
        },
      ],
    };
    expect(isRoutingPolicyDocument(malformed)).toBe(false);
  });

  it('rejects a hard constraint that is prose-only (missing modelFamily/forbiddenTransports)', () => {
    const malformed = {
      ...EMPTY_POLICY,
      hardConstraints: [{ id: 'x', description: 'no Anthropic on non-subscription lanes' }],
    };
    expect(isRoutingPolicyDocument(malformed)).toBe(false);
  });

  it('rejects a hard constraint whose forbiddenTransports is not a string array', () => {
    const malformed = {
      ...EMPTY_POLICY,
      hardConstraints: [{ id: 'x', description: 'd', modelFamily: 'anthropic', forbiddenTransports: [1, 2] }],
    };
    expect(isRoutingPolicyDocument(malformed)).toBe(false);
  });

  it('rejects a dataClassificationAllowlists entry with an unrecognized classification', () => {
    const malformed = {
      ...EMPTY_POLICY,
      dataClassificationAllowlists: [{ classification: 'top-secret', allowedLanes: [] }],
    };
    expect(isRoutingPolicyDocument(malformed)).toBe(false);
  });

  it('rejects budgetCeilings with a non-numeric perStageEstimatedCostUsd value', () => {
    const malformed = {
      ...EMPTY_POLICY,
      budgetCeilings: { ...EMPTY_POLICY.budgetCeilings, perStageEstimatedCostUsd: { chat: 'free' } },
    };
    expect(isRoutingPolicyDocument(malformed)).toBe(false);
  });

  it('rejects a document missing budgetCeilings entirely', () => {
    const { budgetCeilings: _drop, ...missing } = EMPTY_POLICY;
    expect(isRoutingPolicyDocument(missing)).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(isRoutingPolicyDocument(null)).toBe(false);
    expect(isRoutingPolicyDocument('not a policy')).toBe(false);
  });

  // t7 addition (plan §3.2 L1): cooldownPolicy is optional, exponential
  // backoff config.
  it('accepts a document with no cooldownPolicy at all -- optional, every pre-t7 fixture keeps validating', () => {
    expect(isRoutingPolicyDocument(EMPTY_POLICY)).toBe(true);
  });

  it('accepts a well-shaped cooldownPolicy, with and without notes', () => {
    expect(isRoutingPolicyDocument({ ...EMPTY_POLICY, cooldownPolicy: { baseMs: 5000, factor: 2, maxMs: 300000 } })).toBe(true);
    expect(
      isRoutingPolicyDocument({ ...EMPTY_POLICY, cooldownPolicy: { baseMs: 5000, factor: 2, maxMs: 300000, notes: 'placeholder' } }),
    ).toBe(true);
  });

  it('rejects a cooldownPolicy with a negative or fractional baseMs/maxMs', () => {
    expect(isRoutingPolicyDocument({ ...EMPTY_POLICY, cooldownPolicy: { baseMs: -1, factor: 2, maxMs: 300000 } })).toBe(false);
    expect(isRoutingPolicyDocument({ ...EMPTY_POLICY, cooldownPolicy: { baseMs: 1.5, factor: 2, maxMs: 300000 } })).toBe(false);
    expect(isRoutingPolicyDocument({ ...EMPTY_POLICY, cooldownPolicy: { baseMs: 5000, factor: 2, maxMs: -1 } })).toBe(false);
  });

  it('rejects a cooldownPolicy with a zero or negative factor', () => {
    expect(isRoutingPolicyDocument({ ...EMPTY_POLICY, cooldownPolicy: { baseMs: 5000, factor: 0, maxMs: 300000 } })).toBe(false);
    expect(isRoutingPolicyDocument({ ...EMPTY_POLICY, cooldownPolicy: { baseMs: 5000, factor: -2, maxMs: 300000 } })).toBe(false);
  });

  it('accepts a fractional factor (e.g. 1.5x growth is a legitimate backoff multiplier)', () => {
    expect(isRoutingPolicyDocument({ ...EMPTY_POLICY, cooldownPolicy: { baseMs: 5000, factor: 1.5, maxMs: 300000 } })).toBe(true);
  });
});

describe('isRoutingCooldownStatus (t7, plan §3.2 L1)', () => {
  const VALID: RoutingCooldownStatus = {
    scopeType: 'lane',
    scopeId: 'nous',
    inCooldown: true,
    remainingMs: 1200,
    consecutiveFailures: 2,
    category: 'rate_limit',
    reason: 'cooling',
  };

  it('accepts a well-shaped status, including a null category', () => {
    expect(isRoutingCooldownStatus(VALID)).toBe(true);
    expect(isRoutingCooldownStatus({ ...VALID, category: null })).toBe(true);
  });

  it('rejects an unrecognized scopeType', () => {
    expect(isRoutingCooldownStatus({ ...VALID, scopeType: 'process' })).toBe(false);
  });

  it('rejects a negative or fractional remainingMs/consecutiveFailures', () => {
    expect(isRoutingCooldownStatus({ ...VALID, remainingMs: -1 })).toBe(false);
    expect(isRoutingCooldownStatus({ ...VALID, consecutiveFailures: 1.5 })).toBe(false);
  });

  it('rejects an empty scopeId', () => {
    expect(isRoutingCooldownStatus({ ...VALID, scopeId: '' })).toBe(false);
  });
});

// Sol re-check H2: RoutingCandidate now carries lane/transport/modelFamily
// specifically so a hard constraint like PRD_15_HARD_CONSTRAINT can be
// evaluated purely from candidate metadata (no lane-string parsing, no
// runtimeId inference). The predicate below is written inline in the test,
// not shipped as a contracts export -- real admission-control evaluation
// logic is P2/t5 (CWR-P2-2); this only proves the DTO shape carries enough
// information for that later evaluator to exist at all.
function violatesHardConstraint(candidate: RoutingCandidate, constraint: RoutingPolicyHardConstraint): boolean {
  return candidate.modelFamily === constraint.modelFamily && constraint.forbiddenTransports.includes(candidate.transport);
}

describe('RoutingPolicyHardConstraint evaluability against candidate metadata (Sol re-check H2)', () => {
  it('rejects an anthropic candidate whose transport is in the PRD §15 forbidden list', () => {
    const nousRoutedAnthropicCandidate: RoutingCandidate = { ...ANTHROPIC_CANDIDATE, lane: 'nous', transport: 'prepaid' };
    expect(violatesHardConstraint(nousRoutedAnthropicCandidate, PRD_15_HARD_CONSTRAINT)).toBe(true);

    const openrouterRoutedAnthropicCandidate: RoutingCandidate = {
      ...ANTHROPIC_CANDIDATE,
      lane: 'openrouter',
      transport: 'metered-api',
    };
    expect(violatesHardConstraint(openrouterRoutedAnthropicCandidate, PRD_15_HARD_CONSTRAINT)).toBe(true);
  });

  it('admits an anthropic candidate on the required subscription-oauth transport', () => {
    expect(violatesHardConstraint(ANTHROPIC_CANDIDATE, PRD_15_HARD_CONSTRAINT)).toBe(false);
  });

  it('never flags a non-anthropic candidate, even on a forbidden transport', () => {
    const deepseekOnPrepaid: RoutingCandidate = {
      runtimeId: 'deepseek-cli',
      model: 'deepseek-v4-flash',
      effort: 'low',
      lane: 'moonshot',
      transport: 'prepaid',
      modelFamily: 'deepseek',
    };
    expect(violatesHardConstraint(deepseekOnPrepaid, PRD_15_HARD_CONSTRAINT)).toBe(false);
  });
});

describe('isRoutingPolicyResponse', () => {
  it('accepts the GET /api/routing/policy envelope shape', () => {
    expect(isRoutingPolicyResponse({ policy: EMPTY_POLICY, policyVersion: 0 })).toBe(true);
  });

  it('rejects an envelope whose nested policy is malformed', () => {
    expect(isRoutingPolicyResponse({ policy: { ...EMPTY_POLICY, policyVersion: 'zero' }, policyVersion: 0 })).toBe(false);
  });
});

describe('isPlainObject / isStringArray (shared structural guards)', () => {
  it('isPlainObject rejects arrays and null', () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject({})).toBe(true);
  });

  it('isStringArray rejects a mixed-type array', () => {
    expect(isStringArray(['a', 1])).toBe(false);
    expect(isStringArray(['a', 'b'])).toBe(true);
  });
});
