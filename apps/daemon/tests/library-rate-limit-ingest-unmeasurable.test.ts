// Byte-volume cap for the clipper/token caller class of POST
// /api/library/ingest (C9-6 P0 control): `clipperIngestByteVolume`
// (routes/library.ts) sums `Buffer.byteLength(JSON.stringify(value), 'utf8')`
// over every counted field of the parsed body. `JSON.stringify` is
// implemented recursively in V8 and overflows the call stack on a deeply
// nested value well before `JSON.parse` does (the daemon's dedicated
// `/api/library/ingest` body-parser limit is 128mb -- server.ts -- with no
// depth limit), so a parser-valid body containing a sufficiently
// deep-nested field made the byte-volume counter itself throw instead of
// returning a number. That throw happened OUTSIDE the route's `try`/`catch`
// blocks and before `sendApiError` was reached, so Express's own error
// handling took the request instead of the mandated structured 413 --
// worse than the enumeration bypass this cap was built to close, because a
// caller could crash the accounting instead of merely being refused by it.
//
// The fix makes `clipperIngestByteVolume` a total function that never
// throws and fails CLOSED: any value it cannot measure (for any reason --
// the guard does not special-case RangeError) makes the function return
// `Infinity`, which the existing `payloadSize > CLIPPER_INGEST_MAX_BYTES`
// comparison and 413 response already handle -- no new refusal branch, no
// new error code, the same structured `ApiErrorResponse` shape the cap
// already returns for an ordinary oversized body.
//
// Kept in its own file for the same mechanical reason as the sidecar and
// registration files: library-rate-limit-ingest.test.ts's existing reject
// test is cited (control.testRef) with a red-evidence replay pinned to a
// parent commit that predates any byte-volume protection at all. A second,
// independently new failing test in that same file would also be red at
// that old parent, giving the replay two failed leaves instead of one and
// breaking the existing citation.
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
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-rl-ingest-unmeasurable-'));
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

// Builds the RAW JSON TEXT for a value nested `depth` levels deep, by
// string concatenation/`repeat` rather than by building a JS object graph
// and calling `JSON.stringify` on it -- `JSON.stringify` is exactly the
// recursive operation under test, so using it here to construct the request
// body would overflow the TEST's own call stack before the request is even
// sent. A real attacker has the same option (hand-built JSON text, or any
// non-recursive serializer): `JSON.parse` accepts this text (V8 tolerates
// far deeper nesting on parse than on stringify), so it reaches the route
// as an ordinary parsed object exactly like any other deeply-nested body.
function buildDeepNestedJsonText(depth: number): string {
  return '{"nested":'.repeat(depth) + '{"leaf":true}' + '}'.repeat(depth);
}

it('a clipper ingest payload accept while under the 5000000 byte limit with no deep-nested fields', async () => {
  const origin = extOrigin();
  const token = await mintToken(origin);
  const res = await fetch(`${baseUrl}/api/library/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: 'hi', metadata: { note: 'shallow' } }),
  });
  expect(res.status).toBe(200);
});

it('a clipper ingest payload whose byte volume cannot be measured (deep-nested field) is refused with a structured 413, not an unhandled throw', async () => {
  const origin = extOrigin();
  const token = await mintToken(origin);
  // Same reachable shape an independent review's Node 24 probe used: a
  // >5,000,000-byte `sourceTitle` alongside a 10,000-deep nested value in
  // another counted field. `JSON.parse` accepts this body; the byte-volume
  // counter's own `JSON.stringify(value)` on the deep field is what must
  // not be allowed to crash the handler.
  const sourceTitle = 'a'.repeat(5_000_001);
  const rawBody = `{"text":"hi","sourceTitle":"${sourceTitle}","metadata":${buildDeepNestedJsonText(10_000)}}`;
  const res = await fetch(`${baseUrl}/api/library/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: `Bearer ${token}` },
    body: rawBody,
  });
  expect(res.status).toBe(413);
  const body = (await res.json()) as { error?: { code?: string; message?: string } };
  expect(body.error?.code).toBe('PAYLOAD_TOO_LARGE');

  const listRes = await fetch(`${baseUrl}/api/library/assets`, { headers: { Host: '127.0.0.1' } });
  const { assets } = (await listRes.json()) as { assets: unknown[] };
  expect(assets).toHaveLength(0);
}, 20_000);
