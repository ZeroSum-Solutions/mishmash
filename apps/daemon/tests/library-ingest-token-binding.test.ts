// Capability-token identity binding for the clipper ingest path
// (POST /api/library/ingest). Before this fix, routes/library.ts trusted ANY
// `chrome-extension://`/`moz-extension://` Origin as 'clipper' outright --
// no pairing, no token required (the origin string is unforgeable by a web
// page, but ANY installed extension could present it, paired or not). This
// spec asserts the fixed invariant: an extension-shaped Origin is only
// trusted when it also carries a capability token that is (a) currently
// valid and (b) bound to that SAME origin. See
// docs/security/daemon-threat-model.md [C0-5]/[C0-6].
//
// Real transport throughout: a real booted daemon, real HTTP requests, real
// SQLite-backed token storage (no mocked fetch/EventSource/db per
// VERIFICATION-CONTRACT.md R2).

import type http from 'node:http';
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
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-token-binding-'));
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

// Mints a token through the REAL cross-origin bootstrap transport: a
// genuine not-yet-paired `Origin: chrome-extension://...` header on the
// confirm call itself (previously blocked by a pre-existing bug in the
// global `/api` origin gate; fixed in origin-validation.ts's
// isZeroConfigClipperLibraryRequest -- see docs/security/daemon-threat-
// model.md [C0-5]/[C0-6]).
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

async function ingest(origin: string | undefined, token: string | undefined): Promise<number> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/api/library/ingest`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dGVzdA==', filename: 'probe.txt' }),
  });
  return res.status;
}

describe('POST /api/library/pair/confirm — real cross-origin bootstrap transport', () => {
  it('(C0-5/mint) a genuine not-yet-paired chrome-extension Origin header can mint a token via pair/confirm', async () => {
    const origin = extOrigin();
    const pairRes = await fetch(`${baseUrl}/api/library/pair`, { method: 'POST', headers: { Host: '127.0.0.1' } });
    expect(pairRes.status).toBe(200);
    const { code } = (await pairRes.json()) as { code: string };
    const confirmRes = await fetch(`${baseUrl}/api/library/pair/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ code, extensionOrigin: origin }),
    });
    // Before the origin-validation.ts fix, this request never reached
    // registerLibraryRoutes's handler at all -- the global /api origin gate
    // rejected it with 403 "Cross-origin requests are not allowed" first.
    expect(confirmRes.status).toBe(200);
    const body = (await confirmRes.json()) as { token?: string; label?: string };
    expect(typeof body.token).toBe('string');
    expect(body.token!.startsWith('odlt_')).toBe(true);
  });

  it('OPTIONS preflight for pair/confirm succeeds from a genuine extension origin', async () => {
    const res = await fetch(`${baseUrl}/api/library/pair/confirm`, {
      method: 'OPTIONS',
      headers: { Origin: extOrigin() },
    });
    expect(res.status).toBe(204);
  });
});

describe('POST /api/library/ingest — capability token identity binding (C0-5/C0-6)', () => {
  it('(C0-5/reject) rejects an unpaired extension origin with no token', async () => {
    const status = await ingest(extOrigin(), undefined);
    expect(status === 401 || status === 403).toBe(true);
  });

  it('(C0-5/accept) accepts a paired extension origin presenting its own bound token', async () => {
    const origin = extOrigin();
    const token = await mintToken(origin);
    const status = await ingest(origin, token);
    expect(status).toBe(200);
  });

  it('(C0-6/replay) rejects a token replayed from a DIFFERENT extension origin than it was minted for', async () => {
    const mintedFor = extOrigin();
    const token = await mintToken(mintedFor);
    const replayFrom = extOrigin();
    const status = await ingest(replayFrom, token);
    expect(status === 401 || status === 403).toBe(true);
  });

  it('rejects an extension origin presenting a token minted for a different origin, even when both are individually valid', async () => {
    const originA = extOrigin();
    const originB = extOrigin();
    const tokenA = await mintToken(originA);
    await mintToken(originB); // establishes originB as paired too, but with its OWN token
    const status = await ingest(originB, tokenA);
    expect(status === 401 || status === 403).toBe(true);
  });
});
