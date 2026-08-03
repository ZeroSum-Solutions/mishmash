// Fast, hermetic tests for POST /api/storyboards/:id/assemble's `finish`
// request validation (storyboards/routes/storyboard.ts's
// validateAssembleFinish) plus a regression check that the default (no
// `finish`) path still concats and now reports `finish: 'concat'` in the
// response — see packages/contracts/src/api/storyboard.ts's
// AssembleStoryboardResponse. The real Remotion finishing pass (whisper.cpp
// transcription + a real render) is exercised separately in
// remotion-finish-e2e.local.test.ts, gated behind an explicit opt-in env var
// since it builds/downloads whisper.cpp on first run — not something every
// CI machine should pay for on every push.

import type http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { STORYBOARD_FINISH_AUDIO_MAX_BYTES } from '@open-design/contracts';
import { startServer } from '../../src/server.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2uoAAAAASUVORK5CYII=';

// Mirrors the canSymlink probe idiom already used elsewhere in this suite
// (routes.test.ts) — skip the one test that needs a real ffmpeg concat on a
// machine that doesn't have it, rather than failing the whole file.
const canFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('storyboard assemble — finish (Remotion) request validation', () => {
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

  async function createStoryboard(title = 'Finish test storyboard') {
    const resp = await fetch(`${base}/api/storyboards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    expect(resp.status).toBe(201);
    const data = (await resp.json()) as { storyboard: { id: string } };
    return data.storyboard;
  }

  async function assembleErrorMessage(body: unknown): Promise<{ status: number; message: string | undefined }> {
    const created = await createStoryboard();
    const resp = await fetch(`${base}/api/storyboards/${created.id}/assemble`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await resp.json()) as { error?: { message?: string } | string };
    const message = typeof data.error === 'string' ? data.error : data.error?.message;
    return { status: resp.status, message };
  }

  async function pathExists(target: string): Promise<boolean> {
    try {
      await stat(target);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Creates a storyboard with one done shot pointing at a real (arbitrary-
   * bytes) file in the storyboard-media project dir, so a `finish.*`
   * validation reaches the audioDataUrl-decoding step in
   * storyboards/assemble.ts's runRemotionAssemble — that step only runs
   * once there's at least one done shot to assemble (the "no rendered
   * shots" 400 fires first otherwise, per review finding F5).
   */
  async function createStoryboardWithDoneShot(): Promise<{ id: string; projectDir: string; cleanup: () => Promise<void> }> {
    const created = await createStoryboard();
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const projectDir = path.join(dataDir, 'projects', 'storyboard-media');
    const shotFile = `finish-shot-${created.id}.mp4`;
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, shotFile), Buffer.from(PNG_BASE64, 'base64'));
    await fetch(`${base}/api/storyboards/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shots: [
          {
            id: 'shot-1',
            order: 0,
            motionPrompt: 'motion',
            model: 'test-model',
            resolution: '720p',
            durationSec: 4,
            output: shotFile,
            status: 'done',
          },
        ],
      }),
    });
    return {
      id: created.id,
      projectDir,
      cleanup: () => rm(path.join(projectDir, shotFile), { force: true }),
    };
  }

  it('400s on zero rendered shots WITHOUT provisioning the hidden storyboard-media project (F5)', async () => {
    await boot();
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const projectDir = path.join(dataDir, 'projects', 'storyboard-media');
    // Guarantee a clean slate regardless of what earlier tests in this
    // shared-OD_DATA_DIR vitest worker have already provisioned — this test
    // must prove the daemon doesn't (re)create the project as a side
    // effect of a 400, not merely that it happens to be absent already.
    await rm(projectDir, { recursive: true, force: true });

    const created = await createStoryboard();
    const resp = await fetch(`${base}/api/storyboards/${created.id}/assemble`, { method: 'POST' });
    expect(resp.status).toBe(400);
    const data = (await resp.json()) as { error?: { message?: string } | string };
    const message = typeof data.error === 'string' ? data.error : data.error?.message;
    expect(message).toMatch(/no rendered shots to assemble/);
    expect(await pathExists(projectDir)).toBe(false);
  });

  it('400s when finish is not an object', async () => {
    await boot();
    const { status, message } = await assembleErrorMessage({ finish: 'remotion' });
    expect(status).toBe(400);
    expect(message).toMatch(/finish must be an object/);
  });

  it('400s when finish.mode is not "remotion"', async () => {
    await boot();
    const { status, message } = await assembleErrorMessage({ finish: { mode: 'ffmpeg' } });
    expect(status).toBe(400);
    expect(message).toMatch(/finish\.mode must be "remotion"/);
  });

  it('400s when finish.captions is requested without finish.audioDataUrl', async () => {
    await boot();
    const { status, message } = await assembleErrorMessage({ finish: { mode: 'remotion', captions: true } });
    expect(status).toBe(400);
    expect(message).toMatch(/finish\.captions requires finish\.audioDataUrl/);
  });

  it('400s when finish.title is not a string', async () => {
    await boot();
    const { status, message } = await assembleErrorMessage({ finish: { mode: 'remotion', title: 42 } });
    expect(status).toBe(400);
    expect(message).toMatch(/finish\.title must be a string/);
  });

  it('400s when finish.titles is not a boolean', async () => {
    await boot();
    const { status, message } = await assembleErrorMessage({ finish: { mode: 'remotion', titles: 'yes' } });
    expect(status).toBe(400);
    expect(message).toMatch(/finish\.titles must be a boolean/);
  });

  it('400s when finish.transitions is not a boolean', async () => {
    await boot();
    const { status, message } = await assembleErrorMessage({ finish: { mode: 'remotion', transitions: 1 } });
    expect(status).toBe(400);
    expect(message).toMatch(/finish\.transitions must be a boolean/);
  });

  it('400s when finish.audioDataUrl is not a data: URL', async () => {
    await boot();
    const { id, cleanup } = await createStoryboardWithDoneShot();
    try {
      const resp = await fetch(`${base}/api/storyboards/${id}/assemble`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ finish: { mode: 'remotion', audioDataUrl: 'https://example.com/narration.wav' } }),
      });
      const data = (await resp.json()) as { error?: { message?: string } | string };
      const message = typeof data.error === 'string' ? data.error : data.error?.message;
      expect(resp.status).toBe(400);
      expect(message).toMatch(/finish\.audioDataUrl must be a data: URL/);
    } finally {
      await cleanup();
    }
  });

  it('400s when finish.audioDataUrl mime is well-formed but disallowed (audio/ogg)', async () => {
    await boot();
    const { id, cleanup } = await createStoryboardWithDoneShot();
    try {
      const resp = await fetch(`${base}/api/storyboards/${id}/assemble`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          finish: { mode: 'remotion', audioDataUrl: `data:audio/ogg;base64,${PNG_BASE64}` },
        }),
      });
      const data = (await resp.json()) as { error?: { message?: string } | string };
      const message = typeof data.error === 'string' ? data.error : data.error?.message;
      expect(resp.status).toBe(400);
      expect(message).toMatch(/mime type "audio\/ogg" is not supported/);
    } finally {
      await cleanup();
    }
  });

  it('accepts an uppercase MIME in finish.audioDataUrl (lowercased before the allowlist check)', async () => {
    await boot();
    const { id, cleanup } = await createStoryboardWithDoneShot();
    try {
      const resp = await fetch(`${base}/api/storyboards/${id}/assemble`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Uppercase mime + malformed (odd-length, non-%4) base64 so this
        // exercises ONLY the mime-lowercasing path, not a real transcode —
        // it should get past the mime allowlist and fail on the base64
        // shape instead (proving the mime itself was accepted).
        body: JSON.stringify({ finish: { mode: 'remotion', audioDataUrl: 'data:AUDIO/WAV;base64,abc' } }),
      });
      const data = (await resp.json()) as { error?: { message?: string } | string };
      const message = typeof data.error === 'string' ? data.error : data.error?.message;
      expect(resp.status).toBe(400);
      expect(message).not.toMatch(/mime type/);
      expect(message).toMatch(/malformed base64 payload/);
    } finally {
      await cleanup();
    }
  });

  it('400s on a malformed (non-%4, invalid-charset) base64 payload', async () => {
    await boot();
    const { id, cleanup } = await createStoryboardWithDoneShot();
    try {
      const resp = await fetch(`${base}/api/storyboards/${id}/assemble`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ finish: { mode: 'remotion', audioDataUrl: 'data:audio/wav;base64,not-valid-base64!' } }),
      });
      const data = (await resp.json()) as { error?: { message?: string } | string };
      const message = typeof data.error === 'string' ? data.error : data.error?.message;
      expect(resp.status).toBe(400);
      expect(message).toMatch(/malformed base64 payload/);
    } finally {
      await cleanup();
    }
  });

  it('413s on an oversized finish.audioDataUrl payload', async () => {
    await boot();
    const { id, cleanup } = await createStoryboardWithDoneShot();
    try {
      const oversized = Buffer.alloc(STORYBOARD_FINISH_AUDIO_MAX_BYTES + 1).toString('base64');
      const resp = await fetch(`${base}/api/storyboards/${id}/assemble`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ finish: { mode: 'remotion', audioDataUrl: `data:audio/wav;base64,${oversized}` } }),
      });
      const data = (await resp.json()) as { error?: { message?: string } | string };
      const message = typeof data.error === 'string' ? data.error : data.error?.message;
      expect(resp.status).toBe(413);
      expect(message).toMatch(/exceeds the .*-byte limit/);
    } finally {
      await cleanup();
    }
  });

  it.runIf(canFfmpeg)('assemble with no finish still concats and reports finish: "concat" in the response', async () => {
    await boot();
    const created = await createStoryboard();
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const projectDir = path.join(dataDir, 'projects', 'storyboard-media');
    await mkdir(projectDir, { recursive: true });

    // Two tiny real clips via ffmpeg's lavfi test source — small/fast, no
    // checked-in fixture binary needed, and real enough for the concat
    // demuxer to actually process (unlike the symlink-guard tests elsewhere
    // in this suite, which 400 before ffmpeg ever runs on the fake bytes
    // they plant).
    const shotNames = ['finish-shot-1.mp4', 'finish-shot-2.mp4'];
    for (const name of shotNames) {
      execFileSync(
        'ffmpeg',
        ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1', '-pix_fmt', 'yuv420p', path.join(projectDir, name)],
        { stdio: 'ignore' },
      );
    }

    let data: { output: string; finish: string } | undefined;
    try {
      await fetch(`${base}/api/storyboards/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shots: shotNames.map((output, index) => ({
            id: `shot-${index + 1}`,
            order: index,
            motionPrompt: 'motion',
            model: 'test-model',
            resolution: '720p',
            durationSec: 4,
            output,
            status: 'done',
          })),
        }),
      });

      const resp = await fetch(`${base}/api/storyboards/${created.id}/assemble`, { method: 'POST' });
      expect(resp.status).toBe(200);
      data = (await resp.json()) as { output: string; finish: string };
      // Per-run naming (storyboard id + a run discriminator), not the old
      // shared literal 'final.mp4' — see storyboards/assemble.ts's
      // assembleOutputName.
      expect(data.output).toMatch(new RegExp(`^final-${created.id}-.+\\.mp4$`));
      expect(data.finish).toBe('concat');
    } finally {
      // OD_DATA_DIR (and so the storyboard-media project dir) is shared by
      // every test in this vitest worker — clean up what this test wrote
      // so later tests aren't affected.
      if (data) await rm(path.join(projectDir, data.output), { force: true });
      for (const name of shotNames) {
        await rm(path.join(projectDir, name), { force: true });
      }
    }
  });
});
