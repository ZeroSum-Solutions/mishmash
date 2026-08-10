import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const CLI = path.join(__dirname, '..', 'src', 'cli.ts');
const TSX = path.join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');
const DEAD_DAEMON = 'http://127.0.0.1:9';

function runCli(args: string[]): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    execFile(TSX, [CLI, ...args], { timeout: 30_000 }, (error, stdout) => {
      resolve({ code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0, stdout });
    });
  });
}

// Regression pin: `preview` took its id with a bare
// `rest.find((a) => !a.startsWith('-'))`, which cannot tell a positional from
// a string flag's VALUE. With `--daemon-url` written before the id — the
// documented order for every other library command — the daemon URL itself
// became the template id.
//
// `--url` prints the composed address and makes no request, so the parse is
// observable without a live daemon.
describe('od design-templates preview argument parsing', () => {
  it('takes the id positionally when --daemon-url precedes it', async () => {
    const { stdout } = await runCli([
      'design-templates', 'preview', '--daemon-url', DEAD_DAEMON, 'my-template', '--url',
    ]);
    expect(stdout.trim()).toBe(`${DEAD_DAEMON}/api/skills/my-template/example`);
  });

  it('still takes the id positionally when it precedes the flags', async () => {
    const { stdout } = await runCli([
      'design-templates', 'preview', 'my-template', '--daemon-url', DEAD_DAEMON, '--url',
    ]);
    expect(stdout.trim()).toBe(`${DEAD_DAEMON}/api/skills/my-template/example`);
  });
});

// `show` is the same parse in the SHARED library helper, so the identical bug
// reached `od skills show`, `od craft show`, and `od design-systems show` too.
// It issues a real request, so the parse is observed by recording the path a
// stub daemon is asked for.
describe('od <library> show argument parsing', () => {
  let server: http.Server;
  let daemonUrl: string;
  const requested: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requested.push(req.url ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    daemonUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('takes the id positionally when --daemon-url precedes it', async () => {
    requested.length = 0;
    await runCli(['design-templates', 'show', '--daemon-url', daemonUrl, 'my-template']);
    expect(requested).toEqual(['/api/design-templates/my-template']);
  });
});
