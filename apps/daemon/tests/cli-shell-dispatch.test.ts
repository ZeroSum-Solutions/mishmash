// `od shell` must be reachable.
//
// `runShell` has been fully implemented in cli.ts for some time -- help text,
// `--project` validation, `--json` output, and an interactive PTY attached over
// SSE against the same `POST /api/projects/:id/terminals` endpoint the web
// terminal tab uses. It was simply never added to SUBCOMMAND_MAP, so the
// dispatcher fell through and `od shell` reported an unknown subcommand while
// the handler sat in the file unreferenced.
//
// That makes it a dual-track regression under AGENTS.md's "Capability exposure"
// rule: the in-app terminal was reachable from the web UI but not from the CLI,
// so no external agent driving Open Design through `od` could open a project
// shell.
//
// This spec pins the dispatch itself rather than the terminal behaviour. It
// asserts the two things that would break if the map entry were dropped again:
// the subcommand resolves at all, and it resolves to a handler that enforces
// `--project` instead of silently succeeding.
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
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
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

describe('od shell dispatch', () => {
  it('resolves the shell subcommand and prints its usage', async () => {
    const { stdout, stderr, code } = await runCli(['shell', '--help']);

    // The dispatcher prints "unknown subcommand" when a verb is missing from
    // SUBCOMMAND_MAP, so asserting its absence is what actually pins the
    // registration.
    expect(`${stdout}${stderr}`).not.toMatch(/unknown subcommand/i);
    expect(stdout).toContain('od shell --project');
    expect(code).toBe(0);
  }, 30_000);

  it('requires --project rather than proceeding without a target', async () => {
    const { stderr, code } = await runCli(['shell', '--json']);

    expect(stderr).toContain('--project <projectId> is required');
    expect(code).toBe(2);
  }, 30_000);
});
