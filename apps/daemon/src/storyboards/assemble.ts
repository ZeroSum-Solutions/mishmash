// Assemble pipeline for POST /api/storyboards/:id/assemble — delegated to by
// routes/storyboard.ts (which owns request validation, containment checks
// via resolveWithinProjectDirReal/assertSafeWriteTarget, and turning the
// AssembleOutcome below into an HTTP response). Two finishing modes:
//
//   - 'concat' (default, unchanged): ffmpeg concat-demuxer hard cut of the
//     ordered done-shot outputs into final.mp4. This is the pipeline that
//     lived inline in the route handler before this module existed.
//   - 'remotion' (opt-in via `finish: { mode: 'remotion', ... }`): title card
//     + crossfade transitions + burned-in captions transcribed locally via
//     whisper.cpp — see remotion/index.ts.

import { spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AssembleStoryboardFinishOptions, Storyboard, StoryboardShot } from '@open-design/contracts';
import { isStoryboardFinishAudioMimeAllowed, STORYBOARD_FINISH_AUDIO_MAX_BYTES } from '@open-design/contracts';
import { RemotionFinishTimeoutError } from './remotion/deadline.js';
import { finishWithRemotion } from './remotion/index.js';

/**
 * Ordered done-shot outputs to assemble. The route calls this BEFORE
 * ensureStoryboardMediaProject() so a zero-shot assemble 400s without
 * provisioning the hidden storyboard-media project as a side effect —
 * ensureStoryboardMediaProject is only worth paying for once there's
 * actually something to assemble.
 */
export function getDoneShots(storyboard: Storyboard): StoryboardShot[] {
  return [...storyboard.shots].sort((a, b) => a.order - b.order).filter((shot) => shot.status === 'done' && shot.output);
}

export interface AssembleStoryboardInput {
  storyboard: Storyboard;
  /** Absolute path to the storyboard-media project directory. */
  projectDir: string;
  /** Absolute daemon data root (RUNTIME_DATA_DIR) — whisper.cpp's cache lives under it. */
  runtimeDataDir: string;
  finish?: AssembleStoryboardFinishOptions;
  resolveWithinProjectDirReal: (projectDir: string, rel: unknown) => Promise<string | null>;
  assertSafeWriteTarget: (projectDir: string, absoluteTarget: string) => Promise<boolean>;
}

export type AssembleStoryboardOutcome =
  | { ok: true; output: string; finish: 'concat' | 'remotion' }
  | { ok: false; status: number; code: string; message: string };

const FINISH_AUDIO_DATA_URL_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.*)$/i;
const FINISH_AUDIO_BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function finishAudioExtFor(mime: string): string {
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return '.wav';
  if (mime === 'audio/mpeg') return '.mp3';
  if (mime === 'audio/mp4') return '.m4a';
  return '.aac';
}

/**
 * Decodes `finish.audioDataUrl`; never persisted, used only for this one
 * assemble call. Mirrors POST /api/storyboards/:id/uploads's dataUrl
 * validation exactly (mime lowercased before the allowlist check, base64
 * charset + `% 4 !== 0` padding check, pre-decode size bound, post-decode
 * size bound) — see that route for why each step is ordered the way it is.
 */
function decodeFinishAudio(
  dataUrl: string,
): { ok: true; bytes: Buffer; ext: string } | { ok: false; status: number; code: string; message: string } {
  const match = FINISH_AUDIO_DATA_URL_RE.exec(dataUrl);
  if (!match) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'finish.audioDataUrl must be a data: URL' };
  }
  const mime = match[1]?.toLowerCase();
  const payload = match[2];
  if (mime === undefined || payload === undefined) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'finish.audioDataUrl must be a data: URL' };
  }
  if (!isStoryboardFinishAudioMimeAllowed(mime)) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_REQUEST',
      message: `finish.audioDataUrl mime type "${mime}" is not supported (wav|mpeg|mp4|aac)`,
    };
  }
  // Buffer.from(…, 'base64') silently drops invalid characters instead of
  // throwing, so the charset/padding shape must be checked explicitly —
  // otherwise a garbled payload would decode to truncated (but
  // "successful") audio instead of failing loudly.
  if (!FINISH_AUDIO_BASE64_RE.test(payload) || payload.length % 4 !== 0) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'finish.audioDataUrl has a malformed base64 payload' };
  }
  // Same pre-decode size guard idiom as the frame upload route: reject
  // before Buffer.from allocates, using the base64-inflation bound.
  if (payload.length > 4 * Math.ceil(STORYBOARD_FINISH_AUDIO_MAX_BYTES / 3)) {
    return {
      ok: false,
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: `decoded finish.audioDataUrl exceeds the ${STORYBOARD_FINISH_AUDIO_MAX_BYTES}-byte limit`,
    };
  }
  const bytes = Buffer.from(payload, 'base64');
  if (bytes.length === 0) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'finish.audioDataUrl decoded to an empty payload' };
  }
  if (bytes.length > STORYBOARD_FINISH_AUDIO_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: `decoded finish.audioDataUrl (${bytes.length} bytes) exceeds the ${STORYBOARD_FINISH_AUDIO_MAX_BYTES}-byte limit`,
    };
  }
  return { ok: true, bytes, ext: finishAudioExtFor(mime) };
}

async function runConcatAssemble(resolvedOutputs: string[], input: AssembleStoryboardInput): Promise<AssembleStoryboardOutcome> {
  const listFile = path.join(input.projectDir, `.storyboard-concat-${input.storyboard.id}.txt`);
  const outputName = 'final.mp4';
  const outputFile = path.join(input.projectDir, outputName);

  if (!(await input.assertSafeWriteTarget(input.projectDir, listFile))) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'concat list target is unsafe' };
  }
  if (!(await input.assertSafeWriteTarget(input.projectDir, outputFile))) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'output target is unsafe' };
  }

  const listBody = resolvedOutputs.map((resolved) => `file '${resolved.replace(/'/g, "'\\''")}'`).join('\n');
  await writeFile(listFile, listBody, 'utf8');

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputFile]);
      let stderr = '';
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (err: NodeJS.ErrnoException) => {
        if (err?.code === 'ENOENT') {
          reject(Object.assign(new Error('ffmpeg-not-found'), { code: 'ENOENT' }));
        } else {
          reject(err);
        }
      });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
      });
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return {
        ok: false,
        status: 501,
        code: 'INTERNAL_ERROR',
        message: 'ffmpeg not found on this machine. Install it (e.g. `brew install ffmpeg` on macOS) and retry.',
      };
    }
    return { ok: false, status: 500, code: 'INTERNAL_ERROR', message: String(err instanceof Error ? err.message : err) };
  } finally {
    await rm(listFile, { force: true });
  }

  return { ok: true, output: outputName, finish: 'concat' };
}

async function runRemotionAssemble(
  resolvedOutputs: string[],
  finish: AssembleStoryboardFinishOptions,
  input: AssembleStoryboardInput,
): Promise<AssembleStoryboardOutcome> {
  const outputName = 'final.mp4';
  const outputFile = path.join(input.projectDir, outputName);
  if (!(await input.assertSafeWriteTarget(input.projectDir, outputFile))) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'output target is unsafe' };
  }

  const captionsRequested = finish.captions ?? Boolean(finish.audioDataUrl);
  if (captionsRequested && !finish.audioDataUrl) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'finish.captions requires finish.audioDataUrl' };
  }

  let audio: { bytes: Buffer; ext: string } | null = null;
  if (finish.audioDataUrl) {
    const decoded = decodeFinishAudio(finish.audioDataUrl);
    if (!decoded.ok) return decoded;
    audio = { bytes: decoded.bytes, ext: decoded.ext };
  }

  try {
    await finishWithRemotion({
      clipPaths: resolvedOutputs,
      ratio: input.storyboard.ratio,
      titleEnabled: finish.titles ?? true,
      titleText: finish.title ?? input.storyboard.title,
      transitionsEnabled: finish.transitions ?? true,
      audio,
      captionsRequested,
      runtimeDataDir: input.runtimeDataDir,
      outputPath: outputFile,
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return {
        ok: false,
        status: 501,
        code: 'INTERNAL_ERROR',
        message: 'ffmpeg not found on this machine. Install it (e.g. `brew install ffmpeg` on macOS) and retry.',
      };
    }
    // Review finding T1: labeled, user-actionable error on deadline expiry —
    // checked before the generic catch-all so a timeout never reads as an
    // opaque "renderMedia failed" message.
    if (err instanceof RemotionFinishTimeoutError) {
      console.error(`[assemble] Remotion finishing pass timed out during "${err.stage}"`, err);
      return {
        ok: false,
        status: 504,
        code: 'TIMEOUT',
        message:
          `The Remotion finishing pass timed out during "${err.stage}". Increase OD_REMOTION_FINISH_MAX_MS, ` +
          `use fewer/shorter shots, or retry.`,
      };
    }
    return { ok: false, status: 500, code: 'INTERNAL_ERROR', message: String(err instanceof Error ? err.message : err) };
  }

  return { ok: true, output: outputName, finish: 'remotion' };
}

export async function assembleStoryboard(input: AssembleStoryboardInput): Promise<AssembleStoryboardOutcome> {
  // Redundant with the route's own getDoneShots() pre-check (see its doc
  // comment) — kept here too so assembleStoryboard() stays correct on its
  // own for any other caller (tests, a future CLI-direct path) that doesn't
  // replicate that pre-check.
  const doneShots = getDoneShots(input.storyboard);
  if (doneShots.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'no rendered shots to assemble — render at least one shot first',
    };
  }

  const resolvedOutputs: string[] = [];
  for (const shot of doneShots) {
    const resolved = await input.resolveWithinProjectDirReal(input.projectDir, shot.output);
    if (!resolved) {
      return {
        ok: false,
        status: 400,
        code: 'BAD_REQUEST',
        message: `shot ${shot.id}.output escapes the storyboard project directory`,
      };
    }
    resolvedOutputs.push(resolved);
  }

  if (!input.finish) {
    return runConcatAssemble(resolvedOutputs, input);
  }
  return runRemotionAssemble(resolvedOutputs, input.finish, input);
}
