// Byte-volume cap for the clipper/token caller class of POST
// /api/library/ingest (C9-6 P0 control) must bound TOTAL persisted bytes,
// not just the primary `dataUrl`/`text` payload: a clipper request also
// persists `figmaCapture` (written to a Figma IR sidecar), `elementHtml`
// (written to an element sidecar), and `metadata` (stored on the asset row)
// when present. Counting only the primary payload lets a caller ship a tiny
// `text` alongside an arbitrarily large `figmaCapture`/`elementHtml`/
// `metadata` and bypass CLIPPER_INGEST_MAX_BYTES entirely. See
// library-rate-limit-ingest.test.ts for the primary-payload case (kept in
// its own file: its citation replays against a parent that predates this
// file, and adding a second, independently-new failing test into that same
// file would give that replay two failed leaves instead of one) and
// docs/security/daemon-threat-model.md's Wave 9 section.
//
// Real transport throughout: a real booted daemon, real HTTP requests, no
// mocked fetch/db, per VERIFICATION-CONTRACT.md R2. Titles are flat (no
// describe() wrapper).

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
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-rl-ingest-sidecar-'));
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

it('a clipper ingest payload accept while a sidecar figmaCapture stays under the 5000000 byte limit', async () => {
  const origin = extOrigin();
  const token = await mintToken(origin);
  const res = await fetch(`${baseUrl}/api/library/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      text: 'hi',
      figmaCapture: JSON.stringify({ nodes: [{ id: '1', type: 'FRAME' }] }),
      figmaNodeCount: 1,
    }),
  });
  expect(res.status).toBe(200);
});

it('a clipper ingest payload past the 5000000 byte limit via a sidecar figmaCapture: reject with 413', async () => {
  const origin = extOrigin();
  const token = await mintToken(origin);
  const hugeFigmaCapture = 'x'.repeat(5_000_001);
  const res = await fetch(`${baseUrl}/api/library/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      text: 'hi',
      figmaCapture: hugeFigmaCapture,
      figmaNodeCount: 1,
    }),
  });
  expect(res.status).toBe(413);
}, 20_000);
