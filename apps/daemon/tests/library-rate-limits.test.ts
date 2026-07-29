// Rate/volume controls closing the three P0 gaps this tranche's ground facts
// identified (docs/plans/waves/W9-ingest-tranche.md): POST
// /api/library/pair/confirm's pairing-attempt throttle, POST
// /api/library/ingest's clipper/token-class byte-volume cap, and GET
// /api/library/assets's per-caller request-rate limit (its own
// reconcile-on-list throttle is program-wide, not per-caller -- see
// RECONCILE_THROTTLE_MS in routes/library.ts). Also covers GET
// /api/library/clipper-probe's rate limit: exposure===3 by design (it must
// stay reachable pre-pairing from any extension-shaped origin, so it cannot
// be loopback-gated), but previously had no volume control of any kind.
//
// Real transport throughout: a real booted daemon, real HTTP requests, no
// mocked fetch/db, per VERIFICATION-CONTRACT.md R2. Titles are flat (no
// describe() wrapper) so each assertion's reported fullName is exactly its
// own it() string -- see docs/security/library-ingest-attribution.json's
// citations for these routes.

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
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-rate-limits-'));
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

// Mints via the real cross-origin bootstrap transport (same pattern as
// tests/library-ingest-token-binding.test.ts's own mintToken helper).
async function mintToken(origin: string): Promise<string> {
  const pairRes = await fetch(`${baseUrl}/api/library/pair`, { method: 'POST', headers: { Host: '127.0.0.1' } });
  const { code } = (await pairRes.json()) as { code: string };
  const confirmRes = await fetch(`${baseUrl}/api/library/pair/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ code, extensionOrigin: origin }),
  });
  const body = (await confirmRes.json()) as { token: string };
  return body.token;
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

it('a clipper ingest payload accept while under the 5000000 byte limit', async () => {
  const origin = extOrigin();
  const token = await mintToken(origin);
  const bytes = Buffer.alloc(1_000, 7);
  const res = await fetch(`${baseUrl}/api/library/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      dataUrl: `data:application/octet-stream;base64,${bytes.toString('base64')}`,
      filename: 'small.bin',
    }),
  });
  expect(res.status).toBe(200);
});

it('a clipper ingest payload past the 5000000 byte limit gets 413', async () => {
  const origin = extOrigin();
  const token = await mintToken(origin);
  const bytes = Buffer.alloc(5_000_001, 7);
  const res = await fetch(`${baseUrl}/api/library/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      dataUrl: `data:application/octet-stream;base64,${bytes.toString('base64')}`,
      filename: 'big.bin',
    }),
  });
  expect(res.status).toBe(413);
}, 20_000);

it('library assets list requests accept while at or under the 20 request limit', async () => {
  for (let i = 0; i < 5; i += 1) {
    const res = await fetch(`${baseUrl}/api/library/assets`);
    expect(res.status).toBe(200);
  }
});

it('a library assets list request past the 20 request limit gets 429', async () => {
  let lastStatus = 0;
  for (let i = 0; i < 21; i += 1) {
    const res = await fetch(`${baseUrl}/api/library/assets`);
    lastStatus = res.status;
  }
  expect(lastStatus).toBe(429);
});

it('the clipper probe request accepts while at or under the 30 request limit', async () => {
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
