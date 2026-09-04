import http from 'node:http';
import os from 'node:os';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

/**
 * A preview is served from the daemon's OWN origin (decision D-14, option A),
 * so a preview page's scripts are same-origin with every `/api` route. The
 * daemon confines them: a request a browser attributes to a preview page
 * reaches that preview's own subtree and nothing else under `/api`.
 *
 * This runs the real daemon on a NON-loopback interface with `OD_API_TOKEN`
 * set — the production remote gate — and asserts on the daemon's answer to
 * three requests that differ only in the page the browser says asked. A
 * request refused for some incidental reason would not distinguish them, so
 * every case asserts the named confinement error rather than the status alone.
 */

const API_TOKEN = 'w2g2-preview-confinement-token';
const CONFINEMENT_ERROR = 'Preview origin cannot access this API route';

/** A loopback-only child: exactly the shape every framework dev server has. */
const LOOPBACK_CHILD = `
const http = require('node:http');
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('preview-ok');
}).listen(Number(process.env.PORT), '127.0.0.1');
`;

/** An address of this machine that is NOT loopback: the collaborator side. */
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

/** A port nothing is listening on, on every interface. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '0.0.0.0', () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

type Reply = { status: number; body: string };

async function get(url: string, headers: Record<string, string>): Promise<Reply> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
    return { status: res.status, body: (await res.text()).trim() };
  } catch (error) {
    return { status: 0, body: `unreachable: ${(error as Error).message}` };
  }
}

describe('a preview page cannot act as the Open Design app', () => {
  const PREVIOUS_TOKEN = process.env.OD_API_TOKEN;
  let server: http.Server | undefined;
  let shutdown: (() => Promise<void> | void) | undefined;

  afterEach(async () => {
    if (shutdown) await Promise.resolve(shutdown());
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    server = undefined;
    shutdown = undefined;
    if (PREVIOUS_TOKEN === undefined) delete process.env.OD_API_TOKEN;
    else process.env.OD_API_TOKEN = PREVIOUS_TOKEN;
  });

  it('confines a preview page to its own subtree under /api', async () => {
    // A loopback-only runner cannot stand a collaborator up at all, and a
    // confinement that was never asked to decide anything is not evidence.
    // The spec fails rather than reporting a green it did not earn.
    const remoteHost = nonLoopbackIPv4();
    expect(
      remoteHost,
      'this spec needs a non-loopback IPv4 address to stand in for a collaborator machine',
    ).not.toBeNull();

    process.env.OD_API_TOKEN = API_TOKEN;
    const started = (await startServer({ port: 0, host: remoteHost!, returnServer: true })) as {
      url: string;
      server: http.Server;
      shutdown: () => Promise<void> | void;
    };
    server = started.server;
    shutdown = started.shutdown;
    const daemonPort = (started.server.address() as AddressInfo).port;
    const front = `http://${remoteHost}:${daemonPort}`;
    const auth = { Authorization: `Bearer ${API_TOKEN}` };

    const projectId = `w2g2-confine-${Date.now()}`;
    const createdProject = await fetch(`${front}/api/projects`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: projectId }),
    });
    expect(createdProject.status).toBeLessThan(300);
    const seeded = await fetch(`${front}/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'README.md', content: 'w2g2 confinement fixture' }),
    });
    expect(seeded.status).toBeLessThan(300);

    const previewPort = await freePort();
    const startedPreview = await fetch(`${front}/api/projects/${projectId}/previews`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: [process.execPath, '-e', LOOPBACK_CHILD], port: previewPort }),
    });
    expect(startedPreview.status).toBe(200);
    const announced = (await startedPreview.json()) as { id: string; url: string };

    // What a browser sends for a same-origin call made BY the preview page.
    const fromPreviewPage = {
      ...auth,
      Origin: front,
      Referer: announced.url,
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
    };

    try {
      // A privileged route the preview page has no business reaching.
      const escaped = await get(`${front}/api/projects`, fromPreviewPage);
      expect(escaped.status).toBe(403);
      expect(escaped.body).toContain(CONFINEMENT_ERROR);

      // Including the routes that return early from the `/api` origin
      // middleware. The live-artifact embed route reads as loopback-only, but
      // a preview page running on the daemon's own machine IS a loopback peer,
      // so the confinement has to be ahead of that early return.
      const embed = await get(`${front}/api/live-artifacts/w2g2-no-such-artifact/preview`, fromPreviewPage);
      expect(embed.status).toBe(403);
      expect(embed.body).toContain(CONFINEMENT_ERROR);

      // The same route, asked for by the app's own page, is untouched.
      const fromAppPage = await get(`${front}/api/projects`, {
        ...auth,
        Origin: front,
        Referer: `${front}/projects/${projectId}`,
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
      });
      expect(fromAppPage.body).not.toContain(CONFINEMENT_ERROR);
      expect(fromAppPage.status).toBe(200);

      // And the preview still reaches its own subtree, which is the whole
      // point of serving it here: the confinement must not close the route it
      // is guarding.
      expect(await get(announced.url, fromPreviewPage)).toEqual({ status: 200, body: 'preview-ok' });
    } finally {
      await fetch(`${front}/api/projects/${projectId}/previews/${announced.id}`, {
        method: 'DELETE',
        headers: auth,
      }).catch(() => {});
    }
  }, 120_000);
});
