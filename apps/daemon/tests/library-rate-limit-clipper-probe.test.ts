// Baseline request-rate limit for GET /api/library/clipper-probe. This route
// stays gate-free by design (the zero-config, pre-pairing daemon-detection
// probe the extension calls before any token exists), but previously had no
// volume control of any kind. See docs/security/daemon-threat-model.md's
// Wave 9 section.
//
// Real transport throughout: a real booted daemon, real HTTP requests, no
// mocked fetch/db, per VERIFICATION-CONTRACT.md R2. Titles are flat (no
// describe() wrapper). Exactly two assertions in this file, deliberately --
// see docs/security/library-ingest-attribution.json and
// docs/security/library-ingest-red/the-clipper-probe-request-past-the-30-request-limit-gets-429.txt.

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
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-rl-clipper-probe-'));
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

it('clipper probe requests accept while at or under the 30 request limit', async () => {
  for (let i = 0; i < 5; i += 1) {
    const res = await fetch(`${baseUrl}/api/library/clipper-probe`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  }
});

it('the clipper probe request past the 30 request limit gets 429', async () => {
  let lastStatus = 0;
  for (let i = 0; i < 31; i += 1) {
    const res = await fetch(`${baseUrl}/api/library/clipper-probe`);
    lastStatus = res.status;
  }
  expect(lastStatus).toBe(429);
});
