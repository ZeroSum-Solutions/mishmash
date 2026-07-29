// Byte-volume cap for the clipper/token caller class of POST
// /api/library/ingest (C9-6 P0 control) must bound TOTAL persisted bytes,
// not just the primary `dataUrl`/`text`/sidecar payload: a clipper request
// also persists `sourceTitle`, `sourceUrl`, and `tags` (forwarded straight
// into registerLibraryAsset and stored on the asset row). Counting only
// bytes/text/figmaCapture/elementHtml/metadata (round 1's fix) still let a
// caller ship a tiny primary payload alongside an arbitrarily large
// `sourceTitle`/`sourceUrl`/`tags` and bypass CLIPPER_INGEST_MAX_BYTES.
//
// This is the SAME bypass class as library-rate-limit-ingest-sidecar.test.ts,
// through a different set of persisted fields -- see routes/library.ts's
// `clipperIngestByteVolume` docblock for why the fix sums the whole request
// body by construction instead of naming fields (round 1 and round 2 both
// missed real persisted fields by naming them one at a time).
//
// Kept in its own file for the same mechanical reason as the round-1 sidecar
// file: library-rate-limit-ingest.test.ts's existing reject test is cited
// (control.testRef) with a red-evidence replay pinned to a parent commit
// that predates any byte-volume protection at all. A second, independently
// new failing test in that same file would also be red at that old parent,
// giving the replay two failed leaves instead of one and breaking the
// existing citation.
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
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-rl-ingest-reg-'));
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

it('a clipper ingest payload accept while sourceTitle, sourceUrl, and tags stay under the 5000000 byte limit', async () => {
  const origin = extOrigin();
  const token = await mintToken(origin);
  const res = await fetch(`${baseUrl}/api/library/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      text: 'hi',
      sourceTitle: 'My Design',
      sourceUrl: 'https://example.com/page',
      tags: ['design', 'ui'],
    }),
  });
  expect(res.status).toBe(200);
});

it('a clipper ingest payload past the 5000000 byte limit via sourceTitle, sourceUrl, and tags combined: reject with 413', async () => {
  const origin = extOrigin();
  const token = await mintToken(origin);
  // Each field alone stays comfortably under the 5,000,000-byte limit; only
  // their sum exceeds it. This proves the fix aggregates ACROSS fields
  // (registerLibraryAsset's three previously-uncounted arguments), not that
  // it merely rejects one oversized field in isolation.
  const res = await fetch(`${baseUrl}/api/library/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      text: 'hi',
      sourceTitle: 'a'.repeat(2_000_000),
      sourceUrl: `https://example.com/${'b'.repeat(2_000_000)}`,
      tags: ['c'.repeat(2_000_000)],
    }),
  });
  expect(res.status).toBe(413);
}, 20_000);

it('does not persist any asset when the sourceTitle/sourceUrl/tags cap is exceeded', async () => {
  const origin = extOrigin();
  const token = await mintToken(origin);
  const rejectRes = await fetch(`${baseUrl}/api/library/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: 'hi', sourceTitle: 'a'.repeat(6_000_000) }),
  });
  expect(rejectRes.status).toBe(413);

  const listRes = await fetch(`${baseUrl}/api/library/assets`, { headers: { Host: '127.0.0.1' } });
  const { assets } = (await listRes.json()) as { assets: unknown[] };
  expect(assets).toHaveLength(0);
}, 20_000);
