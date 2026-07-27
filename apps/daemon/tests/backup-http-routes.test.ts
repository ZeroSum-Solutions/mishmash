// POST /api/backup / POST /api/restore -- the HTTP half of UI/CLI parity for
// the backup engine (see apps/daemon/src/backup/routes.ts and cli.ts; both
// call the exact same create.ts/restore.ts core). Real booted daemons, real
// HTTP requests, real filesystem archives -- no mocked transport.

import type http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-http-src-'));
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
  register.clear();
  vi.resetModules();
});

describe('POST /api/backup + POST /api/restore', () => {
  it('POST /api/backup produces a real archive on disk; POST /api/restore (against a fresh daemon) restores it', async () => {
    const id = `http-bkp-${Date.now()}`;
    await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: id }),
    });
    const form = new FormData();
    form.append('files', new Blob(['http-route-content'], { type: 'text/plain' }), 'a.txt');
    await fetch(`${baseUrl}/api/projects/${id}/upload`, { method: 'POST', body: form });

    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-http-archive-'));
    const outPath = path.join(archiveDir, 'archive');
    const backupRes = await fetch(`${baseUrl}/api/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outPath }),
    });
    expect(backupRes.status).toBe(200);
    const backupBody = (await backupRes.json()) as { ok: boolean; archivePath: string; classes: string[] };
    expect(backupBody.ok).toBe(true);
    expect(fs.existsSync(path.join(backupBody.archivePath, 'manifest.json'))).toBe(true);

    // Restore against a SEPARATE fresh daemon (fresh OD_DATA_DIR), matching
    // the product's restore-to-fresh-root contract.
    const restoreDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-http-restore-'));
    process.env.OD_DATA_DIR = restoreDir;
    register.clear();
    vi.resetModules();
    const { startServer: startServer2 } = await import('../src/server.js');
    const restoreDaemon = (await startServer2({ port: 0, host: '127.0.0.1', returnServer: true })) as {
      url: string;
      shutdown?: () => Promise<void> | void;
    };
    try {
      const restoreRes = await fetch(`${restoreDaemon.url}/api/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivePath: backupBody.archivePath }),
      });
      expect(restoreRes.status).toBe(200);
      const restoreBody = (await restoreRes.json()) as { ok: boolean; restoredClasses: string[] };
      expect(restoreBody.ok).toBe(true);
      expect(restoreBody.restoredClasses).toContain('sqlite-database');
    } finally {
      if (restoreDaemon.shutdown) await restoreDaemon.shutdown();
      process.env.OD_DATA_DIR = dataDir;
      register.clear();
      vi.resetModules();
    }
    await rm(archiveDir, { recursive: true, force: true });
    await rm(restoreDir, { recursive: true, force: true });
  });

  it('rejects a cross-origin (non-loopback) backup request', async () => {
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-http-cors-'));
    const res = await fetch(`${baseUrl}/api/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
      body: JSON.stringify({ outPath: path.join(archiveDir, 'archive') }),
    });
    expect(res.status).toBe(403);
    await rm(archiveDir, { recursive: true, force: true });
  });

  it('returns 422 naming the corrupted class when restoring a tampered archive over HTTP', async () => {
    const id = `http-bkp-corrupt-${Date.now()}`;
    await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: id }),
    });
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-http-corrupt-'));
    const outPath = path.join(archiveDir, 'archive');
    const backupRes = await fetch(`${baseUrl}/api/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outPath }),
    });
    const { archivePath } = (await backupRes.json()) as { archivePath: string };

    const manifestPath = path.join(archivePath, 'manifest.json');
    const buf = fs.readFileSync(manifestPath);
    buf[Math.floor(buf.length / 2)] = (buf[Math.floor(buf.length / 2)] ?? 0) ^ 0xff;
    fs.writeFileSync(manifestPath, buf);

    const restoreDir = await mkdtemp(path.join(os.tmpdir(), 'od-backup-http-corrupt-restore-'));
    process.env.OD_DATA_DIR = restoreDir;
    register.clear();
    vi.resetModules();
    const { startServer: startServer2 } = await import('../src/server.js');
    const restoreDaemon = (await startServer2({ port: 0, host: '127.0.0.1', returnServer: true })) as {
      url: string;
      shutdown?: () => Promise<void> | void;
    };
    try {
      const restoreRes = await fetch(`${restoreDaemon.url}/api/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivePath }),
      });
      expect(restoreRes.status).toBe(422);
      const body = (await restoreRes.json()) as { error: { corruptedClass?: string } };
      expect(body.error.corruptedClass).toBe('manifest-entry');
    } finally {
      if (restoreDaemon.shutdown) await restoreDaemon.shutdown();
      process.env.OD_DATA_DIR = dataDir;
      register.clear();
      vi.resetModules();
    }
    await rm(archiveDir, { recursive: true, force: true });
    await rm(restoreDir, { recursive: true, force: true });
  });
});
