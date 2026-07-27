// `od backup create` / `od restore` -- the real CLI subprocess chain (the
// SUBCOMMAND_MAP wiring added to apps/daemon/src/cli.ts), invoked exactly
// as a shell caller would: `node apps/daemon/bin/od.mjs <args>` against a
// real booted daemon's data directory, through the built dist/cli.js. No
// mocked transport, no in-process function call -- a genuine child_process
// per VERIFICATION-CONTRACT.md R2.

import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const odBinPath = path.join(repoRoot, 'apps/daemon/bin/od.mjs');

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-cli-src-'));
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
  // server.ts pins RUNTIME_DATA_DIR at module-top-level from OD_DATA_DIR as
  // of first import; without resetting the module registry, the next
  // test's daemon boot would silently reuse THIS test's data directory.
  // register.clear() first: re-importing metrics/index.ts re-registers its
  // prom-client series against the process-global registry, which throws
  // on a second import unless cleared. See tests/backup-restore.test.ts.
  register.clear();
  vi.resetModules();
});

function odCli(args: string[], env: NodeJS.ProcessEnv): { status: number; stdout: string } {
  try {
    const stdout = execFileSync('node', [odBinPath, ...args], { env, encoding: 'utf8', timeout: 60_000 });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '' };
  }
}

describe('od backup create / od restore -- real CLI subprocess chain', () => {
  it('creates a real archive via the CLI and restores it via the CLI, round-tripping real project data', async () => {
    const id = `cli-subprocess-${Date.now()}`;
    await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: id }),
    });
    const form = new FormData();
    const content = `cli-subprocess-content-${Math.random().toString(36).slice(2)}`;
    form.append('files', new Blob([content], { type: 'text/plain' }), 'a.txt');
    await fetch(`${baseUrl}/api/projects/${id}/upload`, { method: 'POST', body: form });

    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-cli-archive-'));
    const archivePath = path.join(archiveDir, 'archive');
    const backupRun = odCli(['backup', 'create', '--out', archivePath, '--json'], { ...process.env, OD_DATA_DIR: dataDir });
    expect(backupRun.status).toBe(0);
    const backupBody = JSON.parse(backupRun.stdout.trim().split('\n').pop()!) as { ok: boolean; archivePath: string; classes: string[] };
    expect(backupBody.ok).toBe(true);
    expect(fs.existsSync(path.join(backupBody.archivePath, 'manifest.json'))).toBe(true);

    const restoreDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-cli-restore-'));
    const restoreRun = odCli(['restore', '--archive', archivePath, '--json'], { ...process.env, OD_DATA_DIR: restoreDir });
    expect(restoreRun.status).toBe(0);
    const restoreBody = JSON.parse(restoreRun.stdout.trim().split('\n').pop()!) as { ok: boolean; restoredClasses: string[] };
    expect(restoreBody.ok).toBe(true);
    expect(restoreBody.restoredClasses).toContain('sqlite-database');
    expect(restoreBody.restoredClasses).toContain('projects-dir');

    // Real content, byte-identical, read straight off disk (no second daemon
    // boot needed -- restore already wrote real files).
    const restoredFile = path.join(restoreDir, 'projects', id, 'a.txt');
    expect(fs.existsSync(restoredFile)).toBe(true);
    expect(fs.readFileSync(restoredFile, 'utf8')).toBe(content);

    await rm(archiveDir, { recursive: true, force: true });
    await rm(restoreDir, { recursive: true, force: true });
  });

  it('od restore exits non-zero and names the corrupted class for a tampered archive, via the real CLI subprocess', async () => {
    const id = `cli-subprocess-corrupt-${Date.now()}`;
    await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: id }),
    });

    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-cli-corrupt-'));
    const archivePath = path.join(archiveDir, 'archive');
    const backupRun = odCli(['backup', 'create', '--out', archivePath, '--json'], { ...process.env, OD_DATA_DIR: dataDir });
    expect(backupRun.status).toBe(0);

    const dbFile = path.join(archivePath, 'data', 'app.sqlite');
    const buf = fs.readFileSync(dbFile);
    const offset = Math.floor(buf.length / 2);
    buf[offset] = (buf[offset] ?? 0) ^ 0xff;
    fs.writeFileSync(dbFile, buf);

    const restoreDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-cli-corrupt-restore-'));
    const restoreRun = odCli(['restore', '--archive', archivePath, '--json'], { ...process.env, OD_DATA_DIR: restoreDir });
    expect(restoreRun.status).not.toBe(0);
    expect(restoreRun.stdout.toLowerCase()).toContain('sqlite-database');

    await rm(archiveDir, { recursive: true, force: true });
    await rm(restoreDir, { recursive: true, force: true });
  });
});
