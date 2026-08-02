// BUG-5: the Library asset list defaults to the 500 most-recent rows (hard
// max 1000) and used to return only `assets` — no total, no truncation
// signal — so every consumer (grid, picker, `od library list`) showed a
// partial set that looked complete. The store now reports the true matching
// count alongside the page, and the list response carries
// `{ assets, total, truncated }`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { closeDatabase, openDatabase } from '../src/db.js';
import {
  countLibraryAssets,
  insertLibraryAsset,
  listLibraryAssets,
} from '../src/library-store.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-trunc-'));
  db = openDatabase(dataDir, { dataDir });
});

afterEach(async () => {
  closeDatabase();
  await rm(dataDir, { recursive: true, force: true });
});

function seedAssets(count: number): void {
  const day = new Date('2024-03-05T12:00:00Z').getTime();
  for (let i = 0; i < count; i += 1) {
    insertLibraryAsset(db, {
      id: `asset-${String(i).padStart(4, '0')}`,
      kind: 'image',
      storage: 'owned',
      capturedAt: day + i,
      archivedDate: '2024-03-05',
      contentHash: `hash-${i}`,
      tags: [],
    });
  }
}

describe('countLibraryAssets', () => {
  it('reports the full matching count regardless of the page limit', () => {
    seedAssets(7);
    expect(countLibraryAssets(db)).toBe(7);
    expect(listLibraryAssets(db, { limit: 3 })).toHaveLength(3);
    // The count is not affected by limit — it answers "how many exist".
    expect(countLibraryAssets(db, { limit: 3 })).toBe(7);
  });

  it('applies the same filters as the list', () => {
    seedAssets(4);
    insertLibraryAsset(db, {
      id: 'asset-video',
      kind: 'video',
      storage: 'owned',
      capturedAt: Date.now(),
      archivedDate: '2024-03-06',
      contentHash: 'hash-video',
      tags: [],
    });
    expect(countLibraryAssets(db, { kind: 'video' })).toBe(1);
    expect(countLibraryAssets(db, { kind: 'image' })).toBe(4);
    expect(countLibraryAssets(db, { date: '2024-03-06' })).toBe(1);
  });
});
