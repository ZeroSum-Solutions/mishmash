// W2.6 / T-09 — `Project.hasCover` must tell a client whether the frozen
// cover endpoint will answer bytes or 404, so no client has to find out by
// issuing a request that fails.
//
// `GET /api/projects/:id/cover` is frozen as "raw image bytes 200, or 404"
// (apps/daemon/src/routes/covers.ts:1-6, packages/contracts/src/api/covers.ts,
// scripts/waves/verify-w4.ts) — the response shape is deliberately NOT
// changed here. Instead the projects list and detail responses publish
// whether a cover exists, and the web reads that instead of probing.
//
// Real booted daemon, real HTTP, real Chromium render — same shape as
// covers-routes.test.ts; no mocked transport, no source-level backdoor.

import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-has-cover-'));
  process.env.OD_DATA_DIR = dataDir;
  const { startServer } = await import('../src/server.js');
  const started = (await startServer({ port: 0, host: '127.0.0.1', returnServer: true })) as {
    url: string;
    server: http.Server;
    shutdown?: () => Promise<void> | void;
  };
  baseUrl = started.url;
  daemon = started.server;
  daemonShutdown = started.shutdown;
}, 60_000);

afterEach(async () => {
  if (daemonShutdown) {
    await Promise.race([Promise.resolve(daemonShutdown()), new Promise((r) => setTimeout(r, 2000))]);
  }
  daemon?.closeAllConnections?.();
  await new Promise<void>((resolve) => daemon?.close(() => resolve()) ?? resolve());
  if (PREV_DATA_DIR === undefined) delete process.env.OD_DATA_DIR;
  else process.env.OD_DATA_DIR = PREV_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  register.clear();
  vi.resetModules();
}, 30_000);

async function createProject(id: string): Promise<void> {
  const resp = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name: id }),
  });
  expect(resp.ok).toBe(true);
}

async function uploadIndexHtml(projectId: string): Promise<void> {
  const form = new FormData();
  form.append(
    'files',
    new Blob(['<!doctype html><html><body style="background:#4477ff;height:400px"></body></html>'], {
      type: 'text/html',
    }),
    'index.html',
  );
  const resp = await fetch(`${baseUrl}/api/projects/${projectId}/upload`, {
    method: 'POST',
    body: form,
  });
  expect(resp.ok).toBe(true);
}

async function listedProject(id: string): Promise<Record<string, unknown>> {
  const resp = await fetch(`${baseUrl}/api/projects`);
  expect(resp.status).toBe(200);
  const body = (await resp.json()) as { projects: Array<Record<string, unknown>> };
  const row = body.projects.find((project) => project.id === id);
  expect(row, `project ${id} must appear in GET /api/projects`).toBeTruthy();
  return row as Record<string, unknown>;
}

async function detailProject(id: string): Promise<Record<string, unknown>> {
  const resp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}`);
  expect(resp.status).toBe(200);
  const body = (await resp.json()) as { project: Record<string, unknown> };
  return body.project;
}

describe('W2.6 / T-09 — Project.hasCover mirrors the frozen cover endpoint', () => {
  it(
    'reports hasCover false, and the cover endpoint 404s, before the first render',
    async () => {
      const id = `has-cover-none-${Date.now()}`;
      await createProject(id);
      await uploadIndexHtml(id);

      const coverResp = await fetch(`${baseUrl}/api/projects/${id}/cover`);
      expect(coverResp.status).toBe(404);

      expect(await listedProject(id)).toMatchObject({ hasCover: false });
      expect(await detailProject(id)).toMatchObject({ hasCover: false });
    },
    60_000,
  );

  it(
    'reports hasCover true, and the cover endpoint 200s, after a render',
    async () => {
      const id = `has-cover-rendered-${Date.now()}`;
      await createProject(id);
      await uploadIndexHtml(id);

      const genResp = await fetch(`${baseUrl}/api/projects/${id}/cover/generate`, {
        method: 'POST',
      });
      expect(genResp.status).toBe(200);

      const coverResp = await fetch(`${baseUrl}/api/projects/${id}/cover`);
      expect(coverResp.status).toBe(200);

      expect(await listedProject(id)).toMatchObject({ hasCover: true });
      expect(await detailProject(id)).toMatchObject({ hasCover: true });
    },
    180_000,
  );
});
