import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  DesignLibraryPromotion,
  DesignLibraryPromotionGroup,
  DesignLibraryPromotionListStatus,
  PatchDesignLibraryPromotionRequest,
} from '@open-design/contracts';

type SqliteDb = Database.Database;

export class PromotionStoreError extends Error {
  constructor(
    readonly kind: 'not-found' | 'conflict',
    message: string,
  ) {
    super(message);
  }
}

export function migrateDesignLibraryPromotions(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS design_library_promotions (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_sha256 TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      asset_content_sha256 TEXT NOT NULL,
      proposed_group TEXT NOT NULL
        CHECK (proposed_group IN ('app-captures','site-capture','site-clone')),
      requester_note TEXT,
      status TEXT NOT NULL
        CHECK (status IN ('pending','claimed','succeeded','failed')),
      curator_id TEXT,
      lease_token_sha256 TEXT,
      lease_expires_at INTEGER,
      acknowledgement_sha256 TEXT,
      final_rel TEXT,
      source_sha256 TEXT,
      tree_sha256 TEXT,
      catalog_generation TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_design_library_promotions_status_created
      ON design_library_promotions(status, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_design_library_promotions_asset_created
      ON design_library_promotions(asset_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_design_library_promotions_lease
      ON design_library_promotions(lease_expires_at);
  `);
}

type PromotionRow = {
  id: string;
  assetId: string;
  assetContentSha256: string;
  proposedGroup: string;
  requesterNote: string | null;
  status: string;
  curatorId: string | null;
  leaseExpiresAt: number | null;
  finalRel: string | null;
  sourceSha256: string | null;
  treeSha256: string | null;
  catalogGeneration: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

const SELECT_COLUMNS = `
  id, asset_id AS assetId, asset_content_sha256 AS assetContentSha256,
  proposed_group AS proposedGroup, requester_note AS requesterNote, status,
  curator_id AS curatorId, lease_expires_at AS leaseExpiresAt,
  final_rel AS finalRel, source_sha256 AS sourceSha256,
  tree_sha256 AS treeSha256, catalog_generation AS catalogGeneration,
  error_code AS errorCode, error_message AS errorMessage,
  created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt`;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function toPromotion(row: PromotionRow, now: number): DesignLibraryPromotion {
  const promotion: DesignLibraryPromotion = {
    id: row.id,
    assetId: row.assetId,
    assetContentSha256: row.assetContentSha256,
    proposedGroup: row.proposedGroup as DesignLibraryPromotionGroup,
    status: row.status as DesignLibraryPromotion['status'],
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    claimable: row.status === 'pending'
      || (row.status === 'claimed' && row.leaseExpiresAt !== null && row.leaseExpiresAt <= now),
  };
  if (row.requesterNote !== null) promotion.requesterNote = row.requesterNote;
  if (row.curatorId !== null) promotion.curatorId = row.curatorId;
  if (row.leaseExpiresAt !== null) promotion.leaseExpiresAt = Number(row.leaseExpiresAt);
  if (row.completedAt !== null) promotion.completedAt = Number(row.completedAt);
  if (row.finalRel !== null) promotion.finalRel = row.finalRel;
  if (row.sourceSha256 !== null) promotion.sourceSha256 = row.sourceSha256;
  if (row.treeSha256 !== null) promotion.treeSha256 = row.treeSha256;
  if (row.catalogGeneration !== null) promotion.catalogGeneration = row.catalogGeneration;
  if (row.errorCode !== null && row.errorMessage !== null) {
    promotion.error = { code: row.errorCode, message: row.errorMessage };
  }
  return promotion;
}

function getRow(db: SqliteDb, id: string): PromotionRow | null {
  return (db.prepare(`SELECT ${SELECT_COLUMNS} FROM design_library_promotions WHERE id = ?`)
    .get(id) as PromotionRow | undefined) ?? null;
}

export function createDesignLibraryPromotion(
  db: SqliteDb,
  input: {
    assetId: string;
    assetContentSha256: string;
    proposedGroup: DesignLibraryPromotionGroup;
    requesterNote?: string;
    idempotencyKey: string;
  },
  now = Date.now(),
): { promotion: DesignLibraryPromotion; deduped: boolean } {
  const requestSha256 = sha256(canonical({
    assetId: input.assetId,
    proposedGroup: input.proposedGroup,
    requesterNote: input.requesterNote,
  }));
  const existing = db.prepare(
    `SELECT id, request_sha256 AS requestSha256 FROM design_library_promotions WHERE idempotency_key = ?`,
  ).get(input.idempotencyKey) as { id: string; requestSha256: string } | undefined;
  if (existing) {
    if (existing.requestSha256 !== requestSha256) {
      throw new PromotionStoreError('conflict', 'idempotency key was already used for a different request');
    }
    return { promotion: toPromotion(getRow(db, existing.id)!, now), deduped: true };
  }
  const id = randomUUID();
  try {
    db.prepare(`
      INSERT INTO design_library_promotions (
        id, idempotency_key, request_sha256, asset_id, asset_content_sha256,
        proposed_group, requester_note, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      id,
      input.idempotencyKey,
      requestSha256,
      input.assetId,
      input.assetContentSha256,
      input.proposedGroup,
      input.requesterNote ?? null,
      now,
      now,
    );
  } catch (error) {
    const winner = db.prepare(
      `SELECT id, request_sha256 AS requestSha256 FROM design_library_promotions WHERE idempotency_key = ?`,
    ).get(input.idempotencyKey) as { id: string; requestSha256: string } | undefined;
    if (winner) {
      if (winner.requestSha256 !== requestSha256) {
        throw new PromotionStoreError('conflict', 'idempotency key was already used for a different request');
      }
      return { promotion: toPromotion(getRow(db, winner.id)!, now), deduped: true };
    }
    throw error;
  }
  return { promotion: toPromotion(getRow(db, id)!, now), deduped: false };
}

export function listDesignLibraryPromotions(
  db: SqliteDb,
  status: DesignLibraryPromotionListStatus,
  limit: number,
  now = Date.now(),
): DesignLibraryPromotion[] {
  let where = '';
  const params: unknown[] = [];
  if (status === 'claimable') {
    where = `WHERE status = 'pending' OR (status = 'claimed' AND lease_expires_at <= ?)`;
    params.push(now);
  } else if (status !== 'all') {
    where = 'WHERE status = ?';
    params.push(status);
  }
  params.push(limit);
  const rows = db.prepare(`
    SELECT ${SELECT_COLUMNS}
    FROM design_library_promotions
    ${where}
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).all(...params) as PromotionRow[];
  return rows.map((item) => toPromotion(item, now));
}

export function claimDesignLibraryPromotion(
  db: SqliteDb,
  id: string,
  curatorId: string,
  leaseMs: number,
  now = Date.now(),
): { promotion: DesignLibraryPromotion; leaseToken: string } {
  return db.transaction(() => {
    if (!getRow(db, id)) throw new PromotionStoreError('not-found', 'promotion not found');
    const leaseToken = randomBytes(32).toString('base64url');
    const changed = db.prepare(`
      UPDATE design_library_promotions
      SET status = 'claimed', curator_id = ?, lease_token_sha256 = ?,
          lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND (
        status = 'pending' OR (status = 'claimed' AND lease_expires_at <= ?)
      )
    `).run(curatorId, sha256(leaseToken), now + leaseMs, now, id, now);
    if (changed.changes !== 1) {
      throw new PromotionStoreError('conflict', 'promotion is not claimable');
    }
    return { promotion: toPromotion(getRow(db, id)!, now), leaseToken };
  })();
}

export function acknowledgeDesignLibraryPromotion(
  db: SqliteDb,
  id: string,
  input: Extract<PatchDesignLibraryPromotionRequest, { action: 'acknowledge' }>,
  now = Date.now(),
): DesignLibraryPromotion {
  return db.transaction(() => {
    const auth = db.prepare(`
      SELECT status, lease_token_sha256 AS leaseTokenSha256,
             lease_expires_at AS leaseExpiresAt,
             acknowledgement_sha256 AS acknowledgementSha256,
             asset_content_sha256 AS assetContentSha256
      FROM design_library_promotions WHERE id = ?
    `).get(id) as {
      status: string;
      leaseTokenSha256: string | null;
      leaseExpiresAt: number | null;
      acknowledgementSha256: string | null;
      assetContentSha256: string;
    } | undefined;
    if (!auth) throw new PromotionStoreError('not-found', 'promotion not found');
    if (!auth.leaseTokenSha256 || sha256(input.leaseToken) !== auth.leaseTokenSha256) {
      throw new PromotionStoreError('conflict', 'lease token is invalid or no longer owns this claim');
    }
    const ackSha256 = sha256(canonical({ ...input, leaseToken: undefined }));
    if (auth.status === 'succeeded' || auth.status === 'failed') {
      if (auth.acknowledgementSha256 === ackSha256) return toPromotion(getRow(db, id)!, now);
      throw new PromotionStoreError('conflict', 'promotion was already acknowledged with a different result');
    }
    if (auth.status !== 'claimed') {
      throw new PromotionStoreError('conflict', 'promotion must be claimed before acknowledgement');
    }
    if (auth.leaseExpiresAt === null || auth.leaseExpiresAt <= now) {
      throw new PromotionStoreError('conflict', 'promotion lease has expired');
    }
    if (input.outcome === 'succeeded' && input.sourceSha256 !== auth.assetContentSha256) {
      throw new PromotionStoreError('conflict', 'source SHA-256 does not match the promoted asset snapshot');
    }
    const failed = input.outcome === 'failed';
    db.prepare(`
      UPDATE design_library_promotions
      SET status = ?, acknowledgement_sha256 = ?, final_rel = ?, source_sha256 = ?,
          tree_sha256 = ?, catalog_generation = ?, error_code = ?, error_message = ?,
          completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      failed ? 'failed' : 'succeeded',
      ackSha256,
      failed ? null : input.finalRel,
      input.sourceSha256 ?? null,
      input.treeSha256 ?? null,
      input.catalogGeneration ?? null,
      failed ? input.error.code : null,
      failed ? input.error.message : null,
      now,
      now,
      id,
    );
    return toPromotion(getRow(db, id)!, now);
  })();
}
