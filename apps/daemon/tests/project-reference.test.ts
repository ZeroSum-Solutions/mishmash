// Red-spec companion for the cross-project "reference another project"
// capability (B2-borrow): POST /api/projects/:id/reference is the single
// endpoint both ProjectReferenceModal (UI) and `od project reference` (CLI)
// call. It must resolve/materialize the referenced project's directory,
// link it into the *referencing* project's linkedDirs (same effect the
// composer's own addLinkedDirs already produces), and persist a
// ProjectReferenceRecord (path + optional free-text intent) onto the
// referencing project's metadata so projectMetadataContextSelection folds
// it into every future turn, not only the turn the reference was added on.

import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'prom-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

type StartedServer = {
  url: string;
  server: Server;
  shutdown?: () => Promise<void> | void;
};

type ServerModule = {
  startServer: (options: { port: number; returnServer: boolean }) => Promise<StartedServer>;
};

const originalDataDir = process.env.OD_DATA_DIR;
let started: StartedServer | null = null;
let dataDir: string | null = null;
let serverModule: ServerModule | null = null;

describe('POST /api/projects/:id/reference', () => {
  afterEach(async () => {
    await stopServer();
    register.clear();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = null;
    if (originalDataDir === undefined) delete process.env.OD_DATA_DIR;
    else process.env.OD_DATA_DIR = originalDataDir;
    serverModule = null;
    vi.resetModules();
  }, 30_000);

  it('links the referenced project into linkedDirs and persists the intent', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'od-project-reference-'));
    started = await startIsolatedServer(dataDir);

    const sourceId = `source-${Date.now()}`;
    const targetId = `target-${Date.now()}`;
    await postJson(`${started.url}/api/projects`, {
      id: sourceId,
      name: 'Current Project',
      metadata: { kind: 'prototype' },
    });
    await postJson(`${started.url}/api/projects`, {
      id: targetId,
      name: 'Bento Cards Project',
      metadata: { kind: 'prototype' },
    });
    // Give the target an on-disk file so it's a real, non-empty directory —
    // the brand-new (never-written) case is covered separately below.
    await postJson(`${started.url}/api/projects/${targetId}/files`, {
      name: 'index.html',
      content: '<!doctype html><title>Bento</title><main>Bento cards</main>',
    });

    const result = await postJson<{
      ok: true;
      project: { id: string; metadata: { linkedDirs?: string[]; projectReferences?: unknown[] } };
      targetProject: { id: string; name: string };
      resolvedDir: string;
      workspaceItem: { id: string; kind: string; label: string; absolutePath: string; intent?: string };
    }>(`${started.url}/api/projects/${sourceId}/reference`, {
      targetProjectId: targetId,
      intent: 'the bento cards',
    });

    expect(result.ok).toBe(true);
    expect(result.targetProject.id).toBe(targetId);
    // The resolver realpath()s the dir (macOS resolves /var -> /private/var),
    // so compare on the stable suffix rather than exact string equality.
    expect(result.resolvedDir).toMatch(new RegExp(`/projects/${targetId}$`));
    expect(result.project.metadata.linkedDirs).toContain(result.resolvedDir);
    expect(result.project.metadata.projectReferences).toEqual([
      expect.objectContaining({
        id: `project:${targetId}`,
        targetProjectId: targetId,
        label: 'Bento Cards Project',
        absolutePath: result.resolvedDir,
        intent: 'the bento cards',
      }),
    ]);
    expect(result.workspaceItem).toMatchObject({
      id: `project:${targetId}`,
      kind: 'project',
      label: 'Bento Cards Project',
      absolutePath: result.resolvedDir,
      intent: 'the bento cards',
    });

    // Persisted on the referencing project, not the referenced one.
    const persisted = await fetchJson<{ project: { metadata: { projectReferences?: unknown[] } } }>(
      `${started.url}/api/projects/${sourceId}`,
    );
    expect(persisted.project.metadata.projectReferences).toHaveLength(1);
  }, 60_000);

  it('is valid with no intent at all — the existing bare-reference flow keeps working', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'od-project-reference-no-intent-'));
    started = await startIsolatedServer(dataDir);

    const sourceId = `source-${Date.now()}`;
    const targetId = `target-${Date.now()}`;
    await postJson(`${started.url}/api/projects`, { id: sourceId, name: 'Source', metadata: { kind: 'prototype' } });
    await postJson(`${started.url}/api/projects`, { id: targetId, name: 'Target', metadata: { kind: 'prototype' } });

    const result = await postJson<{
      ok: true;
      workspaceItem: { intent?: string };
      project: { metadata: { projectReferences?: Array<{ intent?: string }> } };
    }>(`${started.url}/api/projects/${sourceId}/reference`, { targetProjectId: targetId });

    expect(result.ok).toBe(true);
    expect(result.workspaceItem.intent).toBeUndefined();
    expect(result.project.metadata.projectReferences?.[0]?.intent).toBeUndefined();
  }, 60_000);

  it('materializes a brand-new (never-generated) target project directory', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'od-project-reference-new-target-'));
    started = await startIsolatedServer(dataDir);

    const sourceId = `source-${Date.now()}`;
    const targetId = `target-${Date.now()}`;
    await postJson(`${started.url}/api/projects`, { id: sourceId, name: 'Source', metadata: { kind: 'prototype' } });
    await postJson(`${started.url}/api/projects`, { id: targetId, name: 'Target', metadata: { kind: 'prototype' } });
    // No files ever written to targetId — PROJECTS_DIR/<targetId> does not
    // exist on disk yet at this point (see ensureReferencedProjectDir).

    const result = await postJson<{ resolvedDir: string }>(
      `${started.url}/api/projects/${sourceId}/reference`,
      { targetProjectId: targetId },
    );
    expect(result.resolvedDir).toMatch(new RegExp(`/projects/${targetId}$`));
  }, 60_000);

  it('upserts on a repeat reference instead of duplicating the record', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'od-project-reference-upsert-'));
    started = await startIsolatedServer(dataDir);

    const sourceId = `source-${Date.now()}`;
    const targetId = `target-${Date.now()}`;
    await postJson(`${started.url}/api/projects`, { id: sourceId, name: 'Source', metadata: { kind: 'prototype' } });
    await postJson(`${started.url}/api/projects`, { id: targetId, name: 'Target', metadata: { kind: 'prototype' } });

    await postJson(`${started.url}/api/projects/${sourceId}/reference`, {
      targetProjectId: targetId,
      intent: 'the bento cards',
    });
    const second = await postJson<{
      project: { metadata: { linkedDirs?: string[]; projectReferences?: Array<{ intent?: string }> } };
    }>(`${started.url}/api/projects/${sourceId}/reference`, {
      targetProjectId: targetId,
      intent: 'the scrolling animations and the WebGL hero',
    });

    expect(second.project.metadata.projectReferences).toHaveLength(1);
    expect(second.project.metadata.projectReferences?.[0]?.intent).toBe(
      'the scrolling animations and the WebGL hero',
    );
    expect(
      second.project.metadata.linkedDirs?.filter((dir) => dir.endsWith(targetId)),
    ).toHaveLength(1);
  }, 60_000);

  it('rejects a project referencing itself', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'od-project-reference-self-'));
    started = await startIsolatedServer(dataDir);

    const sourceId = `source-${Date.now()}`;
    await postJson(`${started.url}/api/projects`, { id: sourceId, name: 'Source', metadata: { kind: 'prototype' } });

    const response = await fetch(`${started.url}/api/projects/${sourceId}/reference`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetProjectId: sourceId }),
    });
    expect(response.status).toBe(400);
  }, 60_000);

  it('404s when the referenced project does not exist', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'od-project-reference-missing-target-'));
    started = await startIsolatedServer(dataDir);

    const sourceId = `source-${Date.now()}`;
    await postJson(`${started.url}/api/projects`, { id: sourceId, name: 'Source', metadata: { kind: 'prototype' } });

    const response = await fetch(`${started.url}/api/projects/${sourceId}/reference`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetProjectId: 'does-not-exist' }),
    });
    expect(response.status).toBe(404);
  }, 60_000);

  it('404s when the referencing project does not exist', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'od-project-reference-missing-source-'));
    started = await startIsolatedServer(dataDir);

    const targetId = `target-${Date.now()}`;
    await postJson(`${started.url}/api/projects`, { id: targetId, name: 'Target', metadata: { kind: 'prototype' } });

    const response = await fetch(`${started.url}/api/projects/does-not-exist/reference`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetProjectId: targetId }),
    });
    expect(response.status).toBe(404);
  }, 60_000);
});

async function startIsolatedServer(root: string): Promise<StartedServer> {
  process.env.OD_DATA_DIR = root;
  if (!serverModule) {
    vi.resetModules();
    serverModule = await import('../src/server.js') as unknown as ServerModule;
  }
  return await serverModule.startServer({ port: 0, returnServer: true });
}

async function stopServer(): Promise<void> {
  const current = started;
  started = null;
  if (!current) return;
  await Promise.resolve(current.shutdown?.());
  current.server.closeAllConnections?.();
  current.server.closeIdleConnections?.();
  await new Promise<void>((resolve) => current.server.close(() => resolve()));
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.status).toBeLessThan(300);
  return await response.json() as T;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return await response.json() as T;
}
