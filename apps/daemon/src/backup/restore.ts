// Backup restore: verifies archive integrity per class (never trusts an
// unverified copy), then promotes the verified payload into a data
// directory. Every failure names the specific corrupted class so a caller
// (CLI or HTTP) can report exactly what broke -- see RestoreError.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALL_ARCHIVE_CLASSES,
  CHECKSUMS_RELPATH_BY_CLASS,
  isDirEntry,
  MANIFEST_FILENAME,
  MANIFEST_HASH_FILENAME,
  RELPATH_BY_CLASS,
  type ArchiveClass,
  type ArchiveManifestEntry,
} from './manifest.js';
import { promoteIntoPlace, sha256Bytes, sha256File, verifyDirChecksums } from './fs-helpers.js';

export class RestoreError extends Error {
  readonly corruptedClass: string;
  constructor(corruptedClass: string, message: string) {
    super(message);
    this.name = 'RestoreError';
    this.corruptedClass = corruptedClass;
  }
}

export interface RestoreOptions {
  archivePath: string;
  /** Destination data directory. Restoring into a non-fresh root is refused. */
  dataDir: string;
}

export interface RestoreResult {
  ok: true;
  restoredClasses: string[];
  destination: string;
}

function readManifestEntries(archivePath: string): ArchiveManifestEntry[] {
  const manifestPath = path.join(archivePath, MANIFEST_FILENAME);
  const hashPath = path.join(archivePath, MANIFEST_HASH_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    throw new RestoreError('manifest-entry', `corrupted archive entry: class "manifest-entry" -- ${MANIFEST_FILENAME} is missing from the archive`);
  }
  const manifestBytes = fs.readFileSync(manifestPath);
  const recordedHash = fs.existsSync(hashPath) ? fs.readFileSync(hashPath, 'utf8').trim() : null;
  const actualHash = sha256Bytes(manifestBytes);
  if (!recordedHash || actualHash !== recordedHash) {
    throw new RestoreError(
      'manifest-entry',
      `corrupted archive entry: class "manifest-entry" -- ${MANIFEST_FILENAME} failed its integrity check (expected sha256 ${recordedHash ?? '<missing>'}, got ${actualHash})`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestBytes.toString('utf8'));
  } catch (err) {
    throw new RestoreError('manifest-entry', `corrupted archive entry: class "manifest-entry" -- ${MANIFEST_FILENAME} is not valid JSON: ${String(err)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new RestoreError('manifest-entry', `corrupted archive entry: class "manifest-entry" -- ${MANIFEST_FILENAME} top level must be an array`);
  }
  return toKnownArchiveEntries(parsed);
}

/**
 * Every path this engine reads from or writes to during a restore is a lookup
 * in a fixed class -> path map, never a join with manifest text.
 *
 * The manifest is attacker-controlled input, not a trusted self-report: the
 * caller supplies `archivePath`, so anything able to write a directory and
 * reach the daemon controls both the payload and the recorded checksums, and
 * the sha256 pass only proves the archive agrees with itself. An entry is
 * therefore accepted only when it names a class this engine actually writes
 * and records exactly that class's canonical paths -- and the accepted entry
 * is rebuilt from the map rather than carried through, so a traversal-shaped
 * `relPath` or `class` cannot reach `path.resolve`, `path.join`, or
 * `promoteIntoPlace`'s `rmSync`/`renameSync`.
 */
function toKnownArchiveEntries(parsed: unknown[]): ArchiveManifestEntry[] {
  const reject = (detail: string): never => {
    throw new RestoreError('manifest-entry', `corrupted archive entry: class "manifest-entry" -- ${detail}`);
  };
  return parsed.map((raw) => {
    const candidate = (raw ?? {}) as Partial<Record<'class' | 'relPath' | 'sha256' | 'checksumsRelPath', unknown>>;
    const archiveClass = candidate.class;
    if (typeof archiveClass !== 'string' || !(ALL_ARCHIVE_CLASSES as readonly string[]).includes(archiveClass)) {
      reject(`${MANIFEST_FILENAME} names an unknown archive class ${JSON.stringify(archiveClass)}`);
    }
    const known = archiveClass as ArchiveClass;
    const relPath = RELPATH_BY_CLASS[known];
    if (candidate.relPath !== relPath) {
      reject(`class "${known}" must record relPath "${relPath}", got ${JSON.stringify(candidate.relPath)}`);
    }
    // A class has a checksum index exactly when it is a directory class.
    const checksumsRelPath = CHECKSUMS_RELPATH_BY_CLASS[known];
    if (checksumsRelPath === undefined) {
      if (typeof candidate.sha256 !== 'string' || candidate.sha256.length === 0) {
        reject(`class "${known}" must record a sha256, got ${JSON.stringify(candidate.sha256)}`);
      }
      return { class: known, relPath, sha256: candidate.sha256 as string };
    }
    if (candidate.checksumsRelPath !== checksumsRelPath) {
      reject(`class "${known}" must record checksumsRelPath "${checksumsRelPath}", got ${JSON.stringify(candidate.checksumsRelPath)}`);
    }
    return { class: known, relPath, checksumsRelPath };
  });
}

/** Verifies every entry's recorded checksum(s) against the archive's own on-disk bytes. Throws RestoreError naming the first corrupted class. */
function verifyArchiveIntegrity(archivePath: string, entries: ArchiveManifestEntry[]): void {
  for (const entry of entries) {
    const absPath = path.resolve(archivePath, entry.relPath);
    if (isDirEntry(entry)) {
      const checksumsPath = path.join(archivePath, entry.checksumsRelPath);
      if (!fs.existsSync(checksumsPath)) {
        throw new RestoreError(entry.class, `corrupted archive entry: class "${entry.class}" -- checksum index missing (${entry.checksumsRelPath})`);
      }
      let checksums: Record<string, string>;
      try {
        checksums = JSON.parse(fs.readFileSync(checksumsPath, 'utf8'));
      } catch (err) {
        throw new RestoreError(entry.class, `corrupted archive entry: class "${entry.class}" -- checksum index is not valid JSON: ${String(err)}`);
      }
      const problems = verifyDirChecksums(absPath, checksums);
      if (problems.length > 0) {
        throw new RestoreError(entry.class, `corrupted archive entry: class "${entry.class}" failed integrity check -- ${problems.slice(0, 5).join('; ')}`);
      }
    } else {
      if (!fs.existsSync(absPath)) {
        throw new RestoreError(entry.class, `corrupted archive entry: class "${entry.class}" -- file missing at ${entry.relPath}`);
      }
      const actualHash = sha256File(absPath);
      if (actualHash !== entry.sha256) {
        throw new RestoreError(entry.class, `corrupted archive entry: class "${entry.class}" failed integrity check (expected sha256 ${entry.sha256}, got ${actualHash})`);
      }
    }
  }
}

/** True when `dataDir` already holds a real payload (an existing app.sqlite), i.e. restore-to-fresh-root would silently overwrite user state. */
function dataDirHasExistingPayload(dataDir: string): boolean {
  const dbPath = path.join(dataDir, 'app.sqlite');
  if (!fs.existsSync(dbPath)) return false;
  // A daemon that has merely BOOTED against this dataDir (never received a
  // real HTTP restore call yet) already created an empty, migrated
  // app.sqlite as a side effect of opening it -- exactly the shape the
  // POST /api/restore route's own caller is in (it has to boot a daemon to
  // receive the HTTP call at all). Mere file existence is too strict a
  // freshness check; what actually matters is whether real project rows
  // exist yet.
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number } | undefined;
      return (row?.n ?? 0) > 0;
    } finally {
      db.close();
    }
  } catch {
    // Unreadable/unmigrated/corrupt -- treat conservatively as "has a
    // payload" rather than silently restoring over unknown state.
    return true;
  }
}

export async function restoreBackupArchive(options: RestoreOptions): Promise<RestoreResult> {
  const { archivePath, dataDir } = options;
  if (!fs.existsSync(archivePath)) {
    throw new RestoreError('archive', `archive not found at ${archivePath}`);
  }
  if (dataDirHasExistingPayload(dataDir)) {
    throw new RestoreError('destination-not-fresh', `restore refuses to overwrite an existing payload at ${dataDir} -- restore into a fresh data root`);
  }

  const entries = readManifestEntries(archivePath);
  verifyArchiveIntegrity(archivePath, entries);

  // All entries verified clean -- promote each into place via a staging
  // subdirectory of the destination so the rename is same-filesystem
  // whenever possible (see fs-helpers.promoteIntoPlace for the EXDEV
  // fallback).
  fs.mkdirSync(dataDir, { recursive: true });
  const stagingRoot = fs.mkdtempSync(path.join(dataDir, '.restore-staging-'));
  const restoredClasses: string[] = [];
  try {
    for (const entry of entries) {
      const srcAbs = path.resolve(archivePath, entry.relPath);
      const stagedAbs = path.join(stagingRoot, entry.class);
      fs.cpSync(srcAbs, stagedAbs, { recursive: true });
      // Every entry's relPath is "data/<destination-relative-path>" (see
      // manifest.ts RELPATH_BY_CLASS) -- strip the "data/" prefix to get the
      // path relative to the destination data directory itself.
      const destRelToDataDir = entry.relPath.startsWith('data/') ? entry.relPath.slice('data/'.length) : entry.relPath;
      const destAbs = path.join(dataDir, destRelToDataDir);
      promoteIntoPlace(stagedAbs, destAbs);
      restoredClasses.push(entry.class);
    }
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }

  // A freshly-created (pre-restore) app.sqlite may have left WAL/SHM
  // sidecars whose checkpoint sequence no longer matches the restored
  // database file. Stale sidecars next to a swapped-in main file are exactly
  // the kind of state SQLite's recovery path is not meant to reconcile, so
  // clear them explicitly rather than trust a partial checkpoint.
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = path.join(dataDir, `app.sqlite${suffix}`);
    fs.rmSync(sidecar, { force: true });
  }

  return { ok: true, restoredClasses, destination: dataDir };
}
