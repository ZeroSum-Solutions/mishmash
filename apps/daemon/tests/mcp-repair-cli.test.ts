// Red spec for W1F.3: the CLI half of the MCP health surface.
//
// `AGENTS.md` -> "Capability exposure (UI/CLI dual-track)": a user-facing
// capability is reachable through the web UI *and* `od`. The cache repair is
// such a capability, so it needs `od mcp repair` beside the Settings action,
// with `--json` for machine-readable output.
//
// The confirmation gate is part of the mechanism, not a UI detail: the CLI
// must require the flag before anything is removed, and a run without it must
// not reach the repair endpoint at all. Both halves are asserted against a
// stub daemon that records every request.

import { execFile } from 'node:child_process';
import http from 'node:http';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = pathResolve(__dirname, '..');
const REPO_ROOT = pathResolve(__dirname, '../../..');
const CLI_SRC = pathResolve(__dirname, '../src/cli.ts');
const TSX_CLI = pathResolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

const CACHE_ENTRY = '/home/u/.npm/_npx/adab5b373aa91713';

const HEALTH_RESPONSE = {
  checkedAt: '2026-08-28T05:00:00.000Z',
  servers: [
    {
      id: 'mermaid',
      label: 'Mermaid',
      transport: 'stdio',
      enabled: true,
      state: 'failed',
      connectMs: 412,
      budgetMs: 15000,
      stderrExcerpt: `npm error enoent ENOENT: no such file or directory, open '${CACHE_ENTRY}/package.json'`,
      reason: 'server exited with code 1 before replying',
      remedy: `The npx cache entry for this server is incomplete. Repairing it removes ${CACHE_ENTRY}; npx re-downloads the server on the next run.`,
      repair: { kind: 'npx-cache', target: CACHE_ENTRY },
      checkedAt: '2026-08-28T05:00:00.000Z',
    },
    {
      id: 'antv-chart',
      label: 'AntV chart',
      transport: 'stdio',
      enabled: true,
      state: 'ok',
      connectMs: 2900,
      budgetMs: 15000,
      stderrExcerpt: '',
      checkedAt: '2026-08-28T05:00:00.000Z',
    },
  ],
};

interface CapturedRequest {
  method: string;
  url: string;
  body: string;
}

interface StubServer {
  baseUrl: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

let stub: StubServer | null = null;

afterEach(async () => {
  if (stub) await stub.close();
  stub = null;
});

async function startStub(): Promise<StubServer> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const captured: CapturedRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        body: raw,
      };
      requests.push(captured);
      res.setHeader('content-type', 'application/json');
      if (captured.method === 'GET' && captured.url === '/api/mcp/health') {
        res.statusCode = 200;
        res.end(JSON.stringify(HEALTH_RESPONSE));
        return;
      }
      if (captured.method === 'POST' && captured.url === '/api/mcp/repair') {
        const body = JSON.parse(raw || '{}');
        if (body.confirm !== true) {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              error: { code: 'MCP_REPAIR_NOT_CONFIRMED', message: 'confirmation required' },
            }),
          );
          return;
        }
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            serverId: body.serverId,
            removed: true,
            repair: { kind: 'npx-cache', target: CACHE_ENTRY },
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function runCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_OPTIONS;
  try {
    const { stdout, stderr } = await execFileP(
      process.execPath,
      [TSX_CLI, CLI_SRC, ...args],
      { cwd: DAEMON_ROOT, env, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const failed = err as { stdout?: string; stderr?: string; code?: number | null };
    return { stdout: failed.stdout ?? '', stderr: failed.stderr ?? '', code: failed.code ?? 1 };
  }
}

describe('od mcp health renders the shared health response', () => {
  it('prints every server, its state, and the recognized fix', async () => {
    stub = await startStub();

    const result = await runCli(['mcp', 'health', '--daemon-url', stub.baseUrl]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('FAILED');
    expect(result.stdout).toContain('Mermaid (mermaid)');
    expect(result.stdout).toContain('OK');
    expect(result.stdout).toContain('AntV chart (antv-chart)');
    expect(result.stdout).toContain(CACHE_ENTRY);
  }, 40_000);

  it('prints the raw records under --json', async () => {
    stub = await startStub();

    const result = await runCli(['mcp', 'health', '--json', '--daemon-url', stub.baseUrl]);

    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.servers).toHaveLength(2);
    expect(parsed.servers[0].repair).toEqual({ kind: 'npx-cache', target: CACHE_ENTRY });
  }, 40_000);
});

describe('od mcp repair requires the confirmation flag before it removes anything', () => {
  it('states the plan and refuses without --yes, never calling the repair endpoint', async () => {
    stub = await startStub();

    const result = await runCli(['mcp', 'repair', 'mermaid', '--daemon-url', stub.baseUrl]);

    expect(result.code).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain(CACHE_ENTRY);
    expect(`${result.stdout}${result.stderr}`).toContain('--yes');
    // Pins the prose itself, not just the two substrings above: the `--json`
    // work in W1G.4 routes this path through a shared helper, and the plain
    // form has to stay exactly what it was for anyone reading it.
    expect(result.stdout).toContain(`Repairing mermaid removes ${CACHE_ENTRY}\n`);
    expect(result.stdout).toContain('Nothing has been removed. Re-run with --yes to confirm.\n');
    expect(stub.requests.some((request) => request.url === '/api/mcp/repair')).toBe(false);
  }, 40_000);

  it('confirms explicitly on the wire when --yes is given', async () => {
    stub = await startStub();

    const result = await runCli([
      'mcp',
      'repair',
      'mermaid',
      '--yes',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    const repair = stub.requests.find((request) => request.url === '/api/mcp/repair');
    expect(repair?.method).toBe('POST');
    expect(JSON.parse(repair?.body ?? '{}')).toEqual({
      serverId: 'mermaid',
      confirm: true,
    });
    expect(result.stdout).toContain(CACHE_ENTRY);
  }, 40_000);

  it('prints the machine-readable result under --json', async () => {
    stub = await startStub();

    const result = await runCli([
      'mcp',
      'repair',
      'mermaid',
      '--yes',
      '--json',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      serverId: 'mermaid',
      removed: true,
      repair: { kind: 'npx-cache', target: CACHE_ENTRY },
    });
  }, 40_000);

  it('refuses a server that has no repair to offer', async () => {
    stub = await startStub();

    const result = await runCli([
      'mcp',
      'repair',
      'antv-chart',
      '--yes',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(2);
    expect(stub.requests.some((request) => request.url === '/api/mcp/repair')).toBe(false);
  }, 40_000);

  it('requires a server id', async () => {
    stub = await startStub();

    const result = await runCli(['mcp', 'repair', '--yes', '--daemon-url', stub.baseUrl]);

    expect(result.code).toBe(2);
  }, 40_000);
});

// ── W1G.4: the --json contract holds on every path ───────────────────────
//
// Red spec for W1G.4, finding 1 (MEDIUM/LAW). `AGENTS.md` -> "Capability
// exposure (UI/CLI dual-track)": the CLI form of a capability must support
// `--json` for machine-readable output. A refusal is exactly the path a script
// has to branch on, so prose there is the contract broken where it matters
// most. Every refusal must carry the same `{ error: { code, message, data } }`
// envelope the command's daemon failures already emit, on stderr, with the
// exit code unchanged at 2 and nothing removed.
//
// Each case asserts the envelope's fields, not the whole stdout: a sibling
// track that adds a line to this command must not silently change what these
// assert.

/**
 * The single JSON envelope the CLI wrote to stderr, or null when it wrote
 * anything else. Strict on purpose: under `--json` the envelope is the whole
 * of stderr, so prose printed beside it is a failure, not a detail.
 */
function stderrEnvelope(stderr: string): any {
  const lines = stderr.trim().split('\n').filter(Boolean);
  const only = lines.length === 1 ? lines[0] : undefined;
  if (only === undefined) return null;
  try {
    return JSON.parse(only);
  } catch {
    return null;
  }
}

describe('od mcp repair honours --json on every refusal', () => {
  it('refuses without --yes as a JSON envelope, still removing nothing', async () => {
    stub = await startStub();

    const result = await runCli([
      'mcp',
      'repair',
      'mermaid',
      '--json',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(2);
    const envelope = stderrEnvelope(result.stderr);
    expect(
      envelope,
      `expected a JSON envelope on stderr, got stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`,
    ).not.toBeNull();
    expect(envelope.error.code).toBe('mcp-repair-not-confirmed');
    expect(envelope.error.data.serverId).toBe('mermaid');
    expect(envelope.error.data.target).toBe(CACHE_ENTRY);
    expect(result.stdout.trim()).toBe('');
    expect(stub.requests.some((request) => request.url === '/api/mcp/repair')).toBe(false);
  }, 40_000);

  it('reports an unknown server as a JSON envelope', async () => {
    stub = await startStub();

    const result = await runCli([
      'mcp',
      'repair',
      'no-such-server',
      '--yes',
      '--json',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(2);
    const envelope = stderrEnvelope(result.stderr);
    expect(
      envelope,
      `expected a JSON envelope on stderr, got stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`,
    ).not.toBeNull();
    expect(envelope.error.code).toBe('mcp-server-not-found');
    expect(envelope.error.data.serverId).toBe('no-such-server');
    expect(result.stdout.trim()).toBe('');
    expect(stub.requests.some((request) => request.url === '/api/mcp/repair')).toBe(false);
  }, 40_000);

  it('reports a server with no repair available as a JSON envelope', async () => {
    stub = await startStub();

    const result = await runCli([
      'mcp',
      'repair',
      'antv-chart',
      '--yes',
      '--json',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(2);
    const envelope = stderrEnvelope(result.stderr);
    expect(
      envelope,
      `expected a JSON envelope on stderr, got stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`,
    ).not.toBeNull();
    expect(envelope.error.code).toBe('mcp-repair-unavailable');
    expect(envelope.error.data.serverId).toBe('antv-chart');
    expect(envelope.error.data.state).toBe('ok');
    expect(result.stdout.trim()).toBe('');
    expect(stub.requests.some((request) => request.url === '/api/mcp/repair')).toBe(false);
  }, 40_000);

  it('reports a missing server id as a JSON envelope', async () => {
    stub = await startStub();

    const result = await runCli([
      'mcp',
      'repair',
      '--yes',
      '--json',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(2);
    const envelope = stderrEnvelope(result.stderr);
    expect(
      envelope,
      `expected a JSON envelope on stderr, got stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`,
    ).not.toBeNull();
    expect(envelope.error.code).toBe('mcp-repair-server-id-required');
    expect(result.stdout.trim()).toBe('');
  }, 40_000);
});

// ── W1H.3: the --json contract survives a flag-parse failure ─────────────
//
// Red spec for W1H.3 (MEDIUM/REFUTATION against W1G.4). W1G.4 routed every
// refusal `od mcp repair` reaches *after* parsing through `refuseMcpRepair`,
// but `parseFlags` runs first: when it throws — an undeclared option, or a
// declared option with no value after it — the catch printed the parser's
// message as prose and exited before `flags` existed. `AGENTS.md` ->
// "Capability exposure (UI/CLI dual-track)" states the CLI form supports
// `--json` for machine-readable output and names no exception for a bad
// argument list, which is precisely the failure a script has to read back.
//
// The requested output mode is still on the raw command line when the parse
// fails, so these cases assert the same envelope every other refusal emits,
// with the offending token named in `data`, the exit code unchanged at 2, and
// the repair endpoint never reached. The last case pins the other half of the
// contract: without `--json` the output stays the bare parser message.

describe('od mcp repair honours --json when the flags do not parse', () => {
  it('reports an undeclared flag as a JSON envelope naming the token', async () => {
    stub = await startStub();

    const result = await runCli([
      'mcp',
      'repair',
      'mermaid',
      '--json',
      '--bogus',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(2);
    const envelope = stderrEnvelope(result.stderr);
    expect(
      envelope,
      `expected a JSON envelope on stderr, got stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`,
    ).not.toBeNull();
    expect(envelope.error.code).toBe('mcp-repair-invalid-arguments');
    expect(envelope.error.message).toContain('unknown flag: --bogus');
    expect(envelope.error.data.flag).toBe('--bogus');
    expect(result.stdout.trim()).toBe('');
    expect(stub.requests.some((request) => request.url === '/api/mcp/repair')).toBe(false);
  }, 40_000);

  it('reports a declared flag with no value as a JSON envelope naming the token', async () => {
    stub = await startStub();

    const result = await runCli(['mcp', 'repair', 'mermaid', '--json', '--daemon-url']);

    expect(result.code).toBe(2);
    const envelope = stderrEnvelope(result.stderr);
    expect(
      envelope,
      `expected a JSON envelope on stderr, got stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`,
    ).not.toBeNull();
    expect(envelope.error.code).toBe('mcp-repair-invalid-arguments');
    expect(envelope.error.message).toContain('flag --daemon-url requires a value');
    expect(envelope.error.data.flag).toBe('--daemon-url');
    expect(result.stdout.trim()).toBe('');
    expect(stub.requests.some((request) => request.url === '/api/mcp/repair')).toBe(false);
  }, 40_000);

  it('still prints the bare parser message when --json is absent', async () => {
    stub = await startStub();

    const result = await runCli([
      'mcp',
      'repair',
      'mermaid',
      '--bogus',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr.trim()).toBe(
      'unknown flag: --bogus. Run with --help for the list of accepted flags.',
    );
    expect(result.stdout.trim()).toBe('');
    expect(stub.requests.some((request) => request.url === '/api/mcp/repair')).toBe(false);
  }, 40_000);
});
