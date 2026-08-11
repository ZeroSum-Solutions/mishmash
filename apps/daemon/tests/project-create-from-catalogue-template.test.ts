import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

// MM-001 defect #1 / MM-007 — starting a project from the Templates page
// (EntryShell.startProjectFromTemplate -> metadataForSkill) produced an
// empty canvas: the daemon validated and stored the catalogue skill's id as
// the project's skillId, but never copied that skill's assets/ files onto
// disk. This is the red-then-green spec for the daemon-side copy step,
// exercised at the real HTTP boundary against the real design-templates
// catalogue (no fixtures/mocks) per AGENTS.md's "cheapest layer" guidance.
describe('POST /api/projects — catalogue template start', () => {
  let server: http.Server;
  let baseUrl: string;
  const projectsToClean: string[] = [];

  // A real, on-disk design-templates catalogue entry with `od.mode: template`
  // and a single-file assets/template.html — see
  // design-templates/trading-analysis-dashboard-template/. This is the same
  // catalogue project-skill-id-validation.test.ts already exercises
  // (e.g. 'saas-landing'), just one whose mode is 'template' rather than
  // 'prototype' so it matches EntryShell's kindForSkill('template') path.
  const CATALOGUE_TEMPLATE_SKILL_ID = 'trading-analysis-dashboard-template';

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterAll(async () => {
    for (const id of projectsToClean.splice(0)) {
      await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function uniqueId(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }

  async function createProject(body: Record<string, unknown>) {
    return fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('copies the catalogue template files into the new project and sets entryFile', async () => {
    const id = uniqueId('p');
    // Mirrors metadataForSkill's kind:'template' output — no templateId,
    // that field belongs to the unrelated "save as template" feature.
    const resp = await createProject({
      id,
      name: 'Trading dashboard from catalogue',
      skillId: CATALOGUE_TEMPLATE_SKILL_ID,
      designSystemId: null,
      metadata: { kind: 'template', animations: false },
    });
    expect(resp.status).toBe(200);
    projectsToClean.push(id);
    const body = (await resp.json()) as {
      project: { skillId: string; metadata: { kind: string; entryFile?: string } };
    };
    expect(body.project.skillId).toBe(CATALOGUE_TEMPLATE_SKILL_ID);
    expect(body.project.metadata.entryFile).toBe('template.html');

    const filesResp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}/files`);
    expect(filesResp.status).toBe(200);
    const filesBody = (await filesResp.json()) as { files: Array<{ name: string }> };
    const names = filesBody.files.map((f) => f.name);
    expect(names).toContain('template.html');
  });

  it('does not affect the unrelated saved-template flow (metadata.templateId set, skillId null)', async () => {
    const id = uniqueId('p');
    const resp = await createProject({
      id,
      name: 'Blank saved-template project',
      skillId: null,
      designSystemId: null,
      metadata: { kind: 'template', animations: false, templateId: 'not-a-real-saved-template' },
    });
    expect(resp.status).toBe(200);
    projectsToClean.push(id);
    const body = (await resp.json()) as { project: { skillId: string | null; metadata: { entryFile?: string } } };
    expect(body.project.skillId).toBeNull();
    expect(body.project.metadata.entryFile).toBeUndefined();
  });
});
