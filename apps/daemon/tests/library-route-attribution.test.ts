// Route-surface attribution coverage for the routes that previously had
// neither dedicated tests nor a security gap requiring a P0-grade fix (see
// tests/library-rate-limits.test.ts for those): five reads newly gated with
// requireLocalDaemonRequest (a paired browser-extension origin is allowlisted
// by the global /api origin gate for ANY method -- including these reads --
// even though only POST /api/library/ingest is a documented extension
// capability; requireLocalDaemonRequest closes that), and six routes that
// gained a baseline request-rate control (docs/plans/waves/
// W9-ingest-tranche.md's ground facts: "no request- or byte-volume control
// on any /api/library/* route").
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
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-route-attribution-'));
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

async function ingestAsset(body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${baseUrl}/api/library/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { asset: { id: string } };
  return json.asset.id;
}

it('GET library assets by id accepts a loopback request and rejects a non-loopback origin', async () => {
  const assetId = await ingestAsset({ text: 'hello world', kind: 'text' });

  const loopbackRes = await fetch(`${baseUrl}/api/library/assets/${assetId}`);
  expect(loopbackRes.status).toBe(200);

  const origin = extOrigin();
  await mintToken(origin);
  const extRes = await fetch(`${baseUrl}/api/library/assets/${assetId}`, { headers: { Origin: origin } });
  expect(extRes.status).toBe(403);
});

it('GET library assets raw bytes accepts a loopback request and rejects a non-loopback origin', async () => {
  const assetId = await ingestAsset({ text: 'hello world', kind: 'text' });

  const loopbackRes = await fetch(`${baseUrl}/api/library/assets/${assetId}/raw`);
  expect(loopbackRes.status).toBe(200);

  const origin = extOrigin();
  await mintToken(origin);
  const extRes = await fetch(`${baseUrl}/api/library/assets/${assetId}/raw`, { headers: { Origin: origin } });
  expect(extRes.status).toBe(403);
});

it('GET library assets figma sidecar accepts a loopback request and rejects a non-loopback origin', async () => {
  const assetId = await ingestAsset({
    text: '<!doctype html><html><body><h1>Example</h1></body></html>',
    kind: 'html',
    figmaCapture: JSON.stringify({ version: 1, root: { type: 'FRAME', name: 'body' } }),
  });

  const loopbackRes = await fetch(`${baseUrl}/api/library/assets/${assetId}/figma`);
  expect(loopbackRes.status).toBe(200);

  const origin = extOrigin();
  await mintToken(origin);
  const extRes = await fetch(`${baseUrl}/api/library/assets/${assetId}/figma`, { headers: { Origin: origin } });
  expect(extRes.status).toBe(403);
});

it('GET library assets element sidecar accepts a loopback request and rejects a non-loopback origin', async () => {
  const assetId = await ingestAsset({
    text: '<!doctype html><html><body><h1>Example</h1></body></html>',
    kind: 'html',
    elementHtml: '<section class="hero"><h1>Title</h1></section>',
    metadata: { element: { tag: 'section', selector: 'section.hero' } },
  });

  const loopbackRes = await fetch(`${baseUrl}/api/library/assets/${assetId}/element`);
  expect(loopbackRes.status).toBe(200);

  const origin = extOrigin();
  await mintToken(origin);
  const extRes = await fetch(`${baseUrl}/api/library/assets/${assetId}/element`, { headers: { Origin: origin } });
  expect(extRes.status).toBe(403);
});

it('GET library events accepts a loopback request and rejects a non-loopback origin', async () => {
  const loopbackRes = await fetch(`${baseUrl}/api/library/events`);
  expect(loopbackRes.status).toBe(200);
  if (!loopbackRes.body) throw new Error('events stream missing body');
  const reader = loopbackRes.body.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value ?? new Uint8Array());
  expect(text).toContain('event: ready');
  await reader.cancel().catch(() => {});

  const origin = extOrigin();
  await mintToken(origin);
  const extRes = await fetch(`${baseUrl}/api/library/events`, { headers: { Origin: origin } });
  expect(extRes.status).toBe(403);
});

it('a library connection status request past the 50 request limit gets 429', async () => {
  let lastStatus = 0;
  for (let i = 0; i < 51; i += 1) {
    const res = await fetch(`${baseUrl}/api/library/connection`);
    lastStatus = res.status;
  }
  expect(lastStatus).toBe(429);
});

it('a library sync request past the 10 sync limit gets 429', async () => {
  let lastStatus = 0;
  for (let i = 0; i < 11; i += 1) {
    const res = await fetch(`${baseUrl}/api/library/sync`, { method: 'POST' });
    lastStatus = res.status;
  }
  expect(lastStatus).toBe(429);
});

it('a library assets delete request past the 50 request limit gets 429', async () => {
  let lastStatus = 0;
  for (let i = 0; i < 51; i += 1) {
    const res = await fetch(`${baseUrl}/api/library/assets/does-not-exist-${i}`, { method: 'DELETE' });
    lastStatus = res.status;
  }
  expect(lastStatus).toBe(429);
});

it('a library assets apply request past the 50 request limit gets 429', async () => {
  let lastStatus = 0;
  for (let i = 0; i < 51; i += 1) {
    const res = await fetch(`${baseUrl}/api/library/assets/does-not-exist/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    lastStatus = res.status;
  }
  expect(lastStatus).toBe(429);
});

it('a tools library search request past the 50 request limit gets 429', async () => {
  const { toolTokenRegistry } = await import('../src/tool-tokens.js');
  const grant = toolTokenRegistry.mint({ runId: 'w9-attrib-search', projectId: 'w9-attrib-project' });
  let lastStatus = 0;
  for (let i = 0; i < 51; i += 1) {
    const res = await fetch(`${baseUrl}/api/tools/library/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${grant.token}` },
      body: JSON.stringify({}),
    });
    lastStatus = res.status;
  }
  expect(lastStatus).toBe(429);
  toolTokenRegistry.revokeToken(grant.token, 'manual');
});

it('a tools library apply request past the 50 request limit gets 429', async () => {
  const { toolTokenRegistry } = await import('../src/tool-tokens.js');
  const grant = toolTokenRegistry.mint({ runId: 'w9-attrib-apply', projectId: 'w9-attrib-project' });
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
