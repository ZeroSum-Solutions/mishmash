import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompositionMetrics } from '@open-design/contracts';

import { createCompositionMetricsStore } from '../src/composition-metrics-store.js';
import { registerCompositionMetricsRoutes } from '../src/routes/composition-metrics.js';

let dataDir = '';
let projectsDir = '';
let server: http.Server | null = null;
let baseUrl = '';
let cloneProjects: Set<string>;

/** Mounts the surface the way the daemon does. */
async function start(): Promise<void> {
  const app = express();
  const store = createCompositionMetricsStore({ dataDir });
  cloneProjects = new Set();
  registerCompositionMetricsRoutes(app, {
    store,
    projectsDir,
    isWebCloneRun: (id) => cloneProjects.has(id),
  });
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server?.address();
      if (!addr || typeof addr !== 'object') {
        reject(new Error('could not bind'));
        return;
      }
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
    server?.on('error', reject);
  });
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'od-composition-metrics-routes-'));
  projectsDir = join(dataDir, 'projects');
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
  await rm(dataDir, { recursive: true, force: true });
});

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function get(path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

function fakeMetrics(overrides: Partial<CompositionMetrics> = {}): CompositionMetrics {
  return {
    sectionCount: 5,
    outOfFlowElementCount: 1,
    transformedElementCount: 0,
    distinctSectionBackgroundCount: 1,
    distinctSectionWidthCount: 1,
    fullBleedAgainstContained: false,
    bodyFontSizePx: 14,
    maxDisplayFontSizePx: 48,
    displayToBodyFontRatio: 48 / 14,
    measuredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('composition-metrics HTTP surface', () => {
  it('GET returns record: null for an artifact nobody has reported yet', async () => {
    await start();
    const res = await get('/api/composition-metrics?projectId=proj-1&file=index.html');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, record: null });
  });

  it('accepts a report and reads it back by projectId + file', async () => {
    await start();
    const metrics = fakeMetrics({ sectionCount: 9 });

    const posted = await post('/api/composition-metrics', { projectId: 'proj-1', file: 'index.html', metrics });
    expect(posted.status).toBe(200);
    expect(posted.json.ok).toBe(true);
    expect(posted.json.record.metrics.sectionCount).toBe(9);
    expect(posted.json.record.isWebCloneRun).toBe(false);

    const fetched = await get('/api/composition-metrics?projectId=proj-1&file=index.html');
    expect(fetched.json.record.metrics.sectionCount).toBe(9);
  });

  it('resolves isWebCloneRun server-side, never trusting a client-supplied value', async () => {
    await start();
    cloneProjects.add('proj-clone');

    // Even if a caller tried to claim isWebCloneRun via the metrics payload,
    // the route only reads the well-known CompositionMetrics fields.
    const posted = await post('/api/composition-metrics', {
      projectId: 'proj-clone',
      file: 'index.html',
      metrics: fakeMetrics(),
    });
    expect(posted.json.record.isWebCloneRun).toBe(true);

    const notClone = await post('/api/composition-metrics', {
      projectId: 'proj-1',
      file: 'index.html',
      metrics: fakeMetrics(),
    });
    expect(notClone.json.record.isWebCloneRun).toBe(false);
  });

  it('rejects a POST with missing or malformed metrics', async () => {
    await start();
    expect((await post('/api/composition-metrics', { projectId: 'proj-1', file: 'index.html' })).status).toBe(400);
    expect(
      (await post('/api/composition-metrics', { projectId: 'proj-1', file: 'index.html', metrics: { sectionCount: 'nope' } })).status,
    ).toBe(400);
    expect((await post('/api/composition-metrics', { file: 'index.html', metrics: fakeMetrics() })).status).toBe(400);
    expect((await post('/api/composition-metrics', { projectId: 'proj-1', metrics: fakeMetrics() })).status).toBe(400);
  });

  it('rejects an unsafe project id', async () => {
    await start();
    const res = await post('/api/composition-metrics', {
      projectId: '../escape',
      file: 'index.html',
      metrics: fakeMetrics(),
    });
    expect(res.status).toBe(400);
  });

  it('GET resolves an absolute artifactPath under the managed project root into projectId + file', async () => {
    await start();
    await post('/api/composition-metrics', { projectId: 'proj-1', file: 'index.html', metrics: fakeMetrics({ sectionCount: 3 }) });

    const artifactPath = join(projectsDir, 'proj-1', 'index.html');
    const res = await get(`/api/composition-metrics?artifactPath=${encodeURIComponent(artifactPath)}`);
    expect(res.status).toBe(200);
    expect(res.json.record.metrics.sectionCount).toBe(3);
  });

  it('GET resolves a nested artifactPath into a nested file', async () => {
    await start();
    await post('/api/composition-metrics', {
      projectId: 'proj-1',
      file: 'pages/about.html',
      metrics: fakeMetrics({ sectionCount: 4 }),
    });

    const artifactPath = join(projectsDir, 'proj-1', 'pages', 'about.html');
    const res = await get(`/api/composition-metrics?artifactPath=${encodeURIComponent(artifactPath)}`);
    expect(res.json.record.metrics.sectionCount).toBe(4);
  });

  it('rejects an artifactPath outside the managed project root', async () => {
    await start();
    const res = await get(`/api/composition-metrics?artifactPath=${encodeURIComponent('/etc/passwd')}`);
    expect(res.status).toBe(400);
  });

  it('rejects a GET with neither artifactPath nor projectId+file', async () => {
    await start();
    expect((await get('/api/composition-metrics')).status).toBe(400);
    expect((await get('/api/composition-metrics?projectId=proj-1')).status).toBe(400);
  });
});
