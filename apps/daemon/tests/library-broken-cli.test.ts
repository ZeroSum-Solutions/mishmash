// W8C item 4: `od library broken [--json]` drives the new
// `GET /api/library/assets/broken` route. RED on base:
// `unknown subcommand: od library broken` (no `case 'broken'` exists in
// `runLibrary`'s switch). GREEN on branch: the stub's response is printed
// as JSON under `--json`, and as the same one-line-per-asset text `list`
// already uses otherwise.
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli-stub.js';

interface StubServer {
  baseUrl: string;
  requests: string[];
  close: () => Promise<void>;
}

const BROKEN_RESPONSE = {
  assets: [
    { id: 'broken-1', kind: 'image', width: 10, height: 10, sourceTitle: 'render.png' },
  ],
  total: 1,
  truncated: false,
};

async function startLibraryBrokenStub(): Promise<StubServer> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url === '/api/library/assets/broken') {
      res.statusCode = 200;
      res.end(JSON.stringify(BROKEN_RESPONSE));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { code: 'unexpected-request', message: req.url } }));
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

let stub: StubServer | null = null;

afterEach(async () => {
  if (stub) await stub.close();
  stub = null;
});

describe('od library broken', () => {
  it('prints the broken asset list as JSON under --json', async () => {
    stub = await startLibraryBrokenStub();

    const result = await runCli(['library', 'broken', '--json', '--daemon-url', stub.baseUrl]);

    expect(result.code).toBe(0);
    expect(stub.requests).toEqual(['GET /api/library/assets/broken']);
    expect(JSON.parse(result.stdout)).toEqual(BROKEN_RESPONSE);
  });

  it('prints one line per asset in the non-JSON form', async () => {
    stub = await startLibraryBrokenStub();

    const result = await runCli(['library', 'broken', '--daemon-url', stub.baseUrl]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('broken-1');
    expect(result.stdout).toContain('render.png');
  });
});
