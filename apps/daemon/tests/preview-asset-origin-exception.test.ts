// W2G.4b (D-11 option B): the shared /api origin gate must admit ONE extra
// request shape — a sandboxed preview document loading a project raw asset as
// a browser-classified resource — and nothing else.
//
// A preview iframe is sandboxed without `allow-same-origin`, so the document
// inside it holds an opaque origin: every subresource it requests carries
// `Sec-Fetch-Site: cross-site` and no `Origin`. That is the exact shape
// `allowsMissingOriginRequest` refuses, which is why the relative `<img>` on a
// previewed project page answered 403 and stayed at naturalWidth 0.
//
// This file pins the boundary of the exception rather than its user-visible
// effect (that is `e2e/ui/preview-relative-assets.test.ts`). Requests go
// through a REAL booted daemon over raw node:http, because `Sec-Fetch-*` are
// forbidden header names and a browser-shaped request can only be built at the
// transport level.

import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PROJECT_ID = 'w2g4b-preview-asset-exception';
const RELATIVE_REF = 'assets/pic.png';
const RAW_ASSET_PATH = `/api/projects/${PROJECT_ID}/raw/${RELATIVE_REF}`;
// A 4x4 PNG. Only its bytes matter here: the assertions are on status codes.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGN4YOAARwzEcQAsUhUBJmYoNwAAAABJRU5ErkJggg==';

/** What a sandboxed document's `<img src>` load actually puts on the wire. */
const SANDBOXED_IMAGE_HEADERS = {
  'sec-fetch-dest': 'image',
  'sec-fetch-mode': 'no-cors',
  'sec-fetch-site': 'cross-site',
} as const;

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-w2g4b-preview-asset-'));
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

  // Seed through the daemon's own HTTP API as a non-browser client (no fetch
  // metadata at all), so nothing in this fixture bypasses the gate under test.
  const project = await send('POST', '/api/projects', {}, {
    designSystemId: null,
    id: PROJECT_ID,
    metadata: { kind: 'prototype' },
    name: 'Preview asset origin exception',
    skillId: null,
  });
  expect(project.status, project.body).toBe(200);
  const asset = await send('POST', `/api/projects/${PROJECT_ID}/files`, {}, {
    content: PNG_BASE64,
    encoding: 'base64',
    name: RELATIVE_REF,
  });
  expect(asset.status, asset.body).toBe(200);
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

describe('/api origin gate: the sandboxed preview project-asset exception', () => {
  it('admits a sandboxed image load of a project raw asset', async () => {
    expect(await status('GET', RAW_ASSET_PATH, SANDBOXED_IMAGE_HEADERS)).toBe(200);
  });

  it('admits the same load when the sandbox sends the literal null origin', async () => {
    const admitted = await status('GET', RAW_ASSET_PATH, { ...SANDBOXED_IMAGE_HEADERS, origin: 'null' });
    expect(admitted).toBe(200);
  });

  it('refuses a scripted fetch for the same asset', async () => {
    // `Sec-Fetch-Dest: empty` is what a fetch() inside the artifact looks
    // like. Admitting it would let template code read project bytes as data.
    const refused = await status('GET', RAW_ASSET_PATH, {
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'cross-site',
    });
    expect(refused).toBe(403);
  });

  it('refuses the same asset when a real foreign origin is declared', async () => {
    const refused = await status('GET', RAW_ASSET_PATH, {
      ...SANDBOXED_IMAGE_HEADERS,
      origin: 'https://attacker.example',
    });
    expect(refused).toBe(403);
  });

  it('refuses a sandboxed image load of a JSON API route', async () => {
    expect(await status('GET', `/api/projects/${PROJECT_ID}/files`, SANDBOXED_IMAGE_HEADERS)).toBe(403);
    expect(await status('GET', '/api/projects', SANDBOXED_IMAGE_HEADERS)).toBe(403);
    expect(await status('GET', `/api/projects/${PROJECT_ID}`, SANDBOXED_IMAGE_HEADERS)).toBe(403);
  });

  it('refuses a sandboxed image load of a sibling project route that is not the raw tree', async () => {
    const powered = await status('GET', `/api/projects/${PROJECT_ID}/powered/${RELATIVE_REF}`, SANDBOXED_IMAGE_HEADERS);
    expect(powered).toBe(403);
    const preview = await status('GET', `/api/projects/${PROJECT_ID}/preview-url`, SANDBOXED_IMAGE_HEADERS);
    expect(preview).toBe(403);
  });

  it('refuses a mutating request to the raw tree', async () => {
    // The exception is GET-only: the same path with a delete stays behind the
    // gate, so a sandboxed document cannot erase project files.
    const deleted = await status('DELETE', RAW_ASSET_PATH, SANDBOXED_IMAGE_HEADERS);
    expect(deleted).toBe(403);
    const stillThere = await status('GET', RAW_ASSET_PATH, SANDBOXED_IMAGE_HEADERS);
    expect(stillThere).toBe(200);
  });

  it('refuses a raw-tree request that names no file', async () => {
    expect(await status('GET', `/api/projects/${PROJECT_ID}/raw/`, SANDBOXED_IMAGE_HEADERS)).toBe(403);
  });
});
