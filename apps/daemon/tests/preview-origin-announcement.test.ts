import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { createPreviewService } from '../src/previews.js';
import { registerPreviewRoutes } from '../src/routes/preview.js';

/**
 * Red spec for issue #158: a preview URL must name a host the CALLER can
 * reach.
 *
 * The daemon runs the preview server on its own machine, so
 * `http://127.0.0.1:<port>/` is correct only for a caller on that machine.
 * The app is routinely reached from a second computer over a tailnet, where
 * that announced address resolves to the caller's OWN loopback: the preview
 * looks dead and an iframe pointed at it retries forever.
 *
 * Both preview reads (`POST` on start and `GET` on list) must announce the
 * preview on the host the request itself arrived on. A request that arrived
 * on loopback still gets loopback.
 */

const TAILNET_HOST = 'devins-macbook-pro.tail908c18.ts.net:7443';

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

type Reply = { status: number; body: unknown };

// node:http rather than fetch: the whole point of the spec is the `Host`
// header the daemon sees, and only a raw request can set it verbatim.
function request(
  apiPort: number,
  method: string,
  pathname: string,
  options: { host: string; body?: unknown },
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? null : JSON.stringify(options.body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: apiPort,
        method,
        path: pathname,
        headers: {
          Host: options.host,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => {
          let body: unknown = text;
          try {
            body = JSON.parse(text);
          } catch {
            // Leave the raw text for the failure message.
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('preview URL announcement', () => {
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

  async function boot(): Promise<{ apiPort: number }> {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-preview-origin-'));
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
    });
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { apiPort: (server.address() as AddressInfo).port };
  }

  it('announces a preview started over the tailnet on the tailnet host', async () => {
    const { apiPort } = await boot();
    const port = await freePort();

    const created = await request(apiPort, 'POST', '/api/projects/p1/previews', {
      host: TAILNET_HOST,
      body: { command: [process.execPath, 'server.js'], port },
    });

    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      status: 'ready',
      url: `http://devins-macbook-pro.tail908c18.ts.net:${port}/`,
    });
  }, 30_000);

  it('lists a preview on the host the list request arrived on', async () => {
    const { apiPort } = await boot();
    const port = await freePort();

    const created = await request(apiPort, 'POST', '/api/projects/p1/previews', {
      host: `127.0.0.1:${apiPort}`,
      body: { command: [process.execPath, 'server.js'], port },
    });
    expect(created.status).toBe(200);
    // A caller on the daemon's own machine keeps loopback.
    expect(created.body).toMatchObject({ url: `http://127.0.0.1:${port}/` });

    const listed = await request(apiPort, 'GET', '/api/projects/p1/previews', {
      host: TAILNET_HOST,
    });
    expect(listed.status).toBe(200);
    expect((listed.body as { previews: Array<{ url: string }> }).previews).toEqual([
      expect.objectContaining({ url: `http://devins-macbook-pro.tail908c18.ts.net:${port}/` }),
    ]);
  }, 30_000);
});
