// W8B work item 2: `GET /api/media/jobs/limits` is the one media-job route
// in routes/media.ts that never calls `isLocalSameOrigin(req,
// getResolvedPort())` — its handler (routes/media.ts:876-878) even names the
// request parameter `_req` to signal it is unused. Every sibling in that
// file gates on it first (:823-825, :842-844, :881-885).
//
// The gap is only observable for the ONE request shape the daemon's global
// `/api` origin middleware (server.ts:2465+) deliberately lets through: a
// GET carrying a PORTLESS loopback Origin (`http://localhost`). The global
// middleware exempts exactly that case (server.ts: `if (req.method !== 'GET'
// || !isPortlessLoopbackOrigin(String(origin)))`), leaving the per-route
// `isLocalSameOrigin` check as the only thing that can refuse it. A sibling
// media route refuses it; the limits route answers 200.
//
// RED on base: the sibling answers 403 and the limits route answers 200 for
// the identical request — a status assertion about the route's own
// behaviour, not a compile or import failure (the route already exists and
// already answers on base).

import http from 'node:http';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, insertProject, openDatabase } from '../../src/db.js';
import { startServer } from '../../src/server.js';

type StartedServer = { url: string; server: Server };

let server: Server | undefined;
let baseUrl = '';
let projectId = '';

beforeEach(async () => {
  const dataDir = process.env.OD_DATA_DIR;
  if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
  const db = openDatabase(process.cwd(), { dataDir });
  projectId = `project_${randomUUID()}`;
  const now = Date.now();
  insertProject(db, { id: projectId, name: 'media limits origin project', createdAt: now, updatedAt: now });
  const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
  server = started.server;
  baseUrl = started.url;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve();
    server.close((error?: Error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
  closeDatabase();
});

/**
 * A GET over raw `node:http` (Origin and Sec-Fetch-* are forbidden header
 * names for `fetch()`, so this mirrors
 * apps/daemon/tests/api-origin-fetch-metadata.test.ts and
 * video-import-routes.test.ts:66-83) carrying the header set of a
 * cross-origin browser page whose origin the daemon's global `/api`
 * middleware waves through: a portless loopback Origin on a safe method.
 */
function portlessLoopbackOriginGet(url: string): Promise<{ status: number; body: string }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: 'GET',
        headers: { origin: 'http://localhost', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('GET /api/media/jobs/limits — same-origin parity with its sibling media routes (INV-7.14)', () => {
  it('refuses the same cross-origin request its sibling media-tasks route refuses', async () => {
    const sibling = await portlessLoopbackOriginGet(`${baseUrl}/api/projects/${projectId}/media/tasks`);
    expect(sibling.status, 'control: the sibling media route already enforces isLocalSameOrigin').toBe(403);

    const limits = await portlessLoopbackOriginGet(`${baseUrl}/api/media/jobs/limits`);
    expect(
      limits.status,
      'RED on base: the limits route answers 200 for the request its sibling refuses',
    ).toBe(403);
    expect(JSON.parse(limits.body).error).toBe('cross-origin request rejected');
  });

  it('still serves the resolved limits to a same-origin caller', async () => {
    const res = await fetch(`${baseUrl}/api/media/jobs/limits`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.maxDurationMs).toBe('number');
    expect(typeof body.maxOutputBytes).toBe('number');
    expect(typeof body.maxConcurrent).toBe('number');
  });
});
