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
// resolves to this test's local fixture server without being rejected by
// the private/loopback/link-local check that applies to every
// user-supplied download URL. That seam is a parameter of the job runner
// module, not reachable through any HTTP field, so those sub-tests import
// the module directly rather than going through the route. Until
// media/jobs.ts exists, they fail on a clear, readable assertion
// (`expect.fail(...)`) instead of crashing the whole suite on import —
// the red spec's first failure stays behavioural, per builder-protocol.md.

import type http from 'node:http';
import { createServer as createHttpServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, insertProject, openDatabase } from '../../src/db.js';
import { insertMediaTask } from '../../src/media/tasks.js';
import { startServer } from '../../src/server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(HERE, '../fixtures/w7-media');
const FAKE_FFMPEG = path.join(FIXTURE_DIR, 'fake-ffmpeg.mjs');
const FAKE_FFMPEG_SHA256 = readFileSync(path.join(FIXTURE_DIR, 'fake-ffmpeg-output.sha256'), 'utf8').trim();

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
      expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
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

    const cancelResp = await fetch(`${baseUrl}/api/media/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: 'POST',
    });
    expect(cancelResp.status, 'POST /api/media/tasks/:id/cancel must exist (work item 2)').not.toBe(404);

    const waitResp = await fetch(`${baseUrl}/api/media/tasks/${encodeURIComponent(taskId)}/wait`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ since: 0, timeoutMs: 2000 }),
    });
    const snap = (await waitResp.json()) as { status?: string; error?: { code?: string } };
    expect(snap.status).toBe('failed');
    expect(snap.error?.code).toBe('CANCELED');

    const killReceipt = path.join(projectDir, 'out-cancel.mp4.killed');
    expect(existsSync(killReceipt), 'cancel must SIGTERM the child, not just mark the row failed').toBe(true);
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
    // already saturated — same shape asserted in cli-media-jobs.test.ts.
    expect(third.status).toBe(429);
    const body = (await third.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('LIMIT_EXCEEDED');
    expect(body.error?.message ?? '').toMatch(/maxConcurrent/);
  });

  it('(g) GET /api/media/jobs/limits, `od media --help`, and docs/subprocess-limits.md name the same limits', async () => {
    const { baseUrl } = await boot();

    const limitsResp = await fetch(`${baseUrl}/api/media/jobs/limits`);
    expect(limitsResp.status, 'GET /api/media/jobs/limits must exist (INV-7.14)').not.toBe(404);
    const limits = (await limitsResp.json()) as Record<string, unknown>;

    const docsPath = path.join(HERE, '../../../../docs/subprocess-limits.md');
    const docsText = readFileSync(docsPath, 'utf8');
    for (const envVar of LIMIT_ENV_VARS) {
      expect(docsText, `docs/subprocess-limits.md must name ${envVar}`).toMatch(envVar);
    }
    expect(limits).toHaveProperty('maxDurationMs');
    expect(limits).toHaveProperty('maxOutputBytes');
    expect(limits).toHaveProperty('maxConcurrent');
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

    // A stub `lookup` that resolves the test hostname to this fixture
    // server. The private/loopback/link-local check runs against THIS
    // result (same seam, same DnsLookupFn shape as connectionTest.ts), not
    // against a real DNS answer for a hostname that doesn't exist.
    const lookup = (
      _hostname: string,
      _options: unknown,
      callback: (err: Error | null, address: string, family: number) => void,
    ) => callback(null, '127.0.0.1', 4);

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
      await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    }
  });
});
