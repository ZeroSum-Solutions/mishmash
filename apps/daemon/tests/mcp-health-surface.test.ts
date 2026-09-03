// Red spec for issue #157 (W1.3).
//
// Two halves of one rule:
//
//   1. A run's failure indicator derives from the run's own outcome. An
//      external MCP server that failed to connect is not the run's outcome,
//      so its connect-state text must never reach the run failure
//      classifiers. On main it does: the exact `tool_result` text captured
//      from run 074ab1fd-a7af-4469-aa85-ae38185c4f95 (status `succeeded`,
//      exit 0) drives `diagnoseClaudeCliFailure` to report
//      AGENT_CONNECTION_DROPPED — "Claude Code lost its connection to the
//      Anthropic API" — a claim about the agent's own upstream that was in
//      fact never true.
//
//   2. MCP health is its own surface. `GET /api/mcp/health` reports, per
//      configured server, the state MishMash measured itself: connected or
//      not, how long the connect took measured from spawn, and the stderr
//      the server wrote. On main that surface does not exist, so the only
//      thing a user ever sees about a dead MCP server is a run failure.
//
// Both halves are asserted at the cheapest layer that can see them: the
// daemon's own classifier for (1), the daemon HTTP boundary for (2).

import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { diagnoseClaudeCliFailure } from '../src/claude-diagnostics.js';
import { registerMcpRoutes } from '../src/mcp-routes.js';
import { isLocalSameOrigin } from '../src/origin-validation.js';

// Verbatim `tool_result` content from the run linked in issue #157. The run
// finished `succeeded` / exit 0; every string below describes external MCP
// servers, not the agent's connection to its model provider.
const MCP_CONNECT_NOISE =
  'No matching deferred tools found. Note: these configured MCP servers failed to connect, ' +
  'so their tools are unavailable for this session: shadcn-ui (CONNECT_TIMEOUT): ' +
  '"MCP server shadcn-ui connection timed out after 30000ms"; antv-chart (CONNECT_TIMEOUT): ' +
  '"MCP server antv-chart connection timed out after 30000ms"; mermaid (CONNECTION_CLOSED): ' +
  '"Connection closed"; fal-ai (CONNECTION_CLOSED): "Connection closed". ' +
  'Treat this as a connection failure — do not conclude the capability is unconfigured.';

// Second face from the same session's comment on #157: the mid-turn flap.
const MCP_FLAP_NOISE =
  '3 deferred tools are no longer available (MCP server disconnected)\n' +
  '3 deferred tools are available again (reconnected)';

describe('run failure indicator derives from run outcome only (#157)', () => {
  it('does not read external MCP connect failures as an agent connection drop', () => {
    const diagnostic = diagnoseClaudeCliFailure({
      agentId: 'claude',
      exitCode: 1,
      stdoutTail: MCP_CONNECT_NOISE,
      env: {},
    });

    expect(diagnostic?.code).not.toBe('AGENT_CONNECTION_DROPPED');
    expect(diagnostic?.message ?? '').not.toContain('lost its connection');
  });

  it('does not read a mid-turn MCP server flap as an agent connection drop', () => {
    const diagnostic = diagnoseClaudeCliFailure({
      agentId: 'claude',
      exitCode: 1,
      stderrTail: MCP_FLAP_NOISE,
      env: {},
    });

    expect(diagnostic?.code).not.toBe('AGENT_CONNECTION_DROPPED');
  });

  it('still reports a genuine agent connection drop', () => {
    const diagnostic = diagnoseClaudeCliFailure({
      agentId: 'claude',
      exitCode: 1,
      stdoutTail: 'API Error: The socket connection was closed unexpectedly.',
      env: {},
    });

    expect(diagnostic?.code).toBe('AGENT_CONNECTION_DROPPED');
  });
});

// ── MCP health surface ────────────────────────────────────────────────

let dataDir = '';
let server: http.Server | null = null;
let baseUrl = '';

// A minimal stdio MCP server that answers `initialize`, and one that dies
// on spawn after writing to stderr. Real child processes, so `connectMs`
// and `stderrExcerpt` are measured, not stubbed.
const HEALTHY_SERVER_SRC = `
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'healthy-probe', version: '1.0.0' },
        },
      }) + '\\n');
    }
  }
});
`;

const BROKEN_SERVER_SRC = `
process.stderr.write("npm error ENOENT: no such file or directory, open '/cache/package.json'\\n");
process.exit(1);
`;

async function start(): Promise<void> {
  const app = express();
  app.use(express.json());
  // Filled in once the ephemeral port is known, so the daemon's own
  // same-origin guard sees the port the test client actually calls.
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

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'od-mcp-health-'));
  await writeFile(
    join(dataDir, 'mcp-config.json'),
    JSON.stringify({
      servers: [
        {
          id: 'healthy-probe',
          label: 'Healthy probe',
          transport: 'stdio',
          enabled: true,
          command: process.execPath,
          args: ['-e', HEALTHY_SERVER_SRC],
        },
        {
          id: 'broken-probe',
          label: 'Broken probe',
          transport: 'stdio',
          enabled: true,
          command: process.execPath,
          args: ['-e', BROKEN_SERVER_SRC],
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

// Tolerant of a non-JSON body so a missing route fails on the status
// assertion below rather than on a parse error.
async function getJson(path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  try {
    return { status: res.status, json: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, json: null };
  }
}

describe('MCP health is its own surface with per-server state (#157)', () => {
  it('reports per-server state, connect time from spawn, and stderr', async () => {
    const res = await getJson('/api/mcp/health');
    expect(res.status).toBe(200);

    const byId = new Map<string, any>(
      (res.json?.servers ?? []).map((entry: any) => [entry.id, entry]),
    );
    expect([...byId.keys()].sort()).toEqual(['broken-probe', 'healthy-probe']);

    const healthy = byId.get('healthy-probe');
    expect(healthy.state).toBe('ok');
    // Measured from spawn, so a server that answers immediately must not be
    // reported at the full connect budget (the #157 symptom: 3 s servers
    // logged as 30 s timeouts).
    expect(typeof healthy.connectMs).toBe('number');
    expect(healthy.connectMs).toBeLessThan(healthy.budgetMs);

    const broken = byId.get('broken-probe');
    expect(broken.state).toBe('failed');
    // F-09: the stderr excerpt is what makes the failure diagnosable.
    expect(broken.stderrExcerpt).toContain('npm error ENOENT');
  }, 30_000);
});
