// Red spec for W1F.3, finding 2: the mermaid cache repair is an action.
//
// Issue #157's `mermaid` server never starts because its npx cache entry is
// half-written -- `node_modules/` is present, `package.json` is gone -- and npm
// reports it as `ENOENT ... _npx/<hash>/package.json`. `mcpFailureRemedy`
// recognizes that signature and returns a sentence telling the user to remove
// the directory. Nothing removes it.
//
// This file asserts the repair as a capability: a path MishMash derives from
// the failing server's own stderr, an endpoint that refuses to act without an
// explicit confirmation from the caller, and a removal that happens only after
// that confirmation. The `od mcp repair` half is
// `apps/daemon/tests/mcp-repair-cli.test.ts`; the UI half is
// `apps/web/tests/components/McpHealthPanel.test.tsx`.

import http from 'node:http';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mcpNpxCacheRepair } from '../src/mcp-health.js';
import { registerMcpRoutes } from '../src/mcp-routes.js';
import { isLocalSameOrigin } from '../src/origin-validation.js';

/** The npx cache entry hash from issue #157. */
const CACHE_HASH = 'adab5b373aa91713';

let dataDir = '';
let cacheEntry = '';
let server: http.Server | null = null;
let baseUrl = '';

async function start(): Promise<void> {
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
  });
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server?.address();
      if (!addr || typeof addr !== 'object') {
        reject(new Error('could not bind'));
        return;
      }
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolvedPortRef.current = addr.port;
      resolve();
    });
    server?.on('error', reject);
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function postJson(
  path: string,
  body: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, json: null };
  }
}

async function getJson(path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  try {
    return { status: res.status, json: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, json: null };
  }
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'od-mcp-repair-'));
  // The half-written cache entry from #157, reproduced on disk: the tree is
  // there, `package.json` is not.
  cacheEntry = join(dataDir, 'npm-cache', '_npx', CACHE_HASH);
  await mkdir(join(cacheEntry, 'node_modules'), { recursive: true });
  await writeFile(join(cacheEntry, 'node_modules', 'marker.txt'), 'present', 'utf8');

  const brokenSrc =
    `process.stderr.write(${JSON.stringify(
      `npm error code ENOENT\nnpm error syscall open\nnpm error path ${join(cacheEntry, 'package.json')}\nnpm error errno -2\nnpm error enoent ENOENT: no such file or directory, open '${join(cacheEntry, 'package.json')}'\n`,
    )});\nprocess.exit(1);\n`;

  await writeFile(
    join(dataDir, 'mcp-config.json'),
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
        {
          id: 'healthy-probe',
          label: 'Healthy probe',
          transport: 'stdio',
          enabled: true,
          command: process.execPath,
          args: [
            '-e',
            `let buf='';process.stdin.setEncoding('utf8');process.stdin.on('data',(c)=>{buf+=c;let i;while((i=buf.indexOf('\\n'))!==-1){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line.trim())continue;const m=JSON.parse(line);if(m.method==='initialize'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'ok',version:'1'}}})+'\\n');}}});`,
          ],
        },
      ],
    }),
    'utf8',
  );
  await start();
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
  await rm(dataDir, { recursive: true, force: true });
});

describe('the recognized npx-cache failure carries a repair, not only advice', () => {
  it('names the exact directory to remove on the health record', async () => {
    const res = await getJson('/api/mcp/health');
    expect(res.status).toBe(200);

    const mermaid = (res.json?.servers ?? []).find((entry: any) => entry.id === 'mermaid');
    expect(mermaid?.state).toBe('failed');
    expect(mermaid?.repair).toEqual({
      kind: 'npx-cache',
      target: cacheEntry,
    });
    expect(mermaid?.remedy).toContain(cacheEntry);
  });

  it('offers no repair for a server that started', async () => {
    const res = await getJson('/api/mcp/health');
    const healthy = (res.json?.servers ?? []).find(
      (entry: any) => entry.id === 'healthy-probe',
    );

    expect(healthy?.state).toBe('ok');
    expect(healthy?.repair).toBeUndefined();
  });
});

describe('the repair endpoint refuses to act without an explicit confirmation', () => {
  it('rejects a request that does not confirm, and removes nothing', async () => {
    const res = await postJson('/api/mcp/repair', { serverId: 'mermaid' });

    expect(res.status).toBe(400);
    expect(res.json?.error?.code).toBe('MCP_REPAIR_NOT_CONFIRMED');
    expect(await exists(cacheEntry)).toBe(true);
  });

  it('rejects an explicit `confirm: false`, and removes nothing', async () => {
    const res = await postJson('/api/mcp/repair', {
      serverId: 'mermaid',
      confirm: false,
    });

    expect(res.status).toBe(400);
    expect(await exists(cacheEntry)).toBe(true);
  });

  it('rejects an unknown server', async () => {
    const res = await postJson('/api/mcp/repair', {
      serverId: 'not-configured',
      confirm: true,
    });

    expect(res.status).toBe(404);
  });

  it('rejects a server whose current state offers no repair', async () => {
    const res = await postJson('/api/mcp/repair', {
      serverId: 'healthy-probe',
      confirm: true,
    });

    expect(res.status).toBe(409);
    expect(res.json?.error?.code).toBe('MCP_REPAIR_UNAVAILABLE');
  });
});

describe('a confirmed repair removes the cache entry MishMash derived itself', () => {
  it('removes the directory and reports what it removed', async () => {
    expect(await exists(cacheEntry)).toBe(true);

    const res = await postJson('/api/mcp/repair', {
      serverId: 'mermaid',
      confirm: true,
    });

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      serverId: 'mermaid',
      removed: true,
      repair: { kind: 'npx-cache', target: cacheEntry },
    });
    expect(await exists(cacheEntry)).toBe(false);
  }, 40_000);

  it('reports removed: false when the entry was already gone', async () => {
    // The signature is still in the server's stderr, so a repair is still
    // offered — but there is nothing left to remove. `rm` runs with `force`,
    // so only a presence check can tell the difference.
    await rm(cacheEntry, { recursive: true, force: true });

    const res = await postJson('/api/mcp/repair', {
      serverId: 'mermaid',
      confirm: true,
    });

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      serverId: 'mermaid',
      removed: false,
      repair: { kind: 'npx-cache', target: cacheEntry },
    });
  }, 40_000);

  it('ignores a caller-supplied target and uses the one it derived', async () => {
    const attacked = join(dataDir, 'npm-cache');
    const res = await postJson('/api/mcp/repair', {
      serverId: 'mermaid',
      confirm: true,
      // A caller cannot choose what gets deleted.
      repair: { kind: 'npx-cache', target: attacked },
      target: attacked,
    });

    expect(res.status).toBe(200);
    expect(res.json?.repair?.target).toBe(cacheEntry);
    // The parent of the derived entry survives: only the entry itself went.
    expect(await exists(attacked)).toBe(true);
    expect(await exists(cacheEntry)).toBe(false);
  }, 40_000);
});

describe('the derived repair path is an npx cache entry or it is nothing', () => {
  it('recognizes the #157 signature', () => {
    expect(
      mcpNpxCacheRepair(
        `npm error enoent ENOENT: no such file or directory, open '/home/u/.npm/_npx/${CACHE_HASH}/package.json'`,
      ),
    ).toEqual({ kind: 'npx-cache', target: `/home/u/.npm/_npx/${CACHE_HASH}` });
  });

  it('ignores a missing file that is not an npx cache entry', () => {
    expect(
      mcpNpxCacheRepair(
        "npm error enoent ENOENT: no such file or directory, open '/home/u/project/package.json'",
      ),
    ).toBeUndefined();
  });

  it('ignores an npx path whose entry name is not a cache hash', () => {
    expect(
      mcpNpxCacheRepair(
        "npm error enoent ENOENT: no such file or directory, open '/home/u/.npm/_npx/../../etc/package.json'",
      ),
    ).toBeUndefined();
  });

  it('ignores the same path without the ENOENT that makes it a broken entry', () => {
    expect(
      mcpNpxCacheRepair(`warning: reading /home/u/.npm/_npx/${CACHE_HASH}/package.json`),
    ).toBeUndefined();
  });
});
