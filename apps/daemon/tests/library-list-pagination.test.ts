// BUG-5: the Library asset list caps at 500 most-recent rows (hard max 1000)
// with no way to page past the cap and no truncation notice, so a library
// with more assets than the page size renders a partial set that looks
// complete. `total`/`truncated` (library-list-truncation.test.ts) let a
// caller DETECT truncation, but detecting it is not enough -- there was no
// `offset` (or any other paging) parameter, so a caller who *does* notice
// `truncated: true` still has no way to fetch the rest of the library. This
// spec proves the HTTP boundary now supports real pagination: repeated pages
// (respecting the existing 1000-row hard cap as the page-size ceiling) walk
// the whole matching set without gaps or duplicates.
//
// Real transport throughout: a real booted daemon, real HTTP requests, no
// mocked fetch/db, per VERIFICATION-CONTRACT.md R2. Assets are seeded
// directly through the store (not one-by-one over HTTP) so seeding 1200+ rows
// stays fast and does not trip the ingest route's own rate limit.

import type http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { closeDatabase, openDatabase } from '../src/db.js';
import { insertLibraryAsset } from '../src/library-store.js';

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

const TOTAL_ASSETS = 1200;

function seedAssets(count: number): void {
  const db = openDatabase(dataDir, { dataDir });
  const day = new Date('2024-03-05T12:00:00Z').getTime();
  const insertMany = db.transaction((n: number) => {
    for (let i = 0; i < n; i += 1) {
      insertLibraryAsset(db, {
        id: `page-asset-${String(i).padStart(4, '0')}`,
        kind: 'image',
        storage: 'owned',
        // Ascending capturedAt with a fixed archivedDate/created_at tiebreak
        // order (insertion order) so `ORDER BY archived_date DESC, created_at
        // DESC` — the list's real order — is deterministic across pages.
        capturedAt: day + i,
        archivedDate: '2024-03-05',
        contentHash: `page-hash-${i}`,
        tags: [],
      });
    }
  });
  insertMany(count);
  closeDatabase();
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-pagination-'));
  seedAssets(TOTAL_ASSETS);
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

it('pages through the full matching set without gaps or duplicates, respecting the 1000-row page-size ceiling', async () => {
  type ListResponse = { assets: Array<{ id: string }>; total: number; truncated: boolean };

  const page1Res = await fetch(`${baseUrl}/api/library/assets?limit=500`);
  expect(page1Res.status).toBe(200);
  const page1 = (await page1Res.json()) as ListResponse;
  expect(page1.assets).toHaveLength(500);
  expect(page1.total).toBe(TOTAL_ASSETS);
  expect(page1.truncated).toBe(true);

  // The bug: `offset` was not a recognized filter, so a second "page" request
  // silently returned the exact same top-500 rows as page 1 instead of the
  // next slice -- there was no way to actually reach the rest of the library.
  const page2Res = await fetch(`${baseUrl}/api/library/assets?limit=500&offset=500`);
  expect(page2Res.status).toBe(200);
  const page2 = (await page2Res.json()) as ListResponse;
  expect(page2.assets).toHaveLength(500);
  expect(page2.total).toBe(TOTAL_ASSETS);
  expect(page2.truncated).toBe(true);

  const page1Ids = new Set(page1.assets.map((a) => a.id));
  const page2Ids = new Set(page2.assets.map((a) => a.id));
  const overlap = [...page2Ids].filter((id) => page1Ids.has(id));
  expect(overlap, `page 2 must not repeat page 1's rows, but ${overlap.length} ids overlapped`).toEqual([]);

  // A limit above the documented hard max (1000) must still clamp there --
  // paging must not become a backdoor around the page-size ceiling.
  const oversizedRes = await fetch(`${baseUrl}/api/library/assets?limit=5000&offset=1000`);
  expect(oversizedRes.status).toBe(200);
  const page3 = (await oversizedRes.json()) as ListResponse;
  expect(page3.assets.length).toBeLessThanOrEqual(1000);
  // The last page: offset (1000) + this page's rows (200) reaches the total,
  // so nothing is left to truncate.
  expect(page3.assets).toHaveLength(TOTAL_ASSETS - 1000);
  expect(page3.truncated).toBe(false);

  // Walking every page (respecting the ceiling) reaches every seeded asset
  // exactly once -- the whole point of real pagination over a silent cap.
  const allIds = new Set([...page1Ids, ...page2Ids, ...page3.assets.map((a) => a.id)]);
  expect(allIds.size).toBe(TOTAL_ASSETS);
});
