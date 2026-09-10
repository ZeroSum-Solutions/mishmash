// W8C item 4: `GET /api/library/assets/broken` surfaces the same rows
// `listBrokenReferencedAssets` already computes internally (`WHERE storage =
// 'referenced' AND broken = 1`) -- previously only reachable from the
// reconcile pass's own self-heal loop, with no route or CLI exposing the
// list. RED on base: the route does not exist (404). GREEN on branch: 200
// with the seeded asset in `assets`.
//
// Real transport throughout: a real booted daemon, real HTTP requests, no
// mocked fetch/db -- matches the sibling library route test files
// (`library-project-delete-materialize.test.ts`, `library-rate-limit-assets-list.test.ts`).
import type http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { closeDatabase, openDatabase } from '../src/db.js';
import { insertLibraryAsset, markLibraryAssetBroken } from '../src/library-store.js';

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

const BROKEN_ASSET_ID = 'broken-list-asset-1';
const HEALTHY_ASSET_ID = 'healthy-list-asset-1';

async function seedAssets(): Promise<void> {
  const db = openDatabase(dataDir, { dataDir });
  const now = Date.now();
  insertLibraryAsset(db, {
    id: BROKEN_ASSET_ID,
    kind: 'image',
    storage: 'referenced',
    capturedAt: now,
    archivedDate: '2024-05-01',
    contentHash: 'broken-list-hash-1',
    tags: [],
    originProjectId: 'ghost-project-does-not-exist',
    relPath: 'render.png',
    mime: 'image/png',
  });
  markLibraryAssetBroken(db, BROKEN_ASSET_ID, now);
  insertLibraryAsset(db, {
    id: HEALTHY_ASSET_ID,
    kind: 'image',
    storage: 'owned',
    capturedAt: now,
    archivedDate: '2024-05-01',
    contentHash: 'healthy-list-hash-1',
    tags: [],
    relPath: 'healthy.png',
    mime: 'image/png',
  });
  closeDatabase();
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-broken-list-'));
  await seedAssets();

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

it('GET /api/library/assets/broken returns only the broken referenced rows', async () => {
  const res = await fetch(`${baseUrl}/api/library/assets/broken`);
  expect(res.status).toBe(200);
  const body = await res.json() as { assets: Array<{ id: string }>; total: number; truncated: boolean };
  expect(body.assets.map((a) => a.id)).toEqual([BROKEN_ASSET_ID]);
  expect(body.total).toBe(1);
  expect(body.truncated).toBe(false);
});

it('does not let /broken fall through to the :id route (route-ordering hazard)', async () => {
  // If `/broken` were registered after `GET /api/library/assets/:id`, Express
  // would match `:id = "broken"` there instead -- a 404 "asset not found",
  // not the broken-list response. Asserting the shape (an `assets` array)
  // rather than just a 200 pins that this really is the new route.
  const res = await fetch(`${baseUrl}/api/library/assets/broken`);
  const body = await res.json() as Record<string, unknown>;
  expect(Array.isArray(body.assets)).toBe(true);
});
