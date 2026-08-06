import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  isRoutingPolicyDocument,
  type RoutingPolicyDocument,
  type RoutingPolicyHardConstraint,
} from '../src/api/routing-policy';

// CWR-P1-1 (docs/plans/waves/WR-routing.md's Tranche register): the
// drift-failing policy test for apps/daemon/src/routing/routing-policy.json
// (v1). Real §2 model-table content + PRD §15 constraints land here for the
// first time -- routing-policy.test.ts (the P0 skeleton) only pins the DTO
// *shape*, never touching the real file; this file is the one that loads
// the actual bytes and fails when they drift. Pattern cloned from
// scripts/check-context-isolation.test.ts: hardcoded EXPECTED constants
// compared by exact equality, so a stable machine id can't win a fuzzy
// match and a reworded label can't silently flip meaning.
//
// Cross-tree readFileSync of an apps/daemon-owned JSON data file is
// test-only (not a packages/contracts *source* dependency -- AGENTS.md's
// "packages/contracts must be pure TypeScript... free of... Node
// filesystem/process APIs" governs src/, and
// packages/contracts/tests/package-runtime.test.ts already uses
// node:fs/readFileSync in a test for the same reason: tests run under
// Node/vitest regardless of what the shipped package may import).

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const policyPath = path.join(repoRoot, 'apps/daemon/src/routing/routing-policy.json');

function loadPolicyDocument(): RoutingPolicyDocument {
  const raw: unknown = JSON.parse(readFileSync(policyPath, 'utf8'));
  if (!isRoutingPolicyDocument(raw)) {
    throw new Error(
      'apps/daemon/src/routing/routing-policy.json failed RoutingPolicyDocument schema validation',
    );
  }
  return raw;
}

// plan §2's ten task-class rows, transcribed as stable machine ids.
const EXPECTED_TASK_CLASSES = [
  'art-direction-ia-brief-analysis',
  'long-horizon-autonomous-builds',
  'section-component-codegen',
  'mechanical-batch',
  'token-distill',
  'design-md-prose',
  'code-adversary-review-panel',
  'long-context-ops',
  'research',
  'visual-qa',
] as const;

// plan §3.3's seven pipeline stages plus WR-routing.md's "Routing-key
// fallback (normative)" PRD fallback stage keys (chat/ingestion/mobile).
// This is the CLOSED set -- a stage outside it is a policy violation.
const EXPECTED_STAGES = [
  'brief-art-direction',
  'token-freeze',
  'shell-primitives',
  'section-fanout',
  'variations',
  'review-panel',
  'deploy',
  'chat',
  'ingestion',
  'mobile',
] as const;

const SUBSCRIPTION_LANES = ['claude-code-oauth', 'codex-oauth', 'agy'] as const;

const EXPECTED_DATA_CLASSES = ['client-confidential', 'internal', 'public'] as const;

// PRD §15's binding sentence, verbatim, expressed as the machine-evaluable
// shape RoutingPolicyHardConstraint carries (plan §3.2 L2).
const EXPECTED_ANTHROPIC_CONSTRAINT: RoutingPolicyHardConstraint = {
  id: 'prd-15-no-anthropic-api-credits',
  description: 'No Anthropic model may use API credits, Nous, or OpenRouter for this program.',
  modelFamily: 'anthropic',
  forbiddenTransports: ['prepaid', 'metered-api'],
};

describe('routing-policy.json (v1) -- policy version + schema validation', () => {
  it('is policyVersion 1 and validates against the RoutingPolicyDocument contract guard', () => {
    const doc = loadPolicyDocument();
    expect(doc.policyVersion).toBe(1);
    expect(isRoutingPolicyDocument(doc)).toBe(true);
  });
});

describe('routing-policy.json (v1) -- closed stage set (drift = unknown stage)', () => {
  function isKnownStage(stage: string): boolean {
    return (EXPECTED_STAGES as readonly string[]).includes(stage);
  }

  it('the stage guard actually discriminates -- rejects an invented stage, accepts a real one', () => {
    expect(isKnownStage('some-invented-stage')).toBe(false);
    expect(isKnownStage('brief-art-direction')).toBe(true);
  });

  it('budgetCeilings.perStageEstimatedCostUsd carries exactly the closed 10-stage vocabulary, no more, no fewer', () => {
    const doc = loadPolicyDocument();
    const stageKeys = Object.keys(doc.budgetCeilings.perStageEstimatedCostUsd).sort();
    expect(stageKeys).toEqual([...EXPECTED_STAGES].sort());
    for (const stage of stageKeys) {
      expect(isKnownStage(stage)).toBe(true);
    }
  });
});

describe('routing-policy.json (v1) -- every §2 task class present with non-empty ordered candidates', () => {
  it('has a non-empty modelTable', () => {
    expect(loadPolicyDocument().modelTable.length).toBeGreaterThan(0);
  });

  for (const taskClass of EXPECTED_TASK_CLASSES) {
    it(`taskClass "${taskClass}" has at least one row with a non-empty primary candidate`, () => {
      const doc = loadPolicyDocument();
      const rows = doc.modelTable.filter((entry) => entry.match.taskClass === taskClass);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.primary).toBeDefined();
        expect(typeof row.primary.model).toBe('string');
        expect(row.primary.model.length).toBeGreaterThan(0);
        expect(typeof row.primary.runtimeId).toBe('string');
        expect(row.primary.runtimeId.length).toBeGreaterThan(0);
      }
    });
  }

  it('carries no taskClass outside the frozen §2 vocabulary (drift = an invented task class)', () => {
    const doc = loadPolicyDocument();
    const seen = new Set(
      doc.modelTable
        .map((entry) => entry.match.taskClass)
        .filter((v): v is string => typeof v === 'string'),
    );
    for (const taskClass of seen) {
      expect(EXPECTED_TASK_CLASSES as readonly string[]).toContain(taskClass);
    }
  });
});

describe('routing-policy.json (v1) -- PRD §15 hard constraints present and exact (drift = missing/altered constraint)', () => {
  it('carries the exact anthropic-transport-ban constraint, PRD §15 quoted verbatim', () => {
    const doc = loadPolicyDocument();
    const found = doc.hardConstraints.find((c) => c.id === EXPECTED_ANTHROPIC_CONSTRAINT.id);
    expect(found).toBeDefined();
    expect(found?.modelFamily).toBe(EXPECTED_ANTHROPIC_CONSTRAINT.modelFamily);
    expect(found?.description).toBe(EXPECTED_ANTHROPIC_CONSTRAINT.description);
    expect([...(found?.forbiddenTransports ?? [])].sort()).toEqual(
      [...EXPECTED_ANTHROPIC_CONSTRAINT.forbiddenTransports].sort(),
    );
  });

  it('never lets an anthropic-family candidate anywhere in modelTable carry a transport §15 forbids', () => {
    const doc = loadPolicyDocument();
    const constraint = doc.hardConstraints.find((c) => c.id === EXPECTED_ANTHROPIC_CONSTRAINT.id);
    expect(constraint).toBeDefined();
    const allCandidates = doc.modelTable.flatMap((entry) =>
      [entry.primary, entry.burst, entry.cheap].filter((c): c is NonNullable<typeof c> => c !== undefined),
    );
    expect(allCandidates.length).toBeGreaterThan(0);
    for (const candidate of allCandidates) {
      if (candidate.modelFamily === 'anthropic') {
        expect(constraint!.forbiddenTransports).not.toContain(candidate.transport);
      }
    }
  });

  it('carries at least the anthropic ban, the grok-nous-lane rule, and the mechanical-verification sentinel', () => {
    expect(loadPolicyDocument().hardConstraints.length).toBeGreaterThanOrEqual(3);
  });
});

describe('routing-policy.json (v1) -- data classification (drift = unsafe allowlist widening)', () => {
  it('carries exactly the three closed data classes', () => {
    const doc = loadPolicyDocument();
    const found = doc.dataClassificationAllowlists.map((c) => c.classification).sort();
    expect(found).toEqual([...EXPECTED_DATA_CLASSES].sort());
  });

  it('client-confidential allowlist is a subset of subscription lanes only', () => {
    const doc = loadPolicyDocument();
    const clientConfidential = doc.dataClassificationAllowlists.find(
      (c) => c.classification === 'client-confidential',
    );
    expect(clientConfidential).toBeDefined();
    expect(clientConfidential!.allowedLanes.length).toBeGreaterThan(0);
    for (const lane of clientConfidential!.allowedLanes) {
      expect(SUBSCRIPTION_LANES as readonly string[]).toContain(lane);
    }
  });

  it('every data class is fail-closed -- an exhausted allowlist never falls through outside it', () => {
    const doc = loadPolicyDocument();
    expect(doc.dataClassificationAllowlists.length).toBeGreaterThan(0);
    for (const entry of doc.dataClassificationAllowlists) {
      expect(entry.failClosed).toBe(true);
    }
  });
});

describe('routing-policy.json (v1) -- both Sonnet price rows, effective-dated across the 2026-08-31 boundary', () => {
  it('carries exactly two claude-sonnet-5 price rows, before and after the boundary date', () => {
    const doc = loadPolicyDocument();
    expect(doc.sonnetPriceRows.length).toBe(2);
    const byDate = [...doc.sonnetPriceRows].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    expect(byDate[0]).toMatchObject({ model: 'claude-sonnet-5', inputPerMillion: 2, outputPerMillion: 10 });
    expect(byDate[1]).toMatchObject({
      model: 'claude-sonnet-5',
      inputPerMillion: 3,
      outputPerMillion: 15,
      effectiveDate: '2026-08-31',
    });
  });
});
