import { describe, expect, it } from 'vitest';
import {
  isPlainObject,
  isRoutingPolicyDocument,
  isRoutingPolicyResponse,
  isStringArray,
  type RoutingCandidate,
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
