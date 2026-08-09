import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  acknowledgeDesignLibraryPromotion,
  claimDesignLibraryPromotion,
  createDesignLibraryPromotion,
  listDesignLibraryPromotions,
  migrateDesignLibraryPromotions,
  PromotionStoreError,
} from '../../src/design-library/promotions-store.js';

const HASH = 'a'.repeat(64);
const TREE = 'b'.repeat(64);
const GENERATION = `sha256:${'c'.repeat(64)}`;

function memoryDb(): Database.Database {
  const db = new Database(':memory:');
  migrateDesignLibraryPromotions(db);
  return db;
}

function create(db: Database.Database, key = 'key-1', now = 1000) {
  return createDesignLibraryPromotion(db, {
    assetId: 'asset-1',
    assetContentSha256: HASH,
    proposedGroup: 'app-captures',
    requesterNote: 'note',
    idempotencyKey: key,
  }, now);
}

describe('design library promotions store', () => {
  it('migrates idempotently and enforces exact idempotency replay', () => {
    const db = memoryDb();
    migrateDesignLibraryPromotions(db);
    expect(create(db).deduped).toBe(false);
    expect(create(db).deduped).toBe(true);
    expect(() => createDesignLibraryPromotion(db, {
      assetId: 'asset-2',
      assetContentSha256: HASH,
      proposedGroup: 'site-clone',
      idempotencyKey: 'key-1',
    }, 1001)).toThrow(PromotionStoreError);
    expect(listDesignLibraryPromotions(db, 'claimable', 100, 1001)).toHaveLength(1);
    db.close();
  });

  it('permits one claimant across database handles and reclaims an expired lease', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'od-promotions-store-'));
    const file = path.join(root, 'app.sqlite');
    const first = new Database(file);
    const second = new Database(file);
    first.pragma('journal_mode = WAL');
    second.pragma('journal_mode = WAL');
    migrateDesignLibraryPromotions(first);
    const promotion = create(first).promotion;
    const claim = claimDesignLibraryPromotion(first, promotion.id, 'curator-a', 30_000, 2_000);
    expect(() => claimDesignLibraryPromotion(second, promotion.id, 'curator-b', 30_000, 2_000))
      .toThrow(PromotionStoreError);
    const reclaimed = claimDesignLibraryPromotion(second, promotion.id, 'curator-b', 30_000, 32_001);
    expect(reclaimed.promotion.curatorId).toBe('curator-b');
    expect(() => acknowledgeDesignLibraryPromotion(first, promotion.id, {
      action: 'acknowledge',
      leaseToken: claim.leaseToken,
      outcome: 'failed',
      error: { code: 'OLD', message: 'old claimant' },
    }, 32_002)).toThrow(PromotionStoreError);
    first.close();
    second.close();
  });

  it('rejects expired acknowledgement and supports exact terminal replay', () => {
    const db = memoryDb();
    const promotion = create(db).promotion;
    const expired = claimDesignLibraryPromotion(db, promotion.id, 'curator-a', 30_000, 2_000);
    expect(() => acknowledgeDesignLibraryPromotion(db, promotion.id, {
      action: 'acknowledge',
      leaseToken: expired.leaseToken,
      outcome: 'failed',
      error: { code: 'LATE', message: 'late' },
    }, 32_000)).toThrow(/expired/);

    const current = claimDesignLibraryPromotion(db, promotion.id, 'curator-b', 30_000, 32_001);
    const success = {
      action: 'acknowledge' as const,
      leaseToken: current.leaseToken,
      outcome: 'succeeded' as const,
      finalRel: '02 App UI Captures/example',
      sourceSha256: HASH,
      treeSha256: TREE,
      catalogGeneration: GENERATION,
    };
    const completed = acknowledgeDesignLibraryPromotion(db, promotion.id, success, 32_002);
    expect(completed.status).toBe('succeeded');
    expect(acknowledgeDesignLibraryPromotion(db, promotion.id, success, 99_000)).toEqual(completed);
    expect(() => acknowledgeDesignLibraryPromotion(db, promotion.id, {
      ...success,
      finalRel: '02 App UI Captures/other',
    }, 99_001)).toThrow(/different result/);
    db.close();
  });

  it('requires success source hash to match the immutable asset snapshot', () => {
    const db = memoryDb();
    const promotion = create(db).promotion;
    const claim = claimDesignLibraryPromotion(db, promotion.id, 'curator', 30_000, 2_000);
    expect(() => acknowledgeDesignLibraryPromotion(db, promotion.id, {
      action: 'acknowledge',
      leaseToken: claim.leaseToken,
      outcome: 'succeeded',
      finalRel: '02 App UI Captures/example',
      sourceSha256: 'd'.repeat(64),
      treeSha256: TREE,
      catalogGeneration: GENERATION,
    }, 2_001)).toThrow(/snapshot/);
    db.close();
  });
});
