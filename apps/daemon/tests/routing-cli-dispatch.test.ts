// `od route` must not crash on dispatch (mirrors cli-usage-dispatch.test.ts's
// TDZ regression guard: ROUTE_STRING_FLAGS/ROUTE_BOOLEAN_FLAGS must be
// declared before the top-of-file SUBCOMMAND_MAP dispatcher runs, or --help
// throws "Cannot access '...' before initialization" instead of printing).

import { spawn } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CLI_SRC = path.join(__dirname, '../src/cli.ts');
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, CLI_SRC, ...args], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, TMPDIR: '/tmp', TMP: '/tmp', TEMP: '/tmp' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI timed out: od ${args.join(' ')}`));
    }, 20_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, code });
    });
  });
}

describe('od route dispatch', () => {
  it('does not throw a temporal-dead-zone ReferenceError on --help', async () => {
    const { stdout, stderr, code } = await runCli(['route', '--help']);
    expect(stderr).not.toContain('ReferenceError');
    expect(stderr).not.toContain('before initialization');
    expect(stdout).toContain('od route <policy|preview|meters>');
    expect(code).toBe(0);
  });

  it('exits with usage on an unrecognized subcommand instead of crashing', async () => {
    const { stderr, code } = await runCli(['route', 'bogus']);
    expect(stderr).not.toContain('ReferenceError');
    expect(stderr).toContain('unknown subcommand');
    expect(code).toBe(2);
  });
});
