// Loopback gate for GET /api/library/events. Per this file's own documented
// split ("reads ride the daemon's loopback binding + same-origin middleware
// like the rest of /api"), this read previously had no route-level gate,
// relying entirely on the global /api origin middleware -- which allowlists
// a PAIRED extension origin for any method, even though only POST
// /api/library/ingest is a documented extension capability.
// requireLocalDaemonRequest closes that. No persisted mutation (impact floor
// 0), but still a read of live ingest activity. See docs/security/daemon-
// threat-model.md's Wave 9 section.
//
// Real transport throughout: a real booted daemon, real HTTP requests, no
// mocked fetch/db, per VERIFICATION-CONTRACT.md R2. Titles are flat (no
// describe() wrapper). Exactly two assertions in this file, deliberately --
// see docs/security/library-ingest-attribution.json and
// docs/security/library-ingest-red/get-library-events-rejects-a-non-loopback-origin.txt.

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
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-lg-events-'));
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

it('GET library events accepts a loopback request', async () => {
  const res = await fetch(`${baseUrl}/api/library/events`);
  expect(res.status).toBe(200);
  if (!res.body) throw new Error('events stream missing body');
  const reader = res.body.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value ?? new Uint8Array());
  expect(text).toContain('event: ready');
  await reader.cancel().catch(() => {});
});

it('GET library events rejects a non-loopback origin', async () => {
  const origin = extOrigin();
  await mintToken(origin);
  const res = await fetch(`${baseUrl}/api/library/events`, { headers: { Origin: origin } });
  expect(res.status).toBe(403);
});
