// Red spec for W7C work item 2 (INV-7.6 / INV-7.14): a NEW daemon module,
// apps/daemon/src/media/jobs.ts, running heavy encode/download work as
// background media_tasks instead of inside the request/turn. On base
// (8487362f0) none of this exists: no `POST /api/projects/:id/media/jobs`,
// no `POST /api/media/tasks/:id/cancel`, no `GET /api/media/jobs/limits` —
// every HTTP assertion below is RED because the route 404s, not because of
// a missing import.
//
// The encode sub-tests drive a committed first-party fake ffmpeg/ffprobe
// (fixtures/w7-media/fake-ffmpeg.mjs, frozen progress + sleep + output
// bytes + kill receipt) through test-only binary-override env vars
// (OD_MEDIA_JOB_FFMPEG_BIN / OD_MEDIA_JOB_FFPROBE_BIN) that work item 2's
// jobs.ts is expected to honor per job, read at request time (same idiom
// as OD_MEDIA_JOB_MAX_DURATION_MS et al.), defaulting to the real
// `ffmpeg`/`ffprobe` on PATH in production.
//
// The download sub-tests need the internal `lookup` DI seam the brief
// describes (mirroring connectionTest.ts's DnsLookupFn): a hostname that
// resolves to a NON-blocked, public-looking address so the real,
// unmocked private/loopback/link-local check runs and allows it (the
// "success" case), plus a `httpGetSpy` transport seam that separately
// redirects the resulting connection to the local fixture server — a
// hostname resolving to loopback is REJECTED by that same check (see
// test "(c2)"), matching production, where the check never carves out
// loopback for a caller-supplied download URL. Both seams are parameters
// of the job runner module, not reachable through any HTTP field, so
// those sub-tests import the module directly rather than going through
// the route. Until media/jobs.ts exists, they fail on a clear, readable
// assertion (`expect.fail(...)`) instead of crashing the whole suite on
// import — the red spec's first failure stays behavioural, per
// builder-protocol.md.

import type http from 'node:http';
import { createServer as createHttpServer } from 'node:http';
import httpNode from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, insertProject, openDatabase } from '../../src/db.js';
import { insertMediaTask } from '../../src/media/tasks.js';
import { startServer } from '../../src/server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(HERE, '../fixtures/w7-media');
const FAKE_FFMPEG = path.join(FIXTURE_DIR, 'fake-ffmpeg.mjs');
const FAKE_FFPROBE_HANG = path.join(FIXTURE_DIR, 'fake-ffprobe-hang.mjs');
const FAKE_FFMPEG_SHA256 = readFileSync(path.join(FIXTURE_DIR, 'fake-ffmpeg-output.sha256'), 'utf8').trim();
const execFileP = promisify(execFile);
const DAEMON_ROOT = path.resolve(HERE, '../..');
const REPO_ROOT = path.resolve(HERE, '../../../..');
const CLI_SRC = path.resolve(DAEMON_ROOT, 'src/cli.ts');
const TSX_CLI = path.resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

const LIMIT_ENV_VARS = [
  'OD_MEDIA_JOB_MAX_DURATION_MS',
  'OD_MEDIA_JOB_MAX_OUTPUT_BYTES',
  'OD_MEDIA_JOB_MAX_CONCURRENT',
] as const;

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Deliberately untyped: `../../src/media/jobs.js` is a NEW module this
// track adds in the first fix commit and does not exist on base. A typed
// `import()` type-query here would make `tsc` fail at the red-spec commit
// too, which is a compile-time failure, not the behavioural one the red
// spec is required to show (builder-protocol.md:43-48). The dynamic
// `import()` call below is a plain runtime expression instead.
async function importJobsModuleOrFail(): Promise<Record<string, unknown> | null> {
  const modulePath = '../../src/media/jobs.js';
  try {
    return await import(/* @vite-ignore */ modulePath);
  } catch {
    return null;
  }
}

describe('media jobs — encode', () => {
  let server: http.Server | null = null;
  let dataDir: string;
  const OVERRIDE_ENV_VARS = [
    'OD_MEDIA_JOB_FFMPEG_BIN',
    'OD_MEDIA_JOB_FFPROBE_BIN',
    'OD_MEDIA_JOB_MAX_DURATION_MS',
    'OD_MEDIA_JOB_MAX_CONCURRENT',
  ] as const;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
    closeDatabase();
    for (const key of OVERRIDE_ENV_VARS) delete process.env[key];
  });

  async function boot(): Promise<{ baseUrl: string; projectId: string; projectDir: string }> {
    const envDataDir = process.env.OD_DATA_DIR;
    if (!envDataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    dataDir = envDataDir;
    // Test-only binary overrides that work item 2's jobs.ts is expected to
    // read per-job (same idiom as the other OD_MEDIA_JOB_* limit env vars),
    // pointing the encode/probe children at the frozen fixture instead of a
    // real ffmpeg/ffprobe on PATH.
    process.env.OD_MEDIA_JOB_FFMPEG_BIN = FAKE_FFMPEG;
    process.env.OD_MEDIA_JOB_FFPROBE_BIN = FAKE_FFMPEG;
    const db = openDatabase(process.cwd(), { dataDir });
    const projectId = `project_${randomUUID()}`;
    const now = Date.now();
    insertProject(db, { id: projectId, name: 'jobs project', createdAt: now, updatedAt: now });
    const projectDir = path.join(dataDir, 'projects', projectId);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, 'in.mp4'), 'not a real video, the fixture ignores it');
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;
    return { baseUrl: started.url, projectId, projectDir };
  }

  it('(a) reports monotonic fraction and reaches done with the fixture output, byte-identical', async () => {
    const { baseUrl, projectId, projectDir } = await boot();

    const createResp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/media/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'encode', input: 'in.mp4', output: 'out.mp4', preset: 'h264-web' }),
    });
    // RED on base: no jobs route exists yet — this 404s.
    expect(createResp.status, 'POST /api/projects/:id/media/jobs must exist (work item 2)').not.toBe(404);
    const created = (await createResp.json()) as { taskId?: string };
    expect(typeof created.taskId).toBe('string');
    const taskId = created.taskId as string;

    let last: Record<string, unknown> | null = null;
    let since = 0;
    const fractions: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const waitResp = await fetch(`${baseUrl}/api/media/tasks/${encodeURIComponent(taskId)}/wait`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ since, timeoutMs: 1500 }),
      });
      last = (await waitResp.json()) as Record<string, unknown>;
      if (typeof last.nextSince === 'number') since = last.nextSince as number;
      if (typeof last.fraction === 'number') fractions.push(last.fraction as number);
      if (last.status === 'done' || last.status === 'failed') break;
    }

    expect(last?.status).toBe('done');
    for (let i = 1; i < fractions.length; i += 1) {
      expect(fractions[i]!).toBeGreaterThanOrEqual(fractions[i - 1]!);
    }

    const outputPath = path.join(projectDir, 'out.mp4');
    expect(existsSync(outputPath), 'the encode output must land under the project root').toBe(true);
    const outputBytes = readFileSync(outputPath);
    expect(sha256Hex(outputBytes)).toBe(FAKE_FFMPEG_SHA256);
  });

  it('(b) ends failed with LIMIT_EXCEEDED naming the duration limit, and the child is actually killed', async () => {
    const { baseUrl, projectId, projectDir } = await boot();
    process.env.OD_MEDIA_JOB_MAX_DURATION_MS = '200';

    const createResp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/media/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'encode', input: 'in.mp4', output: 'out-limited.mp4', preset: 'h264-web' }),
    });
    expect(createResp.status, 'POST /api/projects/:id/media/jobs must exist (work item 2)').not.toBe(404);
    const created = (await createResp.json()) as { taskId?: string };
    const taskId = created.taskId as string;

    let last: Record<string, unknown> | null = null;
    let since = 0;
    for (let i = 0; i < 30; i += 1) {
      const waitResp = await fetch(`${baseUrl}/api/media/tasks/${encodeURIComponent(taskId)}/wait`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ since, timeoutMs: 1500 }),
      });
      last = (await waitResp.json()) as Record<string, unknown>;
      if (typeof last.nextSince === 'number') since = last.nextSince as number;
      if (last.status === 'done' || last.status === 'failed') break;
    }

    expect(last?.status).toBe('failed');
    const error = last?.error as { code?: string; message?: string } | undefined;
    expect(error?.code).toBe('LIMIT_EXCEEDED');
    expect(error?.message ?? '').toMatch(/OD_MEDIA_JOB_MAX_DURATION_MS/);
    expect(error?.message ?? '').toMatch(/200/);

    const killReceipt = path.join(projectDir, 'out-limited.mp4.killed');
    expect(existsSync(killReceipt), 'SIGTERM must actually reach the fake-ffmpeg child (kill receipt)').toBe(true);
  });

  it('(d) cancel while running ends in exactly one terminal state with the child gone', async () => {
    const { baseUrl, projectId, projectDir } = await boot();

    const createResp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/media/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'encode', input: 'in.mp4', output: 'out-cancel.mp4', preset: 'h264-web' }),
    });
    expect(createResp.status).not.toBe(404);
    const created = (await createResp.json()) as { taskId?: string };
    const taskId = created.taskId as string;

    // Wait for the encode child itself to be emitting progress (a numeric
    // `fraction`, which only ever comes from ffmpeg's `-progress` output)
    // before canceling, so this test exercises "cancel while running" the
    // ENCODE phase specifically — cancel during the PROBE phase is its own,
    // faster-resolving path that never spawns ffmpeg at all (see "(d2)").
    let sinceBeforeCancel = 0;
    for (let i = 0; i < 30; i += 1) {
      const pollResp = await fetch(`${baseUrl}/api/media/tasks/${encodeURIComponent(taskId)}/wait`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ since: sinceBeforeCancel, timeoutMs: 1500 }),
      });
      const poll = (await pollResp.json()) as Record<string, unknown>;
      if (typeof poll.nextSince === 'number') sinceBeforeCancel = poll.nextSince as number;
      if (typeof poll.fraction === 'number' || poll.status === 'done' || poll.status === 'failed') break;
    }

    const cancelResp = await fetch(`${baseUrl}/api/media/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: 'POST',
    });
    expect(cancelResp.status, 'POST /api/media/tasks/:id/cancel must exist (work item 2)').not.toBe(404);
    expect(cancelResp.status, 'a tracked encode/download job must still cancel, not be refused as NOT_CANCELABLE').toBe(200);

    // `since` is compared against the task's progress-entry count, not a
    // timestamp — passing 0 here (instead of `sinceBeforeCancel`, the
    // count already observed above) would short-circuit `/wait` into
    // returning the CURRENT snapshot immediately (progress.length > 0
    // already), racing the cancel's async kill instead of actually
    // waiting for the terminal update it produces.
    const waitResp = await fetch(`${baseUrl}/api/media/tasks/${encodeURIComponent(taskId)}/wait`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ since: sinceBeforeCancel, timeoutMs: 2000 }),
    });
    const snap = (await waitResp.json()) as { status?: string; error?: { code?: string } };
    expect(snap.status).toBe('failed');
    expect(snap.error?.code).toBe('CANCELED');

    const killReceipt = path.join(projectDir, 'out-cancel.mp4.killed');
    expect(existsSync(killReceipt), 'cancel must SIGTERM the child, not just mark the row failed').toBe(true);
  });

  it('(d3) cancel refuses a live media_tasks row that is not a tracked encode/download job (integration-grok-r1 finding 1)', async () => {
    // A `media_tasks` row another surface persisted directly (e.g. a
    // video-import download, or the pre-existing media-generate surface)
    // never sets `LiveMediaTask.kind` and is never registered in jobs.ts's
    // `activeJobs` kill map. Cancel must refuse rather than answering 200
    // with the current, unchanged snapshot while the underlying work keeps
    // running.
    const envDataDir = process.env.OD_DATA_DIR;
    if (!envDataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const { baseUrl } = await boot();
    const db = openDatabase(process.cwd(), { dataDir: envDataDir });
    const projectId = `project_${randomUUID()}`;
    const now = Date.now();
    insertProject(db, { id: projectId, name: 'untracked-task project', createdAt: now, updatedAt: now });
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

    const cancelResp = await fetch(`${baseUrl}/api/media/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: 'POST',
    });
    expect(cancelResp.status).toBe(409);
    const body = (await cancelResp.json()) as { error?: { code?: string; message?: string }; task?: { status?: string } };
    expect(body.error?.code).toBe('NOT_CANCELABLE');
    expect(body.error?.message ?? '').toMatch(/not.*cancel/i);
    // The refusal must not have touched the task: still `running`, no
    // CANCELED error attached.
    expect(body.task?.status).toBe('running');

    const statusResp = await fetch(`${baseUrl}/api/media/tasks/${encodeURIComponent(taskId)}/wait`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ since: 0, timeoutMs: 500 }),
    });
    const snap = (await statusResp.json()) as { status?: string };
    expect(snap.status, 'a refused cancel must not mark the untracked task CANCELED/failed').toBe('running');
  });

  it('(b2) a hung ffprobe is killed by the duration limit without ffmpeg ever spawning', async () => {
    const jobs = await importJobsModuleOrFail();
    if (!jobs) {
      expect.fail('apps/daemon/src/media/jobs.ts must exist and export runFfmpegEncodeChild (work item 2).');
      return;
    }
    const receiptPath = path.join(tmpdir(), `w7c-probe-limit-${randomUUID()}`);
    const handle = (jobs as any).runFfmpegEncodeChild({
      // Intentionally not a real binary: if ffmpeg were ever spawned in
      // this path, the outcome would come back FFMPEG_NOT_FOUND instead of
      // LIMIT_EXCEEDED, and this assertion would catch it.
      ffmpegBin: '/nonexistent/w7c-should-never-spawn-ffmpeg',
      ffprobeBin: FAKE_FFPROBE_HANG,
      args: ['-progress', 'pipe:1', 'out.mp4'],
      probeArgs: [receiptPath, '-show_entries'],
      maxDurationMs: 200,
    });
    const outcome = (await handle.promise) as { ok: boolean; error?: { code?: string; message?: string } };
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe('LIMIT_EXCEEDED');
    expect(outcome.error?.message ?? '').toMatch(/OD_MEDIA_JOB_MAX_DURATION_MS/);
    for (let i = 0; i < 50 && !existsSync(`${receiptPath}.killed`); i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(existsSync(`${receiptPath}.killed`), 'the duration limit must SIGTERM the hung ffprobe child').toBe(true);
  });

  it('(d2) cancel during ffprobe kills the probe and never spawns ffmpeg', async () => {
    const jobs = await importJobsModuleOrFail();
    if (!jobs) {
      expect.fail('apps/daemon/src/media/jobs.ts must exist and export runFfmpegEncodeChild (work item 2).');
      return;
    }
    const receiptPath = path.join(tmpdir(), `w7c-probe-cancel-${randomUUID()}`);
    const handle = (jobs as any).runFfmpegEncodeChild({
      ffmpegBin: '/nonexistent/w7c-should-never-spawn-ffmpeg',
      ffprobeBin: FAKE_FFPROBE_HANG,
      args: ['-progress', 'pipe:1', 'out.mp4'],
      probeArgs: [receiptPath, '-show_entries'],
      maxDurationMs: 30_000,
    });
    // Give the probe a moment to actually spawn before canceling, so this
    // exercises "cancel while the probe is running" rather than the
    // separate pre-spawn race the module already handles.
    await new Promise((r) => setTimeout(r, 100));
    handle.kill();
    const outcome = (await handle.promise) as { ok: boolean; error?: { code?: string } };
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe('CANCELED');
    for (let i = 0; i < 50 && !existsSync(`${receiptPath}.killed`); i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(existsSync(`${receiptPath}.killed`), 'cancel must SIGTERM the probe child, not just wait for it').toBe(true);
  });

  it('(e) a task already running when the daemon restarts comes back interrupted (existing reconcile path)', async () => {
    const envDataDir = process.env.OD_DATA_DIR;
    if (!envDataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const db = openDatabase(process.cwd(), { dataDir: envDataDir });
    const projectId = `project_${randomUUID()}`;
    const now = Date.now() - 5_000;
    insertProject(db, { id: projectId, name: 'restart project', createdAt: now, updatedAt: now });
    const taskId = `task_${randomUUID()}`;
    insertMediaTask(db, {
      id: taskId,
      projectId,
      status: 'running',
      surface: 'video',
      model: 'ffmpeg-encode',
      progress: ['probing input'],
      startedAt: now,
      updatedAt: now,
    });

    // reconcileMediaTasksOnBoot already runs unconditionally at server
    // startup (existing behaviour) — this passes on base by construction
    // and is VERIFIED rather than new red, per builder-protocol.md.
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const resp = await fetch(`${started.url}/api/media/tasks/${encodeURIComponent(taskId)}/wait`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ since: 0, timeoutMs: 0 }),
    });
    const snap = (await resp.json()) as { status?: string; error?: { code?: string } };
    expect(snap.status).toBe('interrupted');
    expect(snap.error?.code).toBe('DAEMON_RESTART');
  });

  it('(f) a third concurrent job is rejected naming maxConcurrent (HTTP 429)', async () => {
    const { baseUrl, projectId } = await boot();
    process.env.OD_MEDIA_JOB_MAX_CONCURRENT = '2';

    const createOne = () =>
      fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/media/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'encode', input: 'in.mp4', output: `out-${randomUUID()}.mp4`, preset: 'h264-web' }),
      });

    const first = await createOne();
    const second = await createOne();
    const third = await createOne();

    expect(first.status, 'POST /api/projects/:id/media/jobs must exist (work item 2)').not.toBe(404);
    expect(second.status).not.toBe(404);
    // The chosen observable shape (brief work item, red-spec item f): the
    // THIRD create request itself answers 429 when maxConcurrent is
    // already saturated. (cli-media-jobs.test.ts does not assert this
    // shape today — it only covers the CLI's other sub-verbs.)
    expect(third.status).toBe(429);
    const body = (await third.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('LIMIT_EXCEEDED');
    expect(body.error?.message ?? '').toMatch(/maxConcurrent/);
  });

  it('(f2) near-simultaneous creates for DIFFERENT outputs never exceed maxConcurrent (no TOCTOU)', async () => {
    const { baseUrl, projectId } = await boot();
    process.env.OD_MEDIA_JOB_MAX_CONCURRENT = '2';

    const createOne = (n: number) =>
      fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/media/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'encode',
          input: 'in.mp4',
          output: `race-${n}-${randomUUID()}.mp4`,
          preset: 'h264-web',
        }),
      });

    // Fired WITHOUT awaiting each other, unlike test (f)'s three
    // sequential `await createOne()` calls: the concurrency check reads
    // `activeMediaJobCount()` and the reservation (`registerActiveMediaJob`)
    // happen at different points in the handler, separated by an `await
    // mediaJobOutputExists(...)`; three DIFFERENT outputs racing that
    // `await` is exactly the shape that can slip more than maxConcurrent
    // past a check-then-later-reserve implementation.
    const responses = await Promise.all([createOne(1), createOne(2), createOne(3)]);
    const statuses = responses.map((r) => r.status);
    const accepted = statuses.filter((status) => status !== 429).length;
    expect(
      accepted,
      `at most maxConcurrent (2) of 3 near-simultaneous creates for different outputs may be accepted; got statuses ${statuses.join(',')}`,
    ).toBeLessThanOrEqual(2);
    for (const response of responses) {
      if (response.status !== 429) continue;
      const rejectedBody = (await response.json()) as { error?: { code?: string } };
      expect(rejectedBody.error?.code).toBe('LIMIT_EXCEEDED');
    }
  });

  it('(g) GET /api/media/jobs/limits, `od media --help`, and docs/subprocess-limits.md agree on the SAME resolved value for each limit', async () => {
    const { baseUrl } = await boot();

    const limitsResp = await fetch(`${baseUrl}/api/media/jobs/limits`);
    expect(limitsResp.status, 'GET /api/media/jobs/limits must exist (INV-7.14)').not.toBe(404);
    const limits = (await limitsResp.json()) as Record<string, unknown>;
    expect(limits).toHaveProperty('maxDurationMs');
    expect(limits).toHaveProperty('maxOutputBytes');
    expect(limits).toHaveProperty('maxConcurrent');

    const docsPath = path.join(HERE, '../../../../docs/subprocess-limits.md');
    const docsText = readFileSync(docsPath, 'utf8');
    for (const envVar of LIMIT_ENV_VARS) {
      expect(docsText, `docs/subprocess-limits.md must name ${envVar}`).toMatch(envVar);
    }

    // Not just name presence: `od media --help` must print the same
    // RESOLVED NUMBER for each limit as the JSON endpoint and the docs
    // table, so a future default change in one place without updating the
    // other two is caught here instead of only being true by coincidence.
    const helpEnv = { ...process.env };
    delete helpEnv.NODE_OPTIONS;
    const { stdout, stderr } = await execFileP(process.execPath, [TSX_CLI, CLI_SRC, 'media', '--help'], {
      cwd: DAEMON_ROOT,
      env: helpEnv,
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const helpText = `${stdout}${stderr}`;

    const LIMIT_JSON_KEYS: Record<(typeof LIMIT_ENV_VARS)[number], keyof typeof limits> = {
      OD_MEDIA_JOB_MAX_DURATION_MS: 'maxDurationMs',
      OD_MEDIA_JOB_MAX_OUTPUT_BYTES: 'maxOutputBytes',
      OD_MEDIA_JOB_MAX_CONCURRENT: 'maxConcurrent',
    };

    for (const envVar of LIMIT_ENV_VARS) {
      const docsMatch = new RegExp(`\`${envVar}\`\\s*\\|\\s*(\\d+)`).exec(docsText);
      expect(docsMatch, `docs/subprocess-limits.md must state a numeric default for ${envVar}`).not.toBeNull();
      const docsValue = Number(docsMatch?.[1]);

      const helpMatch = new RegExp(`${envVar}\\s+default\\s+(\\d+)\\s+\\(resolved:\\s*(\\d+)\\)`).exec(helpText);
      expect(helpMatch, `\`od media --help\` must print a resolved value for ${envVar}`).not.toBeNull();
      const helpDefault = Number(helpMatch?.[1]);
      const helpResolved = Number(helpMatch?.[2]);

      const jsonValue = Number(limits[LIMIT_JSON_KEYS[envVar]]);

      expect(helpResolved, `${envVar}: od media --help resolved value must equal GET /api/media/jobs/limits`).toBe(
        jsonValue,
      );
      expect(
        helpDefault,
        `${envVar}: od media --help default must equal docs/subprocess-limits.md's default`,
      ).toBe(docsValue);
      expect(jsonValue, `${envVar}: GET /api/media/jobs/limits must equal docs/subprocess-limits.md's default`).toBe(
        docsValue,
      );
    }
  });

  it('(h) concat-copy and frames-to-mp4 jobs remove their scratch list file after reaching a terminal state, success or failure', async () => {
    const { baseUrl, projectId, projectDir } = await boot();
    writeFileSync(path.join(projectDir, 'in2.mp4'), 'second fixture input');
    // Tests (f)/(f2) fire jobs without awaiting their fixture ffmpeg child
    // to finish, so a still-running job from an earlier test in this file
    // can still hold an active-job slot here (the registry is process-wide,
    // not per-test). Raise the ceiling well above that so this test's own
    // two sequential jobs are never rejected by stale concurrency from a
    // prior test — it is not what this test exercises.
    process.env.OD_MEDIA_JOB_MAX_CONCURRENT = '10';

    function scratchFileNames(): string[] {
      return readdirSync(projectDir).filter(
        (name) => name.startsWith('.media-job-concat-') || name.startsWith('.media-job-frames-'),
      );
    }

    async function createAndAwait(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
      const createResp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/media/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(createResp.status, `${body.preset} preset must be accepted`).not.toBe(404);
      const created = (await createResp.json()) as { taskId?: string };
      const taskId = created.taskId as string;
      let last: Record<string, unknown> | null = null;
      let since = 0;
      for (let i = 0; i < 30; i += 1) {
        const waitResp = await fetch(`${baseUrl}/api/media/tasks/${encodeURIComponent(taskId)}/wait`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ since, timeoutMs: 1500 }),
        });
        last = (await waitResp.json()) as Record<string, unknown>;
        if (typeof last.nextSince === 'number') since = last.nextSince as number;
        if (last.status === 'done' || last.status === 'failed') break;
      }
      return last;
    }

    // concat-copy, success path.
    const concatLast = await createAndAwait({
      kind: 'encode',
      inputs: ['in.mp4', 'in2.mp4'],
      output: 'out-concat.mp4',
      preset: 'concat-copy',
    });
    expect(concatLast?.status, 'concat-copy must reach done against the fixture ffmpeg').toBe('done');
    expect(
      scratchFileNames(),
      'the concat-copy scratch list file must be gone once the job reaches a terminal state',
    ).toHaveLength(0);

    // frames-to-mp4, forced-failure path (same duration-ceiling fixture as
    // test (b)) — proves the scratch file is removed on the failure branch
    // too, not only on success.
    process.env.OD_MEDIA_JOB_MAX_DURATION_MS = '200';
    const framesLast = await createAndAwait({
      kind: 'encode',
      frames: [
        { path: 'in.mp4', durationMs: 100 },
        { path: 'in2.mp4', durationMs: 100 },
      ],
      output: 'out-frames.mp4',
      preset: 'frames-to-mp4',
    });
    expect(framesLast?.status, 'frames-to-mp4 must fail against a tight duration ceiling').toBe('failed');
    expect(
      scratchFileNames(),
      'the frames-to-mp4 scratch list file must be gone even when the job fails',
    ).toHaveLength(0);
  });
});

describe('media jobs — download', () => {
  afterEach(() => {
    closeDatabase();
  });

  it('(c) succeeds from a local fixture server, rejects a private/loopback target, caps a redirect chain at 3 hops, and enforces the byte ceiling with or without Content-Length', async () => {
    const jobs = await importJobsModuleOrFail();
    if (!jobs) {
      expect.fail(
        'apps/daemon/src/media/jobs.ts must exist and export a download job runner that accepts an ' +
          'injectable DNS `lookup` (mirroring connectionTest.ts DnsLookupFn) before this test can run ' +
          '(work item 2, INV-7.6).',
      );
      return;
    }

    const envDataDir = process.env.OD_DATA_DIR;
    if (!envDataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const db = openDatabase(process.cwd(), { dataDir: envDataDir });
    const projectId = `project_${randomUUID()}`;
    const now = Date.now();
    insertProject(db, { id: projectId, name: 'download project', createdAt: now, updatedAt: now });
    const projectDir = path.join(envDataDir, 'projects', projectId);
    mkdirSync(projectDir, { recursive: true });

    const body = Buffer.from('w7c-download-fixture-body');
    const fixtureServer = createHttpServer((req, res) => {
      if (req.url === '/oversized') {
        res.writeHead(200, { 'content-length': String(body.length), 'content-type': 'application/octet-stream' });
        res.end(body);
        return;
      }
      if (req.url === '/oversized-streamed') {
        // Deliberately NO content-length header: this response streams as
        // chunked transfer-encoding, so the byte ceiling can only be
        // enforced by the STREAMED check in streamResponseToFile, never
        // the pre-read declared-length check (which requires a header
        // this response omits).
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(body);
        return;
      }
      if (req.url === '/redirect-1') {
        res.writeHead(302, { location: '/redirect-2' });
        res.end();
        return;
      }
      if (req.url === '/redirect-2') {
        res.writeHead(302, { location: '/redirect-3' });
        res.end();
        return;
      }
      if (req.url === '/redirect-3') {
        res.writeHead(302, { location: '/redirect-4' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-length': String(body.length) });
      res.end(body);
    });
    await new Promise<void>((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
    const addr = fixtureServer.address();
    if (!addr || typeof addr === 'string') throw new Error('fixture server has no address');
    const fixturePort = addr.port;

    // A stub `lookup` that resolves the test hostname to a PUBLIC-looking,
    // non-blocked address (an RFC 5737-style example unicast address, not
    // loopback/private/link-local/CGNAT) — the same private/loopback check
    // that runs in production runs against THIS result (same seam, same
    // DnsLookupFn shape as connectionTest.ts). It deliberately does NOT
    // resolve to the fixture server's real loopback bind address: the
    // guard must reject a hostname that resolves to loopback (see test
    // "(c2)" below), so a "success" fixture cannot rely on that being
    // permitted. The `httpGetSpy` below is the test-only transport seam
    // that actually reaches the local fixture server once the (real,
    // unmocked) classification above has already allowed the resolved
    // address.
    const ALLOWED_RESOLVED_ADDRESS = '93.184.216.34';
    const lookup = (
      _hostname: string,
      _options: unknown,
      callback: (err: Error | null, address: string, family: number) => void,
    ) => callback(null, ALLOWED_RESOLVED_ADDRESS, 4);

    // Redirects the ACTUAL TCP connection to the real local fixture server
    // regardless of which (already-validated) address the job runner
    // thinks it is connecting to. This is a transport-level test seam —
    // `assertDownloadHostAllowed`'s classification above still runs for
    // real, unmocked, against `ALLOWED_RESOLVED_ADDRESS`; only the socket
    // this spy hands back is redirected, so the guard's verdict is
    // genuinely exercised rather than bypassed.
    const realHttpGet = httpNode.get.bind(httpNode);
    const httpGetSpy = vi
      .spyOn(httpNode, 'get')
      .mockImplementation(((options: Record<string, unknown>, callback: unknown) =>
        realHttpGet({ ...options, hostname: '127.0.0.1' } as never, callback as never)) as typeof httpNode.get);

    try {
      const outputRel = 'downloaded.bin';
      const result = await (jobs as any).runMediaDownloadJob({
        projectDir,
        url: `http://w7c-fixture.test:${fixturePort}/ok`,
        outputRel,
        maxOutputBytes: 10_000,
        maxDurationMs: 30_000,
        lookup,
      });
      expect(result?.ok, 'a download through the injected-lookup fixture host must succeed').toBe(true);
      expect(existsSync(path.join(projectDir, outputRel))).toBe(true);

      const overResult = await (jobs as any).runMediaDownloadJob({
        projectDir,
        url: `http://w7c-fixture.test:${fixturePort}/oversized`,
        outputRel: 'oversized.bin',
        maxOutputBytes: 4,
        maxDurationMs: 30_000,
        lookup,
      });
      expect(overResult?.ok).toBe(false);
      expect(overResult?.error?.code).toBe('LIMIT_EXCEEDED');
      expect(existsSync(path.join(projectDir, 'oversized.bin'))).toBe(false);

      // Same byte ceiling, but the response has no Content-Length at all
      // (chunked transfer-encoding) — this can only be caught by the
      // STREAMED check in streamResponseToFile, not the pre-read
      // declared-length branch the case above exercises.
      const streamedOverResult = await (jobs as any).runMediaDownloadJob({
        projectDir,
        url: `http://w7c-fixture.test:${fixturePort}/oversized-streamed`,
        outputRel: 'oversized-streamed.bin',
        maxOutputBytes: 4,
        maxDurationMs: 30_000,
        lookup,
      });
      expect(
        streamedOverResult?.ok,
        'a body over the byte ceiling with no declared Content-Length must be rejected by the streamed check',
      ).toBe(false);
      expect(streamedOverResult?.error?.code).toBe('LIMIT_EXCEEDED');
      expect(existsSync(path.join(projectDir, 'oversized-streamed.bin'))).toBe(false);

      const redirectResult = await (jobs as any).runMediaDownloadJob({
        projectDir,
        url: `http://w7c-fixture.test:${fixturePort}/redirect-1`,
        outputRel: 'redirected.bin',
        maxOutputBytes: 10_000,
        maxDurationMs: 30_000,
        lookup,
      });
      expect(redirectResult?.ok, 'a 4th redirect hop must be rejected (max 3 allowed)').toBe(false);

      const realLookup = (await import('node:dns')).lookup;
      const privateResult = await (jobs as any).runMediaDownloadJob({
        projectDir,
        url: 'http://127.0.0.1:1/unreachable',
        outputRel: 'private.bin',
        maxOutputBytes: 10_000,
        maxDurationMs: 30_000,
        lookup: realLookup,
      });
      expect(privateResult?.ok, 'a loopback target must be rejected before any connection is attempted').toBe(false);
      expect(existsSync(path.join(projectDir, 'private.bin'))).toBe(false);
    } finally {
      httpGetSpy.mockRestore();
      await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    }
  });

  it('(c2) a hostname that resolves to a loopback address is rejected before any connection is attempted (SSRF)', async () => {
    const jobs = await importJobsModuleOrFail();
    if (!jobs) {
      expect.fail('apps/daemon/src/media/jobs.ts must exist before this test can run (work item 2, INV-7.6).');
      return;
    }

    const envDataDir = process.env.OD_DATA_DIR;
    if (!envDataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const db = openDatabase(process.cwd(), { dataDir: envDataDir });
    const projectId = `project_${randomUUID()}`;
    const now = Date.now();
    insertProject(db, { id: projectId, name: 'download project loopback', createdAt: now, updatedAt: now });
    const projectDir = path.join(envDataDir, 'projects', projectId);
    mkdirSync(projectDir, { recursive: true });

    // The module's own docblock (jobs.ts:14-22) states the exact threat
    // this guards against: an attacker-controlled DNS name that merely
    // RESOLVES to the daemon's own loopback interface must be rejected the
    // same way a literal `127.0.0.1` URL is (test "(c)" above), not
    // allowed through because the hostname string itself isn't an IP
    // literal. `lookup` is this module's documented test-only DI seam
    // (mirroring connectionTest.ts's DnsLookupFn) — no HTTP field reaches
    // it in production, where the real `dns.lookup` is used.
    const lookupToLoopback = (
      _hostname: string,
      _options: unknown,
      callback: (err: Error | null, address: string, family: number) => void,
    ) => callback(null, '127.0.0.1', 4);

    const result = await (jobs as any).runMediaDownloadJob({
      projectDir,
      url: 'http://attacker-controlled.w7c-fixture.test:1/unreachable',
      outputRel: 'loopback-via-dns.bin',
      maxOutputBytes: 10_000,
      maxDurationMs: 30_000,
      lookup: lookupToLoopback,
    });
    expect(
      result?.ok,
      'a hostname that DNS-resolves to a loopback address must be rejected before any connection is attempted',
    ).toBe(false);
    expect(existsSync(path.join(projectDir, 'loopback-via-dns.bin'))).toBe(false);
  });

  it('(c3) canceling before response headers arrive aborts immediately instead of waiting for a response', async () => {
    const jobs = await importJobsModuleOrFail();
    if (!jobs) {
      expect.fail('apps/daemon/src/media/jobs.ts must exist before this test can run (work item 2, INV-7.6).');
      return;
    }

    const envDataDir = process.env.OD_DATA_DIR;
    if (!envDataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const db = openDatabase(process.cwd(), { dataDir: envDataDir });
    const projectId = `project_${randomUUID()}`;
    const now = Date.now();
    insertProject(db, { id: projectId, name: 'download-cancel project', createdAt: now, updatedAt: now });
    const projectDir = path.join(envDataDir, 'projects', projectId);
    mkdirSync(projectDir, { recursive: true });

    // Never responds — the request sits waiting for headers for the whole
    // test. If cancel only took effect once a response arrived (the r1
    // gap), this download would hang until maxDurationMs instead of
    // settling as soon as `abortFn` runs.
    let gotRequest = false;
    const stallServer = createHttpServer((req) => {
      gotRequest = true;
      void req;
    });
    await new Promise<void>((resolve) => stallServer.listen(0, '127.0.0.1', resolve));
    const addr = stallServer.address();
    if (!addr || typeof addr === 'string') throw new Error('fixture server has no address');
    const stallPort = addr.port;

    const ALLOWED_RESOLVED_ADDRESS = '93.184.216.34';
    const lookup = (
      _hostname: string,
      _options: unknown,
      callback: (err: Error | null, address: string, family: number) => void,
    ) => callback(null, ALLOWED_RESOLVED_ADDRESS, 4);
    const realHttpGet = httpNode.get.bind(httpNode);
    const httpGetSpy = vi
      .spyOn(httpNode, 'get')
      .mockImplementation(((options: Record<string, unknown>, callback: unknown) =>
        realHttpGet({ ...options, hostname: '127.0.0.1' } as never, callback as never)) as typeof httpNode.get);

    try {
      let abortFn: (() => void) | undefined;
      const started = Date.now();
      const resultPromise = (jobs as any).runMediaDownloadJob({
        projectDir,
        url: `http://w7c-stall.test:${stallPort}/slow`,
        outputRel: 'never.bin',
        maxOutputBytes: 1024,
        maxDurationMs: 10_000,
        lookup,
        onAbort: (abort: () => void) => {
          abortFn = abort;
        },
      });
      // onAbort now registers synchronously when the request is created
      // (before any response), so this only needs to wait for THAT
      // registration — the server never answers.
      for (let i = 0; i < 100 && !abortFn; i += 1) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(typeof abortFn, 'onAbort must fire before headers arrive, not only after').toBe('function');
      abortFn!();
      const result = (await resultPromise) as { ok: boolean; error?: { code?: string } };
      const elapsedMs = Date.now() - started;
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('CANCELED');
      expect(elapsedMs, 'cancel must not wait for the 10s duration limit').toBeLessThan(5_000);
      expect(gotRequest).toBe(true);
    } finally {
      httpGetSpy.mockRestore();
      await new Promise<void>((resolve) => stallServer.close(() => resolve()));
    }
  });
});
