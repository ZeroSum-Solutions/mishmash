// Local-only speech-to-text for burned-in captions — never calls a cloud
// transcription API. Wraps @remotion/install-whisper-cpp, which builds
// whisper.cpp from source (git clone + make; requires git/make/a C++
// toolchain, all Xcode-Command-Line-Tools defaults on macOS) the first time
// and downloads a ggml model the first time it's requested; both are cached
// under the daemon's own data root so repeat calls are instant. Pin exact
// versions per repo convention (see AGENTS.md's GSAP-pinning precedent) —
// installWhisperCpp builds a specific whisper.cpp git tag, not "latest".
//
// `to`/`folder` accepted by @remotion/install-whisper-cpp are resolved
// relative to `process.cwd()` internally when not absolute (see its
// getWhisperExecutablePath/getModelPath) — callers MUST pass an absolute
// `cacheDir` (derived from RUNTIME_DATA_DIR, per the daemon data directory
// contract) so this doesn't silently depend on the daemon's working
// directory at call time.
//
// downloadWhisperModel() does NOT create its own `folder` — it opens an
// fs.createWriteStream() directly against `<folder>/ggml-<model>.bin`, and
// its internal download loop's write callback fires (and reports 100%
// progress) even when that stream failed to open because `folder` doesn't
// exist yet, since it never checks the callback's error argument. The net
// effect: it resolves successfully and reports a complete download while
// writing nothing at all. installWhisperCpp's git-clone creates `whisperDir`
// (and so `cacheDir`) as a side effect, but `modelDir` is a sibling
// directory nothing else creates — so it must be mkdir'd explicitly before
// downloadWhisperModel runs, or this exact silent-failure mode reproduces.
//
// installWhisperCpp() has a companion silent-failure mode: with
// printOutput:false, if `to` already exists but the whisper-cli executable
// under it is missing (a half-finished install from a previous crashed/
// killed process), it just resolves `{alreadyExisted:false}` WITHOUT
// attempting to (re)install — see its source: the printOutput:true branch
// throws in that case, printOutput:false silently returns. We always pass
// printOutput:false (no daemon business writing to stdout), so we verify the
// executable ourselves afterward. Review finding T2: the detailed diagnostic
// (which names the daemon-data cache dir) is logged server-side only —
// what's THROWN (and so what can reach an HTTP error body) is a stable,
// path-free message.
//
// ensureWhisperCppInstalled also serializes concurrent first-use installs
// for the same whisperDir behind one in-flight promise — same
// Map<key, Promise>.finally-based idiom as media/config.ts's
// higgsfieldRefreshInFlight — so two concurrent assemble requests don't both
// `git clone` into the same target directory (the second clone fails because
// the directory already exists and isn't empty).
//
// Review finding T1: installWhisperCpp/downloadWhisperModel/transcribe all
// forward an AbortSignal straight into the git/make/whisper-cli child
// processes they spawn (and into the model download's fetch() call) — so a
// caller-supplied `signal` here gives REAL process cancellation, not just an
// abandoned promise, when the overall finishing-pass deadline expires.

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  downloadWhisperModel,
  installWhisperCpp,
  transcribe,
  toCaptions,
  type WhisperModel,
} from '@remotion/install-whisper-cpp';
import type { Caption } from '@remotion/captions';

const WHISPER_CPP_VERSION = '1.9.1';
export const DEFAULT_WHISPER_MODEL: WhisperModel = 'tiny.en';

/**
 * whisper-cli's path under a whisper.cpp checkout for whisper.cpp >= 1.7.4
 * (our pinned WHISPER_CPP_VERSION is 1.9.1) — mirrors
 * @remotion/install-whisper-cpp's own internal getWhisperExecutablePath(),
 * which isn't part of that package's public exports so we can't import it
 * directly.
 */
function whisperExecutablePath(whisperDir: string): string {
  return path.join(whisperDir, 'build', 'bin', process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
}

const whisperInstallInFlight = new Map<string, Promise<void>>();

/** Builds whisper.cpp into `whisperDir` on first use; concurrent calls for the same dir share one install. */
export async function ensureWhisperCppInstalled(whisperDir: string, signal?: AbortSignal): Promise<void> {
  const inFlight = whisperInstallInFlight.get(whisperDir);
  if (inFlight) return inFlight;
  const task = (async () => {
    await installWhisperCpp({ version: WHISPER_CPP_VERSION, to: whisperDir, printOutput: false, signal: signal ?? null });
    const execPath = whisperExecutablePath(whisperDir);
    if (!existsSync(execPath)) {
      // eslint-disable-next-line no-console
      console.error(
        `[storyboards/remotion/whisper] whisper.cpp install at "${whisperDir}" is missing its executable ` +
          `(expected "${execPath}"). @remotion/install-whisper-cpp silently no-ops instead of reinstalling ` +
          `when the directory already exists but the binary doesn't (a half-finished install from a ` +
          `previous crashed run). Delete this directory to force a clean reinstall.`,
      );
      throw new Error("Whisper install is corrupted; clear the daemon's whisper cache and retry.");
    }
  })().finally(() => {
    if (whisperInstallInFlight.get(whisperDir) === task) whisperInstallInFlight.delete(whisperDir);
  });
  whisperInstallInFlight.set(whisperDir, task);
  return task;
}

export interface TranscribeLocallyInput {
  /** Absolute path to a 16kHz mono WAV file — whisper.cpp's expected input. */
  wavPath: string;
  /** Absolute directory the whisper.cpp binary + models are cached under. */
  cacheDir: string;
  model?: WhisperModel;
  /** Aborts the underlying install/download/transcribe child processes when triggered (review finding T1). */
  signal?: AbortSignal;
}

/** Builds/downloads whisper.cpp + the model on first use, then transcribes `wavPath` with word-level timestamps. */
export async function transcribeLocally({
  wavPath,
  cacheDir,
  model = DEFAULT_WHISPER_MODEL,
  signal,
}: TranscribeLocallyInput): Promise<Caption[]> {
  if (!path.isAbsolute(cacheDir)) {
    throw new Error(`transcribeLocally: cacheDir must be absolute, got "${cacheDir}"`);
  }
  const whisperDir = path.join(cacheDir, 'whisper-cpp');
  const modelDir = path.join(cacheDir, 'whisper-models');

  await ensureWhisperCppInstalled(whisperDir, signal);
  // Must exist before downloadWhisperModel runs — see the module doc comment above.
  await mkdir(modelDir, { recursive: true });
  await downloadWhisperModel({ model, folder: modelDir, printOutput: false, signal });

  const whisperCppOutput = await transcribe({
    inputPath: wavPath,
    whisperPath: whisperDir,
    whisperCppVersion: WHISPER_CPP_VERSION,
    model,
    modelFolder: modelDir,
    tokenLevelTimestamps: true,
    printOutput: false,
    signal,
  });

  return toCaptions({ whisperCppOutput }).captions;
}
