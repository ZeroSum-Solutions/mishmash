// BUG-5: the Library asset list caps at 500 most-recent rows (hard max 1000)
// with no way to page past the cap and no truncation notice, so a library
// with more assets than the page size renders a partial set that looks
// complete. `total`/`truncated` (library-list-truncation.test.ts) let a
// caller DETECT truncation, but detecting it is not enough -- there was no
// `offset` (or any other paging) parameter, so a caller who *does* notice
// `truncated: true` still has no way to fetch the rest of the library. This
// spec proves the HTTP boundary now supports real pagination: repeated pages
// (respecting the existing 1000-row hard cap as the page-size ceiling) walk
// the whole matching set without gaps or duplicates, and that `truncated`
// stays honest across the edge cases a raw, unclamped offset would get wrong
// (unparsable offset, negative offset, offset past the end, the exact last
// page, and an empty store).
//
// Real transport throughout: a real booted daemon, real HTTP requests, no
// mocked fetch/db, per VERIFICATION-CONTRACT.md R2. Assets are seeded
// directly through the store (not one-by-one over HTTP) so seeding hundreds
// of rows stays fast and does not trip the ingest route's own rate limit.

import type http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, expect, it, vi } from 'vitest';

import { closeDatabase, openDatabase } from '../src/db.js';
import { insertLibraryAsset } from '../src/library-store.js';

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

const TOTAL_ASSETS = 1200;

type ListResponse = { assets: Array<{ id: string }>; total: number; truncated: boolean };

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

/** Seed `count` assets (0 is a valid, deliberate "empty store" case) then boot
 * a real daemon against the same data dir. Called at the top of each `it()`
 * — rather than a shared `beforeEach` — so each test picks its own library
 * size instead of all sharing one fixed seed. */
async function setup(count: number): Promise<void> {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-pagination-'));
  if (count > 0) seedAssets(count);
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
}

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

// Explicit per-test timeout: this is the heaviest case in the file (seeds
// 1200 rows in one transaction, boots a real daemon, then makes three
// sequential HTTP round trips), and the default 20s (vitest.config.ts) can be
// tight under load.
it('pages through the full matching set without gaps or duplicates, respecting the 1000-row page-size ceiling', async () => {
  await setup(TOTAL_ASSETS);

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
}, 45_000);

it('treats an unparsable offset as 0 instead of silently reporting truncated:false forever', async () => {
  await setup(TOTAL_ASSETS);

  // The regression this guards: the route used to compute
  // `offset = filter.offset ?? 0`, and `??` only substitutes on
  // null/undefined -- not NaN. `Number('abc')` is NaN, so a bad offset left
  // `offset` as NaN and `NaN + assets.length < total` is always false,
  // silently re-creating BUG-5 (an unparsable offset would report the page
  // as complete no matter how large the library actually is).
  const res = await fetch(`${baseUrl}/api/library/assets?limit=500&offset=abc`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as ListResponse;
  // The store must fall back to offset 0 for the query too (same clamp rule),
  // so this returns the first page, not an empty/broken one.
  expect(body.assets).toHaveLength(500);
  expect(body.total).toBe(TOTAL_ASSETS);
  expect(body.truncated).toBe(true);
});

it('clamps a negative offset to 0 instead of under-reporting truncated:true past the last row', async () => {
  const SMALL_TOTAL = 10;
  await setup(SMALL_TOTAL);

  // The regression this guards: the store already clamped its own query to
  // offset 0 for a negative input, but the route computed `truncated` from
  // the RAW (unclamped) offset. With offset=-5 and 10 rows returned, the raw
  // math is `-5 + 10 = 5 < 10` -> true, wrongly claiming more rows exist when
  // every row was already returned.
  const res = await fetch(`${baseUrl}/api/library/assets?limit=20&offset=-5`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as ListResponse;
  expect(body.assets).toHaveLength(SMALL_TOTAL);
  expect(body.total).toBe(SMALL_TOTAL);
  expect(body.truncated).toBe(false);
});

it('returns an empty page with truncated:false when the offset is past the end of the matching set', async () => {
  await setup(TOTAL_ASSETS);

  const res = await fetch(`${baseUrl}/api/library/assets?limit=500&offset=5000`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as ListResponse;
  expect(body.assets).toEqual([]);
  expect(body.total).toBe(TOTAL_ASSETS);
  expect(body.truncated).toBe(false);
});

it('reports truncated:false on the exact last (non-empty) page', async () => {
  const SMALL_TOTAL = 50;
  await setup(SMALL_TOTAL);

  // offset (20) + this page's rows (30) lands exactly on the total (50) --
  // the boundary case between "more to load" and "nothing left".
  const res = await fetch(`${baseUrl}/api/library/assets?limit=30&offset=20`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as ListResponse;
  expect(body.assets).toHaveLength(30);
  expect(body.total).toBe(SMALL_TOTAL);
  expect(body.truncated).toBe(false);
});

it('reports an empty, non-truncated page for an empty library', async () => {
  await setup(0);

  const res = await fetch(`${baseUrl}/api/library/assets`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as ListResponse;
  expect(body.assets).toEqual([]);
  expect(body.total).toBe(0);
  expect(body.truncated).toBe(false);
});

it('keeps pages gap-free and duplicate-free when many rows share the same archived_date + created_at', async () => {
  // A bulk sync/import batch (or, as here, many rows seeded in one
  // transaction) routinely lands multiple rows on the exact same
  // archived_date + created_at millisecond. `ORDER BY archived_date DESC,
  // created_at DESC` alone has no way to order a tied group, so which rows
  // land on which OFFSET page is undefined without a deterministic
  // tiebreaker -- two sequential page requests over an unchanged table could
  // duplicate or skip rows inside the tie. Force every seeded row onto the
  // identical archived_date + created_at (bulk UPDATE, since insertLibraryAsset
  // always stamps created_at from Date.now()) so this is guaranteed, not
  // merely likely.
  const TIED_COUNT = 40;
  await setup(TIED_COUNT);
  const db = openDatabase(dataDir, { dataDir });
  db.prepare(`UPDATE library_assets SET archived_date = ?, created_at = ?`).run(
    '2024-01-01',
    1_700_000_000_000,
  );
  closeDatabase();

  const page1Res = await fetch(`${baseUrl}/api/library/assets?limit=20`);
  expect(page1Res.status).toBe(200);
  const page1 = (await page1Res.json()) as ListResponse;
  const page2Res = await fetch(`${baseUrl}/api/library/assets?limit=20&offset=20`);
  expect(page2Res.status).toBe(200);
  const page2 = (await page2Res.json()) as ListResponse;

  expect(page1.assets).toHaveLength(20);
  expect(page2.assets).toHaveLength(20);
  const page1Ids = new Set(page1.assets.map((a) => a.id));
  const page2Ids = new Set(page2.assets.map((a) => a.id));
  const overlap = [...page2Ids].filter((id) => page1Ids.has(id));
  expect(overlap, `tied rows must not repeat across pages, but ${overlap.length} overlapped`).toEqual([]);
  const allIds = new Set([...page1Ids, ...page2Ids]);
  expect(allIds.size, 'the two pages must partition every tied row exactly once').toBe(TIED_COUNT);
});
