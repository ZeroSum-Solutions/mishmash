// Baseline request-rate limit for POST /api/tools/library/apply, closing
// the ground-facts gap "no request- or byte-volume control on any
// /api/library/* route". See docs/security/daemon-threat-model.md's Wave 9
// section.
//
// Real transport throughout: a real booted daemon, real HTTP requests
// authenticated via a genuine minted tool token (toolTokenRegistry, the same
// module-level singleton the running daemon's own authorizeToolRequest
// consults), no mocked fetch/db, per VERIFICATION-CONTRACT.md R2. Titles are
// flat (no describe() wrapper). Exactly two assertions in this file,
// deliberately -- see docs/security/library-ingest-attribution.json and
// docs/security/library-ingest-red/a-tools-library-apply-request-past-the-50-request-limit-gets-429.txt.

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
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-rl-tools-apply-'));
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

it('a tools library apply request accepts under the 50 request limit', async () => {
  const { toolTokenRegistry } = await import('../src/tool-tokens.js');
  const grant = toolTokenRegistry.mint({ runId: 'w9-rl-apply-accept', projectId: 'w9-rl-project' });
  for (let i = 0; i < 5; i += 1) {
    const res = await fetch(`${baseUrl}/api/tools/library/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${grant.token}` },
      body: JSON.stringify({ assetId: 'does-not-exist' }),
    });
    expect(res.status).toBe(404);
  }
  toolTokenRegistry.revokeToken(grant.token, 'manual');
});

it('a tools library apply request past the 50 request limit gets 429', async () => {
  const { toolTokenRegistry } = await import('../src/tool-tokens.js');
  const grant = toolTokenRegistry.mint({ runId: 'w9-rl-apply-reject', projectId: 'w9-rl-project' });
  let lastStatus = 0;
  for (let i = 0; i < 51; i += 1) {
    const res = await fetch(`${baseUrl}/api/tools/library/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${grant.token}` },
      body: JSON.stringify({ assetId: 'does-not-exist' }),
    });
    lastStatus = res.status;
  }
  expect(lastStatus).toBe(429);
  toolTokenRegistry.revokeToken(grant.token, 'manual');
});
