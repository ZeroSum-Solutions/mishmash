// `od project video-import` CLI contract test (Part 8 F-05). Mirrors the
// stub-server + runCli pattern from cli-deploy.test.ts: a real `od` process
// (via tsx) talking to a stub HTTP server standing in for the daemon, so
// this exercises the actual flag parsing and HTTP body/response handling
// rather than calling an internal function directly.
//
// RED on base 8487362f0: the `video-import` subcommand does not exist in
// `runProject`'s switch, so `od project video-import <id> --provider vimeo
// --url <url>` falls into the `default:` case and exits 2 with "unknown
// subcommand: od project video-import" (behavioural, not an import
// failure — cli.ts already exists on base).

import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { isVideoImportResponse } from '@open-design/contracts';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = pathResolve(__dirname, '..');
const REPO_ROOT = pathResolve(__dirname, '../../..');
const CLI_SRC = pathResolve(__dirname, '../src/cli.ts');
const TSX_CLI = pathResolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

interface CapturedRequest {
  method: string;
  url: string;
  body: string;
}

interface StubServer {
  baseUrl: string;
  requests: CapturedRequest[];
  setResponder: (fn: (req: CapturedRequest) => { status: number; body: unknown } | null) => void;
  close: () => Promise<void>;
}

async function startStubServer(): Promise<StubServer> {
  const requests: CapturedRequest[] = [];
  let responder: ((req: CapturedRequest) => { status: number; body: unknown } | null) | null = null;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const captured: CapturedRequest = { method: req.method ?? '', url: req.url ?? '', body: raw };
      requests.push(captured);
      const response = responder?.(captured) ?? { status: 200, body: { ok: true } };
      res.statusCode = response.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(response.body));
    });
  });

  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('stub server has no address');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    requests,
    setResponder: (fn) => {
      responder = fn;
    },
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      }),
  };
}

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
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
    return { stdout: failed.stdout ?? '', stderr: failed.stderr ?? '', code: failed.code ?? 1 };
  }
}

const STUB_DONE_JOB = {
  job: {
    jobId: 'task-cli-1',
    taskId: 'task-cli-1',
    provider: 'vimeo',
    status: 'done',
    progress: ['resolved "Fixture Clip" (1024 bytes)', 'wrote clip.mp4 (1024 bytes)'],
    fraction: 1,
    file: { name: 'clip.mp4', path: 'clip.mp4', size: 1024, mtime: 1_700_000_000_000, kind: 'video', mime: 'video/mp4' },
  },
};

describe('od project video-import CLI', () => {
  let stub: StubServer;

  beforeAll(async () => {
    stub = await startStubServer();
  });

  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.requests.length = 0;
    stub.setResponder(() => ({ status: 202, body: STUB_DONE_JOB }));
  });

  it('POSTs to /api/projects/:id/video-imports and prints a VideoImportResponse that validates with --json', async () => {
    const result = await runCli([
      'project', 'video-import', 'proj-1',
      '--provider', 'vimeo',
      '--url', 'https://vimeo.com/123456789',
      '--daemon-url', stub.baseUrl,
      '--json',
    ]);

    expect(result.code).toBe(0);
    expect(stub.requests).toHaveLength(1);
    const req = stub.requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/api/projects/proj-1/video-imports');
    const sentBody = JSON.parse(req.body);
    expect(sentBody).toMatchObject({ provider: 'vimeo', url: 'https://vimeo.com/123456789' });

    const printed = JSON.parse(result.stdout);
    expect(isVideoImportResponse(printed)).toBe(true);
    expect(printed.job.status).toBe('done');
  });

  it('forwards --as as a project-relative destination path', async () => {
    await runCli([
      'project', 'video-import', 'proj-1',
      '--provider', 'vimeo',
      '--url', 'https://vimeo.com/123456789',
      '--as', 'clips/mine.mp4',
      '--daemon-url', stub.baseUrl,
      '--json',
    ]);
    const sentBody = JSON.parse(stub.requests[0]!.body);
    expect(sentBody.as).toBe('clips/mine.mp4');
  });

  it('exits 2 with the disabled reason for --provider youtube, never reaching the create route', async () => {
    stub.setResponder(() => ({
      status: 409,
      body: { error: { code: 'CONFLICT', message: 'YouTube video import is not enabled yet — Vimeo ships first (Part 8 F-05)' } },
    }));
    const result = await runCli([
      'project', 'video-import', 'proj-1',
      '--provider', 'youtube',
      '--url', 'https://youtube.com/watch?v=abc',
      '--daemon-url', stub.baseUrl,
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('YouTube');
  });
});
