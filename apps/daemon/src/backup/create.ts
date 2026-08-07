// Backup creation: snapshots RUNTIME_DATA_DIR into a self-contained archive
// directory. See manifest.ts for the archive layout and docs/security/
// backup-secret-inventory.json for what is excluded and why.
//
// The SQLite class always goes through better-sqlite3's `.backup()` (the
// real SQLite online-backup API -- a page-level, WAL-safe copy performed by
// the SQLite engine itself), never a raw `fs.copyFile` of app.sqlite. That is
// what makes the snapshot atomic under concurrent writers: the backup API
// reads a consistent view of the database as of the moment it starts,
// regardless of writes landing on the source connection while it runs.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALL_ARCHIVE_CLASSES,
  ARCHIVE_DIR_CLASSES,
  CHECKSUMS_RELPATH_BY_CLASS,
  MANIFEST_FILENAME,
  MANIFEST_HASH_FILENAME,
  RELPATH_BY_CLASS,
  type ArchiveManifestEntry,
} from './manifest.js';
import { copyDirWithChecksums, sha256Bytes, sha256File } from './fs-helpers.js';
import { currentRoutingPolicyVersion } from '../routing/policy.js';

export interface CreateBackupOptions {
  /** The daemon's resolved RUNTIME_DATA_DIR (never a raw OD_DATA_DIR -- callers resolve first). */
  dataDir: string;
  /** Destination archive root. Must not already exist (or must be empty). */
  outPath: string;
}

export interface CreateBackupResult {
  archivePath: string;
  manifest: ArchiveManifestEntry[];
}

/** BYOK provider-key material embedded in app-config.json. Stripped before the config is archived -- see the "byok-keys" excluded class. */
const APP_CONFIG_BYOK_KEYS = ['agentCliEnv', 'agentCliEnvIntent'] as const;

/**
 * Which routing-policy generation produced this archive (WR wave, CWR-P1-3).
 * The archived `routing_telemetry` rows are only interpretable against the
 * policy that emitted them, so the archive has to say which one that was.
 *
 * A policy problem must never fail a backup -- recovery is exactly the moment
 * the rest of the system is untrustworthy -- so a throwing loader degrades to
 * `null` ("unavailable") instead of aborting the snapshot.
 */
function archivedRoutingPolicyVersion(): number | null {
  try {
    return currentRoutingPolicyVersion();
  } catch (error) {
    // Logged, never swallowed: `null` is also the legitimate "policy version
    // unavailable" marker value, so without this line an operator inspecting a
    // restored archive could not tell a broken policy document apart from the
    // intended semantics.
    console.error('[backup] routing policy version unavailable; archiving null marker', error);
    return null;
  }
}

/**
 * In-band diagnostic written into the ARCHIVED app-config when the live file
 * could not be parsed (Amendment 2, item 4). It is deliberately not an
 * `AppConfigPrefs` key, so `filterAllowedKeys` drops it the moment a restored
 * config is read -- it is a message to the operator reading the archive, never
 * state the daemon consumes.
 */
const APP_CONFIG_UNPARSEABLE_MARKER = {
  code: 'APP_CONFIG_UNPARSEABLE',
  message:
    'The live app-config.json was unparseable when this archive was created; preferences were not archived.',
} as const;

/**
 * A parse failure reduced to the parts that cannot carry secrets.
 *
 * V8's JSON `SyntaxError` messages quote a window of the offending source --
 * e.g. `Unexpected token 's', ..."_API_KEY":sk-live-ab"... is not valid JSON`.
 * app-config.json is exactly the file that holds BYOK provider keys, so that
 * window can contain a credential prefix and the message must never be logged
 * verbatim (GPT-5.6 Sol adversarial review, P2). The error's name and byte
 * offset are the genuinely useful parts for an operator repairing the file by
 * hand, and neither can echo file content.
 */
function redactedParseFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown parse failure';
  const offset = /position (\d+)/.exec(error.message)?.[1];
  return offset === undefined ? error.name : `${error.name} at position ${offset}`;
}

function redactAppConfig(raw: string): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    // Never silent, and never `{}`: an empty object is indistinguishable from a
    // legitimately empty config, so the operator would discover the loss during
    // a restore -- the one moment they are relying on this file. The archive
    // carries the marker because the daemon logs from the machine that produced
    // a months-old archive are typically long gone by then.
    //
    // The raw source is NOT copied in, and the exception is NOT logged
    // verbatim: V8's JSON errors quote a window of the offending source, which
    // in this file can be a BYOK provider key. Only the redacted name/offset
    // goes anywhere -- neither the archive nor the log sees file content.
    console.error(
      '[backup] app-config.json is unparseable; archiving a diagnostic marker',
      redactedParseFailure(error),
    );
    return JSON.stringify(
      { __mishmashBackupError: APP_CONFIG_UNPARSEABLE_MARKER, routingPolicyVersion: archivedRoutingPolicyVersion() },
      null,
      2,
    );
  }
  const clone = { ...parsed };
  for (const key of APP_CONFIG_BYOK_KEYS) delete clone[key];
  clone.routingPolicyVersion = archivedRoutingPolicyVersion();
  return JSON.stringify(clone, null, 2);
}

export async function createBackupArchive(options: CreateBackupOptions): Promise<CreateBackupResult> {
  const { dataDir, outPath } = options;
  fs.mkdirSync(outPath, { recursive: true });
  const dataOut = path.join(outPath, 'data');
  const checksumsOut = path.join(outPath, 'checksums');
  fs.mkdirSync(dataOut, { recursive: true });
  fs.mkdirSync(checksumsOut, { recursive: true });

  const entries: ArchiveManifestEntry[] = [];

  // ---- sqlite-database: real SQLite online backup, never a file copy ----
  const sourceDbPath = path.join(dataDir, 'app.sqlite');
  const destDbPath = path.join(outPath, RELPATH_BY_CLASS['sqlite-database']);
  fs.mkdirSync(path.dirname(destDbPath), { recursive: true });
  if (fs.existsSync(sourceDbPath)) {
    const sourceDb = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
    try {
      await sourceDb.backup(destDbPath);
    } finally {
      sourceDb.close();
    }
  } else {
    // No database has ever been created in this data dir. Back up an empty
    // (but real, valid) database so the class is still genuinely present.
    const empty = new Database(destDbPath);
    empty.close();
  }
  entries.push({ class: 'sqlite-database', relPath: RELPATH_BY_CLASS['sqlite-database'], sha256: sha256File(destDbPath) });

  // ---- directory classes: copy + per-file checksum index ----
  const dirSourceByClass: Record<'projects-dir' | 'library-assets' | 'memory-markdown' | 'covers', string> = {
    'projects-dir': path.join(dataDir, 'projects'),
    'library-assets': path.join(dataDir, 'library'),
    'memory-markdown': path.join(dataDir, 'memory'),
    // W4 — RUNTIME_DATA_DIR/covers (see apps/daemon/src/covers/store.ts).
    // A persisted artifact class the archive did not know about before was
    // a silent recovery gap: nobody would notice until a restore came back
    // with blank cards (S4-7 / C4-11).
    covers: path.join(dataDir, 'covers'),
  };
  for (const cls of ARCHIVE_DIR_CLASSES) {
    const destRel = RELPATH_BY_CLASS[cls];
    const destAbs = path.join(outPath, destRel);
    const checksums = copyDirWithChecksums(dirSourceByClass[cls], destAbs);
    const checksumsRelPath = CHECKSUMS_RELPATH_BY_CLASS[cls]!;
    fs.writeFileSync(path.join(outPath, checksumsRelPath), JSON.stringify(checksums, null, 2));
    entries.push({ class: cls, relPath: destRel, checksumsRelPath });
  }

  // ---- app-config: archived, but with BYOK provider keys stripped ----
  const sourceConfigPath = path.join(dataDir, 'app-config.json');
  const destConfigPath = path.join(outPath, RELPATH_BY_CLASS['app-config']);
  const rawConfig = fs.existsSync(sourceConfigPath) ? fs.readFileSync(sourceConfigPath, 'utf8') : '{}';
  const redacted = redactAppConfig(rawConfig);
  fs.writeFileSync(destConfigPath, redacted);
  entries.push({ class: 'app-config', relPath: RELPATH_BY_CLASS['app-config'], sha256: sha256Bytes(redacted) });

  // Sanity: every class this engine claims to write is actually present.
  const writtenClasses = new Set(entries.map((e) => e.class));
  for (const cls of ALL_ARCHIVE_CLASSES) {
    if (!writtenClasses.has(cls)) throw new Error(`internal error: backup engine did not write required class "${cls}"`);
  }

  const manifestJson = JSON.stringify(entries, null, 2);
  fs.writeFileSync(path.join(outPath, MANIFEST_FILENAME), manifestJson);
  fs.writeFileSync(path.join(outPath, MANIFEST_HASH_FILENAME), sha256Bytes(manifestJson));

  return { archivePath: outPath, manifest: entries };
}
