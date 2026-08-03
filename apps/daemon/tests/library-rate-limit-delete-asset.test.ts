// Baseline request-rate limit for DELETE /api/library/assets/:id, closing
// the ground-facts gap "no request- or byte-volume control on any
// /api/library/* route". See docs/security/daemon-threat-model.md's Wave 9
// section.
//
// Real transport throughout: a real booted daemon, real HTTP requests, no
// mocked fetch/db, per VERIFICATION-CONTRACT.md R2. Titles are flat (no
// describe() wrapper). Exactly two assertions in this file, deliberately --
// see docs/security/library-ingest-attribution.json and
// docs/security/library-ingest-red/a-library-assets-delete-request-past-the-50-request-limit-gets-429.txt.

import type http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-rl-delete-asset-'));
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
});

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
});

it('a library assets delete request accepts under the 50 request limit', async () => {
  for (let i = 0; i < 5; i += 1) {
    const res = await fetch(`${baseUrl}/api/library/assets/does-not-exist-${i}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  }
});

it('a library assets delete request past the 50 request limit gets 429', async () => {
  let lastStatus = 0;
  for (let i = 0; i < 51; i += 1) {
    const res = await fetch(`${baseUrl}/api/library/assets/does-not-exist-${i}`, { method: 'DELETE' });
    lastStatus = res.status;
  }
  expect(lastStatus).toBe(429);
});
