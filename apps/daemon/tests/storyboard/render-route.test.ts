// Real-server route tests for POST /api/storyboards/:id/shots/:shotId/render's
// concurrency behavior. routes.test.ts already covers this route's
// validation/containment/dispatch paths; this file is scoped to the
// read-modify-write race the route runs across `ensureStoryboardMediaProject`
// and the re-read-inside-the-lock dispatch, and the optional
// `expectedUpdatedAt` concurrency token.
//
// The race window this route closes (BUG1, and the dispatch-value bug this
// file also covers) is only a few real fs syscalls wide, which is too narrow
// to hit reliably by racing two real HTTP requests against wall-clock delays
// (tried first; the interleaving landed in a different, already-acknowledged
// residual window instead of the one this fix targets — see the draft-shots
// re-read's own doc comment on that residual window). So, same idiom as
// draft-route.test.ts's `providerGate`, this file gates the route's own
// `ensureStoryboardMediaProject()` call with a manually-released promise —
// specifically the `mkdir` it awaits — to park a request mid-flight, right
// after its entry-time read/validation and before it ever touches the
// per-storyboard lock. That is the ONLY awaited I/O the route still performs
// ahead of the lock: the startFrame/endFrame containment checks now run
// INSIDE the lock, against the freshly re-read shot, so gating them (as an
// earlier version of this file did, via `realpath`) would park the route
// while it already holds the per-storyboard mutex — deadlocking against any
// concurrent PATCH to the same storyboard, which needs that same lock to
// make any progress at all. Every other `mkdir` call in the process (e.g.
// writeStoryboard's own storyboards-dir mkdir) passes straight through to
// the real implementation; only a call whose target is the storyboard-media
// project directory, while a test has armed `gate`, is held.
//
// Media dispatch is never live here: every shot uses a model id that fails
// generateMedia's catalog lookup synchronously (an "unknown model" throw
// before any network call) — the same idiom routes.test.ts's own render-shot
// tests already use.

import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startServer } from '../../src/server.js';

const mkdirMock = vi.fn();

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: (...args: Parameters<typeof actual.mkdir>) => mkdirMock(...args),
  };
});

/** Smallest valid PNG (1x1, transparent) — written directly into the
 * storyboard-media project dir below (not via POST /uploads — see the
 * `mediaProjectDir` doc comment for why). */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const dataDir = process.env.OD_DATA_DIR;
if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
// The hidden storyboard-media project dir every render-shot call resolves
// frame paths against — same path every route/test in this suite computes
// (see routes.test.ts's identical `path.join(dataDir, 'projects',
// 'storyboard-media')`). `ensureStoryboardMediaProject()`'s own `mkdir(dir,
// {recursive:true})` call always targets this exact path, regardless of
// whether the directory already exists on disk (from an earlier test in
// this shared-OD_DATA_DIR vitest worker) — recursive mkdir on an existing
// dir is a fast no-op, but it is still a real awaited fs call, which is what
// makes it gate-able here.
const mediaProjectDir = path.join(dataDir, 'projects', 'storyboard-media');

interface JsonResponse {
  status: number;
  json: any;
}

describe('POST /api/storyboards/:id/shots/:shotId/render — concurrency', () => {
  let server: http.Server | null = null;
  let base: string;

  /**
   * When armed (non-null), the FIRST `mkdir` call targeting
   * `mediaProjectDir` waits on this promise before resolving for real.
   * `hits` counts such calls, so a test can wait for the route to have
   * actually reached (and parked inside) its `ensureStoryboardMediaProject()`
   * await before proceeding. Always passes through to the real `mkdir` —
   * never fakes a result — so the route's own logic still runs against the
   * real filesystem once released.
   */
  let gate: Promise<void> | null = null;
  let hits = 0;

  mkdirMock.mockImplementation(async (...args: unknown[]) => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const [dir] = args as [string, unknown?];
    if (gate && dir === mediaProjectDir) {
      hits += 1;
      await gate;
    }
    return (actual.mkdir as (...a: unknown[]) => Promise<string | undefined>)(...args);
  });

  afterEach(async () => {
    gate = null;
    hits = 0;
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
  });

  async function boot() {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;
    base = started.url;
  }

  async function api(method: string, path: string, body?: unknown): Promise<JsonResponse> {
    const resp = await fetch(`${base}${path}`, {
      method,
      ...(body !== undefined
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
    const text = await resp.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    return { status: resp.status, json };
  }

  /**
   * A storyboard with one draft shot that owns a real start frame. The frame
   * is written directly into `mediaProjectDir` (bypassing POST
   * /api/storyboards/:id/uploads) so this suite's render calls remain the
   * FIRST thing to touch the hidden storyboard-media project for a given
   * `boot()`'d server — an /uploads call would warm (and permanently
   * memoize) `ensureStoryboardMediaProject()`'s promise, closing the only
   * pre-lock await left for `gate` to park on.
   */
  async function createStoryboardWithShot(model = 'this-model-does-not-exist') {
    const created = await api('POST', '/api/storyboards', { title: 'render concurrency probe' });
    expect(created.status).toBe(201);
    const id = created.json.storyboard.id as string;

    await mkdir(mediaProjectDir, { recursive: true });
    const framePath = `frame-${randomUUID()}.png`;
    await writeFile(path.join(mediaProjectDir, framePath), Buffer.from(PNG_1X1, 'base64'));

    const shotId = 'shot-render-probe';
    const shot = {
      id: shotId,
      order: 0,
      title: 'Probe shot',
      motionPrompt: 'camera pushes in slowly',
      model,
      resolution: '720p',
      durationSec: 5,
      status: 'draft',
      startFrame: { path: framePath, origin: 'uploaded' },
    };
    const patched = await api('PATCH', `/api/storyboards/${id}`, { shots: [shot] });
    expect(patched.status).toBe(200);
    return { id, shotId, shot, updatedAt: patched.json.storyboard.updatedAt as string };
  }

  it('does not discard a concurrent write that lands while render-shot is in flight', async () => {
    await boot();
    const { id, shotId, shot, updatedAt } = await createStoryboardWithShot();

    let release: () => void = () => {};
    gate = new Promise((resolve) => {
      release = resolve;
    });

    // A: render-shot. It has already read the (now stale) storyboard and
    // validated it, and is blocked inside ensureStoryboardMediaProject's own
    // mkdir, having not yet touched the per-storyboard lock.
    const renderPromise = api('POST', `/api/storyboards/${id}/shots/${shotId}/render`);
    while (hits === 0) await new Promise((r) => setImmediate(r));

    // B: a normal, well-behaved PATCH with a correct expectedUpdatedAt —
    // renames the storyboard and adds a second shot. Runs to completion
    // while A is still parked on the gate above — PATCH never touches the
    // storyboard-media project, so it is never blocked by A's gate.
    const patchResp = await api('PATCH', `/api/storyboards/${id}`, {
      expectedUpdatedAt: updatedAt,
      title: 'RENAMED BY CONCURRENT CLIENT',
      shots: [
        shot,
        {
          id: 'shot-added-concurrently',
          order: 1,
          title: 'Added by concurrent client',
          motionPrompt: 'slow orbit around the subject',
          model: 'this-model-does-not-exist',
          resolution: '720p',
          durationSec: 6,
          status: 'draft',
        },
      ],
    });
    expect(patchResp.status).toBe(200);

    // Release A now that B's write has actually landed on disk.
    release();
    gate = null;

    const renderResp = await renderPromise;
    expect(renderResp.status).toBe(202);
    expect(renderResp.json.taskId).toBeTruthy();

    const final = await api('GET', `/api/storyboards/${id}`);
    // Both writes must survive: B's rename and added shot are not silently
    // erased by A writing back the snapshot it read before B committed.
    expect(final.json.storyboard.title).toBe('RENAMED BY CONCURRENT CLIENT');
    expect(final.json.storyboard.shots).toHaveLength(2);
    expect(final.json.storyboard.shots.some((s: any) => s.id === 'shot-added-concurrently')).toBe(true);
    // A's own mutation must also survive, applied onto the up-to-date doc.
    const probeShot = final.json.storyboard.shots.find((s: any) => s.id === shotId);
    expect(probeShot.status).toBe('rendering');
    expect(probeShot.taskId).toBe(renderResp.json.taskId);
  });

  it('dispatches the media task using the CONCURRENTLY-updated shot, not the entry-time snapshot', async () => {
    await boot();
    const { id, shotId, updatedAt } = await createStoryboardWithShot('stale-entry-time-model');
    // Overwrite the shot below via a concurrent PATCH before A ever re-reads
    // the storyboard, keeping startFrame.path unchanged (still real) so the
    // only thing distinguishing entry-time vs. re-read values is model and
    // durationSec — isolates the assertion to the fields BUG1's follow-up
    // fix is about.
    const created = await api('GET', `/api/storyboards/${id}`);
    const framePath = created.json.storyboard.shots[0].startFrame.path as string;

    let release: () => void = () => {};
    gate = new Promise((resolve) => {
      release = resolve;
    });

    // A: render-shot. Read its entry-time snapshot (model
    // 'stale-entry-time-model', durationSec 5) above and is now parked
    // inside ensureStoryboardMediaProject's own mkdir, before it has
    // re-read the storyboard or reached the per-storyboard lock.
    const renderPromise = api('POST', `/api/storyboards/${id}/shots/${shotId}/render`);
    while (hits === 0) await new Promise((r) => setImmediate(r));

    // B: a concurrent PATCH that edits the SAME shot's model and duration.
    // Runs to completion while A is still parked (PATCH never touches the
    // storyboard-media project, so it is never blocked by A's gate).
    const patchResp = await api('PATCH', `/api/storyboards/${id}`, {
      expectedUpdatedAt: updatedAt,
      shots: [
        {
          id: shotId,
          order: 0,
          title: 'Probe shot',
          motionPrompt: 'fresh concurrent motion prompt',
          model: 'fresh-concurrent-model',
          resolution: '720p',
          durationSec: 10,
          status: 'draft',
          startFrame: { path: framePath, origin: 'uploaded' },
        },
      ],
    });
    expect(patchResp.status).toBe(200);

    release();
    gate = null;

    const renderResp = await renderPromise;
    expect(renderResp.status).toBe(202);
    const taskId = renderResp.json.taskId as string;
    expect(taskId).toBeTruthy();

    // Both models fail generateMedia's catalog lookup synchronously (same
    // idiom the rest of this file and routes.test.ts use), so the task's own
    // failure message — "unknown model: <model>" — tells us which model
    // string dispatch actually handed to generateMedia. This is
    // independent of what ended up persisted on the shot itself: B's PATCH
    // already wrote 'fresh-concurrent-model' there regardless of whether the
    // route's dispatch call used it.
    const waited = await api('POST', `/api/media/tasks/${taskId}/wait`, {});
    expect(waited.status).toBe(200);
    expect(waited.json.status).toBe('failed');
    expect(waited.json.error.message).toContain('fresh-concurrent-model');
    expect(waited.json.error.message).not.toContain('stale-entry-time-model');

    // B also rewrote the motion prompt above. The dispatched prompt is not
    // separately observable here — the unknown-model lookup fails before the
    // prompt is ever used, so nothing echoes it back. What the model assertion
    // does establish is that dispatch read the RE-READ shot, and the prompt,
    // model, duration and frames are all derived from that same object inside
    // the lock. Stating the limit rather than implying the prompt is directly
    // proven: if these ever stop sharing one source object, this test would no
    // longer cover the prompt.
    const finalDoc = await api('GET', `/api/storyboards/${id}`);
    const persisted = finalDoc.json.storyboard.shots.find((s: any) => s.id === shotId);
    expect(persisted.motionPrompt).toBe('fresh concurrent motion prompt');
  });

  it('409s when expectedUpdatedAt is stale, without dispatching a media task', async () => {
    await boot();
    const { id, shotId } = await createStoryboardWithShot();

    const renderResp = await api('POST', `/api/storyboards/${id}/shots/${shotId}/render`, {
      expectedUpdatedAt: '1999-01-01T00:00:00.000Z',
    });
    expect(renderResp.status).toBe(409);
    expect(renderResp.json.error).toBe('storyboard changed');

    const after = await api('GET', `/api/storyboards/${id}`);
    const probeShot = after.json.storyboard.shots.find((s: any) => s.id === shotId);
    expect(probeShot.status).toBe('draft');
    expect(probeShot.taskId).toBeUndefined();
  });

  it('omitting expectedUpdatedAt still renders successfully (existing-caller behavior preserved)', async () => {
    await boot();
    const { id, shotId } = await createStoryboardWithShot();

    const renderResp = await api('POST', `/api/storyboards/${id}/shots/${shotId}/render`);
    expect(renderResp.status).toBe(202);
    expect(renderResp.json.taskId).toBeTruthy();

    const after = await api('GET', `/api/storyboards/${id}`);
    const probeShot = after.json.storyboard.shots.find((s: any) => s.id === shotId);
    expect(probeShot.status).toBe('rendering');
    expect(probeShot.taskId).toBe(renderResp.json.taskId);
  });
});
