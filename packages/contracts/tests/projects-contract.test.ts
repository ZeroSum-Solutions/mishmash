import { describe, expect, it } from 'vitest';

import type { CreateProjectRequest, ProjectMetadata } from '../src/index';

describe('project contracts', () => {
  it('requires callers to provide the project id when creating a project', () => {
    const request: CreateProjectRequest = {
      id: 'project-1',
      name: 'Project one',
    };

    // @ts-expect-error CreateProjectRequest requires a caller-owned id.
    const requestWithoutId: CreateProjectRequest = { name: 'Missing id' };

    expect(request.id).toBe('project-1');
    expect(requestWithoutId.name).toBe('Missing id');
  });

  // F001 R8a -- directionSelections is additive: existing single-skillId/
  // single-templateId project creation must stay valid without it, and a
  // caller may attach a blended multi-select without any other field.
  it('carries F001 R8a directionSelections as an additive, optional field', () => {
    const legacyRequest: CreateProjectRequest = {
      id: 'project-legacy',
      name: 'Legacy single-template project',
      skillId: 'some-skill',
    };
    expect(legacyRequest.metadata).toBeUndefined();

    const metadata: ProjectMetadata = {
      kind: 'other',
      directionSelections: [
        { directionId: 'literary-journal', sections: ['hero', 'poem-layout'] },
        { directionId: 'poet-portfolio', sections: ['readings-calendar'] },
      ],
    };
    const blendedRequest: CreateProjectRequest = {
      id: 'project-blended',
      name: 'Blended poetry selection',
      metadata,
    };
    expect(blendedRequest.metadata?.directionSelections).toHaveLength(2);
    expect(blendedRequest.metadata?.directionSelections?.[0]).toEqual({
      directionId: 'literary-journal',
      sections: ['hero', 'poem-layout'],
    });
  });
});
