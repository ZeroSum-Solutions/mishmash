import { describe, expect, it } from 'vitest';
import { isRoutingPolicyDocument, type RoutingPolicyDocument } from '../src/api/routing-policy';

// Type-shape coverage for the P0 routing-policy contract (WR wave skeleton).
// Real policy content and the drift-failing policy test land in a later
// tranche (CWR-P1-1) -- this only pins the DTO shape itself.

const EMPTY_POLICY: RoutingPolicyDocument = {
  policyVersion: 0,
  modelTable: [],
  hardConstraints: [],
  laneChains: {},
  dataClassificationAllowlists: [],
  sonnetPriceRows: [],
};

describe('isRoutingPolicyDocument', () => {
  it('accepts the minimal empty-but-typed P0 stub shape', () => {
    expect(isRoutingPolicyDocument(EMPTY_POLICY)).toBe(true);
  });

  it('accepts a populated document, including both Sonnet price rows', () => {
    const populated: RoutingPolicyDocument = {
      policyVersion: 1,
      modelTable: [{ taskClass: 'chat', model: 'claude-sonnet-5', effort: 'medium', lane: 'claude-code-oauth' }],
      hardConstraints: [{ id: 'prd-15-no-anthropic-api-credits', description: 'no Anthropic model may use API credits, Nous, or OpenRouter' }],
      laneChains: { 'claude-code-oauth': ['claude-code-oauth'] },
      dataClassificationAllowlists: [{ classification: 'client-confidential', allowedLanes: ['claude-code-oauth'] }],
      sonnetPriceRows: [
        { model: 'claude-sonnet-5', inputPerMillion: 2, outputPerMillion: 10, effectiveDate: '2026-01-01' },
        { model: 'claude-sonnet-5', inputPerMillion: 3, outputPerMillion: 15, effectiveDate: '2026-08-31' },
      ],
    };
    expect(isRoutingPolicyDocument(populated)).toBe(true);
  });

  it('rejects a document missing a required section', () => {
    const { modelTable: _drop, ...missingModelTable } = EMPTY_POLICY;
    expect(isRoutingPolicyDocument(missingModelTable)).toBe(false);
  });

  it('rejects a laneChains that is an array instead of a keyed map', () => {
    expect(isRoutingPolicyDocument({ ...EMPTY_POLICY, laneChains: [] })).toBe(false);
  });

  it('rejects a malformed price row (missing effectiveDate)', () => {
    const malformed = {
      ...EMPTY_POLICY,
      sonnetPriceRows: [{ model: 'claude-sonnet-5', inputPerMillion: 2, outputPerMillion: 10 }],
    };
    expect(isRoutingPolicyDocument(malformed)).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(isRoutingPolicyDocument(null)).toBe(false);
    expect(isRoutingPolicyDocument('not a policy')).toBe(false);
  });
});
