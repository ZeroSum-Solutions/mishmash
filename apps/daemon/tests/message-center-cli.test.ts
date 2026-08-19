import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

const execFileP = promisify(execFile);

interface StartedDaemon {
  url: string;
  shutdown: () => Promise<void> | void;
}
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
  setResponder: (fn: (req: CapturedRequest) => StubResponse) => void;
  close: () => Promise<void>;
}

interface StubResponse {
  status: number;
  body: unknown;
}

async function startStubServer(): Promise<StubServer> {
  const requests: CapturedRequest[] = [];
  let responder: (req: CapturedRequest) => StubResponse = (_req) => ({
    status: 200,
    body: { ok: true },
  });

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
      const response = responder(captured);
      res.statusCode = response.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(response.body));
    });
  });

  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('stub server has no address');

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
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
    const { stdout, stderr } = await execFileP(
      process.execPath,
      [TSX_CLI, CLI_SRC, ...args],
      {
        cwd: DAEMON_ROOT,
        env,
        timeout: 15_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
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

// The stub server below accepts any responder a test hands it — useful for
// proving the CLI builds the right request (query params, locale mapping,
// output formatting), but it would stay green even if the real daemon route
// still proxied to the vendor and returned arbitrary messages. The second
// `describe` block drives the CLI against the actual registered
// `/api/integrations/vela/message-center/*` handler (apps/daemon/src/routes/
// vela.ts) and asserts the exact local-empty contract R1 promises, which the
// stub cannot prove either way.
describe('od message-center CLI', () => {
  let stub: StubServer;

  beforeAll(async () => {
    stub = await startStubServer();
  });

  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.requests.length = 0;
    stub.setResponder(() => ({ status: 200, body: { ok: true } }));
  });

  it('prints usage on `od message-center help` and exits 0', async () => {
    const result = await runCli(['message-center', 'help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/od message-center/);
    expect(result.stdout).toMatch(/read-all/);
    expect(stub.requests).toHaveLength(0);
  });

  it('lists messages through the daemon route and maps locale/filter query params', async () => {
    stub.setResponder((req) => {
      if (req.method === 'GET' && req.url === '/api/integrations/vela/message-center/messages?locale=en-US&filter=unread&limit=50') {
        return {
          status: 200,
          body: {
            messages: [
              {
                id: 'release',
                typeName: 'Product update',
                title: 'MishMash 0.14 is available',
                publishedAt: '2026-07-16T12:00:00.000Z',
                readAt: null,
              },
            ],
            nextCursor: null,
            unreadCount: 1,
          },
        };
      }
      return { status: 404, body: { error: 'unexpected' } };
    });

    const result = await runCli([
      'message-center',
      'list',
      '--locale',
      'en',
      '--filter',
      'unread',
      '--limit',
      '50',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]).toMatchObject({
      method: 'GET',
      url: '/api/integrations/vela/message-center/messages?locale=en-US&filter=unread&limit=50',
    });
    expect(result.stdout).toContain('release\tunread\tProduct update\t2026-07-16T12:00:00.000Z\tMishMash 0.14 is available');
    expect(result.stdout).toContain('unreadCount\t1');
  });

  it('emits raw JSON for `message-center list --json`', async () => {
    const payload = {
      messages: [],
      nextCursor: 'cursor-2',
      unreadCount: 0,
    };
    stub.setResponder(() => ({ status: 200, body: payload }));

    const result = await runCli([
      'message-center',
      'list',
      '--json',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(payload);
  });

  it('POSTs the message read endpoint on `message-center read <id>`', async () => {
    stub.setResponder((req) => {
      if (req.method === 'POST' && req.url === '/api/integrations/vela/message-center/messages/release%2F2026/read') {
        return { status: 200, body: { ok: true, id: 'release/2026' } };
      }
      return { status: 404, body: { error: 'unexpected' } };
    });

    const result = await runCli([
      'message-center',
      'read',
      'release/2026',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/integrations/vela/message-center/messages/release%2F2026/read',
    });
    expect(result.stdout).toContain('Marked message as read\trelease/2026');
  });

  it('POSTs the read-all endpoint on `message-center read-all --json`', async () => {
    const payload = { ok: true, updated: 3 };
    stub.setResponder((req) => {
      if (req.method === 'POST' && req.url === '/api/integrations/vela/message-center/read-all') {
        return { status: 200, body: payload };
      }
      return { status: 404, body: { error: 'unexpected' } };
    });

    const result = await runCli([
      'message-center',
      'read-all',
      '--json',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/integrations/vela/message-center/read-all',
    });
    expect(JSON.parse(result.stdout)).toEqual(payload);
  });

  it('fails fast when `message-center read` is missing an id', async () => {
    const result = await runCli(['message-center', 'read', '--daemon-url', stub.baseUrl]);
    expect(result.code).toBe(2);
    expect(stub.requests).toHaveLength(0);
    expect(result.stderr).toMatch(/Usage: od message-center read/);
  });
});

describe('od message-center CLI against the registered local route', () => {
  let daemon: StartedDaemon;

  beforeAll(async () => {
    daemon = (await startServer({ port: 0, returnServer: true })) as StartedDaemon;
  });

  afterAll(async () => {
    await daemon.shutdown();
  });

  it('`message-center list --json` returns the exact empty page, not a stub-shaped stand-in', async () => {
    const result = await runCli(['message-center', 'list', '--json', '--daemon-url', daemon.url]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ messages: [], nextCursor: null, unreadCount: 0 });
  });

  it('`message-center list` prints the empty-inbox line against the real route', async () => {
    const result = await runCli(['message-center', 'list', '--daemon-url', daemon.url]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('No message-center messages.\n');
  });

  it('`message-center read <id>` acknowledges locally without a vendor round trip', async () => {
    const result = await runCli(['message-center', 'read', 'anything', '--daemon-url', daemon.url]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Marked message as read\tanything');
  });

  it('`message-center read --json` returns the real route\'s exact ack, not an arbitrary echo', async () => {
    const result = await runCli(['message-center', 'read', 'anything', '--json', '--daemon-url', daemon.url]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true });
  });

  it('`message-center read-all --json` returns the real route\'s exact ok response', async () => {
    const result = await runCli(['message-center', 'read-all', '--json', '--daemon-url', daemon.url]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true });
  });
});
