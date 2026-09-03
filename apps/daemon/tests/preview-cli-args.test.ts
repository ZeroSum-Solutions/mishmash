import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import path from 'node:path';

const CLI = path.join(__dirname, '..', 'src', 'cli.ts');
const TSX = path.join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');
const DEAD_DAEMON = 'http://127.0.0.1:9';

function runCli(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    execFile(TSX, [CLI, ...args], { timeout: 30_000 }, (error, _stdout, stderr) => {
      resolve({ code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0, stderr });
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
