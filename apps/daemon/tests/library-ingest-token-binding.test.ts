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

// NOTE: the confirm call below is issued WITHOUT an extension-shaped Origin
// header (loopback instead) -- a PRE-EXISTING bug means the real flow (an
// actual cross-origin `Origin: chrome-extension://...` request) is rejected
// by server.ts's global `/api` origin gate before it ever reaches
// registerLibraryRoutes's `/api/library/pair/confirm` handler:
// isZeroConfigClipperLibraryRequest() (apps/daemon/src/origin-validation.ts)
// only zero-config-allowlists GET /library/clipper-probe and
// POST/OPTIONS /library/ingest, NOT /library/pair/confirm, and the origin
// isn't yet in the paired-origins allowlist at this point in the flow
// (that's the whole point of confirming). Both files are outside this
// wave's write lease, so this cannot be fixed here -- see the wave's
// completion report. confirmPairing() reads the target extensionOrigin from
// the JSON BODY, not the request's actual Origin header, so a loopback-
// origin'd call can still mint a token correctly bound to an extension
// origin for the purpose of testing the BINDING enforcement this spec
// exists to cover; it does not exercise the (separately broken) end-to-end
// bootstrap transport.
async function mintToken(origin: string): Promise<string> {
  const pairRes = await fetch(`${baseUrl}/api/library/pair`, { method: 'POST', headers: { Host: '127.0.0.1' } });
  const { code } = (await pairRes.json()) as { code: string };
  const confirmRes = await fetch(`${baseUrl}/api/library/pair/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Host: '127.0.0.1' },
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
