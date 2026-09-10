// W8D / F-03 red spec item 4 — the CLI half of named local attribution.
//
// Three resolution sources, in priority order: `--actor <name>`, then
// `OD_ACTOR`, then a value a previous `--actor` invocation stored on disk.
// Every one of them must reach the daemon as `x-od-actor` — and must NEVER
// reach a non-daemon host, which is what the last case pins.
//
// Behavioural red on base d7ff39a36: `od run list --daemon-url <stub>` already
// works and already reaches the stub; the request simply carries no
// `x-od-actor` header, because neither the resolver nor the fetch wrap exists.
// The stub records every request's headers, so RED fails on "expected
// 'devin', got undefined" rather than on a missing module.
//
// The stub server is a local copy of `helpers/run-cli-stub.ts`'s shape, kept
// here because that helper deliberately records only method/url/body and this
// spec is entirely about headers.

import { execFile } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = pathResolve(__dirname, '..');
const REPO_ROOT = pathResolve(__dirname, '../../..');
const CLI_SRC = pathResolve(__dirname, '../src/cli.ts');
const TSX_CLI = pathResolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

// See the D-18 note in `actor-attribution.test.ts`.
const ACTOR_HEADER_NAME = 'x-od-actor';

interface CapturedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
}

interface HeaderStub {
  baseUrl: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

/** A daemon-shaped stub that records the headers of everything it receives. */
async function startHeaderStub(): Promise<HeaderStub> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
      res.setHeader('content-type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ runs: [] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('stub server has no address');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    close: () => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))),
  };
}

interface CliResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

async function runCli(args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  delete env.NODE_OPTIONS;
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [TSX_CLI, CLI_SRC, ...args], {
      cwd: DAEMON_ROOT,
      env,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const failed = err as { stdout?: string; stderr?: string; code?: number | null };
    return { stdout: failed.stdout ?? '', stderr: failed.stderr ?? '', code: failed.code ?? 1 };
  }
}

let stub: HeaderStub | null = null;
let stateDir = '';

beforeEach(async () => {
  stub = await startHeaderStub();
  stateDir = await mkdtemp(pathResolve(os.tmpdir(), 'od-w8d-cli-actor-'));
});

afterEach(async () => {
  if (stub) await stub.close();
  stub = null;
  await rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

function actorHeadersSeen(): Array<string | undefined> {
  return (stub?.requests ?? []).map((r) => {
    const value = r.headers[ACTOR_HEADER_NAME];
    return Array.isArray(value) ? value[0] : value;
  });
}

describe('W8D: od resolves the actor and sends it as x-od-actor', () => {
  it('sends the --actor flag value', async () => {
    const result = await runCli(
      ['run', 'list', '--daemon-url', stub!.baseUrl, '--actor', 'devin'],
      { OD_USER_STATE_DIR: stateDir },
    );
    expect(result.code, result.stderr).toBe(0);
    expect(stub!.requests.length).toBeGreaterThan(0);
    // RED on base: `undefined` — no fetch wrap, no header.
    expect(actorHeadersSeen()).toContain('devin');
  });

  it('sends the OD_ACTOR env value when no flag is given', async () => {
    const result = await runCli(['run', 'list', '--daemon-url', stub!.baseUrl], {
      OD_USER_STATE_DIR: stateDir,
      OD_ACTOR: 'devin',
    });
    expect(result.code, result.stderr).toBe(0);
    expect(actorHeadersSeen()).toContain('devin');
  });

  it('reuses the name a previous --actor invocation stored', async () => {
    const first = await runCli(
      ['run', 'list', '--daemon-url', stub!.baseUrl, '--actor', 'devin'],
      { OD_USER_STATE_DIR: stateDir },
    );
    expect(first.code, first.stderr).toBe(0);

    // Second invocation: no flag, no env. The stored value must carry over.
    const second = await runCli(['run', 'list', '--daemon-url', stub!.baseUrl], {
      OD_USER_STATE_DIR: stateDir,
      OD_ACTOR: '',
    });
    expect(second.code, second.stderr).toBe(0);
    expect(stub!.requests.length).toBe(2);
    expect(actorHeadersSeen()[1]).toBe('devin');
  });

  it('prefers the flag over the env value', async () => {
    const result = await runCli(
      ['run', 'list', '--daemon-url', stub!.baseUrl, '--actor', 'flagname'],
      { OD_USER_STATE_DIR: stateDir, OD_ACTOR: 'envname' },
    );
    expect(result.code, result.stderr).toBe(0);
    expect(actorHeadersSeen()).toContain('flagname');
  });

  it('never sends the header to a non-daemon host', async () => {
    // The scoping guard, exercised in-process against the real module rather
    // than through a test-only CLI flag: install the wrap for the stub's
    // origin, then call BOTH the daemon stub and a second local server
    // standing in for a third-party API (the Vimeo / YouTube OAuth calls
    // `cli.ts` makes). Only the daemon call may carry the header.
    const foreign = await startHeaderStub();
    const originalFetch = globalThis.fetch;
    let uninstall: (() => void) | undefined;
    try {
      const actorModule = (await import('../src/cli-actor.js').catch(() => null)) as {
        installCliActorFetchWrap?: (options: {
          actorName: string | null;
          daemonBaseUrl?: string | null;
        }) => () => void;
      } | null;
      // RED on base: the module does not exist, so this is null.
      expect(actorModule?.installCliActorFetchWrap).toBeTypeOf('function');

      uninstall = actorModule!.installCliActorFetchWrap!({
        actorName: 'devin',
        daemonBaseUrl: stub!.baseUrl,
      });

      await fetch(`${stub!.baseUrl}/api/runs`);
      await fetch(`${foreign.baseUrl}/oauth/token`);

      expect(actorHeadersSeen()).toContain('devin');
      expect(foreign.requests.length).toBe(1);
      expect(foreign.requests[0]?.headers[ACTOR_HEADER_NAME]).toBeUndefined();
    } finally {
      uninstall?.();
      globalThis.fetch = originalFetch;
      await foreign.close();
    }
  });

  it('runs `od run diff` against the daemon and prints the before/after text', async () => {
    // A stub that answers the new route with a contracts-shaped body.
    const diffStub = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (/\/api\/runs\/[^/]+\/diff$/.test(req.url ?? '')) {
          res.statusCode = 200;
          res.end(JSON.stringify({
            runId: 'run-1',
            files: [{
              fileName: 'index.html',
              kind: 'html',
              actorName: 'devin',
              at: 1_700_000_000_000,
              before: { id: 'v1', content: '<h1>one</h1>\n', fileName: 'index.html', version: 1, kind: 'html' },
              after: { id: 'v2', content: '<h1>two</h1>\n', fileName: 'index.html', version: 2, kind: 'html' },
            }],
          }));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no' } }));
      });
    });
    await new Promise<void>((r) => diffStub.listen(0, '127.0.0.1', r));
    const addr = diffStub.address();
    const diffBase = `http://127.0.0.1:${(addr as { port: number }).port}`;
    try {
      const result = await runCli(
        ['run', 'diff', 'run-1', '--daemon-url', diffBase],
        { OD_USER_STATE_DIR: stateDir },
      );
      // RED on base: `od run diff` is not a case in `runRun`, so the CLI prints
      // the usage block and exits non-zero.
      expect(result.code, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('index.html');
      expect(result.stdout).toContain('one');
      expect(result.stdout).toContain('two');
      expect(result.stdout).toContain('devin');
    } finally {
      await new Promise<void>((r) => diffStub.close(() => r()));
    }
  });
});
