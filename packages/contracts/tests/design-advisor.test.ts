import { describe, expect, it } from 'vitest';

import {
  DESIGN_ADVISOR_DEFAULT_LIMIT,
  DESIGN_ADVISOR_MAX_LIMIT,
  type DesignAdvisorRequest,
  type DesignAdvisorResponse,
} from '../src/index';

describe('F001 R6 design-advisor contract', () => {
  it('caps the default limit at the max limit (F001 open question #1 provisional default: ~12)', () => {
    expect(DESIGN_ADVISOR_DEFAULT_LIMIT).toBeLessThanOrEqual(DESIGN_ADVISOR_MAX_LIMIT);
    expect(DESIGN_ADVISOR_DEFAULT_LIMIT).toBe(12);
  });

  it('requires a prompt and allows an optional limit, mirroring CatalogueMatchRequest', () => {
    const request: DesignAdvisorRequest = { prompt: 'a small business poetry website' };
    const withLimit: DesignAdvisorRequest = { prompt: 'a small business poetry website', limit: 6 };

    // @ts-expect-error DesignAdvisorRequest requires a prompt.
    const missingPrompt: DesignAdvisorRequest = {};

    expect(request.prompt.length).toBeGreaterThan(0);
    expect(withLimit.limit).toBe(6);
    expect(missingPrompt).toEqual({});
  });

  it('responds with a nullable archetypeId and a ranked candidate list carrying a named rationale', () => {
    const noMatch: DesignAdvisorResponse = { archetypeId: null, candidates: [] };
    const matched: DesignAdvisorResponse = {
      archetypeId: 'poetry',
      candidates: [
        { slug: 'verdigris-trail-h50', name: 'verdigris-trail-h50', score: 0.71, rationale: ['typography.headings matches'] },
      ],
    };
    expect(noMatch.candidates).toEqual([]);
    expect(matched.candidates[0]?.rationale.length).toBeGreaterThan(0);
  });
});
