import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { createChromeOpenInvocation } from '../src/browser/browser-open.js';
import { createPreviewService } from '../src/previews.js';
import { registerPreviewRoutes } from '../src/routes/preview.js';

/**
 * "Open in Chrome" (issue #158): the host's default browser can refuse
 * loopback connections, which makes a healthy preview server look dead. The
 * daemon has to name the browser, and it always opens the address ITS OWN
 * machine reaches the preview on.
 */

const SERVER_FIXTURE = `
const http = require('node:http');
const server = http.createServer((req, res) => res.end('preview-ok'));
server.listen(Number(process.env.PORT), '127.0.0.1');
`;

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

describe('opening a preview in Chrome', () => {
  const services: Array<ReturnType<typeof createPreviewService>> = [];
  const servers: http.Server[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(services.map((s) => s.shutdown().catch(() => {})));
    services.length = 0;
    await Promise.all(
      servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
    );
    servers.length = 0;
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  async function boot(openPreviewInChrome: (url: string) => boolean): Promise<{ base: string }> {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-preview-chrome-'));
    tempDirs.push(tempDir);
    writeFileSync(path.join(tempDir, 'server.js'), SERVER_FIXTURE);

    const previews = createPreviewService();
    services.push(previews);
    const app = express();
    app.use(express.json());
    registerPreviewRoutes(app, {
      previews,
      projectStore: { getProject: (id: string) => (id === 'p1' ? { id: 'p1' } : null) },
      resolvePreviewCwd: () => tempDir,
      openPreviewInChrome,
    });
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const apiPort = (server.address() as AddressInfo).port;
    return { base: `http://127.0.0.1:${apiPort}` };
  }

  it('opens the daemon-machine loopback URL of a registered session', async () => {
    const opened: string[] = [];
    const { base } = await boot((url) => {
      opened.push(url);
      return true;
    });
    const port = await freePort();

    const created = await fetch(`${base}/api/projects/p1/previews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: [process.execPath, 'server.js'], port }),
    });
    expect(created.status).toBe(200);
    const session = (await created.json()) as { id: string };

    const res = await fetch(`${base}/api/projects/p1/previews/${session.id}/open`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      opened: true,
      url: `http://127.0.0.1:${port}/`,
      browser: 'chrome',
    });
    expect(opened).toEqual([`http://127.0.0.1:${port}/`]);
  }, 30_000);

  it('refuses an unknown session instead of opening anything', async () => {
    const openPreviewInChrome = vi.fn(() => true);
    const { base } = await boot(openPreviewInChrome);

    const res = await fetch(`${base}/api/projects/p1/previews/nope/open`, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(openPreviewInChrome).not.toHaveBeenCalled();
  });

  it('reports a launcher that could not start instead of a false success', async () => {
    const { base } = await boot(() => false);
    const port = await freePort();

    const created = await fetch(`${base}/api/projects/p1/previews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: [process.execPath, 'server.js'], port }),
    });
    expect(created.status).toBe(200);
    const session = (await created.json()) as { id: string };

    const res = await fetch(`${base}/api/projects/p1/previews/${session.id}/open`, {
      method: 'POST',
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: 'PREVIEW_OPEN_FAILED',
      url: `http://127.0.0.1:${port}/`,
    });
  }, 30_000);
});

describe('Chrome open invocation', () => {
  it('names Chrome rather than the OS default browser', () => {
    expect(createChromeOpenInvocation('darwin', 'http://127.0.0.1:8125/')).toMatchObject({
      command: '/usr/bin/open',
      args: ['-a', 'Google Chrome', 'http://127.0.0.1:8125/'],
    });
    expect(createChromeOpenInvocation('linux', 'http://127.0.0.1:8125/')).toMatchObject({
      command: 'google-chrome',
      args: ['http://127.0.0.1:8125/'],
    });
    const win = createChromeOpenInvocation('win32', 'http://127.0.0.1:8125/', { ComSpec: 'cmd.exe' });
    expect(win.command).toBe('cmd.exe');
    expect(win.args.join(' ')).toContain('chrome');
  });
});
