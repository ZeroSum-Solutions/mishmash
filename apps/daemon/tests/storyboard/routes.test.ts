// Real-server route tests for the Storyboard capability (see
// packages/contracts/src/api/storyboard.ts and
// apps/daemon/src/routes/storyboard.ts). Mirrors the boot pattern in
// apps/daemon/tests/media/tasks-routes.test.ts (startServer with
// port:0/returnServer:true against the shared OD_DATA_DIR test fixture).
//
// Media dispatch is never live here: render-shot tests use a model id that
// fails generateMedia's catalog lookup synchronously (an "unknown model"
// throw before any network call), the same class of pre-network failure
// tasks-routes.test.ts's own "proxy setup throws" test already validates.

import type http from 'node:http';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { STORYBOARD_UPLOAD_MAX_BYTES } from '@open-design/contracts';
import { startServer } from '../../src/server.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2uoAAAAASUVORK5CYII=';

// Windows non-admin runners can't create symlinks; probe once and skip the
// symlink-escape cases there instead of failing — same idiom as
// tests/design-library/routes.test.ts's canSymlink.
const canSymlink = (() => {
  try {
    const probeDir = mkdtempSync(path.join(tmpdir(), 'od-storyboard-symlink-probe-'));
    writeFileSync(path.join(probeDir, 'a'), '');
    symlinkSync(path.join(probeDir, 'a'), path.join(probeDir, 'b'));
    rmSync(probeDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
})();

describe('storyboard routes', () => {
  let server: http.Server | null = null;
  let base: string;

  afterEach(async () => {
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

  async function createStoryboard(title = 'Test storyboard') {
    const resp = await fetch(`${base}/api/storyboards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    expect(resp.status).toBe(201);
    const data = (await resp.json()) as { storyboard: any };
    return data.storyboard;
  }

  it('CRUD roundtrip: create -> get -> patch -> list -> delete', async () => {
    await boot();
    const created = await createStoryboard('My first storyboard');
    expect(created.id).toBeTruthy();
    expect(created.title).toBe('My first storyboard');
    expect(created.shots).toEqual([]);
    expect(created.moodDrafts).toEqual([]);
    expect(created.ratio).toBe('16:9');

    const getResp = await fetch(`${base}/api/storyboards/${created.id}`);
    expect(getResp.status).toBe(200);
    expect(((await getResp.json()) as any).storyboard.id).toBe(created.id);

    const patchResp = await fetch(`${base}/api/storyboards/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Renamed storyboard',
        shots: [
          {
            id: 'shot-1',
            order: 0,
            motionPrompt: 'the camera pans slowly to the right',
            model: 'openrouter/bytedance/seedance-2.0:1080p',
            resolution: '1080p',
            durationSec: 5,
            status: 'draft',
          },
        ],
      }),
    });
    expect(patchResp.status).toBe(200);
    const patched = ((await patchResp.json()) as any).storyboard;
    expect(patched.title).toBe('Renamed storyboard');
    expect(patched.shots).toHaveLength(1);
    expect(patched.shots[0].id).toBe('shot-1');
    expect(patched.updatedAt >= created.updatedAt).toBe(true);

    const listResp = await fetch(`${base}/api/storyboards`);
    expect(listResp.status).toBe(200);
    const list = ((await listResp.json()) as any).storyboards;
    expect(list.some((sb: any) => sb.id === created.id && sb.shotCount === 1)).toBe(true);

    const deleteResp = await fetch(`${base}/api/storyboards/${created.id}`, { method: 'DELETE' });
    expect(deleteResp.status).toBe(204);

    const afterDelete = await fetch(`${base}/api/storyboards/${created.id}`);
    expect(afterDelete.status).toBe(404);
  });

  it('PATCH rejects a stale expectedUpdatedAt with 409 and the current doc', async () => {
    await boot();
    const created = await createStoryboard();

    const staleResp = await fetch(`${base}/api/storyboards/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Stale write', expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }),
    });
    expect(staleResp.status).toBe(409);
    const body = (await staleResp.json()) as { error?: string; storyboard?: any };
    expect(body.error).toBe('storyboard changed');
    expect(body.storyboard?.id).toBe(created.id);
    expect(body.storyboard?.title).toBe(created.title);

    // The rejected patch must not have taken effect.
    const getResp = await fetch(`${base}/api/storyboards/${created.id}`);
    const current = ((await getResp.json()) as any).storyboard;
    expect(current.title).toBe(created.title);
  });

  it('PATCH accepts a matching expectedUpdatedAt with 200', async () => {
    await boot();
    const created = await createStoryboard();

    const resp = await fetch(`${base}/api/storyboards/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Fresh write', expectedUpdatedAt: created.updatedAt }),
    });
    expect(resp.status).toBe(200);
    const patched = ((await resp.json()) as any).storyboard;
    expect(patched.title).toBe('Fresh write');
  });

  it('PATCH rejects an invalid storyboard id', async () => {
    await boot();
    const resp = await fetch(`${base}/api/storyboards/${encodeURIComponent('../etc')}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    });
    expect(resp.status).toBe(400);
  });

  it('PATCH rejects a shot with an endFrame but no startFrame', async () => {
    await boot();
    const created = await createStoryboard();
    const resp = await fetch(`${base}/api/storyboards/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shots: [
          {
            id: 'shot-1',
            order: 0,
            endFrame: { path: 'end.png', origin: 'derived' },
            motionPrompt: 'motion',
            model: 'openrouter/bytedance/seedance-2.0:1080p',
            resolution: '1080p',
            durationSec: 5,
            status: 'draft',
          },
        ],
      }),
    });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toMatch(/endFrame requires .*startFrame/);
  });

  it('PATCH rejects a shots array containing duplicate shot ids with 400 (review finding: 409-retry re-append)', async () => {
    await boot();
    const created = await createStoryboard();
    const shotTemplate = {
      id: 'shot-dup',
      order: 0,
      motionPrompt: 'the camera pans slowly to the right',
      model: 'openrouter/bytedance/seedance-2.0:1080p',
      resolution: '1080p',
      durationSec: 5,
      status: 'draft',
    };
    const resp = await fetch(`${base}/api/storyboards/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shots: [shotTemplate, { ...shotTemplate, order: 1 }] }),
    });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toMatch(/duplicate shot id/);

    // The rejected patch must not have taken effect.
    const getResp = await fetch(`${base}/api/storyboards/${created.id}`);
    const currentDoc = ((await getResp.json()) as any).storyboard;
    expect(currentDoc.shots).toEqual([]);
  });

  it('PATCH rejects a shot.output path that escapes the storyboard project dir', async () => {
    await boot();
    const created = await createStoryboard();
    const resp = await fetch(`${base}/api/storyboards/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shots: [
          {
            id: 'shot-1',
            order: 0,
            startFrame: { path: 'start.png', origin: 'uploaded' },
            motionPrompt: 'motion',
            model: 'openrouter/bytedance/seedance-2.0:1080p',
            resolution: '1080p',
            durationSec: 5,
            output: '../../../etc/passwd',
            status: 'done',
          },
        ],
      }),
    });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toMatch(/output must be a safe relative path/);
  });

  it('PATCH rejects a frame path that escapes the storyboard project dir', async () => {
    await boot();
    const created = await createStoryboard();
    const resp = await fetch(`${base}/api/storyboards/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shots: [
          {
            id: 'shot-1',
            order: 0,
            startFrame: { path: '../../etc/hosts', origin: 'uploaded' },
            motionPrompt: 'motion',
            model: 'openrouter/bytedance/seedance-2.0:1080p',
            resolution: '1080p',
            durationSec: 5,
            status: 'draft',
          },
        ],
      }),
    });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toMatch(/startFrame\.path must be a safe relative path/);
  });

  it('render-shot 400s when the stored startFrame path escapes the storyboard project dir', async () => {
    await boot();
    const created = await createStoryboard();
    // Bypass PATCH's own validateShot (already rejects this going forward)
    // to pin the render route's OWN independent containment re-check —
    // simulates a shot written before that validation existed.
    const store = await import('../../src/storyboards/store.js');
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const stored = await store.readStoryboard(dataDir, created.id);
    if (!stored) throw new Error('storyboard not found on disk');
    stored.shots = [
      {
        id: 'shot-1',
        order: 0,
        startFrame: { path: '../../etc/hosts', origin: 'uploaded' },
        motionPrompt: 'motion',
        model: 'openrouter/bytedance/seedance-2.0:1080p',
        resolution: '1080p',
        durationSec: 5,
        status: 'draft',
      },
    ];
    await store.writeStoryboard(dataDir, stored);

    const renderResp = await fetch(`${base}/api/storyboards/${created.id}/shots/shot-1/render`, { method: 'POST' });
    expect(renderResp.status).toBe(400);
    const body = (await renderResp.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toMatch(/startFrame\.path escapes the storyboard project directory/);
  });

  it.runIf(canSymlink)('render-shot 400s when the stored startFrame path symlinks outside the storyboard project dir', async () => {
    await boot();
    const created = await createStoryboard();
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const projectDir = path.join(dataDir, 'projects', 'storyboard-media');
    await mkdir(projectDir, { recursive: true });
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'od-storyboard-outside-'));
    try {
      const secret = path.join(outsideDir, 'secret.png');
      writeFileSync(secret, Buffer.from(PNG_BASE64, 'base64'));
      // The symlink's own path sits inside the storyboard-media project dir,
      // so the lexical containment check alone would pass — only realpath
      // re-validation catches it.
      symlinkSync(secret, path.join(projectDir, 'evil-start.png'));

      const store = await import('../../src/storyboards/store.js');
      const stored = await store.readStoryboard(dataDir, created.id);
      if (!stored) throw new Error('storyboard not found on disk');
      stored.shots = [
        {
          id: 'shot-1',
          order: 0,
          startFrame: { path: 'evil-start.png', origin: 'uploaded' },
          motionPrompt: 'motion',
          model: 'openrouter/bytedance/seedance-2.0:1080p',
          resolution: '1080p',
          durationSec: 5,
          status: 'draft',
        },
      ];
      await store.writeStoryboard(dataDir, stored);

      const renderResp = await fetch(`${base}/api/storyboards/${created.id}/shots/shot-1/render`, { method: 'POST' });
      expect(renderResp.status).toBe(400);
      const body = (await renderResp.json()) as { error?: { message?: string } | string };
      const message = typeof body.error === 'string' ? body.error : body.error?.message;
      expect(message).toMatch(/startFrame\.path escapes the storyboard project directory/);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('assemble 400s when a stored shot.output path escapes the storyboard project dir', async () => {
    await boot();
    const created = await createStoryboard();
    const store = await import('../../src/storyboards/store.js');
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const stored = await store.readStoryboard(dataDir, created.id);
    if (!stored) throw new Error('storyboard not found on disk');
    stored.shots = [
      {
        id: 'shot-1',
        order: 0,
        motionPrompt: 'motion',
        model: 'openrouter/bytedance/seedance-2.0:1080p',
        resolution: '1080p',
        durationSec: 5,
        output: '../../../etc/passwd',
        status: 'done',
      },
    ];
    await store.writeStoryboard(dataDir, stored);

    const assembleResp = await fetch(`${base}/api/storyboards/${created.id}/assemble`, { method: 'POST' });
    expect(assembleResp.status).toBe(400);
    const body = (await assembleResp.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toMatch(/output escapes the storyboard project directory/);
  });

  it.runIf(canSymlink)('assemble 400s when a stored shot.output path symlinks outside the storyboard project dir', async () => {
    await boot();
    const created = await createStoryboard();
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const projectDir = path.join(dataDir, 'projects', 'storyboard-media');
    await mkdir(projectDir, { recursive: true });
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'od-storyboard-outside-'));
    try {
      const secret = path.join(outsideDir, 'secret.mp4');
      writeFileSync(secret, 'not really a video, just needs to exist');
      symlinkSync(secret, path.join(projectDir, 'evil-output.mp4'));

      const store = await import('../../src/storyboards/store.js');
      const stored = await store.readStoryboard(dataDir, created.id);
      if (!stored) throw new Error('storyboard not found on disk');
      stored.shots = [
        {
          id: 'shot-1',
          order: 0,
          motionPrompt: 'motion',
          model: 'openrouter/bytedance/seedance-2.0:1080p',
          resolution: '1080p',
          durationSec: 5,
          output: 'evil-output.mp4',
          status: 'done',
        },
      ];
      await store.writeStoryboard(dataDir, stored);

      const assembleResp = await fetch(`${base}/api/storyboards/${created.id}/assemble`, { method: 'POST' });
      expect(assembleResp.status).toBe(400);
      const body = (await assembleResp.json()) as { error?: { message?: string } | string };
      const message = typeof body.error === 'string' ? body.error : body.error?.message;
      expect(message).toMatch(/output escapes the storyboard project directory/);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  // The assemble output itself is now a per-run name (storyboard id + a
  // random run discriminator — see storyboards/assemble.ts's
  // assembleOutputName), so a test can no longer pre-plant a symlink at the
  // exact path a future run will write to. The concat list file
  // (`.storyboard-concat-<storyboard id>.txt`) stays deterministic per
  // storyboard and is checked through the exact same
  // assertSafeStoryboardWriteTarget guard, one step earlier in
  // runConcatAssemble — targeting it still proves the route refuses to
  // write through a pre-existing symlink.
  it.runIf(canSymlink)('assemble 400s when its concat list file already exists as a symlink (refuses to write through it)', async () => {
    await boot();
    const created = await createStoryboard();
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const projectDir = path.join(dataDir, 'projects', 'storyboard-media');
    await mkdir(projectDir, { recursive: true });
    // A real (if fake-content) done-shot output so the route gets past the
    // "no rendered shots" 400 and reaches the write-target guard — ffmpeg
    // never actually runs here because the guard 400s first.
    await writeFile(path.join(projectDir, 'shot-1.mp4'), Buffer.from(PNG_BASE64, 'base64'));
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'od-storyboard-outside-'));
    const listFile = path.join(projectDir, `.storyboard-concat-${created.id}.txt`);
    try {
      const secretTarget = path.join(outsideDir, 'clobber-me.txt');
      writeFileSync(secretTarget, 'pre-existing file outside the project');
      symlinkSync(secretTarget, listFile);

      await fetch(`${base}/api/storyboards/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shots: [
            {
              id: 'shot-1',
              order: 0,
              motionPrompt: 'motion',
              model: 'openrouter/bytedance/seedance-2.0:1080p',
              resolution: '1080p',
              durationSec: 5,
              output: 'shot-1.mp4',
              status: 'done',
            },
          ],
        }),
      });

      const resp = await fetch(`${base}/api/storyboards/${created.id}/assemble`, { method: 'POST' });
      expect(resp.status).toBe(400);
      const body = (await resp.json()) as { error?: { message?: string } | string };
      const message = typeof body.error === 'string' ? body.error : body.error?.message;
      expect(message).toMatch(/concat list target is unsafe/);
    } finally {
      // OD_DATA_DIR (and so the storyboard-media project dir) is shared by
      // every test in this vitest worker — clean up the fixed-name symlink
      // this test plants so later tests using the same storyboard id's
      // concat list name aren't blocked by it.
      rmSync(listFile, { force: true });
      rmSync(path.join(projectDir, 'shot-1.mp4'), { force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('render-shot 400s when the shot has no start frame', async () => {
    await boot();
    const created = await createStoryboard();
    await fetch(`${base}/api/storyboards/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shots: [
          {
            id: 'shot-1',
            order: 0,
            motionPrompt: 'motion',
            model: 'openrouter/bytedance/seedance-2.0:1080p',
            resolution: '1080p',
            durationSec: 5,
            status: 'draft',
          },
        ],
      }),
    });
    const renderResp = await fetch(`${base}/api/storyboards/${created.id}/shots/shot-1/render`, { method: 'POST' });
    expect(renderResp.status).toBe(400);
    const body = (await renderResp.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toMatch(/start frame/);
  });

  it('render-shot 400s when the motion prompt is empty', async () => {
    await boot();
    const created = await createStoryboard();
    await fetch(`${base}/api/storyboards/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shots: [
          {
            id: 'shot-1',
            order: 0,
            startFrame: { path: 'start.png', origin: 'uploaded' },
            motionPrompt: '   ',
            model: 'openrouter/bytedance/seedance-2.0:1080p',
            resolution: '1080p',
            durationSec: 5,
            status: 'draft',
          },
        ],
      }),
    });
    const renderResp = await fetch(`${base}/api/storyboards/${created.id}/shots/shot-1/render`, { method: 'POST' });
    expect(renderResp.status).toBe(400);
    const body = (await renderResp.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toMatch(/motion prompt/);
  });

  it('render-shot 404s for an unknown shot id', async () => {
    await boot();
    const created = await createStoryboard();
    const renderResp = await fetch(`${base}/api/storyboards/${created.id}/shots/does-not-exist/render`, { method: 'POST' });
    expect(renderResp.status).toBe(404);
  });

  it('render-shot dispatches into the media task machinery and surfaces failure with no live provider call', async () => {
    await boot();
    const created = await createStoryboard();
    // The route's read-side containment check (resolveWithinStoryboardMediaDirReal)
    // realpaths startFrame.path, which requires the file to actually exist —
    // write it for real so this test exercises the "unknown model" failure
    // path, not the (also valid, but different) "file doesn't exist" 400.
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const projectDir = path.join(dataDir, 'projects', 'storyboard-media');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'start.png'), Buffer.from(PNG_BASE64, 'base64'));
    await fetch(`${base}/api/storyboards/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shots: [
          {
            id: 'shot-1',
            order: 0,
            startFrame: { path: 'start.png', origin: 'uploaded' },
            motionPrompt: 'the components separate smoothly and float apart',
            model: 'this-model-does-not-exist',
            resolution: '1080p',
            durationSec: 5,
            status: 'draft',
          },
        ],
      }),
    });
    const renderResp = await fetch(`${base}/api/storyboards/${created.id}/shots/shot-1/render`, { method: 'POST' });
    expect(renderResp.status).toBe(202);
    const { taskId } = (await renderResp.json()) as { taskId: string };
    expect(taskId).toBeTruthy();

    const waitResp = await fetch(`${base}/api/media/tasks/${taskId}/wait`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ since: 0, timeoutMs: 5000 }),
    });
    const snap = (await waitResp.json()) as { status?: string; error?: { message?: string } };
    expect(snap.status).toBe('failed');
    expect(snap.error?.message).toMatch(/unknown model/);

    const getResp = await fetch(`${base}/api/storyboards/${created.id}`);
    const shot = ((await getResp.json()) as any).storyboard.shots[0];
    // The route only sets 'rendering' synchronously at dispatch time; it
    // never writes back on completion by design (see routes/storyboard.ts
    // doc comment) — the caller (web UI / `od storyboard render-shot`)
    // PATCHes the final status after polling /wait itself.
    expect(shot.status).toBe('rendering');
    expect(shot.taskId).toBe(taskId);
  });

  it('POST /frames dispatches a still-generation task and returns a predicted framePath', async () => {
    await boot();
    const created = await createStoryboard();
    const resp = await fetch(`${base}/api/storyboards/${created.id}/frames`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'a warm product hero shot', model: 'this-model-does-not-exist' }),
    });
    expect(resp.status).toBe(202);
    const { taskId, framePath } = (await resp.json()) as { taskId: string; framePath: string };
    expect(taskId).toBeTruthy();
    expect(framePath).toMatch(/^frame-.+\.png$/);

    const waitResp = await fetch(`${base}/api/media/tasks/${taskId}/wait`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ since: 0, timeoutMs: 5000 }),
    });
    const snap = (await waitResp.json()) as { status?: string; error?: { message?: string } };
    expect(snap.status).toBe('failed');
    expect(snap.error?.message).toMatch(/unknown model/);
  });

  it('POST /frames 400s without a prompt or model', async () => {
    await boot();
    const created = await createStoryboard();
    const noPrompt = await fetch(`${base}/api/storyboards/${created.id}/frames`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-2' }),
    });
    expect(noPrompt.status).toBe(400);
    const noModel = await fetch(`${base}/api/storyboards/${created.id}/frames`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x' }),
    });
    expect(noModel.status).toBe(400);
  });

  it.runIf(canSymlink)('POST /frames 400s when sourceImage symlinks outside the storyboard project dir', async () => {
    await boot();
    const created = await createStoryboard();
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const projectDir = path.join(dataDir, 'projects', 'storyboard-media');
    await mkdir(projectDir, { recursive: true });
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'od-storyboard-outside-'));
    try {
      const secret = path.join(outsideDir, 'secret.png');
      writeFileSync(secret, Buffer.from(PNG_BASE64, 'base64'));
      // The symlink's own path sits inside the storyboard-media project dir,
      // so the lexical containment check alone would pass — only realpath
      // re-validation catches it.
      symlinkSync(secret, path.join(projectDir, 'evil.png'));

      const resp = await fetch(`${base}/api/storyboards/${created.id}/frames`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'x', model: 'this-model-does-not-exist', sourceImage: 'evil.png' }),
      });
      expect(resp.status).toBe(400);
      const body = (await resp.json()) as { error?: { message?: string } | string };
      const message = typeof body.error === 'string' ? body.error : body.error?.message;
      expect(message).toMatch(/sourceImage escapes the storyboard project directory/);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('POST /uploads writes the decoded image into the media project and the path round-trips through GET raw', async () => {
    await boot();
    const created = await createStoryboard();
    const resp = await fetch(`${base}/api/storyboards/${created.id}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl: `data:image/png;base64,${PNG_BASE64}` }),
    });
    expect(resp.status).toBe(201);
    const { path: relPath } = (await resp.json()) as { path: string };
    expect(relPath).toMatch(/^upload-.+\.png$/);

    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const onDisk = await readFile(path.join(dataDir, 'projects', 'storyboard-media', relPath));
    expect(onDisk.equals(Buffer.from(PNG_BASE64, 'base64'))).toBe(true);

    const rawResp = await fetch(`${base}/api/projects/storyboard-media/raw/${relPath}`);
    expect(rawResp.status).toBe(200);
    const rawBytes = Buffer.from(await rawResp.arrayBuffer());
    expect(rawBytes.equals(Buffer.from(PNG_BASE64, 'base64'))).toBe(true);
  });

  it('POST /uploads 404s for an unknown storyboard', async () => {
    await boot();
    const resp = await fetch(`${base}/api/storyboards/does-not-exist/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl: `data:image/png;base64,${PNG_BASE64}` }),
    });
    expect(resp.status).toBe(404);
  });

  it('POST /uploads 400s for a dataUrl whose MIME type is not in the png|jpeg|webp allowlist', async () => {
    await boot();
    const created = await createStoryboard();
    const resp = await fetch(`${base}/api/storyboards/${created.id}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }),
    });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toMatch(/data:image\/\(png\|jpeg\|webp\);base64,<payload>/);
  });

  it('POST /uploads 400s for malformed base64', async () => {
    await boot();
    const created = await createStoryboard();
    const resp = await fetch(`${base}/api/storyboards/${created.id}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl: 'data:image/png;base64,!!!not-valid-base64!!!' }),
    });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toMatch(/malformed base64/);
  });

  it('POST /uploads 413s when the decoded image exceeds the upload limit', async () => {
    await boot();
    const created = await createStoryboard();
    const oversize = Buffer.alloc(STORYBOARD_UPLOAD_MAX_BYTES + 1024);
    const resp = await fetch(`${base}/api/storyboards/${created.id}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl: `data:image/png;base64,${oversize.toString('base64')}` }),
    });
    expect(resp.status).toBe(413);
    const body = (await resp.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toMatch(/exceeds the .*-byte upload limit/);
  });

  // Exact-boundary cases (review finding #8) — the prior 413 case only ever
  // exercised limit+1KiB, leaving the `>` (not `>=`) comparison at
  // storyboard.ts's size check untested at the actual boundary.
  it('POST /uploads accepts a decoded image of EXACTLY STORYBOARD_UPLOAD_MAX_BYTES with 201', async () => {
    await boot();
    const created = await createStoryboard();
    const exact = Buffer.alloc(STORYBOARD_UPLOAD_MAX_BYTES);
    const resp = await fetch(`${base}/api/storyboards/${created.id}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl: `data:image/png;base64,${exact.toString('base64')}` }),
    });
    expect(resp.status).toBe(201);
  });

  it('POST /uploads 413s a decoded image of exactly STORYBOARD_UPLOAD_MAX_BYTES + 1 byte', async () => {
    await boot();
    const created = await createStoryboard();
    const overByOne = Buffer.alloc(STORYBOARD_UPLOAD_MAX_BYTES + 1);
    const resp = await fetch(`${base}/api/storyboards/${created.id}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl: `data:image/png;base64,${overByOne.toString('base64')}` }),
    });
    expect(resp.status).toBe(413);
  });

  it('assemble 400s when no shot is done', async () => {
    await boot();
    const created = await createStoryboard();
    const resp = await fetch(`${base}/api/storyboards/${created.id}/assemble`, { method: 'POST' });
    expect(resp.status).toBe(400);
  });

  it('export-slider 400s when no shot has a start frame', async () => {
    await boot();
    const created = await createStoryboard();
    const resp = await fetch(`${base}/api/storyboards/${created.id}/export-slider`, { method: 'POST' });
    expect(resp.status).toBe(400);
  });

  it('export-slider 400s when a stored startFrame path escapes the storyboard project dir', async () => {
    await boot();
    const created = await createStoryboard();
    const store = await import('../../src/storyboards/store.js');
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const stored = await store.readStoryboard(dataDir, created.id);
    if (!stored) throw new Error('storyboard not found on disk');
    stored.shots = [
      {
        id: 'shot-1',
        order: 0,
        startFrame: { path: '../../etc/hosts', origin: 'uploaded' },
        motionPrompt: 'motion',
        model: 'openrouter/bytedance/seedance-2.0:1080p',
        resolution: '1080p',
        durationSec: 5,
        status: 'draft',
      },
    ];
    await store.writeStoryboard(dataDir, stored);

    const resp = await fetch(`${base}/api/storyboards/${created.id}/export-slider`, { method: 'POST' });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toMatch(/startFrame\.path escapes the storyboard project directory/);
  });

  it.runIf(canSymlink)('export-slider 400s when a stored startFrame path symlinks outside the storyboard project dir', async () => {
    await boot();
    const created = await createStoryboard();
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const projectDir = path.join(dataDir, 'projects', 'storyboard-media');
    await mkdir(projectDir, { recursive: true });
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'od-storyboard-outside-'));
    try {
      const secret = path.join(outsideDir, 'secret.png');
      writeFileSync(secret, Buffer.from(PNG_BASE64, 'base64'));
      symlinkSync(secret, path.join(projectDir, 'evil-frame.png'));

      const store = await import('../../src/storyboards/store.js');
      const stored = await store.readStoryboard(dataDir, created.id);
      if (!stored) throw new Error('storyboard not found on disk');
      stored.shots = [
        {
          id: 'shot-1',
          order: 0,
          startFrame: { path: 'evil-frame.png', origin: 'uploaded' },
          motionPrompt: 'motion',
          model: 'openrouter/bytedance/seedance-2.0:1080p',
          resolution: '1080p',
          durationSec: 5,
          status: 'draft',
        },
      ];
      await store.writeStoryboard(dataDir, stored);

      const resp = await fetch(`${base}/api/storyboards/${created.id}/export-slider`, { method: 'POST' });
      expect(resp.status).toBe(400);
      const body = (await resp.json()) as { error?: { message?: string } | string };
      const message = typeof body.error === 'string' ? body.error : body.error?.message;
      expect(message).toMatch(/startFrame\.path escapes the storyboard project directory/);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it.runIf(canSymlink)('export-slider 400s when slider.html already exists as a symlink (refuses to write through it)', async () => {
    await boot();
    const created = await createStoryboard();
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const projectDir = path.join(dataDir, 'projects', 'storyboard-media');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'start-1.png'), Buffer.from(PNG_BASE64, 'base64'));
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'od-storyboard-outside-'));
    try {
      const secretTarget = path.join(outsideDir, 'clobber-me.html');
      writeFileSync(secretTarget, '<html>pre-existing</html>');
      symlinkSync(secretTarget, path.join(projectDir, 'slider.html'));

      await fetch(`${base}/api/storyboards/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shots: [
            {
              id: 'shot-1',
              order: 0,
              startFrame: { path: 'start-1.png', origin: 'generated' },
              motionPrompt: 'motion',
              model: 'openrouter/bytedance/seedance-2.0:1080p',
              resolution: '1080p',
              durationSec: 5,
              status: 'draft',
            },
          ],
        }),
      });

      const resp = await fetch(`${base}/api/storyboards/${created.id}/export-slider`, { method: 'POST' });
      expect(resp.status).toBe(400);
      const body = (await resp.json()) as { error?: { message?: string } | string };
      const message = typeof body.error === 'string' ? body.error : body.error?.message;
      expect(message).toMatch(/slider output target is unsafe/);
    } finally {
      // OD_DATA_DIR (and so the storyboard-media project dir) is shared by
      // every test in this vitest worker — clean up the fixed-name symlink
      // this test plants so later tests writing the same 'slider.html' name
      // (e.g. the "writes parseable" test below) aren't blocked by it.
      rmSync(path.join(projectDir, 'slider.html'), { force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('export-slider writes parseable, GSAP-free HTML with tiny synthetic frames inlined', async () => {
    await boot();
    const created = await createStoryboard('Slider export test');

    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const projectDir = path.join(dataDir, 'projects', 'storyboard-media');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'start-1.png'), Buffer.from(PNG_BASE64, 'base64'));
    await writeFile(path.join(projectDir, 'end-1.png'), Buffer.from(PNG_BASE64, 'base64'));

    await fetch(`${base}/api/storyboards/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shots: [
          {
            id: 'shot-1',
            order: 0,
            title: 'Opening shot',
            startFrame: { path: 'start-1.png', origin: 'generated' },
            endFrame: { path: 'end-1.png', origin: 'derived' },
            motionPrompt: 'motion',
            model: 'openrouter/bytedance/seedance-2.0:1080p',
            resolution: '1080p',
            durationSec: 5,
            status: 'draft',
          },
        ],
      }),
    });

    const resp = await fetch(`${base}/api/storyboards/${created.id}/export-slider`, { method: 'POST' });
    expect(resp.status).toBe(200);
    const { output } = (await resp.json()) as { output: string };
    expect(output).toBe('slider.html');

    const html = await readFile(path.join(projectDir, 'slider.html'), 'utf8');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Opening shot');
    expect(html).toContain('data:image/png;base64,');
    expect(html.toLowerCase()).not.toContain('gsap');
    const frameImgCount = (html.match(/class="frame /g) || []).length;
    expect(frameImgCount).toBe(2); // start + end frame for the one shot
  });
});
