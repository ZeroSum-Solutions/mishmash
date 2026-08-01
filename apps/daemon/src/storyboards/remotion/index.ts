// Public entrypoint for the Remotion storyboard finishing pass — the only
// module storyboards/assemble.ts imports from this directory. Ties together:
// ffmpeg audio-format conversion (whisper.cpp requires 16kHz mono WAV) ->
// local whisper transcription (whisper.ts) -> the Remotion bundle+render
// (render.ts). No cloud calls anywhere in this path.
//
// Review finding T1: this whole pipeline shares ONE overall time budget
// (createDeadline(), env-tunable via OD_REMOTION_FINISH_MAX_MS) so a stuck
// ffprobe/ffmpeg, a stuck webpack bundle, or a stuck Chrome render can never
// hold the assemble HTTP request open indefinitely. An AbortController tied
// to the same deadline gives real process cancellation for the ffmpeg
// conversion spawn and every whisper.cpp child process (git/make/
// whisper-cli, and the model-download fetch).

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Caption } from '@remotion/captions';
import { createDeadline, RemotionFinishTimeoutError, withDeadline } from './deadline.js';
import { renderStoryboardFinish } from './render.js';
import { spawnWithTimeout } from './spawn-with-timeout.js';
import { transcribeLocally } from './whisper.js';

export interface FinishWithRemotionInput {
  /** Absolute paths to the ordered, already-validated done-shot clip files. */
  clipPaths: string[];
  ratio: string;
  titleEnabled: boolean;
  titleText: string;
  transitionsEnabled: boolean;
  /** Decoded narration/voiceover bytes from finish.audioDataUrl, or null when omitted. */
  audio: { bytes: Buffer; ext: string } | null;
  captionsRequested: boolean;
  /** Absolute daemon data root (RUNTIME_DATA_DIR) — whisper.cpp's binary/model cache lives under it. */
  runtimeDataDir: string;
  /** Absolute destination path for the rendered mp4. */
  outputPath: string;
}

async function convertToWav16kMono(inputPath: string, outputPath: string, timeoutMs: number): Promise<void> {
  await spawnWithTimeout(
    'ffmpeg',
    ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outputPath],
    timeoutMs,
    'ffmpeg audio conversion',
  );
}

export async function finishWithRemotion(input: FinishWithRemotionInput): Promise<void> {
  const deadline = createDeadline();
  // Real cancellation for whisper.cpp's child processes (see whisper.ts) —
  // aborted the moment the overall deadline expires so a slow git
  // clone/make/model-download/transcribe doesn't strand a background
  // process after the HTTP request has already failed.
  const whisperAbort = new AbortController();
  const abortTimer = setTimeout(() => whisperAbort.abort(new RemotionFinishTimeoutError('whisper')), deadline.remainingMs());
  abortTimer.unref?.();

  const scratchDir = await mkdtemp(path.join(os.tmpdir(), 'od-remotion-audio-'));
  try {
    let audioPath: string | null = null;
    let captions: Caption[] | null = null;

    if (input.audio) {
      deadline.assertNotExpired('audio decode');
      audioPath = path.join(scratchDir, `narration${input.audio.ext}`);
      await writeFile(audioPath, input.audio.bytes);

      if (input.captionsRequested) {
        deadline.assertNotExpired('ffmpeg audio conversion');
        const wavPath = path.join(scratchDir, 'narration-16k-mono.wav');
        await convertToWav16kMono(audioPath, wavPath, deadline.remainingMs());
        deadline.assertNotExpired('whisper transcription');
        // The AbortSignal above gives real process cancellation, but
        // whatever error IT produces (an AbortError, a killed-child error,
        // ...) isn't guaranteed to read as a clear "you hit the deadline"
        // message — race it too so the labeled RemotionFinishTimeoutError
        // always wins on expiry, same as every other stage.
        captions = await withDeadline(
          transcribeLocally({
            wavPath,
            cacheDir: path.join(input.runtimeDataDir, 'remotion-whisper'),
            signal: whisperAbort.signal,
          }),
          deadline,
          'whisper transcription',
        );
      }
    }

    await renderStoryboardFinish({
      clipPaths: input.clipPaths,
      titleEnabled: input.titleEnabled,
      titleText: input.titleText,
      transitionsEnabled: input.transitionsEnabled,
      audioPath,
      captions,
      ratio: input.ratio,
      outputPath: input.outputPath,
      deadline,
    });
  } finally {
    clearTimeout(abortTimer);
    await rm(scratchDir, { recursive: true, force: true });
  }
}
