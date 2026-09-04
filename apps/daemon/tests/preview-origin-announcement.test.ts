import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';

import {
  PREVIEW_PROXY_MOUNT,
  createPreviewRootAssetFallback,
  createPreviewProxyUpgradeHandler,
} from '../src/preview-proxy.js';
import { createPreviewService } from '../src/previews.js';
import { registerPreviewRoutes } from '../src/routes/preview.js';

/**
 * Preview announcement and the exposure behind it (issue #158, decision
 * D-14).
 *
 * The daemon runs the preview server on its own machine and cannot make the
 * child listen anywhere else, so it serves each preview from its OWN origin
 * and announces that path. Two properties belong together here: the URL names
 * the front the request arrived on (a collaborator is not handed the daemon's
 * loopback), and that URL actually serves the preview.
 *
 * The reachability half — a request from a non-loopback network context under
 * the production gate — is `preview-proxy-reachability.test.ts`.
 */

const TAILNET_HOST = 'devins-macbook-pro.tail908c18.ts.net:7443';

const SERVER_FIXTURE = `
const http = require('node:http');
const server = http.createServer((req, res) => {
  if (req.url === '/redirect') {
    res.writeHead(302, { Location: '/landed' });
    res.end();
    return;
  }
  if (req.url === '/echo-headers') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.headers));
    return;
  }
  if (req.url === '/style.css') {
    res.writeHead(200, { 'content-type': 'text/css' });
    res.end('body{color:red}');
    return;
  }
  if (req.method === 'POST' && req.url === '/echo-framing') {
    const chunks = [];
    req.on('data', (chunk) => { chunks.push(chunk); });
    req.on('end', () => {
      const received = Buffer.concat(chunks);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        echo: received.toString(),
        received: received.length,
        contentLength: req.headers['content-length'] ?? null,
        contentEncoding: req.headers['content-encoding'] ?? null,
      }));
    });
    return;
  }
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ echo: body }));
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'sid=1; Path=/' });
  res.end('preview-ok');
});
server.on('upgrade', (req, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n\\r\\n');
  socket.write('hmr-ready');
});
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

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: unknown };

// node:http rather than fetch: the whole point of the spec is the `Host`
// header the daemon sees, and only a raw request can set it verbatim.
function request(
  apiPort: number,
  method: string,
  pathname: string,
  options: { host: string; body?: unknown; rawBody?: Buffer; headers?: Record<string, string> },
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = options.rawBody ?? (options.body === undefined ? null : JSON.stringify(options.body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port: apiPort,
        method,
        path: pathname,
        headers: {
          Host: options.host,
          ...(options.headers ?? {}),
          ...(payload
            ? {
                ...(options.rawBody ? {} : { 'Content-Type': 'application/json' }),
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
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

describe('preview URL announcement', () => {
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
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-preview-origin-'));
    tempDirs.push(tempDir);
    writeFileSync(path.join(tempDir, 'server.js'), SERVER_FIXTURE);

    const previews = createPreviewService();
    services.push(previews);
    const app = express();
    // Mirrors the daemon's own wiring: the proxy's body is captured as bytes
    // before the JSON parser can consume it (apps/daemon/src/server.ts).
    app.use(PREVIEW_PROXY_MOUNT, express.raw({ type: () => true, limit: '4mb' }));
    app.use(express.json());
    registerPreviewRoutes(app, {
      previews,
      projectStore: { getProject: (id: string) => (id === 'p1' ? { id: 'p1' } : null) },
      resolvePreviewCwd: () => tempDir,
    });
    app.use(createPreviewRootAssetFallback({
      getPreview: (id) => previews.get(id),
      hasLivePreview: () => previews.list().length > 0,
    }));
    const server = http.createServer(app);
    server.on('upgrade', createPreviewProxyUpgradeHandler({ getPreview: (id) => previews.get(id) }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { apiPort: (server.address() as AddressInfo).port };
  }

  async function startPreview(apiPort: number, host: string): Promise<Reply> {
    const port = await freePort();
    return await request(apiPort, 'POST', '/api/projects/p1/previews', {
      host,
      body: { command: [process.execPath, 'server.js'], port },
    });
  }

  it('announces a preview started over the tailnet on the tailnet host', async () => {
    const { apiPort } = await boot();

    const created = await startPreview(apiPort, TAILNET_HOST);

    expect(created.status).toBe(200);
    const session = created.body as { id: string; status: string; url: string };
    expect(session.status).toBe('ready');
    expect(session.url).toBe(
      `http://devins-macbook-pro.tail908c18.ts.net:7443/api/projects/p1/previews/${session.id}/proxy/`,
    );
  }, 30_000);

  it('lists a preview on the host the list request arrived on', async () => {
    const { apiPort } = await boot();

    const created = await startPreview(apiPort, `127.0.0.1:${apiPort}`);
    expect(created.status).toBe(200);
    const session = created.body as { id: string; url: string };
    // A caller on the daemon's own machine gets the same path on their front.
    expect(session.url).toBe(`http://127.0.0.1:${apiPort}/api/projects/p1/previews/${session.id}/proxy/`);

    const listed = await request(apiPort, 'GET', '/api/projects/p1/previews', {
      host: TAILNET_HOST,
    });
    expect(listed.status).toBe(200);
    expect((listed.body as { previews: Array<{ url: string }> }).previews).toEqual([
      expect.objectContaining({
        url: `http://devins-macbook-pro.tail908c18.ts.net:7443/api/projects/p1/previews/${session.id}/proxy/`,
      }),
    ]);
  }, 30_000);

  it('serves the preview under the announced path', async () => {
    const { apiPort } = await boot();
    const created = await startPreview(apiPort, TAILNET_HOST);
    const session = created.body as { id: string };
    const base = `/api/projects/p1/previews/${session.id}/proxy/`;

    const served = await request(apiPort, 'GET', base, { host: TAILNET_HOST });
    expect(served.status).toBe(200);
    expect(served.body).toBe('preview-ok');
    expect(served.headers['content-type']).toContain('text/html');
    // A preview cookie is scoped to the preview, not to the whole daemon.
    expect(served.headers['set-cookie']).toEqual([expect.stringContaining(`Path=${base}`)]);
  }, 30_000);

  it('forwards a request body to the preview verbatim', async () => {
    const { apiPort } = await boot();
    const created = await startPreview(apiPort, TAILNET_HOST);
    const session = created.body as { id: string };

    const posted = await request(
      apiPort,
      'POST',
      `/api/projects/p1/previews/${session.id}/proxy/submit`,
      { host: TAILNET_HOST, body: { hello: 'preview' } },
    );
    expect(posted.status).toBe(200);
    expect(posted.body).toEqual({ echo: '{"hello":"preview"}' });
  }, 30_000);

  it('re-states the framing headers of a body the daemon decoded', async () => {
    const { apiPort } = await boot();
    const created = await startPreview(apiPort, TAILNET_HOST);
    const session = created.body as { id: string };
    const plain = 'compressed preview payload';
    const compressed = gzipSync(Buffer.from(plain));

    const posted = await request(
      apiPort,
      'POST',
      `/api/projects/p1/previews/${session.id}/proxy/echo-framing`,
      {
        host: TAILNET_HOST,
        rawBody: compressed,
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip' },
      },
    );
    // The parser in front of the mount decodes the body, so the child must be
    // told about the bytes it is actually getting: no Content-Encoding, and a
    // Content-Length that names the decoded size, not the compressed one.
    expect(posted.status).toBe(200);
    expect(posted.body).toEqual({
      echo: plain,
      received: plain.length,
      contentLength: String(plain.length),
      contentEncoding: null,
    });
    expect(compressed.length).not.toBe(plain.length);
  }, 30_000);

  it('forwards the caller headers a preview needs, and never the daemon bearer', async () => {
    const { apiPort } = await boot();
    const created = await startPreview(apiPort, TAILNET_HOST);
    const session = created.body as { id: string };

    const echoed = await request(
      apiPort,
      'GET',
      `/api/projects/p1/previews/${session.id}/proxy/echo-headers`,
      {
        host: TAILNET_HOST,
        headers: {
          Range: 'bytes=0-99',
          Cookie: 'app_session=abc',
          Authorization: 'Bearer daemon-only-secret',
          'Accept-Encoding': 'gzip',
        },
      },
    );
    expect(echoed.status).toBe(200);
    const upstreamHeaders = echoed.body as Record<string, string>;
    expect(upstreamHeaders.range).toBe('bytes=0-99');
    expect(upstreamHeaders.cookie).toBe('app_session=abc');
    expect(upstreamHeaders['accept-encoding']).toBe('gzip');
    // The child is the project's own dev server; the daemon's credential is
    // not its business, and `host` names the loopback upstream.
    expect(upstreamHeaders.authorization).toBeUndefined();
    expect(upstreamHeaders.host).toMatch(/^127\.0\.0\.1:\d+$/);
  }, 30_000);

  it('re-anchors a root-absolute redirect on the preview base path', async () => {
    const { apiPort } = await boot();
    const created = await startPreview(apiPort, TAILNET_HOST);
    const session = created.body as { id: string };
    const base = `/api/projects/p1/previews/${session.id}/proxy/`;

    const redirected = await request(apiPort, 'GET', `${base}redirect`, { host: TAILNET_HOST });
    expect(redirected.status).toBe(302);
    expect(redirected.headers.location).toBe(`${base}landed`);
  }, 30_000);

  it('serves a root-absolute asset for the preview page that asked for it', async () => {
    const { apiPort } = await boot();
    const created = await startPreview(apiPort, TAILNET_HOST);
    const session = created.body as { id: string };
    const base = `/api/projects/p1/previews/${session.id}/proxy/`;

    const asset = await request(apiPort, 'GET', '/style.css', {
      host: TAILNET_HOST,
      headers: { Referer: `http://${TAILNET_HOST}${base}` },
    });
    expect(asset.status).toBe(200);
    expect(asset.body).toBe('body{color:red}');
  }, 30_000);

  it('carries a WebSocket upgrade through to the preview', async () => {
    const { apiPort } = await boot();
    const created = await startPreview(apiPort, TAILNET_HOST);
    const session = created.body as { id: string };

    const handshake = await new Promise<{ status: number; first: string }>((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: apiPort,
        path: `/api/projects/p1/previews/${session.id}/proxy/_hmr`,
        headers: {
          Host: TAILNET_HOST,
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        },
      });
      req.on('upgrade', (res, socket, head) => {
        const first = head.length ? head.toString() : '';
        if (first) {
          socket.destroy();
          resolve({ status: res.statusCode ?? 0, first });
          return;
        }
        socket.once('data', (chunk: Buffer) => {
          socket.destroy();
          resolve({ status: res.statusCode ?? 0, first: chunk.toString() });
        });
      });
      req.on('response', (res) => reject(new Error(`upgrade refused with ${res.statusCode}`)));
      req.on('error', reject);
      req.end();
    });

    expect(handshake.status).toBe(101);
    expect(handshake.first).toBe('hmr-ready');
  }, 30_000);

  it('answers a stopped preview with a named response instead of proxying', async () => {
    const { apiPort } = await boot();
    const created = await startPreview(apiPort, TAILNET_HOST);
    const session = created.body as { id: string };
    const base = `/api/projects/p1/previews/${session.id}/proxy/`;

    const stopped = await request(apiPort, 'DELETE', `/api/projects/p1/previews/${session.id}`, {
      host: TAILNET_HOST,
    });
    expect(stopped.status).toBe(200);

    const stale = await request(apiPort, 'GET', base, { host: TAILNET_HOST });
    expect(stale.status).toBe(404);
    expect(stale.body).toMatchObject({ error: 'PREVIEW_NOT_FOUND' });
    expect((stale.body as { message: string }).message).toContain('no longer running');
  }, 30_000);
});
