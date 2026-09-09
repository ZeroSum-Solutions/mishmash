// Shared `od run` CLI test harness: a stub daemon HTTP server plus a
// `runCli` execFile wrapper. Lives outside `run-cli.test.ts` (not matched
// by the `tests/**/*.test.*` glob) so `run-cli-notice.test.ts` (W7B,
// INV-7.15) can reuse it without re-executing `run-cli.test.ts`'s own
// `describe` block as an import side effect.
import { execFile } from 'node:child_process';
import http from 'node:http';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = pathResolve(__dirname, '..', '..');
const REPO_ROOT = pathResolve(__dirname, '../../../..');
const CLI_SRC = pathResolve(__dirname, '../../src/cli.ts');
const TSX_CLI = pathResolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

export interface CapturedRequest {
  method: string;
  url: string;
  body: string;
}

export interface StubServer {
  baseUrl: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

/**
 * W7B (INV-7.13 F-02): `runEndEvent`, when given, adds the
 * `/api/runs/:id/events` SSE branch — absent on base — that serves it as
 * one terminal `end` frame and closes the stream. Every caller of this
 * branch drives it through `execFile` (never a TTY), so the notice test's
 * TTY case stubs `process.stderr.isTTY` on the CLI side instead of faking
 * a TTY on this stub transport.
 */
export async function startRunStubServer(
  resumable: boolean,
  extraStatusFields: Record<string, unknown> = {},
  runEndEvent: Record<string, unknown> | null = null,
): Promise<StubServer> {
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

      if (
        runEndEvent
        && captured.method === 'GET'
        && /^\/api\/runs\/[^/]+\/events$/.test(captured.url)
      ) {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream');
        res.write(`event: end\ndata: ${JSON.stringify(runEndEvent)}\n\n`);
        res.end();
        return;
      }

      res.setHeader('content-type', 'application/json');

      if (captured.method === 'GET' && captured.url === '/api/runs/run-1') {
        res.statusCode = 200;
        res.end(JSON.stringify({
          id: 'run-1',
          projectId: 'project-1',
          conversationId: 'conversation-1',
          agentId: 'claude',
          status: 'failed',
          resumable,
          ...extraStatusFields,
        }));
        return;
      }

      if (captured.method === 'POST' && captured.url === '/api/runs') {
        res.statusCode = 200;
        res.end(JSON.stringify({ runId: 'run-2' }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: { code: 'unexpected-request', message: captured.url } }));
    });
  });

  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('stub server has no address');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      }),
  };
}

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export async function runCli(args: string[]): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_OPTIONS;
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [TSX_CLI, CLI_SRC, ...args], {
      cwd: DAEMON_ROOT,
      env,
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const failed = err as { stdout?: string; stderr?: string; code?: number | null };
    return {
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
      code: failed.code ?? 1,
    };
  }
}
