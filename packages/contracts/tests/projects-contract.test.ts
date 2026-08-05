import { describe, expect, it } from 'vitest';

import type { CreateProjectRequest } from '../src/index';

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
});
