import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { PREVIEW_PROXY_MOUNT } from '../src/preview-proxy.js';
import { createPreviewService } from '../src/previews.js';
import { registerPreviewRoutes } from '../src/routes/preview.js';

/**
 * A redirect out of the proxy is a redirect out of reach (issue #158,
 * decision D-14).
 *
 * The child is loopback-bound on the daemon's machine and nobody else can
 * open it, so every `Location` the child writes against its own origin has to
 * come back re-anchored under the daemon's proxy path. `127.0.0.1` is only
 * one of the names that origin has: a dev server writes `localhost`, an IPv6
 * stack writes `[::1]`, a wildcard bind writes `0.0.0.0`, and a scheme-relative
 * `//host:port/path` names the same host without a scheme at all. Each of
 * those, passed through, sends a collaborator to an address that answers
 * nothing on their machine.
 *
 * The other half of the invariant: a redirect that genuinely leaves the child
 * stays exactly as the child wrote it.
 */

const TAILNET_HOST = 'devins-macbook-pro.tail908c18.ts.net:7443';

const SERVER_FIXTURE = `
const http = require('node:http');
const port = Number(process.env.PORT);
const otherPort = port === 65535 ? port - 1 : port + 1;
const REDIRECTS = {
  '/r/root': '/landed',
  '/r/scheme-relative-ipv4': '//127.0.0.1:' + port + '/next',
  '/r/scheme-relative-localhost': '//localhost:' + port + '/next',
  '/r/absolute-localhost': 'http://localhost:' + port + '/next',
  '/r/absolute-ipv6': 'http://[::1]:' + port + '/next',
  '/r/absolute-any': 'http://0.0.0.0:' + port + '/next',
  '/r/absolute-query': 'http://localhost:' + port + '/next?a=1#frag',
  '/r/offsite-absolute': 'https://example.com/next',
  '/r/offsite-scheme-relative': '//example.com/next',
  '/r/other-port': 'http://127.0.0.1:' + otherPort + '/next',
};
const server = http.createServer((req, res) => {
  const target = REDIRECTS[req.url];
  if (target) {
    res.writeHead(302, { Location: target });
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('preview-ok');
});
server.listen(port, '127.0.0.1');
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

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: unknown };

// node:http rather than fetch: the spec is about the `Host` the daemon sees
// and the `Location` it writes back, and only a raw request sets `Host`
// verbatim while leaving a 302 unfollowed.
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
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('a preview redirect to the child loopback origin', () => {
  const services: Array<ReturnType<typeof createPreviewService>> = [];
  const servers: http.Server[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(services.map((s) => s.shutdown().catch(() => {})));
    services.length = 0;
    await Promise.all(
      servers.map((s) => new Promise<void>((resolve) => {
        s.closeAllConnections?.();
        s.close(() => resolve());
      })),
    );
    servers.length = 0;
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  async function boot(): Promise<{ apiPort: number }> {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-preview-redirect-'));
    tempDirs.push(tempDir);
    writeFileSync(path.join(tempDir, 'server.js'), SERVER_FIXTURE);

    const previews = createPreviewService();
    services.push(previews);
    const app = express();
    app.use(PREVIEW_PROXY_MOUNT, express.raw({ type: () => true, limit: '4mb' }));
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

  async function startPreview(apiPort: number): Promise<{ id: string; port: number }> {
    const port = await freePort();
    const created = await request(apiPort, 'POST', '/api/projects/p1/previews', {
      host: TAILNET_HOST,
      body: { command: [process.execPath, 'server.js'], port },
    });
    expect(created.status).toBe(200);
    return { id: (created.body as { id: string }).id, port };
  }

  it('stays under the daemon proxy path for every loopback spelling', async () => {
    const { apiPort } = await boot();
    const session = await startPreview(apiPort);
    const base = `/api/projects/p1/previews/${session.id}/proxy/`;

    const location = async (upstream: string): Promise<string | undefined> => {
      const reply = await request(apiPort, 'GET', `${base}${upstream}`, { host: TAILNET_HOST });
      expect(reply.status).toBe(302);
      return reply.headers.location;
    };

    expect(await location('r/root')).toBe(`${base}landed`);
    expect(await location('r/scheme-relative-ipv4')).toBe(`${base}next`);
    expect(await location('r/scheme-relative-localhost')).toBe(`${base}next`);
    expect(await location('r/absolute-localhost')).toBe(`${base}next`);
    expect(await location('r/absolute-ipv6')).toBe(`${base}next`);
    expect(await location('r/absolute-any')).toBe(`${base}next`);
    expect(await location('r/absolute-query')).toBe(`${base}next?a=1#frag`);
  }, 30_000);

  it('leaves a redirect that genuinely leaves the child exactly as written', async () => {
    const { apiPort } = await boot();
    const session = await startPreview(apiPort);
    const base = `/api/projects/p1/previews/${session.id}/proxy/`;
    const otherPort = session.port === 65535 ? session.port - 1 : session.port + 1;

    const location = async (upstream: string): Promise<string | undefined> => {
      const reply = await request(apiPort, 'GET', `${base}${upstream}`, { host: TAILNET_HOST });
      expect(reply.status).toBe(302);
      return reply.headers.location;
    };

    expect(await location('r/offsite-absolute')).toBe('https://example.com/next');
    expect(await location('r/offsite-scheme-relative')).toBe('//example.com/next');
    // Loopback, but not the port this session registered: not the child.
    expect(await location('r/other-port')).toBe(`http://127.0.0.1:${otherPort}/next`);
  }, 30_000);
});
