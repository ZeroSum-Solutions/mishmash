// `od usage` must not crash on dispatch.
//
// apps/daemon/src/cli.ts's SUBCOMMAND_MAP dispatcher (`await
// SUBCOMMAND_MAP[first](rest)`) sits near the TOP of the file and runs as
// plain top-level module code -- there is no wrapping `main()` called at the
// bottom, so by the time a subcommand handler's body actually executes, the
// module's own top-to-bottom pass has only reached the dispatch line, not
// whatever comes after it textually. A flag-set `const` declared near a
// handler's own definition (deep in the file, after the dispatcher) is still
// in its temporal dead zone the first time that handler runs, so referencing
// it throws `ReferenceError: Cannot access '...' before initialization`
// instead of returning parsed flags. `USAGE_STRING_FLAGS` /
// `USAGE_BOOLEAN_FLAGS` originally shipped declared right next to
// `runUsage`, thousands of lines after the dispatcher -- this is a
// deterministic repro (`--help` reaches the flag-parsing line before any
// network/daemon setup) pinning the fix: those two consts must be declared
// before the dispatcher, alongside the file's other pre-hoisted flag sets
// (e.g. LIBRARY_STRING_FLAGS).
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

describe('od usage dispatch', () => {
  it('does not throw a temporal-dead-zone ReferenceError on --help', async () => {
    const { stdout, stderr, code } = await runCli(['usage', '--help']);
    expect(stderr).not.toContain('ReferenceError');
    expect(stderr).not.toContain('before initialization');
    expect(stdout).toContain('od usage --project');
    expect(code).toBe(0);
  });
});
