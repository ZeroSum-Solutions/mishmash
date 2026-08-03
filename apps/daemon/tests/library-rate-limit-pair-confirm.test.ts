// Pairing-attempt throttle for POST /api/library/pair/confirm (C9-6 P0
// control): startPairing() mints a 6-digit code with no attempt counter of
// its own (library-tokens.ts), and this route is reachable pre-pairing from
// any extension-shaped origin (the zero-config bypass) -- a genuine, narrow
// brute-force window. See docs/security/daemon-threat-model.md's Wave 9
// section.
//
// Real transport throughout: a real booted daemon, real HTTP requests, no
// mocked fetch/db, per VERIFICATION-CONTRACT.md R2. Titles are flat (no
// describe() wrapper) so each assertion's reported fullName is exactly its
// own it() string. Exactly two assertions in this file, deliberately: the
// "accept" case is unaffected by the throttle (it stays true whether or not
// the throttle exists) and the "reject" case is this file's own C9-5/C9-6
// citation -- see docs/security/library-ingest-attribution.json and
// docs/security/library-ingest-red/the-pair-confirm-attempt-past-the-5-attempt-limit-gets-429.txt.

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
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-rl-pair-confirm-'));
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

function extOrigin(): string {
  return `chrome-extension://${Math.random().toString(36).slice(2).padEnd(32, 'a')}`;
}

it('pair confirm requests accept while at or under the 5 attempt limit', async () => {
  for (let i = 0; i < 3; i += 1) {
    const pairRes = await fetch(`${baseUrl}/api/library/pair`, { method: 'POST', headers: { Host: '127.0.0.1' } });
    expect(pairRes.status).toBe(200);
    const { code } = (await pairRes.json()) as { code: string };
    const origin = extOrigin();
    const confirmRes = await fetch(`${baseUrl}/api/library/pair/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ code, extensionOrigin: origin }),
    });
    expect(confirmRes.status).toBe(200);
  }
});

it('the pair confirm attempt past the 5 attempt limit gets 429', async () => {
  let lastStatus = 0;
  for (let i = 0; i < 6; i += 1) {
    const res = await fetch(`${baseUrl}/api/library/pair/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: extOrigin() },
      // A deliberately-wrong code: the throttle counts every attempt before
      // the code is even checked, so this only needs to consume the budget.
      body: JSON.stringify({ code: '000000', extensionOrigin: extOrigin() }),
    });
    lastStatus = res.status;
  }
  expect(lastStatus).toBe(429);
});
