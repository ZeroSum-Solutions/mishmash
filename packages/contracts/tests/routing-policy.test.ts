import { describe, expect, it } from 'vitest';
import {
  isPlainObject,
  isRoutingPolicyDocument,
  isRoutingPolicyResponse,
  isStringArray,
  type RoutingPolicyDocument,
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

const POPULATED: RoutingPolicyDocument = {
  policyVersion: 1,
  modelTable: [
    {
      match: { taskClass: 'chat', stage: 'chat', minContextTokens: 0, maxContextTokens: 8000 },
      primary: { runtimeId: 'claude-code', model: 'claude-sonnet-5', effort: 'medium' },
      burst: { runtimeId: 'claude-code', model: 'claude-opus-5', effort: 'high' },
      cheap: { runtimeId: 'claude-code', model: 'claude-haiku-4-5', effort: 'low' },
    },
  ],
  hardConstraints: [
    {
      id: 'prd-15-no-anthropic-api-credits',
      description: 'no Anthropic model may use API credits, Nous, or OpenRouter for this program',
      modelFamily: 'anthropic',
      forbiddenTransports: ['api-credits', 'nous', 'openrouter'],
    },
  ],
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

  it('rejects a malformed price row (missing effectiveDate)', () => {
    const malformed = {
      ...EMPTY_POLICY,
      sonnetPriceRows: [{ model: 'claude-sonnet-5', inputPerMillion: 2, outputPerMillion: 10 }],
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
