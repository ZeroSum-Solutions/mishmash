// Covers join the backup set (C4-11) and `od cover` CLI parity (C4-12) --
// real booted daemon, real `od` CLI subprocess, real backup/restore
// archive on disk.

import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const odBinPath = path.join(repoRoot, 'apps/daemon/bin/od.mjs');

let daemon: import('node:http').Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-covers-backup-cli-'));
  process.env.OD_DATA_DIR = dataDir;
  const { startServer } = await import('../src/server.js');
  const started = (await startServer({ port: 0, host: '127.0.0.1', returnServer: true })) as {
    url: string;
    server: import('node:http').Server;
    shutdown?: () => Promise<void> | void;
  };
  baseUrl = started.url;
  daemon = started.server;
  daemonShutdown = started.shutdown;
}, 60_000);

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
}, 30_000);

// Standalone CLI operations (backup/restore) that never call back into a
// daemon over HTTP -- safe to run synchronously.
function runOd(args: string[], env: NodeJS.ProcessEnv): { status: number; stdout: string; stderr: string } {
  try {
    // stdio must be explicit: execFileSync otherwise inherits the parent's
    // stdin, which under a test runner is not a real TTY/EOF stream and can
    // hang the child indefinitely waiting on input it will never receive.
    const stdout = execFileSync('node', [odBinPath, ...args], {
      env,
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

// CLI operations (cover generate/show) that call back into the SAME
// in-process daemon this file boots via startServer() over HTTP. Must be
// the async execFile, never execFileSync: a synchronous spawn blocks this
// worker's ENTIRE event loop while waiting for the child's HTTP request to
// resolve -- but that request can only resolve once THIS event loop is
// free to drive the daemon's own async renderer, deadlocking until the
// spawn's own timeout fires. execFile keeps this process's event loop free
// so the in-process daemon can actually answer the request.
async function runOdAsync(args: string[], env: NodeJS.ProcessEnv): Promise<{ status: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [odBinPath, ...args], {
      env,
      timeout: 60_000,
    });
    return { status: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number | null; stdout?: string; stderr?: string };
    return { status: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('covers backup class (C4-11) + od cover CLI parity (C4-12)', () => {
  it(
    'a generated cover is archived byte-faithfully under a covers class and a restored daemon serves the same bytes',
    async () => {
      const id = `cover-backup-${Date.now()}`;
      await fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: id }),
      });
      const form = new FormData();
      form.append('files', new Blob(['<!doctype html><html><body>backup test</body></html>'], { type: 'text/html' }), 'index.html');
      await fetch(`${baseUrl}/api/projects/${id}/upload`, { method: 'POST', body: form });

      const genResp = await fetch(`${baseUrl}/api/projects/${id}/cover/generate`, { method: 'POST' });
      expect(genResp.status).toBe(200);
      const originalBytes = Buffer.from(await (await fetch(`${baseUrl}/api/projects/${id}/cover`)).arrayBuffer());
      expect(originalBytes.length).toBeGreaterThan(0);

      const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'od-covers-backup-archive-'));
      const archivePath = path.join(archiveRoot, 'archive');
      const backupRun = runOd(['backup', 'create', '--out', archivePath, '--json'], {
        ...process.env,
        OD_DATA_DIR: dataDir,
        OD_DAEMON_CLI_PATH: path.join(repoRoot, 'apps/daemon/dist/cli.js'),
      });
      expect(backupRun.status).toBe(0);

      const manifestPath = path.join(archivePath, 'manifest.json');
      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        class?: string;
        relPath?: string;
      }[];
      const coverEntry = manifest.find((e) => e.class === 'covers');
      expect(coverEntry).toBeTruthy();
      expect(coverEntry?.relPath).toBe('data/covers');

      // The archived bytes must byte-match the original cover.
      const coverArchivedDir = path.join(archivePath, coverEntry!.relPath!);
      const archivedCoverPath = path.join(coverArchivedDir, id, 'cover.png');
      expect(fs.existsSync(archivedCoverPath)).toBe(true);
      expect(fs.readFileSync(archivedCoverPath).equals(originalBytes)).toBe(true);

      // Restore into a fresh data dir and confirm the restored cover renders.
      const restoreDir = await mkdtemp(path.join(os.tmpdir(), 'od-covers-restore-'));
      const restoreRun = runOd(['restore', '--archive', archivePath, '--json'], {
        ...process.env,
        OD_DATA_DIR: restoreDir,
        OD_DAEMON_CLI_PATH: path.join(repoRoot, 'apps/daemon/dist/cli.js'),
      });
      expect(restoreRun.status).toBe(0);

      process.env.OD_DATA_DIR = restoreDir;
      register.clear();
      vi.resetModules();
      const { startServer: startServer2 } = await import('../src/server.js');
      const restoredDaemon = (await startServer2({ port: 0, host: '127.0.0.1', returnServer: true })) as {
        url: string;
        shutdown?: () => Promise<void> | void;
      };
      try {
        const restoredResp = await fetch(`${restoredDaemon.url}/api/projects/${id}/cover`);
        expect(restoredResp.status).toBe(200);
        const restoredBytes = Buffer.from(await restoredResp.arrayBuffer());
        expect(restoredBytes.equals(originalBytes)).toBe(true);
      } finally {
        if (restoredDaemon.shutdown) await restoredDaemon.shutdown();
        process.env.OD_DATA_DIR = dataDir;
        register.clear();
        vi.resetModules();
      }
      await rm(archiveRoot, { recursive: true, force: true });
      await rm(restoreDir, { recursive: true, force: true });
    },
    120_000,
  );

  it(
    '`od cover generate` and `od cover show` drive the same frozen HTTP endpoints the UI calls',
    async () => {
      const id = `cover-cli-${Date.now()}`;
      await fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: id }),
      });
      const form = new FormData();
      form.append('files', new Blob(['<!doctype html><html><body>cli parity</body></html>'], { type: 'text/html' }), 'index.html');
      await fetch(`${baseUrl}/api/projects/${id}/upload`, { method: 'POST', body: form });

      const cliEnv = {
        ...process.env,
        OD_DATA_DIR: dataDir,
        OD_DAEMON_CLI_PATH: path.join(repoRoot, 'apps/daemon/dist/cli.js'),
        OD_DAEMON_URL: baseUrl,
      };

      const generateRun = await runOdAsync(['cover', 'generate', '--project', id, '--json'], cliEnv);
      expect(generateRun.status).toBe(0);
      const generateBody = JSON.parse(generateRun.stdout.trim()) as {
        ok: boolean;
        cover?: { width: number; height: number };
      };
      expect(generateBody.ok).toBe(true);
      expect(generateBody.cover?.width).toBe(1280);

      const httpGet = await fetch(`${baseUrl}/api/projects/${id}/cover`);
      expect(httpGet.status).toBe(200);

      const showRun = await runOdAsync(['cover', 'show', '--project', id, '--json'], cliEnv);
      expect(showRun.status).toBe(0);
      const showBody = JSON.parse(showRun.stdout.trim()) as {
        ok: boolean;
        bytes?: number;
        placeholder?: boolean;
      };
      expect(showBody.ok).toBe(true);
      expect(showBody.bytes).toBeGreaterThan(0);
      expect(showBody.placeholder).toBe(false);
    },
    60_000,
  );

  // W2G.6 -- the CLI half of "a cover the project advertises never answers
  // 404". The route serves a placeholder instead of 404 when it cannot read
  // the advertised bytes, so `od cover show` must report that rather than
  // present the placeholder as the stored cover.
  it(
    '`od cover show` reports placeholder=true when the advertised cover bytes cannot be read',
    async () => {
      const id = `cover-cli-placeholder-${Date.now()}`;
      await fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: id }),
      });
      const form = new FormData();
      form.append('files', new Blob(['<!doctype html><html><body>cli placeholder</body></html>'], { type: 'text/html' }), 'index.html');
      await fetch(`${baseUrl}/api/projects/${id}/upload`, { method: 'POST', body: form });

      const genResp = await fetch(`${baseUrl}/api/projects/${id}/cover/generate`, { method: 'POST' });
      expect(genResp.status).toBe(200);

      // The advertised bytes go away between the advertisement and the fetch.
      fs.unlinkSync(path.join(dataDir, 'covers', id, 'cover.png'));

      const cliEnv = {
        ...process.env,
        OD_DATA_DIR: dataDir,
        OD_DAEMON_CLI_PATH: path.join(repoRoot, 'apps/daemon/dist/cli.js'),
        OD_DAEMON_URL: baseUrl,
      };
      const showRun = await runOdAsync(['cover', 'show', '--project', id, '--json'], cliEnv);
      expect(showRun.status).toBe(0);
      const showBody = JSON.parse(showRun.stdout.trim()) as {
        ok: boolean;
        bytes?: number;
        placeholder?: boolean;
      };
      expect(showBody.ok).toBe(true);
      expect(showBody.placeholder).toBe(true);
      expect(showBody.bytes).toBeGreaterThan(0);
    },
    60_000,
  );
});
