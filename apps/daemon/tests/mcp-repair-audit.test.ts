// Red spec for W1G.4, finding 2 (MEDIUM/SECURITY): the MCP cache repair
// removes a directory without leaving a record.
//
// The removal is a destructive write to another tool's state -- an npx cache
// entry outside the daemon's own data root. The daemon records route-owned
// filesystem mutations by wrapping `createFilesystemWriteGateway` with the
// configured `filesystemWriteAuditSink` (`server.ts` ->
// `createRouteFilesystemWriteGateway`) and handing the wrapped factory to
// every route module that writes. The MCP route never received it, and
// `applyMcpServerRepair` built its own unwrapped gateway instead, so the one
// destructive external-tool write the daemon performs left no audit record.
//
// Containment was never the gap and is not what this file asserts: the two
// removal rules and the confirmation gate are covered by
// `mcp-cache-repair.test.ts` and must not move. This file asserts only that
// the removal is recorded -- once at the route seam, with a sink the route is
// handed directly, and once through the real daemon, which is what proves
// `server.ts` hands the MCP route the audited factory rather than a bare one.

import http from 'node:http';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFilesystemWriteGateway } from '../src/filesystem/write-gateway.js';
import type { FilesystemWriteAuditEntry } from '../src/filesystem/write-gateway.js';
import { registerMcpRoutes } from '../src/mcp-routes.js';
import { isLocalSameOrigin } from '../src/origin-validation.js';
import { startServer } from '../src/server.js';

/** The npx cache entry hash from issue #157. */
const CACHE_HASH = 'adab5b373aa91713';

let dataDir = '';
let cacheEntry = '';
let routeServer: http.Server | null = null;
let daemonShutdown: (() => Promise<void> | void) | null = null;
let daemonConfigPath = '';
const audit: FilesystemWriteAuditEntry[] = [];

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * The #157 fixture: a half-written npx cache entry on disk, plus an MCP server
 * whose own stderr names it in npm's ENOENT wording. Written under `root`, so
 * the same fixture serves both the route seam and the real daemon.
 */
async function writeBrokenServerFixture(root: string, configDir: string): Promise<string> {
  const entry = join(root, 'npm-cache', '_npx', CACHE_HASH);
  await mkdir(join(entry, 'node_modules'), { recursive: true });
  await writeFile(join(entry, 'node_modules', 'marker.txt'), 'present', 'utf8');

  const brokenSrc =
    `process.stderr.write(${JSON.stringify(
      `npm error code ENOENT\nnpm error syscall open\nnpm error path ${join(entry, 'package.json')}\nnpm error errno -2\nnpm error enoent ENOENT: no such file or directory, open '${join(entry, 'package.json')}'\n`,
    )});\nprocess.exit(1);\n`;

  await writeFile(
    join(configDir, 'mcp-config.json'),
    JSON.stringify({
      servers: [
        {
          id: 'mermaid',
          label: 'Mermaid',
          transport: 'stdio',
          enabled: true,
          command: process.execPath,
          args: ['-e', brokenSrc],
        },
      ],
    }),
    'utf8',
  );
  return entry;
}

async function postRepair(baseUrl: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}/api/mcp/repair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ serverId: 'mermaid', confirm: true }),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, json: null };
  }
}

/**
 * Mount the MCP routes on a bare express app with the given `filesystem` dep,
 * the same shape `server.ts` passes. `undefined` is the misregistration case.
 */
async function mountRoutes(
  filesystem: { create: typeof createFilesystemWriteGateway } | undefined,
): Promise<string> {
  const app = express();
  app.use(express.json());
  const resolvedPortRef = { current: 0 };
  registerMcpRoutes(app, {
    http: {
      createSseResponse: () => undefined,
      isLocalSameOrigin,
      requireLocalDaemonRequest: () => true,
      resolvedPortRef,
      sendApiError: (res: any, status: number, code: string, message: string) =>
        res.status(status).json({ error: { code, message } }),
      sendLiveArtifactRouteError: () => undefined,
      sendMulterError: () => undefined,
    } as any,
    paths: {
      OD_BIN: join(dataDir, 'cli.js'),
      RUNTIME_DATA_DIR: dataDir,
      PROJECTS_DIR: join(dataDir, 'projects'),
    } as any,
    mcp: {
      pendingAuth: new Map(),
      daemonUrlRef: { current: 'http://127.0.0.1:0' },
    } as any,
    ...(filesystem ? { filesystem } : {}),
  });
  return new Promise<string>((resolve, reject) => {
    routeServer = app.listen(0, '127.0.0.1', () => {
      const addr = routeServer?.address();
      if (!addr || typeof addr !== 'object') {
        reject(new Error('could not bind'));
        return;
      }
      resolvedPortRef.current = addr.port;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
    routeServer?.on('error', reject);
  });
}

/** The audited removal of the cache entry, or undefined when none was recorded. */
function auditedRemoval(): FilesystemWriteAuditEntry | undefined {
  return audit.find(
    (entry) =>
      entry.operation === 'rm' &&
      entry.capability === 'externalTool' &&
      entry.destination.endsWith(join('_npx', CACHE_HASH)),
  );
}

beforeEach(async () => {
  audit.length = 0;
  dataDir = await mkdtemp(join(tmpdir(), 'od-mcp-repair-audit-'));
  cacheEntry = await writeBrokenServerFixture(dataDir, dataDir);
});

afterEach(async () => {
  if (routeServer) await new Promise<void>((resolve) => routeServer?.close(() => resolve()));
  routeServer = null;
  if (daemonShutdown) await daemonShutdown();
  daemonShutdown = null;
  if (daemonConfigPath) await rm(daemonConfigPath, { force: true });
  daemonConfigPath = '';
  await rm(dataDir, { recursive: true, force: true });
});

describe('the MCP cache repair is recorded on the daemon audited write gateway', () => {
  it('records the removal on the gateway factory the route was given', async () => {
    const baseUrl = await mountRoutes({
      create: (options) =>
        createFilesystemWriteGateway({
          ...options,
          auditSink: (entry) => audit.push(entry),
        }),
    });

    const res = await postRepair(baseUrl);

    expect(res.status).toBe(200);
    expect(res.json?.removed).toBe(true);
    expect(await exists(cacheEntry)).toBe(false);
    expect(
      auditedRemoval(),
      `the removal left no audit record; entries seen: ${JSON.stringify(audit)}`,
    ).toBeDefined();
  }, 60_000);

  it('refuses rather than removing when no gateway factory was supplied', async () => {
    const baseUrl = await mountRoutes(undefined);

    const res = await postRepair(baseUrl);

    expect(res.status).toBe(500);
    expect(res.json?.error?.code).toBe('MCP_REPAIR_FAILED');
    expect(await exists(cacheEntry)).toBe(true);
  }, 60_000);

  it('records the removal through the real daemon audit sink', async () => {
    daemonConfigPath = join(process.env.OD_DATA_DIR!, 'mcp-config.json');
    await writeBrokenServerFixture(dataDir, process.env.OD_DATA_DIR!);

    const started = (await startServer({
      port: 0,
      returnServer: true,
      filesystemWriteAuditSink: (entry) => audit.push(entry),
    })) as { url: string; shutdown: () => Promise<void> | void };
    daemonShutdown = started.shutdown;

    const res = await postRepair(started.url);

    expect(res.status).toBe(200);
    expect(res.json?.removed).toBe(true);
    expect(
      auditedRemoval(),
      `the daemon removed the entry without recording it; entries seen: ${JSON.stringify(audit)}`,
    ).toBeDefined();
  }, 60_000);
});
