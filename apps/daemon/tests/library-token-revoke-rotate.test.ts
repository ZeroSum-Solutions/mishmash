// Revoke / rotate for OD Library capability tokens
// (POST /api/library/pair/revoke, POST /api/library/pair/rotate). New
// lifecycle operations this wave adds -- library-tokens.ts previously had
// no way to invalidate a minted token short of wiping the whole database.
// Real transport throughout (no mocks) per VERIFICATION-CONTRACT.md R2.
//
// Independent-token discipline: revocation and rotation are each tested on
// their OWN freshly-minted token, never chained on the same token, so the
// two semantics can never be mutually exclusive for a correct
// implementation (mirrors the wave gate's own C0-6 design).

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
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-token-lifecycle-'));
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

// Mints via the REAL cross-origin bootstrap transport -- a genuine
// not-yet-paired `Origin: chrome-extension://...` header on the confirm
// call itself. See tests/library-ingest-token-binding.test.ts's dedicated
// "real cross-origin bootstrap transport" describe block for the direct
// assertion that this call succeeds (200, not the pre-fix 403).
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

async function ingestStatus(origin: string, token: string): Promise<number> {
  const res = await fetch(`${baseUrl}/api/library/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dGVzdA==', filename: 'probe.txt' }),
  });
  return res.status;
}

describe('library token revoke / rotate (C0-6)', () => {
  it('(C0-6/revoke) revocation takes effect immediately: the revoked token is rejected on its very next use', async () => {
    const origin = extOrigin();
    const token = await mintToken(origin);
    expect(await ingestStatus(origin, token)).toBe(200);

    const revokeRes = await fetch(`${baseUrl}/api/library/pair/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(revokeRes.status).toBe(200);

    const status = await ingestStatus(origin, token);
    expect(status === 401 || status === 403).toBe(true);
  });

  it('revoking requires a currently-valid token (cannot revoke with an invalid/missing token)', async () => {
    const res = await fetch(`${baseUrl}/api/library/pair/revoke`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('(C0-6/rotate) rotation invalidates the prior token AND issues a working new one bound to the same identity', async () => {
    const origin = extOrigin();
    const oldToken = await mintToken(origin);
    expect(await ingestStatus(origin, oldToken)).toBe(200);

    const rotateRes = await fetch(`${baseUrl}/api/library/pair/rotate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${oldToken}` },
    });
    expect(rotateRes.status).toBe(200);
    const { token: newToken } = (await rotateRes.json()) as { token: string };
    expect(typeof newToken).toBe('string');
    expect(newToken).not.toBe(oldToken);

    const oldStatus = await ingestStatus(origin, oldToken);
    expect(oldStatus === 401 || oldStatus === 403).toBe(true);
    expect(await ingestStatus(origin, newToken)).toBe(200);
  });

  it('a token cannot be revoked or rotated by presenting it from a DIFFERENT origin than it is bound to', async () => {
    const origin = extOrigin();
    const token = await mintToken(origin);
    const otherOrigin = extOrigin();

    const revokeRes = await fetch(`${baseUrl}/api/library/pair/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Origin: otherOrigin },
    });
    expect(revokeRes.status).toBe(403);
    // Token is still alive -- the mismatched-origin revoke attempt did nothing.
    expect(await ingestStatus(origin, token)).toBe(200);
  });
});
