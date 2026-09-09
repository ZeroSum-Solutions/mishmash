// Red spec for `od project upload` (Part 2.17 / F-01 CLI half). Exercises the
// same staged-session HTTP contract the web client uses, against an
// http.createServer stub — no real daemon needed, mirrors `run-cli.test.ts`.
// RED on base: the subcommand does not exist (`od project upload` falls into
// runProject's `default:` "unknown subcommand" branch).

import { execFile } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

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
  close: () => Promise<void>;
}

let stub: StubServer | null = null;
let tmpDir: string | null = null;

afterEach(async () => {
  if (stub) await stub.close();
  stub = null;
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

async function listenStub(handler: (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => void): Promise<StubServer> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method ?? '', url: req.url ?? '', body: body.toString('utf8') });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('stub server has no address');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
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

describe('od project upload CLI', () => {
  it('subscribes to progress events before PUTting bytes and prints the terminal event under --json', async () => {
    let sseRes: http.ServerResponse | null = null;

    stub = await listenStub((req, res, body) => {
      res.setHeader('content-type', 'application/json');

      if (req.method === 'POST' && req.url === '/api/projects/p1/uploads') {
        res.statusCode = 200;
        res.end(JSON.stringify({
          uploadId: 'up1',
          token: 'tok1',
          expiresAt: Date.now() + 60_000,
          limits: { maxFileBytes: 1024, maxFilesPerRequest: 12, maxTotalBytes: 12_288, acceptedKinds: [] },
        }));
        return;
      }

      if (req.method === 'GET' && req.url === '/api/projects/p1/uploads/up1/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.flushHeaders();
        sseRes = res;
        return; // left open on purpose — completed once the PUT below arrives
      }

      if (req.method === 'PUT' && req.url === '/api/projects/p1/uploads/up1/files/0') {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, index: 0 }));
        const progress = { type: 'upload-progress', uploadId: 'up1', index: 0, name: 'a.txt', bytesReceived: body.length, totalBytes: body.length };
        const completed = { type: 'upload-completed', uploadId: 'up1', files: [{ name: 'a.txt', path: 'a.txt', size: body.length, mtime: Date.now(), originalName: 'a.txt' }] };
        sseRes?.write(`event: upload-progress\ndata: ${JSON.stringify(progress)}\n\n`);
        sseRes?.write(`event: upload-completed\ndata: ${JSON.stringify(completed)}\n\n`);
        sseRes?.end();
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: { code: 'unexpected-request', message: req.url } }));
    });

    tmpDir = mkdtempSync(join(tmpdir(), 'od-cli-upload-'));
    const localFile = join(tmpDir, 'a.txt');
    writeFileSync(localFile, 'hello world');

    const result = await runCli(['project', 'upload', 'p1', localFile, '--daemon-url', stub.baseUrl, '--json']);

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.type).toBe('upload-completed');
    expect(parsed.files).toEqual([
      expect.objectContaining({ name: 'a.txt', originalName: 'a.txt', size: 11 }),
    ]);

    const order = stub.requests.map((r) => `${r.method} ${r.url}`);
    expect(order[0]).toBe('POST /api/projects/p1/uploads');
    const eventsIdx = order.indexOf('GET /api/projects/p1/uploads/up1/events');
    const putIdx = order.indexOf('PUT /api/projects/p1/uploads/up1/files/0');
    expect(eventsIdx).toBeGreaterThanOrEqual(0);
    expect(putIdx).toBeGreaterThan(eventsIdx);
  });

  it('prints the daemon PAYLOAD_TOO_LARGE envelope naming the limit and exits non-zero', async () => {
    stub = await listenStub((req, res) => {
      if (req.method === 'POST' && req.url === '/api/projects/p1/uploads') {
        res.statusCode = 413;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: '"big.bin" (2000 bytes) exceeds the 1000 byte limit',
            details: { limitBytes: 1000 },
          },
        }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });

    tmpDir = mkdtempSync(join(tmpdir(), 'od-cli-upload-'));
    const localFile = join(tmpDir, 'big.bin');
    writeFileSync(localFile, Buffer.alloc(2000));

    const result = await runCli(['project', 'upload', 'p1', localFile, '--daemon-url', stub.baseUrl, '--json']);

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    const envelope = JSON.parse(result.stderr);
    expect(envelope.error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: '"big.bin" (2000 bytes) exceeds the 1000 byte limit',
      data: { details: { limitBytes: 1000 } },
    });
  });

  it('leaves the legacy `od files upload` route and request shape untouched', async () => {
    stub = await listenStub((req, res, body) => {
      if (req.method === 'POST' && req.url === '/api/projects/p1/files') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ file: { name: 'a.txt', path: 'a.txt', size: body.length } }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });

    tmpDir = mkdtempSync(join(tmpdir(), 'od-cli-upload-'));
    const localFile = join(tmpDir, 'a.txt');
    writeFileSync(localFile, 'hello');

    const result = await runCli(['files', 'upload', 'p1', localFile, '--daemon-url', stub.baseUrl, '--json']);

    expect(result.code).toBe(0);
    expect(stub.requests.map((r) => `${r.method} ${r.url}`)).toEqual(['POST /api/projects/p1/files']);
    const sent = JSON.parse(stub.requests[0]!.body);
    expect(sent).toMatchObject({ name: 'a.txt', encoding: 'base64' });
    expect(sent.content).toBe(Buffer.from('hello').toString('base64'));
  });
});
