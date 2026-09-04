import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import {
  PREVIEW_PROXY_MOUNT,
  createPreviewProxyUpgradeHandler,
  createPreviewRootAssetFallback,
} from '../src/preview-proxy.js';
import { createPreviewService } from '../src/previews.js';
import { registerPreviewRoutes } from '../src/routes/preview.js';

/**
 * The membership rule and the same-site check on the two preview entry points
 * Express middleware cannot cover: the root-absolute asset fallback, which
 * answers paths outside `/api`, and the WebSocket upgrade, which never enters
 * the router at all (decision D-14, condition 3).
 *
 * Everything here runs from a NON-loopback peer with `OD_API_TOKEN` set — the
 * production remote gate — because that is the only context in which the rule
 * has anything to decide. A loopback peer passes by definition, so a
 * loopback-bound fixture would exercise no branch.
 */

const TAILNET_HOST = 'devins-macbook-pro.tail908c18.ts.net:7443';
const API_TOKEN = 'w2g2-preview-gate-token';

const SERVER_FIXTURE = `
const http = require('node:http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/css' });
  res.end('body{color:red}');
});
server.on('upgrade', (req, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n\\r\\n');
  socket.write('hmr-ready');
});
server.listen(Number(process.env.PORT), '127.0.0.1');
`;

/**
 * The same child, still compiling: it accepts the upgrade and does not answer
 * it. This is the ordinary state of a dev server's HMR endpoint for the first
 * seconds of its life, and the window in which a browser reload abandons the
 * handshake.
 */
const SLOW_UPGRADE_FIXTURE = `
const http = require('node:http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/css' });
  res.end('body{color:red}');
});
server.on('upgrade', (req, socket) => {
  socket.on('error', () => {});
});
server.listen(Number(process.env.PORT), '127.0.0.1');
`;

/**
 * An address of this machine that is not loopback: the collaborator-side
 * network context. Without one the gate under test never runs, so the spec
 * says so rather than passing quietly.
 */
function nonLoopbackIPv4(): string | null {
  const candidates: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      candidates.push(entry.address);
    }
  }
  const lan = candidates.find((a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a));
  return lan ?? candidates[0] ?? null;
}

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

type Reply = { status: number; body: string };

/** What happened to an upgrade: carried, answered as plain HTTP, or closed. */
type UpgradeOutcome = { kind: 'upgraded'; status: number } | { kind: 'response'; status: number } | { kind: 'closed' };

describe('the preview proxy gate on the entry points outside the router', () => {
  const PREVIOUS_TOKEN = process.env.OD_API_TOKEN;
  const services: Array<ReturnType<typeof createPreviewService>> = [];
  const servers: http.Server[] = [];
  const tempDirs: string[] = [];
  let peerHost: string | null = null;

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
    if (PREVIOUS_TOKEN === undefined) delete process.env.OD_API_TOKEN;
    else process.env.OD_API_TOKEN = PREVIOUS_TOKEN;
  });

  /**
   * The daemon's own wiring for the two handlers, bound to a non-loopback
   * address and guarded by a configured token. The `/api` routes themselves
   * carry no bearer middleware here: what is under test is the rule the two
   * handlers apply by hand, not the middleware that already covers `/api`.
   */
  async function boot(fixture: string = SERVER_FIXTURE): Promise<{ apiPort: number; previewId: string; base: string }> {
    // Fails rather than skips, for the reason given on `nonLoopbackIPv4`: a
    // loopback peer passes the membership rule by definition, so a skip would
    // report these gate cases green on a run that exercised no branch of them.
    const host = nonLoopbackIPv4();
    expect(host, 'this spec needs a non-loopback IPv4 address to stand in for a collaborator machine').not.toBeNull();
    peerHost = host;
    process.env.OD_API_TOKEN = API_TOKEN;

    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-preview-gate-'));
    tempDirs.push(tempDir);
    writeFileSync(path.join(tempDir, 'server.js'), fixture);

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
    app.use(createPreviewRootAssetFallback({ getPreview: (id) => previews.get(id) }));
    const server = http.createServer(app);
    server.on('upgrade', createPreviewProxyUpgradeHandler({ getPreview: (id) => previews.get(id) }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, host!, resolve));
    const apiPort = (server.address() as AddressInfo).port;

    const started = await get(apiPort, '/api/projects/p1/previews', {
      method: 'POST',
      host: TAILNET_HOST,
      body: JSON.stringify({ command: [process.execPath, 'server.js'], port: await freePort() }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(started.status).toBe(200);
    const previewId = (JSON.parse(started.body) as { id: string }).id;
    return { apiPort, previewId, base: `/api/projects/p1/previews/${previewId}/proxy/` };
  }

  // node:http rather than fetch: these specs turn on the exact `Host`,
  // `Origin`, and `X-Forwarded-*` headers a front sends, which only a raw
  // request can set verbatim.
  function get(
    apiPort: number,
    pathname: string,
    options: { method?: string; host: string; body?: string; headers?: Record<string, string> },
  ): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: peerHost!,
          port: apiPort,
          method: options.method ?? 'GET',
          path: pathname,
          headers: {
            Host: options.host,
            ...(options.headers ?? {}),
            ...(options.body ? { 'Content-Length': Buffer.byteLength(options.body) } : {}),
          },
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
        },
      );
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  function upgrade(
    apiPort: number,
    pathname: string,
    options: { host: string; headers?: Record<string, string> },
  ): Promise<UpgradeOutcome> {
    return new Promise((resolve) => {
      const req = http.request({
        host: peerHost!,
        port: apiPort,
        path: pathname,
        headers: {
          Host: options.host,
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          ...(options.headers ?? {}),
        },
      });
      req.on('upgrade', (res, socket) => {
        socket.destroy();
        resolve({ kind: 'upgraded', status: res.statusCode ?? 0 });
      });
      req.on('response', (res) => {
        res.resume();
        resolve({ kind: 'response', status: res.statusCode ?? 0 });
      });
      req.on('error', () => resolve({ kind: 'closed' }));
      req.on('close', () => resolve({ kind: 'closed' }));
      req.end();
    });
  }

  /**
   * A browser that gives up on a handshake the preview child has not answered:
   * the raw request bytes, then an RST. `net` rather than `http.request`,
   * because a Node client will not reset a request it owns, and a FIN does not
   * reproduce the failure — the socket must raise `ECONNRESET`.
   */
  function resetPendingUpgrade(apiPort: number, pathname: string): Promise<void> {
    return new Promise((resolve) => {
      const client = net.connect(apiPort, peerHost!, () => {
        client.write(
          `GET ${pathname} HTTP/1.1\r\n`
          + `Host: ${TAILNET_HOST}\r\n`
          + 'Connection: Upgrade\r\nUpgrade: websocket\r\n'
          + 'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
          + `Authorization: Bearer ${API_TOKEN}\r\n\r\n`,
        );
        setTimeout(() => {
          client.resetAndDestroy();
          resolve();
        }, 150);
      });
      client.on('error', () => resolve());
    });
  }

  it('survives a client that resets a handshake the preview has not answered', async () => {
    const { apiPort, base } = await boot(SLOW_UPGRADE_FIXTURE);

    // Node hands the upgrade socket over with its own error listener removed,
    // so an unheard reset here reaches the process as an `uncaughtException` —
    // which the daemon's fatal telemetry handler turns into `process.exit(1)`
    // for every session on the machine.
    const uncaught: unknown[] = [];
    const capture = (error: unknown) => uncaught.push(error);
    process.on('uncaughtException', capture);
    try {
      await resetPendingUpgrade(apiPort, `${base}_hmr`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    } finally {
      process.off('uncaughtException', capture);
    }

    expect(uncaught).toEqual([]);

    // And the daemon is still the daemon: the next request is served.
    const served = await get(apiPort, '/style.css', {
      host: TAILNET_HOST,
      headers: { Referer: `https://${TAILNET_HOST}${base}`, Authorization: `Bearer ${API_TOKEN}` },
    });
    expect(served.status).toBe(200);
    expect(served.body).toBe('body{color:red}');
  }, 30_000);

  it('refuses a root-absolute preview asset from a collaborator with no bearer', async () => {
    const { apiPort, base } = await boot();

    const refused = await get(apiPort, '/style.css', {
      host: TAILNET_HOST,
      headers: { Referer: `https://${TAILNET_HOST}${base}` },
    });

    // The fallback declines, so the daemon answers as it does for any path it
    // does not own. The preview's bytes are not in the answer.
    expect(refused.status).toBe(404);
    expect(refused.body).not.toContain('body{color:red}');
  }, 30_000);

  it('serves that asset once the collaborator presents the bearer', async () => {
    const { apiPort, base } = await boot();

    const served = await get(apiPort, '/style.css', {
      host: TAILNET_HOST,
      headers: { Referer: `https://${TAILNET_HOST}${base}`, Authorization: `Bearer ${API_TOKEN}` },
    });

    expect(served.status).toBe(200);
    expect(served.body).toBe('body{color:red}');
  }, 30_000);

  it('refuses a root-absolute preview asset whose Referer names another site', async () => {
    const { apiPort, base } = await boot();

    // The path is a real preview's, but the page that carries it is not on
    // this front. A `Referer` any site can write must not name a session.
    const refused = await get(apiPort, '/style.css', {
      host: TAILNET_HOST,
      headers: {
        Referer: `https://attacker.example${base}`,
        Authorization: `Bearer ${API_TOKEN}`,
      },
    });

    expect(refused.status).toBe(404);
    expect(refused.body).not.toContain('body{color:red}');
  }, 30_000);

  it('refuses a root-absolute preview asset asked for by another site', async () => {
    const { apiPort, base } = await boot();

    const refused = await get(apiPort, '/style.css', {
      host: TAILNET_HOST,
      headers: {
        Referer: `https://${TAILNET_HOST}${base}`,
        Origin: 'https://attacker.example',
        Authorization: `Bearer ${API_TOKEN}`,
      },
    });

    expect(refused.status).toBe(404);
    expect(refused.body).not.toContain('body{color:red}');
  }, 30_000);

  it('closes an upgrade from a collaborator with no bearer', async () => {
    const { apiPort, base } = await boot();

    const outcome = await upgrade(apiPort, `${base}_hmr`, { host: TAILNET_HOST });

    expect(outcome).toEqual({ kind: 'closed' });
  }, 30_000);

  it('closes an upgrade whose Origin names another site', async () => {
    const { apiPort, base } = await boot();

    const outcome = await upgrade(apiPort, `${base}_hmr`, {
      host: TAILNET_HOST,
      headers: { Origin: 'https://attacker.example', Authorization: `Bearer ${API_TOKEN}` },
    });

    expect(outcome).toEqual({ kind: 'closed' });
  }, 30_000);

  it('carries an upgrade through a front that rewrote Host to its upstream address', async () => {
    const { apiPort, base } = await boot();

    // The shape `tailscale serve` produces: the front keeps the caller's
    // origin in `X-Forwarded-Host` and puts its own upstream address in
    // `Host`. A browser handshake always carries `Origin`, so a same-site
    // check that read `Host` alone would refuse the HMR channel of exactly the
    // collaborator this route exists for.
    const outcome = await upgrade(apiPort, `${base}_hmr`, {
      host: `${peerHost}:${apiPort}`,
      headers: {
        Origin: `https://${TAILNET_HOST}`,
        'X-Forwarded-Host': TAILNET_HOST,
        'X-Forwarded-Proto': 'https',
        Authorization: `Bearer ${API_TOKEN}`,
      },
    });

    expect(outcome).toEqual({ kind: 'upgraded', status: 101 });
  }, 30_000);
});
