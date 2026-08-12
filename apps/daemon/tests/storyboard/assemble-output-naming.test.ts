// Regression coverage for the deferred "assemble final.mp4 clobber" bug:
// both assemble finishing modes hardcoded `const outputName = 'final.mp4'`
// in storyboards/assemble.ts, so the single shared storyboard-media project
// dir could only ever hold ONE assembled video at a time — any assemble
// run, for ANY storyboard, silently overwrote whatever a previous run (for
// that storyboard or a different one) had just produced. Fixed by giving
// every assemble run its own uniquely-named output (storyboard id + a run
// discriminator — see assembleOutputName in storyboards/assemble.ts) and
// persisting the winning run's name onto the storyboard record
// (Storyboard.finalOutput) so a caller can resolve "the current run's
// output" without guessing a fixed name.
//
// The first test below is RED on main (both assembles report the literal
// 'final.mp4', and the second one destroys the first's bytes) and GREEN on
// the fix branch.

import type http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../../src/server.js';

const canFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('storyboard assemble — per-run output naming (final.mp4 clobber regression)', () => {
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

  async function createStoryboard(title: string) {
    const resp = await fetch(`${base}/api/storyboards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    expect(resp.status).toBe(201);
    const data = (await resp.json()) as { storyboard: { id: string } };
    return data.storyboard;
  }

  async function markShotDone(id: string, shotOutputFile: string) {
    const resp = await fetch(`${base}/api/storyboards/${id}`, {
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
            output: shotOutputFile,
            status: 'done',
          },
        ],
      }),
    });
    expect(resp.status).toBe(200);
  }

  it.runIf(canFfmpeg)(
    "two different storyboards assembled back-to-back do not clobber each other's output",
    async () => {
      await boot();
      const dataDir = process.env.OD_DATA_DIR;
      if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
      const projectDir = path.join(dataDir, 'projects', 'storyboard-media');
      await mkdir(projectDir, { recursive: true });

      const shotA = 'clobber-shot-a.mp4';
      const shotB = 'clobber-shot-b.mp4';
      // Distinguishable real clips (different color, so the assembled
      // bytes differ) via ffmpeg's lavfi test source — same idiom as
      // assemble-remotion.test.ts, no checked-in fixture binary needed.
      execFileSync(
        'ffmpeg',
        ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-pix_fmt', 'yuv420p', path.join(projectDir, shotA)],
        { stdio: 'ignore' },
      );
      execFileSync(
        'ffmpeg',
        ['-y', '-f', 'lavfi', '-i', 'color=c=green:s=64x64:d=1', '-pix_fmt', 'yuv420p', path.join(projectDir, shotB)],
        { stdio: 'ignore' },
      );

      const boardA = await createStoryboard('Clobber A');
      const boardB = await createStoryboard('Clobber B');
      await markShotDone(boardA.id, shotA);
      await markShotDone(boardB.id, shotB);

      let dataA: { output: string; finish: string } | undefined;
      let dataB: { output: string; finish: string } | undefined;
      try {
        const respA = await fetch(`${base}/api/storyboards/${boardA.id}/assemble`, { method: 'POST' });
        expect(respA.status).toBe(200);
        dataA = (await respA.json()) as { output: string; finish: string };
        const bytesAfterA = await readFile(path.join(projectDir, dataA.output));

        const respB = await fetch(`${base}/api/storyboards/${boardB.id}/assemble`, { method: 'POST' });
        expect(respB.status).toBe(200);
        dataB = (await respB.json()) as { output: string; finish: string };

        // The bug: both finishing modes hardcoded the exact same literal
        // output name ('final.mp4'), so B's run silently destroyed A's
        // already-produced file the moment it wrote through that shared
        // path. RED on main: both equal 'final.mp4'.
        expect(dataB.output).not.toBe(dataA.output);

        // A's file must still hold A's original bytes after B's run.
        const bytesStillA = await readFile(path.join(projectDir, dataA.output));
        expect(bytesStillA).toEqual(bytesAfterA);

        // The persisted record is how a caller resolves "the current run's
        // output" after the fact instead of guessing a fixed name.
        const getA = await fetch(`${base}/api/storyboards/${boardA.id}`);
        const { storyboard: storedA } = (await getA.json()) as { storyboard: { finalOutput?: string } };
        expect(storedA.finalOutput).toBe(dataA.output);

        const getB = await fetch(`${base}/api/storyboards/${boardB.id}`);
        const { storyboard: storedB } = (await getB.json()) as { storyboard: { finalOutput?: string } };
        expect(storedB.finalOutput).toBe(dataB.output);
      } finally {
        await rm(path.join(projectDir, shotA), { force: true });
        await rm(path.join(projectDir, shotB), { force: true });
        if (dataA) await rm(path.join(projectDir, dataA.output), { force: true });
        if (dataB) await rm(path.join(projectDir, dataB.output), { force: true });
      }
    },
  );

  it('reading a legacy storyboard record with no finalOutput field does not break', async () => {
    await boot();
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const created = await createStoryboard('Legacy record');

    // Simulate a pre-fix stored record: this field never existed in the
    // JSON doc before this fix, so an already-created storyboard on disk
    // never has it either — reading it back must not error.
    const store = await import('../../src/storyboards/store.js');
    const stored = await store.readStoryboard(dataDir, created.id);
    if (!stored) throw new Error('expected the just-created storyboard to be readable');
    delete (stored as { finalOutput?: string }).finalOutput;
    await store.writeStoryboard(dataDir, stored);

    const resp = await fetch(`${base}/api/storyboards/${created.id}`);
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { storyboard: { finalOutput?: string } };
    expect(data.storyboard.finalOutput).toBeUndefined();
  });

  it('clears a stale finalOutput when its assembled file no longer exists', async () => {
    await boot();
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const created = await createStoryboard('Stale assembled output');

    const store = await import('../../src/storyboards/store.js');
    const stored = await store.readStoryboard(dataDir, created.id);
    if (!stored) throw new Error('expected the just-created storyboard to be readable');
    stored.finalOutput = `final-${created.id}-00000000-0000-4000-8000-000000000000.mp4`;
    await store.writeStoryboard(dataDir, stored);

    const resp = await fetch(`${base}/api/storyboards/${created.id}`);
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { storyboard: { finalOutput?: string } };
    expect(data.storyboard.finalOutput).toBeUndefined();

    const repaired = await store.readStoryboard(dataDir, created.id);
    expect(repaired?.finalOutput).toBeUndefined();
  });
});
