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
// This is the CLOSED set -- a stage outside it is a policy violation,
// whether it shows up as a budgetCeilings key OR as a modelTable row's
// match.stage (Sol review drift-gap b).
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

// Plan §2's three load-bearing per-row notes, copied byte-for-byte from the
// plan's table cell (only the markdown table-cell pipes are stripped -- Sol
// review micro-fix). Any clarifying text this policy wants to add about a
// row lives in the top-level `notes` array instead, never appended here.
const EXPECTED_CODEGEN_NOTE =
  'SWE-bench cost-bend: ~75–76% at $0.07–0.55/task `[PUBLISHED]` — a *coding* proxy only, not a design proxy (Grok F3).';
const EXPECTED_MECHANICAL_NOTE = 'Machine-checkable output → cascade covers risk.';
const EXPECTED_LONG_CONTEXT_NOTE =
  'Route by pricing structure; never use long context as retrieval (multi-needle degrades `[PUBLISHED]`) — chunk + targeted queries.';

const EXPECTED_DATA_CLASSES = ['client-confidential', 'internal', 'public'] as const;

// PRD §15's binding sentence, verbatim, expressed as the machine-evaluable
// shape RoutingPolicyHardConstraint carries (plan §3.2 L2). `allowedTransports`
// is the STRONGER positive form (Sol review MED-1b) that closes the gap a
// forbidden-list alone leaves open (e.g. `local` was never forbidden).
const EXPECTED_ANTHROPIC_CONSTRAINT: RoutingPolicyHardConstraint = {
  id: 'prd-15-no-anthropic-api-credits',
  description: 'No Anthropic model may use API credits, Nous, or OpenRouter for this program.',
  modelFamily: 'anthropic',
  forbiddenTransports: ['prepaid', 'metered-api'],
  allowedTransports: ['subscription-oauth'],
};

// Sol review drift-gap (a): the grok-nous-lane and mechanical-verification
// constraints must be asserted exactly, the same way the anthropic one
// already was -- flipping or removing either must fail this file.
const EXPECTED_GROK_NOUS_CONSTRAINT: RoutingPolicyHardConstraint = {
  id: 'prd-15-grok-via-nous-lane',
  description:
    "Grok 4.5 dispatches only through the prepaid Nous Portal lane in-program (PRD §15, plan §2). This session's OpenRouter-routed review predates program alignment and is not a standing exception; a future in-program Grok call outside the prepaid transport requires a PRD amendment (plan §6 open question 6 -- Nous-hosted Grok availability is not yet confirmed).",
  modelFamily: 'xai',
  forbiddenTransports: ['subscription-oauth', 'metered-api', 'local'],
};

const EXPECTED_MECHANICAL_VERIFICATION_CONSTRAINT: RoutingPolicyHardConstraint = {
  id: 'prd-15-mechanical-verification-deterministic-only',
  description:
    "Mechanical verification runs via deterministic scripts and tests, never model judgment (PRD §15). This is not one of the ten §2 task classes; it deliberately has zero RoutingCandidate entries anywhere in modelTable. The sentinel modelFamily 'other' is banned on every transport here as a machine-evaluable guarantee that no candidate may ever claim that family for this concern -- see the top-level notes for why this is the schema's closest expression of 'has no model candidates'.",
  modelFamily: 'other',
  forbiddenTransports: ['subscription-oauth', 'prepaid', 'metered-api', 'local'],
};

function expectExactConstraint(found: RoutingPolicyHardConstraint | undefined, expected: RoutingPolicyHardConstraint): void {
  expect(found).toBeDefined();
  expect(found?.id).toBe(expected.id);
  expect(found?.modelFamily).toBe(expected.modelFamily);
  expect(found?.description).toBe(expected.description);
  expect([...(found?.forbiddenTransports ?? [])].sort()).toEqual([...expected.forbiddenTransports].sort());
  expect([...(found?.allowedTransports ?? [])].sort()).toEqual([...(expected.allowedTransports ?? [])].sort());
}

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

  it('no modelTable row carries a match.stage value outside the closed vocabulary (drift = a rogue stage on a row)', () => {
    const doc = loadPolicyDocument();
    const rowStages = doc.modelTable
      .map((entry) => entry.match.stage)
      .filter((stage): stage is string => typeof stage === 'string');
    for (const stage of rowStages) {
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

  it('only names an effort the plan states verbatim (Opus 5 "high" for art-direction) -- every other candidate is "inherit", never invented', () => {
    const doc = loadPolicyDocument();
    const artDirectionRow = doc.modelTable.find((entry) => entry.match.taskClass === 'art-direction-ia-brief-analysis');
    expect(artDirectionRow?.primary.effort).toBe('high');
    const allOtherCandidates = doc.modelTable
      .filter((entry) => entry !== artDirectionRow)
      .flatMap((entry) => [entry.primary, entry.burst, entry.cheap].filter((c): c is NonNullable<typeof c> => c !== undefined));
    expect(allOtherCandidates.length).toBeGreaterThan(0);
    for (const candidate of allOtherCandidates) {
      expect(candidate.effort).toBe('inherit');
    }
    // art-direction's own burst (Gemini) is not plan-specified either.
    expect(artDirectionRow?.burst?.effort).toBe('inherit');
  });

  it("the research row carries WebSearch as a toolTargets entry, not a dropped burst cell", () => {
    const doc = loadPolicyDocument();
    const researchRow = doc.modelTable.find((entry) => entry.match.taskClass === 'research');
    expect(researchRow?.toolTargets).toEqual([{ kind: 'tool', id: 'websearch' }]);
  });

  it('both code-adversary-review-panel rows carry the exact §2 merge rule as a machine field', () => {
    const doc = loadPolicyDocument();
    const reviewPanelRows = doc.modelTable.filter((entry) => entry.match.taskClass === 'code-adversary-review-panel');
    expect(reviewPanelRows.length).toBeGreaterThanOrEqual(2);
    for (const row of reviewPanelRows) {
      expect(row.mergeRule).toEqual({
        deterministicFailures: 'any-veto',
        stochasticFindings: 'two-of-three-escalates-human',
      });
    }
  });

  it('every deepseek-v4-flash candidate carries dispatchValidation.slugRecheckAtDispatch (PRD §15: slug rechecked at dispatch)', () => {
    const doc = loadPolicyDocument();
    const allCandidates = doc.modelTable.flatMap((entry) =>
      [entry.primary, entry.burst, entry.cheap].filter((c): c is NonNullable<typeof c> => c !== undefined),
    );
    const deepseekCandidates = allCandidates.filter((c) => c.model === 'deepseek-v4-flash');
    expect(deepseekCandidates.length).toBeGreaterThan(0);
    for (const candidate of deepseekCandidates) {
      expect(candidate.dispatchValidation).toEqual({ slugRecheckAtDispatch: true });
    }
  });
});

describe('routing-policy.json (v1) -- three load-bearing §2 notes are byte-for-byte verbatim (drift = altered punctuation/markup or appended text)', () => {
  it('section-component-codegen carries the exact SWE-bench-proxy note, no more, no less', () => {
    const doc = loadPolicyDocument();
    const row = doc.modelTable.find((entry) => entry.match.taskClass === 'section-component-codegen');
    expect(row?.notes).toBe(EXPECTED_CODEGEN_NOTE);
  });

  it('mechanical-batch carries the exact machine-checkable-cascade note, no more, no less', () => {
    const doc = loadPolicyDocument();
    const row = doc.modelTable.find((entry) => entry.match.taskClass === 'mechanical-batch');
    expect(row?.notes).toBe(EXPECTED_MECHANICAL_NOTE);
  });

  it('both long-context-ops rows carry the exact never-use-as-retrieval note, no more, no less', () => {
    const doc = loadPolicyDocument();
    const rows = doc.modelTable.filter((entry) => entry.match.taskClass === 'long-context-ops');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.notes).toBe(EXPECTED_LONG_CONTEXT_NOTE);
    }
  });
});

describe('routing-policy.json (v1) -- PRD §15 hard constraints present and exact (drift = missing/altered constraint)', () => {
  it('carries the exact anthropic-transport-ban constraint, PRD §15 quoted verbatim, with the stronger allowedTransports form', () => {
    const doc = loadPolicyDocument();
    expectExactConstraint(
      doc.hardConstraints.find((c) => c.id === EXPECTED_ANTHROPIC_CONSTRAINT.id),
      EXPECTED_ANTHROPIC_CONSTRAINT,
    );
  });

  it('carries the exact grok-via-nous-lane constraint (drift = flipped/removed)', () => {
    const doc = loadPolicyDocument();
    expectExactConstraint(
      doc.hardConstraints.find((c) => c.id === EXPECTED_GROK_NOUS_CONSTRAINT.id),
      EXPECTED_GROK_NOUS_CONSTRAINT,
    );
  });

  it('carries the exact mechanical-verification-deterministic-only sentinel constraint (drift = flipped/removed)', () => {
    const doc = loadPolicyDocument();
    expectExactConstraint(
      doc.hardConstraints.find((c) => c.id === EXPECTED_MECHANICAL_VERIFICATION_CONSTRAINT.id),
      EXPECTED_MECHANICAL_VERIFICATION_CONSTRAINT,
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
        expect(constraint!.allowedTransports).toContain(candidate.transport);
      }
    }
  });

  it('carries exactly the anthropic ban, the grok-nous-lane rule, and the mechanical-verification sentinel', () => {
    const doc = loadPolicyDocument();
    const ids = doc.hardConstraints.map((c) => c.id).sort();
    expect(ids).toEqual(
      [
        EXPECTED_ANTHROPIC_CONSTRAINT.id,
        EXPECTED_GROK_NOUS_CONSTRAINT.id,
        EXPECTED_MECHANICAL_VERIFICATION_CONSTRAINT.id,
      ].sort(),
    );
  });
});

describe('routing-policy.json (v1) -- PRD §15 program assignments are present and exact (drift = wrong model/lane/scope)', () => {
  const EXPECTED_ASSIGNMENTS: Record<string, { model: string; requiredLane: string; slugRecheck?: boolean }> = {
    'product-architecture-adversary': { model: 'grok-4.5', requiredLane: 'nous' },
    'long-horizon-prd-review': { model: 'claude-fable-5', requiredLane: 'claude-code-oauth' },
    'scoped-implementation': { model: 'deepseek-v4-flash', requiredLane: 'deepseek-direct', slugRecheck: true },
    'visual-review': { model: 'Gemini 3.1 Pro (High)', requiredLane: 'agy' },
    'code-adversary': { model: 'claude-opus-5', requiredLane: 'claude-code-oauth' },
  };

  it('carries exactly PRD §15\'s five process-role assignments, each with its stated model and required lane', () => {
    const doc = loadPolicyDocument();
    const assignments = doc.programAssignments ?? [];
    expect(assignments.map((a) => a.taskSelector).sort()).toEqual(Object.keys(EXPECTED_ASSIGNMENTS).sort());
    for (const assignment of assignments) {
      const expected = EXPECTED_ASSIGNMENTS[assignment.taskSelector];
      expect(expected).toBeDefined();
      expect(assignment.model).toBe(expected!.model);
      expect(assignment.requiredLane).toBe(expected!.requiredLane);
      if (expected!.slugRecheck) {
        expect(assignment.dispatchValidation).toEqual({ slugRecheckAtDispatch: true });
      }
    }
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
  it('carries exactly two claude-sonnet-5 price rows, with BOTH exact effective dates asserted (drift = an edited date on either row)', () => {
    const doc = loadPolicyDocument();
    expect(doc.sonnetPriceRows.length).toBe(2);
    const before = doc.sonnetPriceRows.find((r) => r.effectiveDate === '2026-01-01');
    const after = doc.sonnetPriceRows.find((r) => r.effectiveDate === '2026-08-31');
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(before).toMatchObject({ model: 'claude-sonnet-5', inputPerMillion: 2, outputPerMillion: 10, effectiveDate: '2026-01-01' });
    expect(after).toMatchObject({ model: 'claude-sonnet-5', inputPerMillion: 3, outputPerMillion: 15, effectiveDate: '2026-08-31' });
  });
});

describe('routing-policy.json (v1) -- pricing exactness (drift = an invented price or unsourced date)', () => {
  it('does not carry a Kimi K3 price row -- plan §2 gives context size only, never a per-token price', () => {
    const doc = loadPolicyDocument();
    const kimiRows = (doc.otherModelPriceRows ?? []).filter((r) => /kimi/i.test(r.model));
    expect(kimiRows).toEqual([]);
  });

  it('otherModelPriceRows entries carry no invented effectiveDate -- only the two sonnetPriceRows dates are plan-sourced', () => {
    const doc = loadPolicyDocument();
    for (const row of doc.otherModelPriceRows ?? []) {
      expect(row.effectiveDate).toBeUndefined();
    }
  });

  it("Gemini 3.1 Pro's >200k-token price doubling is encoded mechanically via thresholdedPricing", () => {
    const doc = loadPolicyDocument();
    const gemini = (doc.otherModelPriceRows ?? []).find((r) => r.model === 'Gemini 3.1 Pro (High)');
    expect(gemini?.thresholdedPricing).toEqual({ thresholdTokens: 200000, multiplier: 2 });
  });
});
