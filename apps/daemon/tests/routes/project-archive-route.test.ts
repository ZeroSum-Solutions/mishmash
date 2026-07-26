import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../../src/server.js';

describe('project archive route', () => {
  let server: http.Server;
  let baseUrl: string;
  const projectsToClean: string[] = [];

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
      await fetch(`${baseUrl}/api/projects/${id}`, { method: 'DELETE' }).catch(() => {});
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function createProject(
    metadata: Record<string, unknown> = { kind: 'prototype', entryFile: 'index.html' },
  ): Promise<string> {
    const id = `project-archive-route-${randomUUID()}`;
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id,
        name: 'Archive route project',
        metadata,
      }),
    });
    expect(response.ok).toBe(true);
    projectsToClean.push(id);
    return id;
  }

  async function writeFile(projectId: string, body: Record<string, unknown>): Promise<void> {
    const response = await fetch(`${baseUrl}/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.ok).toBe(true);
  }

  it('streams the project as a downloadable zip with the expected headers', async () => {
    const projectId = await createProject();
    await writeFile(projectId, { name: 'index.html', content: '<!doctype html><main>hi</main>' });

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/archive`);
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toBe('application/zip');
    const disposition = response.headers.get('content-disposition') || '';
    expect(disposition).toMatch(/attachment; filename="[^"]+\.zip"/);
    expect(disposition).toMatch(/filename\*=UTF-8''/);

    const buffer = Buffer.from(await response.arrayBuffer());
    // ZIP local-file-header magic bytes: 'PK\x03\x04'.
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');
  });

  it('returns 404 FILE_NOT_FOUND when ?root= names a directory that does not exist', async () => {
    const projectId = await createProject();
    await writeFile(projectId, { name: 'index.html', content: '<!doctype html><main>hi</main>' });

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/archive?root=no-such-dir`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('FILE_NOT_FOUND');
  });
});
