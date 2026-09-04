import http from 'node:http';
import os from 'node:os';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

/**
 * Red spec for W2G.2 (findings F1 / F6 in `proof/w2/codex-wave-r1.json`).
 *
 * Track 2.2 made the daemon announce a preview on the host the request
 * arrived on. Nothing behind that name is listening: the preview child binds
 * `127.0.0.1` and the daemon only ever passes it `PORT`, so a collaborator is
 * handed `http://<their front>:<preview port>/` and their browser gets
 * ECONNREFUSED. The announcement is a label, not a route.
 *
 * This spec refuses to assert on the URL STRING, which is what F6 says the
 * wave-2 spec did wrong. It runs the real daemon on a NON-loopback interface
 * with `OD_API_TOKEN` set — the production remote gate — starts a preview whose
 * child binds loopback only, and then FETCHES the announced URL from that same
 * non-loopback network context. The bar is bytes, not a string.
 */

const API_TOKEN = 'w2g2-preview-proxy-token';
const PREVIEW_BODY = 'preview-ok';

/** A loopback-only child: exactly the shape every framework dev server has. */
const LOOPBACK_CHILD = `
const http = require('node:http');
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('${PREVIEW_BODY}');
}).listen(Number(process.env.PORT), '127.0.0.1');
`;

/**
 * An address of this machine that is NOT loopback — the collaborator-side
 * network context. Private LAN first so the daemon's own browser-origin rules
 * see a familiar shape; any non-internal IPv4 will do.
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

/**
 * A transport failure is the SYMPTOM here, so it must arrive as a value the
 * test can assert on — never as a rejected promise that reads like a broken
 * fixture.
 */
async function get(url: string, headers: Record<string, string>): Promise<Reply> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
    return { status: res.status, body: (await res.text()).trim() };
  } catch (error) {
    return { status: 0, body: `unreachable: ${(error as Error).message}` };
  }
}

describe('an announced preview URL is reachable from the host it names', () => {
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

  it('serves the preview to a collaborator off the daemon loopback', async () => {
    // A loopback-only runner cannot reproduce the bug at all: every fetch it
    // could make is from the child's own bind address, which is the string
    // oracle F6 rejects. The spec fails there rather than skipping, because a
    // skip reports this criterion green on a run that never made the request
    // the bar is about.
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
    // Every request below crosses the daemon's remote gate: a non-loopback
    // peer with the bearer the deployment requires.
    const auth = { Authorization: `Bearer ${API_TOKEN}` };

    const projectId = `w2g2-preview-${Date.now()}`;
    const createdProject = await fetch(`${front}/api/projects`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: projectId }),
    });
    expect(createdProject.status).toBeLessThan(300);
    // Materialize the project directory the preview will run in — the same
    // call the web file panel makes.
    const seeded = await fetch(`${front}/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'README.md', content: 'w2g2 preview fixture' }),
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

    try {
      // THE BAR. The announced URL is fetched from the same non-loopback
      // context the announcement was made to. Bytes, not a string.
      expect(await get(announced.url, auth)).toEqual({ status: 200, body: PREVIEW_BODY });

      // And the loopback child is not what got announced: its own port is a
      // private implementation detail of the daemon's machine.
      expect(announced.url).not.toContain(`:${previewPort}`);
      expect(announced.url).not.toContain('127.0.0.1');
    } finally {
      await fetch(`${front}/api/projects/${projectId}/previews/${announced.id}`, {
        method: 'DELETE',
        headers: auth,
      }).catch(() => {});
    }
  }, 120_000);
});
