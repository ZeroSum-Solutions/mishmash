// REAL end-to-end fixture render smoke for the Remotion finishing pass (goal-run
// C5, t5): synthesizes 3 tiny fixture clips + a short real narration track,
// drives the actual /api/storyboards/:id/assemble HTTP surface exactly like the
// `od storyboard assemble --finish remotion` CLI would, and asserts a real mp4
// comes out the other end. Nothing here is mocked — ffmpeg, whisper.cpp
// (built from source on first run), and Remotion's headless-Chrome render all
// run for real.
//
// Gated behind OD_RUN_REAL_REMOTION_FINISH_E2E=1 (same `.local.test.ts` +
// opt-in-env-var idiom as vela-login-activation-e2e.local.test.ts) because:
//   - whisper.cpp is built from source (git clone + make) and its model
//     downloaded from huggingface.co the first time this runs in a given
//     OD_DATA_DIR — not something every CI push should pay for.
//   - it uses macOS's `say` for real (not synthetic) narration speech, so it
//     only runs on darwin.
// Skipped automatically wherever the gate isn't satisfied.

import type http from 'node:http';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { startServer } from '../../src/server.js';

// Machine-independent — never hardcode an operator/session-specific path in
// a committed test. Anyone running this locally gets the rendered mp4 under
// their own OS temp dir.
const SMOKE_OUTPUT_DIR = path.join(os.tmpdir(), 'od-remotion-finish-smoke');

function shouldRunRealRemotionFinishE2E(): boolean {
  if (process.env.OD_RUN_REAL_REMOTION_FINISH_E2E !== '1') return false;
  if (process.platform !== 'darwin') return false;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    execFileSync('say', ['-v', '?'], { stdio: 'ignore' });
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    execFileSync('make', ['--version'], { stdio: 'ignore' });
  } catch {
    return false;
  }
  return true;
}

const maybe = shouldRunRealRemotionFinishE2E() ? describe : describe.skip;

maybe('storyboard assemble --finish remotion (real fixture render)', () => {
  it(
    'renders a real mp4: title card + crossfades + captions burned from a real whisper.cpp transcription',
    async () => {
      const started = (await startServer({ port: 0, returnServer: true })) as {
        url: string;
        server: http.Server;
      };
      const base = started.url;

      try {
        const dataDir = process.env.OD_DATA_DIR;
        if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
        const projectDir = path.join(dataDir, 'projects', 'storyboard-media');
        await mkdir(projectDir, { recursive: true });

        // Optional: pre-seed an already-downloaded ggml-tiny.en.bin so this
        // run doesn't depend on huggingface.co being reachable — whisper.ts's
        // downloadWhisperModel() short-circuits (existsSync + byte-size
        // match) when the model is already at the path it expects.
        const modelSeed = process.env.OD_TEST_WHISPER_MODEL_SEED;
        if (modelSeed) {
          const modelDir = path.join(dataDir, 'remotion-whisper', 'whisper-models');
          await mkdir(modelDir, { recursive: true });
          await cp(modelSeed, path.join(modelDir, 'ggml-tiny.en.bin'));
        }

        // --- Fixture clips: 3 tiny, distinguishable, real mp4s -------------
        const shotNames = ['smoke-shot-1.mp4', 'smoke-shot-2.mp4', 'smoke-shot-3.mp4'];
        const colors = ['red', 'green', 'blue'];
        for (const [index, name] of shotNames.entries()) {
          execFileSync(
            'ffmpeg',
            [
              '-y',
              '-f',
              'lavfi',
              '-i',
              `color=c=${colors[index]}:s=320x180:d=4`,
              '-pix_fmt',
              'yuv420p',
              path.join(projectDir, name),
            ],
            { stdio: 'ignore' },
          );
        }

        // --- Fixture narration: real speech via macOS `say` ----------------
        const narrationAiff = path.join(projectDir, 'smoke-narration.aiff');
        const narrationWav = path.join(projectDir, 'smoke-narration.wav');
        execFileSync('say', [
          '-o',
          narrationAiff,
          'This is a fixture render smoke test of the Remotion finishing pipeline.',
        ]);
        execFileSync('ffmpeg', ['-y', '-i', narrationAiff, '-ar', '16000', '-ac', '1', narrationWav], {
          stdio: 'ignore',
        });
        const narrationBytes = await readFile(narrationWav);
        const audioDataUrl = `data:audio/wav;base64,${narrationBytes.toString('base64')}`;

        // --- Create the storyboard + mark all 3 shots done -----------------
        const createResp = await fetch(`${base}/api/storyboards`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'T5 Remotion finishing smoke' }),
        });
        expect(createResp.status).toBe(201);
        const { storyboard } = (await createResp.json()) as { storyboard: { id: string } };

        const patchResp = await fetch(`${base}/api/storyboards/${storyboard.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            shots: shotNames.map((output, index) => ({
              id: `smoke-shot-${index + 1}`,
              order: index,
              motionPrompt: 'fixture motion',
              model: 'test-fixture-model',
              resolution: '720p',
              durationSec: 4,
              output,
              status: 'done',
            })),
          }),
        });
        expect(patchResp.status).toBe(200);

        // --- Assemble through the real Remotion finishing pass -------------
        const assembleResp = await fetch(`${base}/api/storyboards/${storyboard.id}/assemble`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            finish: {
              mode: 'remotion',
              title: 'T5 Remotion Finishing Smoke',
              transitions: true,
              captions: true,
              audioDataUrl,
            },
          }),
        });
        const assembleBody = (await assembleResp.json()) as
          | { output: string; finish: string }
          | { error: { message?: string } | string };
        expect(assembleResp.status, JSON.stringify(assembleBody)).toBe(200);
        const data = assembleBody as { output: string; finish: string };
        // Per-run naming (storyboard id + a run discriminator), not the old
        // shared literal 'final.mp4' — see storyboards/assemble.ts's
        // assembleOutputName.
        expect(data.output).toMatch(new RegExp(`^final-${storyboard.id}-.+\\.mp4$`));
        expect(data.finish).toBe('remotion');

        const outputPath = path.join(projectDir, data.output);
        const outputStat = await stat(outputPath);
        expect(outputStat.size).toBeGreaterThan(100 * 1024);

        // Copy out before this vitest worker's OD_DATA_DIR gets torn down on
        // process exit (tests/setup.ts rm's it) — this is the report artifact.
        await mkdir(SMOKE_OUTPUT_DIR, { recursive: true });
        const reportPath = path.join(SMOKE_OUTPUT_DIR, 'final.mp4');
        await cp(outputPath, reportPath);
        // eslint-disable-next-line no-console
        console.log(`[remotion-finish-e2e] rendered ${outputStat.size} bytes -> ${reportPath}`);
      } finally {
        await new Promise<void>((resolve) => started.server.close(() => resolve()));
      }
    },
    900_000,
  );
});
