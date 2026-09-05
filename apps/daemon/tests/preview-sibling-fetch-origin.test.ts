// W2K.2 (FU-31 / D-22): the `/api` origin gate and the sandboxed preview's
// SCRIPTED sibling read.
//
// D-11 (`preview-asset-origin-exception.test.ts`) pinned the browser-classified
// resource shape — `Sec-Fetch-Dest: image`, no `Origin`. D-22 asks a different
// question: may sandboxed preview JavaScript read a sibling file of its own
// project? The answer the running product already gives is yes, and this file
// pins it so it cannot regress, together with every escape that must stay
// refused.
//
// The header set below is RECORDED, not designed. It is what Chromium 148 put
// on the wire for `fetch('data.json')` from the srcdoc preview of a real
// two-file artifact, captured through Playwright's request event against a
// tools-dev runtime (the full capture is in the track proof file). The
// difference that decides the request is `Origin: null`: an opaque-origin
// CORS-mode fetch always declares it, so the request is judged by the
// null-origin branch of the gate rather than by the no-Origin one. A scripted
// fetch that declares NO origin at all is not a shape a browser produces, and
// `preview-asset-origin-exception.test.ts` keeps refusing it.
//
// Requests go through a REAL booted daemon over raw node:http, because
// `Sec-Fetch-*` are forbidden header names and a browser-shaped request can
// only be built at the transport level.

import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PROJECT_ID = 'w2k2-preview-sibling-fetch';
const SIBLING_FILE = 'data.json';
const SIBLING_PATH = `/api/projects/${PROJECT_ID}/raw/${SIBLING_FILE}`;

/**
 * What Chromium 148 actually sent for `fetch('data.json')` from the sandboxed
 * srcdoc preview document. Only the headers the gate reads are replayed; the
 * capture also carried `accept`, `cache-control`, `pragma` and the UA hints,
 * none of which the gate consults.
 */
const RECORDED_SANDBOXED_FETCH_HEADERS = {
  origin: 'null',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
} as const;

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-w2k2-sibling-fetch-'));
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

  // Seeded through the daemon's own HTTP API as a non-browser client, so
  // nothing in the fixture bypasses the gate under test.
  const project = await send('POST', '/api/projects', {}, {
    designSystemId: null,
    id: PROJECT_ID,
    metadata: { kind: 'prototype' },
    name: 'Preview sibling fetch',
    skillId: null,
  });
  expect(project.status, project.body).toBe(200);
  const sibling = await send('POST', `/api/projects/${PROJECT_ID}/files`, {}, {
    content: JSON.stringify({ label: '14 stores loaded' }),
    name: SIBLING_FILE,
  });
  expect(sibling.status, sibling.body).toBe(200);
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

function send(
  method: string,
  requestPath: string,
  headers: http.OutgoingHttpHeaders,
  body?: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
    const request = http.request(
      new URL(baseUrl),
      {
        headers: payload
          ? { ...headers, 'content-length': payload.length, 'content-type': 'application/json' }
          : headers,
        method,
        path: requestPath,
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => resolve({ body: text, status: response.statusCode ?? 0 }));
      },
    );
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function status(method: string, requestPath: string, headers: http.OutgoingHttpHeaders) {
  return send(method, requestPath, headers).then((response) => response.status);
}

describe('/api origin gate: a sandboxed preview reading a sibling project file', () => {
  it('admits the recorded scripted sibling read of a project raw file', async () => {
    const admitted = await send('GET', SIBLING_PATH, RECORDED_SANDBOXED_FETCH_HEADERS);
    expect(admitted.status, admitted.body).toBe(200);
    expect(JSON.parse(admitted.body)).toEqual({ label: '14 stores loaded' });
  });

  it('answers the sibling read with a CORS header an opaque origin can read', async () => {
    // Without this the browser withholds a 200 from the page and the fetch
    // rejects, which is indistinguishable from the daemon refusing it.
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const request = http.request(
        new URL(baseUrl),
        { headers: RECORDED_SANDBOXED_FETCH_HEADERS, method: 'GET', path: SIBLING_PATH },
        resolve,
      );
      request.on('error', reject);
      request.end();
    });
    response.resume();
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });

  it('refuses a scripted read of a JSON API route', async () => {
    expect(await status('GET', '/api/projects', RECORDED_SANDBOXED_FETCH_HEADERS)).toBe(403);
    expect(await status('GET', `/api/projects/${PROJECT_ID}/files`, RECORDED_SANDBOXED_FETCH_HEADERS)).toBe(403);
    expect(await status('GET', `/api/projects/${PROJECT_ID}`, RECORDED_SANDBOXED_FETCH_HEADERS)).toBe(403);
  });

  it('refuses a scripted read of a sibling project route that is not the raw tree', async () => {
    expect(await status('GET', `/api/projects/${PROJECT_ID}/powered/${SIBLING_FILE}`, RECORDED_SANDBOXED_FETCH_HEADERS))
      .toBe(403);
    expect(await status('GET', `/api/projects/${PROJECT_ID}/preview-url`, RECORDED_SANDBOXED_FETCH_HEADERS)).toBe(403);
  });

  it('serves nothing for a raw-tree request that names no file', async () => {
    // The two sandbox branches of the gate part company here, and the
    // difference is worth stating rather than smoothing over. The no-Origin
    // branch (`sandboxedPreviewAssetScope`, D-11) requires a file below
    // `/raw/` and answers 403 for the bare prefix; the null-origin branch this
    // request lands in admits the prefix, and the raw route -- whose pattern
    // needs a file path -- then matches nothing. Either way no bytes leave the
    // daemon and no listing exists to walk, which is the containment claim.
    expect(await status('GET', `/api/projects/${PROJECT_ID}/raw/`, RECORDED_SANDBOXED_FETCH_HEADERS)).toBe(404);
  });

  it('refuses the same read when a real foreign origin is declared', async () => {
    const refused = await status('GET', SIBLING_PATH, {
      ...RECORDED_SANDBOXED_FETCH_HEADERS,
      origin: 'https://attacker.example',
    });
    expect(refused).toBe(403);
  });

  it('refuses a mutating request to the sibling file', async () => {
    expect(await status('DELETE', SIBLING_PATH, RECORDED_SANDBOXED_FETCH_HEADERS)).toBe(403);
    expect(await status('GET', SIBLING_PATH, RECORDED_SANDBOXED_FETCH_HEADERS)).toBe(200);
  });
});
