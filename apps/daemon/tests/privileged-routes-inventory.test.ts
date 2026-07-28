// Real HTTP coverage for every row in
// apps/daemon/src/security/privileged-routes.json -- the inventory the W0
// wave gate's C0-7 criterion cross-checks against a static AST pass over
// requireLocalDaemonRequest-guarded routes. C0-7 itself asserts two things
// per row against a daemon it boots and probes directly (never through this
// suite): a hostile cross-origin request must be rejected (401/403 -- "this
// IS the security property C0-7 verifies", scripts/waves/verify-w0.ts), and
// an origin-less request (the CLI's own real shape) must NOT be rejected.
// This file gives that same property real, package-local test coverage so
// it is enforced by `pnpm --filter @open-design/daemon test`, not only by
// the wave gate.
//
// Real transport throughout (no mocked HTTP) per VERIFICATION-CONTRACT.md
// R2. One shared daemon boots every row's hostile-Origin probe -- that
// probe never reaches a route handler when the guard is doing its job, so
// no row (however side-effecting its handler) can leave state behind from
// that phase. The origin-less canary phase is shared too, EXCEPT for the
// two rows documented below as unsafe to invoke for real inside this
// process.

import type http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'prom-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface PrivilegedRoute {
  method: string;
  path: string;
  probePath?: string;
  probeBody?: unknown;
  expectedLocalStatus?: number;
  note?: string;
}

const routesJsonPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/security/privileged-routes.json',
);
const routes = JSON.parse(fs.readFileSync(routesJsonPath, 'utf8')) as PrivilegedRoute[];

// Rows whose real handler has an effect this in-process test harness cannot
// safely trigger:
//   - POST /api/daemon/shutdown: its handler calls process.emit('SIGTERM')
//     (apps/daemon/src/routes/daemon.ts) on the CURRENT process. Confirmed
//     live: with zero 'SIGTERM' listeners registered (this harness calls
//     startServer() directly, never through cli.ts's daemon-startup.ts,
//     which is the only place that installs one), Node's default signal
//     disposition still terminates the process -- invoking this route for
//     real here would kill the vitest worker, not just "the daemon".
//   - POST /api/agents/:agentId/oauth-launch: its only non-400 agentId
//     ('antigravity') opens a real Terminal.app window via osascript
//     (apps/daemon/src/runtimes/terminal-launch.ts) -- a genuine, visible
//     OS side effect, same reasoning as this row's own "note" in
//     privileged-routes.json for why the wave gate itself does not live-
//     probe it to a success conclusion either.
// Both rows' hostile-Origin rejection is still fully tested below -- that
// probe never reaches the handler, so it carries none of this risk.
const UNSAFE_FOR_LOCAL_CANARY = new Set(['POST /api/daemon/shutdown', 'POST /api/agents/:agentId/oauth-launch']);

// Rows where genuine 2xx local success is confirmed (live, on this branch)
// to be structurally unreachable in an isolated gate/test environment --
// mirrors each row's own "note" in privileged-routes.json. The expected
// status here is the route's real, deterministic, product-correct response
// to that precondition, not a placeholder.
const DOCUMENTED_NON_2XX_STATUS: Record<string, number> = {
  'POST /api/connectors/:connectorId/connect': 503, // no Composio API key configured (ConnectorServiceError, 503)
  'DELETE /api/library/assets/:id': 404, // getLibraryAsset() 404s -- no real asset exists to reference
  'POST /api/library/assets/:id/apply': 404, // same root cause as DELETE .../assets/:id
  'POST /api/library/assets/:id/edit-as-page': 404, // same root cause as DELETE .../assets/:id
  'GET /api/live-artifacts/:artifactId/preview': 404, // LIVE_ARTIFACT_NOT_FOUND -- no persisted live artifact exists
  'POST /api/live-artifacts/:artifactId/refresh': 404, // same root cause as GET .../preview
  'POST /api/applied-plugins/export': 404, // no AppliedPluginSnapshot exists for the probe project
};

function substituteNonce(value: unknown, nonce: string): unknown {
  if (typeof value === 'string') return value.split('<nonceProjectId>').join(nonce);
  if (Array.isArray(value)) return value.map((v) => substituteNonce(v, nonce));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, substituteNonce(v, nonce)]));
  }
  return value;
}

function buildProbeInit(method: string, hostileOrigin: string | null, body: unknown): RequestInit {
  const headers: Record<string, string> = { Host: '127.0.0.1' };
  if (hostileOrigin) headers.Origin = hostileOrigin;
  const init: RequestInit = { method, headers };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return init;
}

function resolveRow(row: PrivilegedRoute, nonceProjectId: string): { resolvedPath: string; body: unknown } {
  const declaredPath = row.probePath ?? row.path;
  const substituted = substituteNonce(declaredPath, nonceProjectId) as string;
  const resolvedPath = substituted.replace(/:[a-zA-Z]+/g, 'w0-verifier-probe-id');
  const body = row.probeBody !== undefined ? substituteNonce(row.probeBody, nonceProjectId) : undefined;
  return { resolvedPath, body };
}

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
let nonceProjectId = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-privileged-routes-inventory-'));
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

  nonceProjectId = `w0-c07-inventory-fixture-${Math.random().toString(36).slice(2)}`;
  await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: nonceProjectId, name: nonceProjectId }),
  });
});

afterAll(async () => {
  if (daemonShutdown) {
    await Promise.race([Promise.resolve(daemonShutdown()), new Promise((r) => setTimeout(r, 2000))]);
  }
  daemon?.closeAllConnections?.();
  await new Promise<void>((resolve) => daemon?.close(() => resolve()) ?? resolve());
  if (PREV_DATA_DIR === undefined) delete process.env.OD_DATA_DIR;
  else process.env.OD_DATA_DIR = PREV_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  register.clear();
});

describe('privileged routes inventory (C0-7)', () => {
  it('(C0-7/control) a known guarded route rejects a hostile Origin AND accepts the CLI\'s own origin-less shape', async () => {
    // Baseline proving the methodology itself distinguishes pass from fail
    // on a single well-known row before trusting the full per-row sweep
    // below: requireLocalDaemonRequest must reject a hostile cross-origin
    // caller on this route, but must NOT reject the genuine local-CLI
    // shape (no Origin header at all) on the exact same route.
    const row = routes.find((r) => r.method === 'POST' && r.path === '/api/daemon/db/verify');
    expect(row, 'control row POST /api/daemon/db/verify must exist in the inventory').toBeDefined();
    const { resolvedPath, body } = resolveRow(row!, nonceProjectId);

    const hostileRes = await fetch(`${baseUrl}${resolvedPath}`, buildProbeInit(row!.method, 'https://evil.invalid', body));
    expect([401, 403]).toContain(hostileRes.status);
    await hostileRes.text().catch(() => undefined);

    const localRes = await fetch(`${baseUrl}${resolvedPath}`, buildProbeInit(row!.method, null, body));
    expect(localRes.status).not.toBe(401);
    expect(localRes.status).not.toBe(403);
    await localRes.text().catch(() => undefined);
  });

  for (const row of routes) {
    const key = `${row.method} ${row.path}`;

    it(`(C0-7/route) hostile Origin is rejected: ${key}`, async () => {
      const { resolvedPath, body } = resolveRow(row, nonceProjectId);
      const res = await fetch(`${baseUrl}${resolvedPath}`, buildProbeInit(row.method, 'https://evil.invalid', body));
      expect([401, 403], `${key} -> status ${res.status}`).toContain(res.status);
      await res.text().catch(() => undefined);
    });

    if (!UNSAFE_FOR_LOCAL_CANARY.has(key)) {
      it(`(C0-7/route) origin-less local request resolves to its real status: ${key}`, async () => {
        const { resolvedPath, body } = resolveRow(row, nonceProjectId);
        const res = await fetch(`${baseUrl}${resolvedPath}`, buildProbeInit(row.method, null, body));
        await res.text().catch(() => undefined);

        expect(res.status, `${key} must never resolve the guard-rejection statuses on an origin-less request`).not.toBe(401);
        expect(res.status).not.toBe(403);

        if (typeof row.expectedLocalStatus === 'number') {
          expect(res.status).toBe(row.expectedLocalStatus);
        } else if (key in DOCUMENTED_NON_2XX_STATUS) {
          expect(res.status).toBe(DOCUMENTED_NON_2XX_STATUS[key]);
        } else {
          expect(res.status, `${key} -> status ${res.status}`).toBeGreaterThanOrEqual(200);
          expect(res.status).toBeLessThan(300);
        }
      });
    }
  }
});
