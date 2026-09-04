import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const CLI = path.join(__dirname, '..', 'src', 'cli.ts');
const TSX = path.join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');
const DEAD_DAEMON = 'http://127.0.0.1:9';

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(TSX, [CLI, ...args], { timeout: 30_000 }, (error, stdout, stderr) => {
      resolve({
        code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
        stdout,
        stderr,
      });
    });
  });
}

// Regression pins for the subcommand-token filter: a flag VALUE equal to the
// subcommand name must survive parsing. Exit 3 (daemon unreachable) proves the
// arguments parsed; exit 2 with "requires a value" is the filter bug.
describe('od preview argument parsing', () => {
  it('keeps a --id value that equals the subcommand name', async () => {
    const { code, stderr } = await runCli([
      'preview', 'stop', '--project', 'p1', '--id', 'stop', '--daemon-url', DEAD_DAEMON,
    ]);
    expect(stderr).not.toContain('requires a value');
    expect(code).toBe(3);
  });

  it('routes `open` to the daemon with the session id', async () => {
    const { code, stderr } = await runCli([
      'preview', 'open', '--project', 'p1', '--id', 'pv1', '--daemon-url', DEAD_DAEMON,
    ]);
    expect(stderr).not.toContain('unknown subcommand');
    expect(code).toBe(3);
  });

  it('requires --id for open', async () => {
    const { code, stderr } = await runCli([
      'preview', 'open', '--project', 'p1', '--daemon-url', DEAD_DAEMON,
    ]);
    expect(stderr).toContain('--id required');
    expect(code).toBe(2);
  });

  it('keeps a --dir value that equals the subcommand name', async () => {
    const { code, stderr } = await runCli([
      'preview', 'start', '--project', 'p1', '--port', '3000', '--dir', 'start',
      '--daemon-url', DEAD_DAEMON, '--', 'npm', 'run', 'dev',
    ]);
    expect(stderr).not.toContain('requires a value');
    expect(code).toBe(3);
  });
});

/**
 * The CLI half of the announcement (AGENTS.md, "Capability exposure"): the web
 * panel reads whether the front can serve a preview's root-absolute assets, so
 * an external agent driving `od` must be able to read the same fact. `list`
 * relays the daemon's JSON verbatim, which is what this pins.
 */
describe('od preview list output', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.map((s) => new Promise<void>((resolve) => {
        s.closeAllConnections?.();
        s.close(() => resolve());
      })),
    );
    servers.length = 0;
  });

  it('relays whether the front serves the preview root-absolute assets', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        previews: [{
          id: 'pv1',
          projectId: 'p1',
          pid: 4242,
          port: 8125,
          url: 'http://localhost:17622/api/projects/p1/previews/pv1/proxy/',
          frontServesRootAbsoluteAssets: false,
          command: ['npm', 'run', 'dev'],
          cwd: '/tmp/p1',
          startedAt: 1700000000000,
          status: 'ready',
        }],
      }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    const { code, stdout } = await runCli([
      'preview', 'list', '--project', 'p1', '--daemon-url', `http://127.0.0.1:${port}`,
    ]);
    expect(code).toBe(0);
    const listed = JSON.parse(stdout) as { previews: Array<{ frontServesRootAbsoluteAssets: boolean }> };
    expect(listed.previews[0]!.frontServesRootAbsoluteAssets).toBe(false);
  });
});
