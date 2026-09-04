import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import net from 'node:net';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { confinePreviewCwd, createPreviewService, groupAlive, signalGroup } from '../src/previews.js';
import { registerPreviewRoutes } from '../src/routes/preview.js';

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const SERVER_FIXTURE = `
const http = require('node:http');
const server = http.createServer((req, res) => res.end('preview-ok'));
// Delayed listen: readiness must come from actually reaching the socket,
// not from the process merely having started.
setTimeout(() => server.listen(Number(process.env.PORT), '127.0.0.1'), 300);
`;

const CRASH_FIXTURE = `
console.error('boom: fixture exiting');
process.exit(1);
`;

const GRANDCHILD_FIXTURE = `
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
fs.writeFileSync('grandchild.pid', String(child.pid));
const server = http.createServer((req, res) => res.end('ok'));
server.listen(Number(process.env.PORT), '127.0.0.1');
`;

describe('preview service', () => {
  let tempDir: string;
  const services: Array<ReturnType<typeof createPreviewService>> = [];

  function service() {
    const svc = createPreviewService();
    services.push(svc);
    return svc;
  }

  afterEach(async () => {
    await Promise.all(services.splice(0).map((svc) => svc.shutdown().catch(() => {})));
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function fixtureDir(): string {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-preview-'));
    writeFileSync(path.join(tempDir, 'server.js'), SERVER_FIXTURE);
    writeFileSync(path.join(tempDir, 'crash.js'), CRASH_FIXTURE);
    writeFileSync(path.join(tempDir, 'grandchild.js'), GRANDCHILD_FIXTURE);
    return tempDir;
  }

  it('resolves start() only once the server actually answers HTTP, and survives with daemon ownership', async () => {
    const dir = fixtureDir();
    const port = await freePort();
    const svc = service();
    const session = await svc.start({
      projectId: 'p1',
      cwd: dir,
      command: [process.execPath, 'server.js'],
      port,
    });
    expect(session.status).toBe('ready');
    expect(session.url).toBe(`http://127.0.0.1:${port}/`);

    // The daemon (not any agent shell) owns the process: it is alive and
    // serving after start() returned.
    const body = await (await fetch(session.url)).text();
    expect(body).toBe('preview-ok');
    expect(processAlive(session.pid)).toBe(true);

    const listed = svc.list('p1');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(session.id);
  });

  it('reports a crashed command as an error with captured output instead of claiming live', async () => {
    const dir = fixtureDir();
    const port = await freePort();
    const svc = service();
    await expect(
      svc.start({
        projectId: 'p1',
        cwd: dir,
        command: [process.execPath, 'crash.js'],
        port,
      }),
    ).rejects.toMatchObject({
      code: 'PREVIEW_EXITED',
      logs: expect.stringContaining('boom: fixture exiting'),
    });
    expect(svc.list('p1')).toHaveLength(0);
  });

  it('fails with PREVIEW_NOT_REACHABLE when nothing ever listens, and tears the process down', async () => {
    const dir = fixtureDir();
    // A "server" that never listens on the probed port.
    writeFileSync(path.join(dir, 'never.js'), 'setInterval(() => {}, 1000);');
    const port = await freePort();
    const svc = service();
    let leakedPid = 0;
    await expect(
      svc.start({
        projectId: 'p1',
        cwd: dir,
        command: [process.execPath, 'never.js'],
        port,
        readyTimeoutMs: 800,
        onSpawn: (pid: number) => { leakedPid = pid; },
      }),
    ).rejects.toMatchObject({ code: 'PREVIEW_NOT_REACHABLE' });
    expect(leakedPid).toBeGreaterThan(0);
    // A failed readiness gate must not leak the child.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(processAlive(leakedPid)).toBe(false);
  });

  it('stop() signals the whole process group and confirms no survivors', async () => {
    const dir = fixtureDir();
    const port = await freePort();
    const svc = service();
    const session = await svc.start({
      projectId: 'p1',
      cwd: dir,
      command: [process.execPath, 'grandchild.js'],
      port,
    });
    const pidFile = path.join(dir, 'grandchild.pid');
    expect(existsSync(pidFile)).toBe(true);
    const grandchildPid = Number(readFileSync(pidFile, 'utf8'));
    expect(processAlive(grandchildPid)).toBe(true);

    const result = await svc.stop(session.id);
    expect(result.confirmed).toBe(true);
    expect(processAlive(session.pid)).toBe(false);
    // Group signal must have taken the grandchild down too.
    expect(processAlive(grandchildPid)).toBe(false);
    expect(svc.list('p1')).toHaveLength(0);
  });
});

describe('preview routes', () => {
  const servers: http.Server[] = [];
  const services: Array<ReturnType<typeof createPreviewService>> = [];
  let tempDir: string;

  afterEach(async () => {
    await Promise.all(services.splice(0).map((svc) => svc.shutdown().catch(() => {})));
    await Promise.all(
      servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
    );
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  async function boot() {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-preview-routes-'));
    writeFileSync(path.join(tempDir, 'server.js'), SERVER_FIXTURE);
    const previews = createPreviewService();
    services.push(previews);
    const app = express();
    app.use(express.json());
    registerPreviewRoutes(app, {
      previews,
      projectStore: { getProject: (id: string) => (id === 'p1' ? { id: 'p1' } : null) },
      resolvePreviewCwd: () => tempDir,
    });
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const apiPort = (server.address() as AddressInfo).port;
    return { base: `http://127.0.0.1:${apiPort}` };
  }

  it('starts, lists, and stops a preview over HTTP; unknown projects 404', async () => {
    const { base } = await boot();
    const port = await freePort();

    const missing = await fetch(`${base}/api/projects/nope/previews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: [process.execPath, 'server.js'], port }),
    });
    expect(missing.status).toBe(404);

    const created = await fetch(`${base}/api/projects/p1/previews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: [process.execPath, 'server.js'], port }),
    });
    expect(created.status).toBe(200);
    const session = (await created.json()) as { id: string; status: string; url: string };
    // The daemon serves the preview from its own origin (decision D-14), so
    // the announced URL is a path on this caller's front, never the child's
    // own port.
    expect(session).toMatchObject({
      status: 'ready',
      url: `${base}/api/projects/p1/previews/${session.id}/proxy/`,
    });

    const listed = (await (await fetch(`${base}/api/projects/p1/previews`)).json()) as { previews: unknown[] };
    expect(listed.previews).toHaveLength(1);

    const stopped = await fetch(`${base}/api/projects/p1/previews/${session.id}`, {
      method: 'DELETE',
    });
    expect(stopped.status).toBe(200);
    const after = (await (await fetch(`${base}/api/projects/p1/previews`)).json()) as { previews: unknown[] };
    expect(after.previews).toHaveLength(0);
  });
});

describe('group liveness under permission boundaries', () => {
  const eperm = () => {
    const err = new Error('kill EPERM') as NodeJS.ErrnoException;
    err.code = 'EPERM';
    throw err;
  };
  const esrch = () => {
    const err = new Error('kill ESRCH') as NodeJS.ErrnoException;
    err.code = 'ESRCH';
    throw err;
  };

  it('treats EPERM on the group signal as ALIVE — a permission-blocked survivor exists', () => {
    expect(groupAlive(1234, eperm)).toBe(true);
  });

  it('treats EPERM on the leader fallback as ALIVE too', () => {
    let call = 0;
    expect(groupAlive(1234, () => {
      call += 1;
      if (call === 1) esrch();
      eperm();
    })).toBe(true);
  });

  it('reports gone only when both group and leader are ESRCH', () => {
    expect(groupAlive(1234, esrch)).toBe(false);
  });

  it('does not misdeliver a group signal to the dead leader on EPERM', () => {
    const calls: number[] = [];
    signalGroup(1234, 'SIGTERM', (pid) => {
      calls.push(pid);
      if (pid === -1234) eperm();
    });
    // Group call attempted, but NO leader-only fallback: kill(pid) would
    // misreport delivery the confirmation loop must instead surface.
    expect(calls).toEqual([-1234]);
  });
});

describe('confinePreviewCwd', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('resolves relative cwds inside the project and rejects escapes', () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'od-confine-'));
    mkdirSync(path.join(dir, 'app'));
    expect(confinePreviewCwd(dir)).toBe(realpathSync(dir));
    expect(confinePreviewCwd(dir, 'app')).toBe(path.join(realpathSync(dir), 'app'));
    expect(confinePreviewCwd(dir, '..')).toBeNull();
    expect(confinePreviewCwd(dir, '/etc')).toBeNull();
    expect(confinePreviewCwd(dir, 'missing-subdir')).toBeNull();
  });

  it('rejects a symlink inside the project that points outside it', () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'od-confine-link-'));
    const outside = mkdtempSync(path.join(os.tmpdir(), 'od-outside-'));
    try {
      symlinkSync(outside, path.join(dir, 'escape'));
      expect(confinePreviewCwd(dir, 'escape')).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('port ownership preflight', () => {
  it('refuses to start when the port is already in use instead of verifying a stranger', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'od-portuse-'));
    writeFileSync(path.join(dir, 'server.js'), SERVER_FIXTURE);
    const occupant = net.createServer();
    const port = await freePort();
    await new Promise<void>((resolve) => occupant.listen(port, '127.0.0.1', resolve));
    const svc = createPreviewService();
    try {
      await expect(
        svc.start({ projectId: 'p1', cwd: dir, command: [process.execPath, 'server.js'], port }),
      ).rejects.toMatchObject({ code: 'PREVIEW_PORT_IN_USE' });
      expect(svc.list('p1')).toHaveLength(0);
    } finally {
      await svc.shutdown().catch(() => {});
      await new Promise<void>((resolve) => occupant.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
