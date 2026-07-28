// Revoke / rotate for OD Library capability tokens (the browser-extension
// pairing tokens minted by apps/daemon/src/library-tokens.ts).
//
// library-tokens.ts / library-store.ts own the `library_tokens` table and
// its mint/find/touch/list operations, but neither exposes a delete --
// revocation and rotation are new lifecycle operations this wave adds. Both
// files sit outside this wave's write lease (docs/plans/waves/leases.json,
// W0 grants apps/daemon/src/security/** and apps/daemon/src/routes/
// library.ts specifically, not library-tokens.ts/library-store.ts), so this
// module operates on the existing `library_tokens` schema directly via raw
// SQL rather than adding exports to those files -- the same pattern
// apps/daemon/src/routes/daemon.ts already uses for read-only queries
// against tables it doesn't own (`SELECT COUNT(*) FROM installed_plugins`).
//
// No schema change is needed: revocation is row deletion (possession of a
// deleted token's string is worthless -- validateLibraryToken looks the
// hash up by primary key and finds nothing), and rotation is
// delete-old-insert-new inside one identity (same extension_origin/label),
// so the old token is provably dead the instant the new one exists.

import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';

type SqliteDb = Database.Database;

interface LibraryTokenRow {
  tokenHash: string;
  label: string;
  extensionOrigin: string;
  createdAt: number;
  lastUsedAt: number;
}

/** Mirrors the private `tokenHash()` in library-tokens.ts -- same algorithm (sha256 hex), so hashes computed here and there are interchangeable against the same `library_tokens.token_hash` column. */
export function hashLibraryToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function findByHash(db: SqliteDb, tokenHash: string): LibraryTokenRow | null {
  const raw = db
    .prepare(
      `SELECT token_hash AS tokenHash, label, extension_origin AS extensionOrigin,
              created_at AS createdAt, last_used_at AS lastUsedAt
         FROM library_tokens WHERE token_hash = ?`,
    )
    .get(tokenHash) as LibraryTokenRow | undefined;
  return raw ?? null;
}

export interface RevokeResult {
  revoked: boolean;
}

/** Deletes the row for `tokenHash`. Idempotent: revoking an already-gone token is not an error. */
export function revokeLibraryTokenByHash(db: SqliteDb, tokenHash: string): RevokeResult {
  const info = db.prepare('DELETE FROM library_tokens WHERE token_hash = ?').run(tokenHash);
  return { revoked: info.changes > 0 };
}

export type RotateResult = { ok: true; token: string } | { ok: false; error: string };

/** Deletes the row at `oldTokenHash` and inserts a fresh token bound to the SAME identity (extension_origin, label). The old token is dead as soon as this returns -- there is no window where both are simultaneously valid. */
export function rotateLibraryToken(db: SqliteDb, oldTokenHash: string): RotateResult {
  const existing = findByHash(db, oldTokenHash);
  if (!existing) return { ok: false, error: 'token not found' };
  const newToken = `odlt_${randomBytes(32).toString('base64url')}`;
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM library_tokens WHERE token_hash = ?').run(oldTokenHash);
    db.prepare(
      `INSERT OR REPLACE INTO library_tokens (token_hash, label, extension_origin, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(hashLibraryToken(newToken), existing.label, existing.extensionOrigin, now, now);
  });
  tx();
  return { ok: true, token: newToken };
}
