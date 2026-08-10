// Security review finding: the shared /api origin gate treated a missing
// Origin header as proof of a non-browser client and let the request straight
// through. The Fetch spec omits Origin on cross-site GET subresource loads
// (<img>, <script>, <link>, <iframe src>), so any page a user has open could
// reach every /api GET route without ever presenting an Origin -- while the
// codebase's own isLocalSameOrigin helper already consults Sec-Fetch-Site for
// exactly this case.
//
// Requests go through a REAL booted daemon over raw node:http (not fetch):
// Sec-Fetch-* are forbidden header names, so a browser-shaped request can only
// be built at the transport level.

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
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-origin-meta-'));
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

/** GET /api/projects with the given headers and NO Origin, over a raw socket. */
function statusWithHeaders(headers: http.OutgoingHttpHeaders): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(baseUrl), { path: '/api/projects', method: 'GET', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('/api origin gate: requests with no Origin header', () => {
  it('rejects a cross-site subresource GET that carries no Origin', async () => {
    // What an attacker page's <img src="http://127.0.0.1:PORT/api/projects">
    // actually puts on the wire.
    const status = await statusWithHeaders({
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'no-cors',
      'sec-fetch-dest': 'image',
    });
    expect(status).toBe(403);
  });

  it('rejects a same-site subresource GET that carries no Origin', async () => {
    const status = await statusWithHeaders({
      'sec-fetch-site': 'same-site',
      'sec-fetch-mode': 'no-cors',
      'sec-fetch-dest': 'script',
    });
    expect(status).toBe(403);
  });

  it('still allows a genuine non-browser client (no fetch metadata at all)', async () => {
    expect(await statusWithHeaders({})).toBe(200);
  });

  it('still allows our own page: a same-origin GET subresource', async () => {
    const status = await statusWithHeaders({
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
    });
    expect(status).toBe(200);
  });

  it('still allows a user-initiated navigation (address bar, bookmark)', async () => {
    const status = await statusWithHeaders({
      'sec-fetch-site': 'none',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
    });
    expect(status).toBe(200);
  });

  it('still allows a cross-site top-level navigation (the OAuth provider redirect back into /api)', async () => {
    // The browser leaves the initiating page, so it can never read this
    // response -- and blocking it would break /api/mcp/oauth/callback and the
    // deliberately cross-site powered-preview iframe.
    const status = await statusWithHeaders({
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
    });
    expect(status).toBe(200);
  });
});
