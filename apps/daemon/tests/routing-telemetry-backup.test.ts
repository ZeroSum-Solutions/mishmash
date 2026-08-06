// Backup-class inclusion for L5 telemetry (WR wave, P1 tranche --
// WR-routing.md's P1 section: "Telemetry rows live in that same SQLite
// database [as run_usage], so they are ALREADY in the backup set with zero
// code change.").
//
// This asserts that claim directly rather than trusting the doc: the
// routing_telemetry table lives in the exact same app.sqlite file
// `openDatabase(projectRoot, { dataDir })` opens (RUNTIME_DATA_DIR/
// app.sqlite), which apps/daemon/src/backup/create.ts's 'sqlite-database'
// archive class backs up via better-sqlite3's real online-backup API (never
// a raw file copy). No change to create.ts was needed or made for this --
// see the test below, which runs the REAL createBackupArchive against a
// data dir seeded with a routing_telemetry row and reads the row back out
// of the archived copy.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { closeDatabase, openDatabase } from '../src/db.js';
import { ensureRoutingTelemetryTable, recordRoutingTelemetry } from '../src/routing/telemetry.js';
import { createBackupArchive } from '../src/backup/create.js';
import { RELPATH_BY_CLASS } from '../src/backup/manifest.js';

let dataDir: string;
let archiveDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-backup-data-'));
  archiveDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-backup-archive-'));
});

afterEach(() => {
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(archiveDir, { recursive: true, force: true });
});

describe('routing telemetry table falls under the sqlite-database archive class', () => {
  it('a real backup archive contains the routing_telemetry table with its rows, via the existing sqlite-database class -- no ArchiveClass change needed', async () => {
    const db = openDatabase(dataDir, { dataDir });
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(db, {
      runId: 'run-backup-1',
      projectId: 'proj-1',
      attempt: 0,
      buildId: null,
      stage: 'chat',
      templateId: null,
      designSystem: null,
      routedModel: 'claude-sonnet-5',
      observedModel: 'claude-sonnet-5',
      routedLane: 'claude-code-oauth',
      observedLane: 'claude-code-oauth',
      tokens: { input: 10, output: 5, cacheReadInput: 0 },
      cacheHits: 0,
      latencyMs: 500,
      costUsd: 0.001,
      costEstimated: true,
      gateOutcomes: {},
      escalated: false,
      policyVersion: 1,
      createdAt: '2026-08-05T00:00:00.000Z',
      recordedAt: '2026-08-05T00:00:00.000Z',
    });
    // The 'sqlite-database' class runs a real SQLite online backup against
    // the file at RUNTIME_DATA_DIR/app.sqlite (create.ts); WAL mode means
    // recently-written pages must be checkpointed/visible to a fresh
    // read-only connection -- force that here the same way create.ts's own
    // reader does implicitly by opening a second connection.
    db.pragma('wal_checkpoint(FULL)');

    const result = await createBackupArchive({ dataDir, outPath: archiveDir });
    const sqliteEntry = result.manifest.find((e) => e.class === 'sqlite-database');
    expect(sqliteEntry).toBeDefined();

    const archivedDbPath = path.join(archiveDir, RELPATH_BY_CLASS['sqlite-database']);
    const archivedDb = new Database(archivedDbPath, { readonly: true, fileMustExist: true });
    try {
      const tableExists = (
        archivedDb
          .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'routing_telemetry'`)
          .get() as { n: number }
      ).n;
      expect(tableExists).toBe(1);

      const archivedRow = archivedDb
        .prepare(`SELECT run_id, routed_model, observed_model FROM routing_telemetry WHERE run_id = ?`)
        .get('run-backup-1') as { run_id: string; routed_model: string; observed_model: string } | undefined;
      expect(archivedRow).toEqual({
        run_id: 'run-backup-1',
        routed_model: 'claude-sonnet-5',
        observed_model: 'claude-sonnet-5',
      });
    } finally {
      archivedDb.close();
    }
  });
});
