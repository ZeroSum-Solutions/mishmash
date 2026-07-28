// Backup/restore engine (apps/daemon/src/backup/{create,restore}.ts).
//
// Exercises the REAL SQLite online-backup API and real filesystem copies
// against a real booted daemon's data directory -- no mocked transport, per
// VERIFICATION-CONTRACT.md R2. Covers: round-trip fidelity (C0-1), atomicity
// under a concurrent writer (C0-2), per-class corruption detection (C0-3),
// and secret exclusion (C0-4).

import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { register } from 'prom-client';
import Database from 'better-sqlite3';
import { createBackupArchive } from '../src/backup/create.js';
import { restoreBackupArchive, RestoreError } from '../src/backup/restore.js';

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-src-'));
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
  // server.ts pins RUNTIME_DATA_DIR (and every dependent path) as a
  // module-top-level const computed from process.env.OD_DATA_DIR at first
  // import. Without resetting the module registry, every subsequent test in
  // this file would get the SAME cached module -- i.e. the FIRST test's data
  // directory -- regardless of what OD_DATA_DIR is reassigned to. Mirrors
  // tests/project-design-system-copy.test.ts's afterEach. register.clear()
  // first: re-importing metrics/index.ts re-registers its prom-client
  // Counters/Gauges/Histograms against the (process-global, NOT reset by
  // vi.resetModules()) default registry, which throws on the second import
  // ("already registered") unless the registry is cleared first.
  register.clear();
  vi.resetModules();
});

interface SeededProject {
  id: string;
  files: { name: string; content: string }[];
}

async function seedProjects(count: number, filesPerProject: number): Promise<SeededProject[]> {
  const projects: SeededProject[] = [];
  for (let p = 0; p < count; p++) {
    const id = `bkp-proj-${p}-${Math.random().toString(36).slice(2)}`;
    await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: id }),
    });
    const files: { name: string; content: string }[] = [];
    const form = new FormData();
    for (let f = 0; f < filesPerProject; f++) {
      const name = `file-${p}-${f}.txt`;
      const content = `content-${p}-${f}-${Math.random().toString(36).slice(2)}`;
      form.append('files', new Blob([content], { type: 'text/plain' }), name);
      files.push({ name, content });
    }
    await fetch(`${baseUrl}/api/projects/${id}/upload`, { method: 'POST', body: form });
    projects.push({ id, files });
  }
  return projects;
}

describe('backup/restore engine', () => {
  it('round-trips real projects: restored DB rows resolve to byte-identical files via HTTP (C0-1)', async () => {
    const projects = await seedProjects(3, 5);
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-archive-'));
    const archivePath = path.join(archiveDir, 'archive');
    const result = await createBackupArchive({ dataDir, outPath: archivePath });
    expect(result.manifest.map((e) => e.class).sort()).toEqual(
      ['app-config', 'library-assets', 'memory-markdown', 'projects-dir', 'sqlite-database'].sort(),
    );

    const restoreDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-restore-'));
    const restored = await restoreBackupArchive({ archivePath, dataDir: restoreDir });
    expect(restored.ok).toBe(true);

    // PRAGMA integrity_check via a fresh open of the restored db file.
    const restoredDb = new Database(path.join(restoreDir, 'app.sqlite'), { readonly: true });
    try {
      const check = restoredDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      expect(check[0]?.integrity_check).toBe('ok');
      const rows = restoredDb.prepare('SELECT id FROM projects').all() as Array<{ id: string }>;
      const restoredIds = new Set(rows.map((r) => r.id));
      for (const p of projects) expect(restoredIds.has(p.id)).toBe(true);
    } finally {
      restoredDb.close();
    }

    // Byte-identical file content via a fresh daemon boot on the restored dir.
    // vi.resetModules() first -- see the afterEach comment: server.ts pins
    // RUNTIME_DATA_DIR at module-top-level from OD_DATA_DIR as of first
    // import, so reusing the cached module here would boot against the
    // SOURCE dataDir again, not restoreDir.
    process.env.OD_DATA_DIR = restoreDir;
    register.clear();
    vi.resetModules();
    const { startServer } = await import('../src/server.js');
    const restoredStarted = (await startServer({ port: 0, host: '127.0.0.1', returnServer: true })) as {
      url: string;
      shutdown?: () => Promise<void> | void;
    };
    try {
      for (const p of projects) {
        for (const f of p.files) {
          const res = await fetch(`${restoredStarted.url}/api/projects/${p.id}/raw/${encodeURIComponent(f.name)}`);
          expect(res.status).toBe(200);
          expect(await res.text()).toBe(f.content);
        }
      }
    } finally {
      if (restoredStarted.shutdown) await restoredStarted.shutdown();
      process.env.OD_DATA_DIR = dataDir;
    }
    await rm(archiveDir, { recursive: true, force: true });
    await rm(restoreDir, { recursive: true, force: true });
  });

  it('is atomic under a concurrent writer: a post-backup file never appears in the restored snapshot (C0-2)', async () => {
    const projects = await seedProjects(2, 3);
    const dbPath = path.join(dataDir, 'app.sqlite');
    let writerWrites = 0;
    const writerInterval = setInterval(() => {
      try {
        const db = new Database(dbPath);
        db.prepare('UPDATE projects SET updated_at = ? WHERE id = (SELECT id FROM projects LIMIT 1)').run(Date.now());
        db.close();
        writerWrites++;
      } catch {
        /* the daemon's own connection may hold a transient lock -- keep trying */
      }
    }, 20);

    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-c02-archive-'));
    const archivePath = path.join(archiveDir, 'archive');
    const backupPromise = createBackupArchive({ dataDir, outPath: archivePath });
    // Give the writer loop real wall-clock time to interleave with the backup.
    await new Promise((r) => setTimeout(r, 150));
    await backupPromise;
    clearInterval(writerInterval);

    // Marker written to the source AFTER the backup completed.
    const markerName = `post-backup-marker-${Math.random().toString(36).slice(2)}.txt`;
    const form = new FormData();
    form.append('files', new Blob(['post-backup-marker'], { type: 'text/plain' }), markerName);
    await fetch(`${baseUrl}/api/projects/${projects[0]!.id}/upload`, { method: 'POST', body: form });

    const restoreDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-c02-restore-'));
    await restoreBackupArchive({ archivePath, dataDir: restoreDir });

    const markerPath = path.join(restoreDir, 'projects', projects[0]!.id, markerName);
    expect(fs.existsSync(markerPath)).toBe(false);

    await rm(archiveDir, { recursive: true, force: true });
    await rm(restoreDir, { recursive: true, force: true });
  });

  it('rejects a corrupted sqlite-database entry, naming the class, and does not touch the destination (C0-3)', async () => {
    await seedProjects(1, 2);
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-c03-db-'));
    const archivePath = path.join(archiveDir, 'archive');
    await createBackupArchive({ dataDir, outPath: archivePath });

    const dbFile = path.join(archivePath, 'data', 'app.sqlite');
    const buf = fs.readFileSync(dbFile);
    const offset = Math.floor(buf.length / 2);
    buf[offset] = (buf[offset] ?? 0) ^ 0xff;
    fs.writeFileSync(dbFile, buf);

    const restoreDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-c03-db-restore-'));
    await expect(restoreBackupArchive({ archivePath, dataDir: restoreDir })).rejects.toThrow(RestoreError);
    try {
      await restoreBackupArchive({ archivePath, dataDir: restoreDir });
    } catch (err) {
      expect(err).toBeInstanceOf(RestoreError);
      expect((err as RestoreError).corruptedClass).toBe('sqlite-database');
    }
    await rm(archiveDir, { recursive: true, force: true });
    await rm(restoreDir, { recursive: true, force: true });
  });

  it('rejects a corrupted projects-dir file, naming the class (C0-3)', async () => {
    const projects = await seedProjects(1, 2);
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-c03-proj-'));
    const archivePath = path.join(archiveDir, 'archive');
    await createBackupArchive({ dataDir, outPath: archivePath });

    const target = path.join(archivePath, 'data', 'projects', projects[0]!.id, projects[0]!.files[0]!.name);
    const buf = fs.readFileSync(target);
    const offset = Math.floor(buf.length / 2);
    buf[offset] = (buf[offset] ?? 0) ^ 0xff;
    fs.writeFileSync(target, buf);

    const restoreDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-c03-proj-restore-'));
    try {
      await restoreBackupArchive({ archivePath, dataDir: restoreDir });
      expect.fail('expected restore to reject the corrupted archive');
    } catch (err) {
      expect(err).toBeInstanceOf(RestoreError);
      expect((err as RestoreError).corruptedClass).toBe('projects-dir');
    }
    await rm(archiveDir, { recursive: true, force: true });
    await rm(restoreDir, { recursive: true, force: true });
  });

  it('rejects a corrupted manifest.json, naming "manifest-entry" (C0-3)', async () => {
    await seedProjects(1, 1);
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-c03-manifest-'));
    const archivePath = path.join(archiveDir, 'archive');
    await createBackupArchive({ dataDir, outPath: archivePath });

    const manifestPath = path.join(archivePath, 'manifest.json');
    const buf = fs.readFileSync(manifestPath);
    const offset = Math.floor(buf.length / 2);
    buf[offset] = (buf[offset] ?? 0) ^ 0xff;
    fs.writeFileSync(manifestPath, buf);

    const restoreDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-c03-manifest-restore-'));
    try {
      await restoreBackupArchive({ archivePath, dataDir: restoreDir });
      expect.fail('expected restore to reject the corrupted manifest');
    } catch (err) {
      expect(err).toBeInstanceOf(RestoreError);
      expect((err as RestoreError).corruptedClass).toBe('manifest-entry');
    }
    await rm(archiveDir, { recursive: true, force: true });
    await rm(restoreDir, { recursive: true, force: true });
  });

  it('a clean (uncorrupted) archive still restores successfully (negative control for the C0-3 corruption checks)', async () => {
    await seedProjects(1, 2);
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-c03-control-'));
    const archivePath = path.join(archiveDir, 'archive');
    await createBackupArchive({ dataDir, outPath: archivePath });
    const restoreDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-c03-control-restore-'));
    const result = await restoreBackupArchive({ archivePath, dataDir: restoreDir });
    expect(result.ok).toBe(true);
    await rm(archiveDir, { recursive: true, force: true });
    await rm(restoreDir, { recursive: true, force: true });
  });

  it('excludes secret classes from the archive and strips BYOK keys from the archived app-config (C0-4)', async () => {
    // Seed a real MCP config, connector credential, and BYOK app-config key
    // through real on-disk writes at the same paths the daemon itself uses,
    // then verify none of it reaches the archive.
    fs.writeFileSync(path.join(dataDir, 'mcp-config.json'), JSON.stringify({ servers: [{ id: 'x' }] }));
    fs.writeFileSync(path.join(dataDir, 'mcp-tokens.json'), JSON.stringify({ x: { accessToken: 'super-secret-mcp-token' } }));
    fs.mkdirSync(path.join(dataDir, 'connectors'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'connectors', 'credentials.json'), JSON.stringify({ github: { accessToken: 'super-secret-connector-token' } }));
    fs.writeFileSync(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({ onboardingCompleted: true, agentCliEnv: { claude: { ANTHROPIC_API_KEY: 'sk-super-secret-byok' } } }),
    );

    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-c04-'));
    const archivePath = path.join(archiveDir, 'archive');
    const result = await createBackupArchive({ dataDir, outPath: archivePath });

    // Excluded classes are entirely absent as filesystem paths inside the archive.
    expect(fs.existsSync(path.join(archivePath, 'connectors'))).toBe(false);
    expect(fs.existsSync(path.join(archivePath, 'data', 'mcp-config.json'))).toBe(false);
    expect(fs.existsSync(path.join(archivePath, 'data', 'mcp-tokens.json'))).toBe(false);

    // Grep the entire archive tree for the secret literals -- they must not
    // appear ANYWHERE, not just at the "expected" paths.
    const archiveText = fs
      .readdirSync(archivePath, { recursive: true } as any)
      .filter((f): f is string => typeof f === 'string')
      .map((f) => path.join(archivePath, f))
      .filter((f) => fs.existsSync(f) && fs.statSync(f).isFile())
      .map((f) => fs.readFileSync(f, 'utf8'))
      .join('\n');
    expect(archiveText).not.toContain('super-secret-mcp-token');
    expect(archiveText).not.toContain('super-secret-connector-token');
    expect(archiveText).not.toContain('sk-super-secret-byok');

    // app-config IS archived (required class) but with agentCliEnv stripped.
    const archivedConfig = JSON.parse(fs.readFileSync(path.join(archivePath, 'data', 'app-config.json'), 'utf8'));
    expect(archivedConfig.onboardingCompleted).toBe(true);
    expect(archivedConfig.agentCliEnv).toBeUndefined();

    const manifestClasses = new Set((result.manifest as Array<{ class: string }>).map((e) => e.class));
    expect(manifestClasses.has('mcp-config-tokens')).toBe(false);
    expect(manifestClasses.has('connector-credentials')).toBe(false);
    expect(manifestClasses.has('byok-keys')).toBe(false);

    await rm(archiveDir, { recursive: true, force: true });
  });

  it('refuses to restore onto a data directory that already has a payload', async () => {
    await seedProjects(1, 1);
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-fresh-root-'));
    const archivePath = path.join(archiveDir, 'archive');
    await createBackupArchive({ dataDir, outPath: archivePath });
    // dataDir itself already has a real app.sqlite -- restoring onto it must be refused.
    await expect(restoreBackupArchive({ archivePath, dataDir })).rejects.toThrow(RestoreError);
    await rm(archiveDir, { recursive: true, force: true });
  });
});
