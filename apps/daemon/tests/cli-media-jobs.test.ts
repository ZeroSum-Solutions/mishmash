// Red spec for W7C work item 3: `od media job encode|download`, `od media
// status`, `od media list`, `od media cancel`, and `od media --help` naming
// the three job limits. None of this exists on base — `runMedia` in
// apps/daemon/src/cli.ts only recognizes `generate` and `wait`, so every
// other sub-verb below prints "unknown subcommand" and exits 1. That is a
// genuine CLI-behaviour failure (wrong stderr text, wrong exit code), not
// an import error: this file drives the real `od` entrypoint as a child
// process through tsx, exactly like the existing cli-templates.test.ts
// harness, and never imports daemon internals directly.

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, insertProject, openDatabase } from '../src/db.js';
import { insertMediaTask } from '../src/media/tasks.js';
import { startServer } from '../src/server.js';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = pathResolve(__dirname, '..');
const REPO_ROOT = pathResolve(__dirname, '../../..');
const CLI_SRC = pathResolve(__dirname, '../src/cli.ts');
const TSX_CLI = pathResolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

const LIMIT_ENV_VARS = [
  'OD_MEDIA_JOB_MAX_DURATION_MS',
  'OD_MEDIA_JOB_MAX_OUTPUT_BYTES',
  'OD_MEDIA_JOB_MAX_CONCURRENT',
] as const;

async function runCli(
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
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

describe('od media job / status / list / cancel (CLI, work item 3)', () => {
  it('`od media --help` names all three job limits by env var', async () => {
    const result = await runCli(['media', '--help']);
    for (const envVar of LIMIT_ENV_VARS) {
      expect(
        result.stdout + result.stderr,
        `od media --help must document ${envVar} (INV-7.14)`,
      ).toMatch(envVar);
    }
  });

  it('`od media job download --json` prints a CreateMediaJobResponse instead of "unknown subcommand"', async () => {
    // No daemon needs to be reachable for this assertion: on base the CLI
    // rejects the sub-verb before it ever tries to make an HTTP call.
    const result = await runCli([
      'media',
      'job',
      'download',
      '--url',
      'https://example.invalid/fixture.bin',
      '--output',
      'fixture.bin',
      '--project',
      'proj_test',
      '--json',
    ]);
    expect(result.stderr, 'RED on base: "unknown subcommand: od media job"').not.toMatch(/unknown subcommand/);
  });

  it('`od media status <taskId> --json` prints a snapshot instead of "unknown subcommand"', async () => {
    const result = await runCli(['media', 'status', 'task_fixture', '--project', 'proj_test', '--json']);
    expect(result.stderr).not.toMatch(/unknown subcommand/);
  });

  it('`od media list` prints a MediaTaskListResponse instead of "unknown subcommand"', async () => {
    const result = await runCli(['media', 'list', '--project', 'proj_test', '--json']);
    expect(result.stderr).not.toMatch(/unknown subcommand/);
  });

  it('`od media cancel <taskId>` ends the task instead of "unknown subcommand"', async () => {
    const result = await runCli(['media', 'cancel', 'task_fixture', '--project', 'proj_test']);
    expect(result.stderr).not.toMatch(/unknown subcommand/);
  });
});

// Behavioural, against a real booted daemon: `od media cancel` must print the
// daemon's refusal reason and exit non-zero when the target task is real but
// is not one of THIS route's tracked encode/download jobs (a media_tasks row
// another surface persisted directly — e.g. a video-import download — never
// registers a killable child, so cancel must refuse rather than lying that it
// canceled something it never touched; integration-grok-r1 finding 1).
describe('od media cancel — refused against an untracked live task (real daemon)', () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
    closeDatabase();
  });

  it('prints the reason instead of "canceled" and exits non-zero', async () => {
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const db = openDatabase(process.cwd(), { dataDir });
    const projectId = `project_${randomUUID()}`;
    const now = Date.now();
    insertProject(db, { id: projectId, name: 'cli untracked-task project', createdAt: now, updatedAt: now });
    const taskId = `task_${randomUUID()}`;
    insertMediaTask(db, {
      id: taskId,
      projectId,
      status: 'running',
      surface: 'video-import',
      progress: ['downloading from Vimeo'],
      startedAt: now,
      updatedAt: now,
    });

    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const result = await runCli([
      'media',
      'cancel',
      taskId,
      '--project',
      projectId,
      '--daemon-url',
      started.url,
    ]);

    expect(result.code, 'a refused cancel must exit non-zero').not.toBe(0);
    expect(result.stderr, 'must not claim the task was canceled').not.toMatch(/media task .* canceled$/m);
    expect(result.stderr, 'must print the daemon-supplied reason').toMatch(/not canceled/i);
    expect(result.stderr, 'must surface the typed refusal, not a generic HTTP dump').toMatch(
      /not a background encode\/download job/i,
    );
  });
});
