// Background media jobs (W7C, INV-7.6 / INV-7.14): heavy ffmpeg encodes and
// URL downloads run as `media_tasks` rows instead of inside the request
// turn. Two job kinds:
//
//   - encode: a whitelisted ffmpeg argument template (preset-selected) with
//     progress parsed from `-progress pipe:1` against a probed duration.
//   - download: an `https` (or test-only `http`) URL staged straight into
//     the target project directory, with progress from `Content-Length`.
//
// Every child is bounded by three env-resolved limits (`resolveMediaJobLimits`)
// and killed via SIGTERM -> SIGKILL escalation on breach or cancel, targeting
// the child's own process group so a real ffmpeg (which can fork helpers)
// cannot outlive the daemon's decision to stop it.
//
// This module is a NEW, standalone piece of the media surface: it does not
// import `connectionTest.ts` (that module's `validateBaseUrlResolved` /
// `assertAndFetchExternalAsset` carve out loopback for user-configured
// provider endpoints and upstream-response asset URLs; a media-job download
// URL is neither of those — it is untrusted, caller-supplied input that
// must not be able to reach the daemon's own loopback services under a
// hostname that merely resolves there in production). It reuses only the
// pure hostname classifiers from `@open-design/contracts`.

import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { lookup as realDnsLookup } from 'node:dns';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  isBlockedExternalApiHostname,
  isLoopbackApiHost,
} from '@open-design/contracts/api/connectionTest';
import type {
  MediaEncodeFrameInput,
  MediaEncodePreset,
  MediaJobLimits,
  MediaTaskErrorCode,
} from '@open-design/contracts';
import { validateProjectPath } from '../projects.js';

// ---------------------------------------------------------------------------
// Limits (INV-7.14) — resolved from env at use time, never cached, so a
// test (or an operator) that changes the env between calls is honored
// immediately.
// ---------------------------------------------------------------------------

export const DEFAULT_MEDIA_JOB_MAX_DURATION_MS = 30 * 60 * 1000;
export const DEFAULT_MEDIA_JOB_MAX_OUTPUT_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_MEDIA_JOB_MAX_CONCURRENT = 2;

function positiveIntFromEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function resolveMediaJobLimits(env: NodeJS.ProcessEnv = process.env): MediaJobLimits {
  return {
    maxDurationMs: positiveIntFromEnv(env.OD_MEDIA_JOB_MAX_DURATION_MS, DEFAULT_MEDIA_JOB_MAX_DURATION_MS),
    maxOutputBytes: positiveIntFromEnv(env.OD_MEDIA_JOB_MAX_OUTPUT_BYTES, DEFAULT_MEDIA_JOB_MAX_OUTPUT_BYTES),
    maxConcurrent: positiveIntFromEnv(env.OD_MEDIA_JOB_MAX_CONCURRENT, DEFAULT_MEDIA_JOB_MAX_CONCURRENT),
  };
}

// ---------------------------------------------------------------------------
// Concurrency + cancel tracking. One process-wide map keyed by taskId — the
// daemon runs as a single process, so this is the whole picture; a
// concurrency check reads its size, and cancel looks up its kill function.
// ---------------------------------------------------------------------------

interface ActiveMediaJobEntry {
  kill: () => void;
  /** Set once cancelMediaJob() has been called for this taskId. */
  canceled: boolean;
}
const activeJobs = new Map<string, ActiveMediaJobEntry>();

export function activeMediaJobCount(): number {
  return activeJobs.size;
}

/**
 * Registers the current kill function for a task. The route layer
 * registers a no-op placeholder synchronously at task creation (so the
 * concurrency count is accurate immediately), then replaces it once the
 * real child/connection exists (`onSpawned`/`onAbort`) — a call this
 * function makes AFTER a `buildEncodeArgs`/probe await, i.e. not
 * necessarily before a client's cancel request can arrive. If
 * cancelMediaJob() already ran against the PLACEHOLDER before this real
 * kill exists, that intent must not be lost: this re-registration invokes
 * the new kill immediately instead of silently overwriting a canceled
 * entry with an un-canceled one.
 */
export function registerActiveMediaJob(taskId: string, kill: () => void): void {
  const existing = activeJobs.get(taskId);
  if (existing?.canceled) {
    activeJobs.set(taskId, { kill, canceled: true });
    kill();
    return;
  }
  activeJobs.set(taskId, { kill, canceled: false });
}

export function unregisterActiveMediaJob(taskId: string): void {
  activeJobs.delete(taskId);
}

/** Looks up the active job by taskId and signals it. Returns false if no active job is tracked under that id (already terminal, or unknown). */
export function cancelMediaJob(taskId: string): boolean {
  const job = activeJobs.get(taskId);
  if (!job) return false;
  job.canceled = true;
  job.kill();
  return true;
}

// ---------------------------------------------------------------------------
// Shared outcome shape both job kinds resolve to.
// ---------------------------------------------------------------------------

export interface MediaJobFile {
  name: string;
  path: string;
  size: number;
  mtime: number;
  kind: string;
  mime: string;
}

export interface MediaJobOutcome {
  ok: boolean;
  file?: MediaJobFile;
  error?: { code: MediaTaskErrorCode; message: string };
}

// ---------------------------------------------------------------------------
// ffmpeg/ffprobe child runner — the one place that spawns, watches, and
// kills an encode child. Callers (the HTTP job route, the storyboard
// assemble migration) build their own argv per preset and hand it here so
// every encode/concat path shares one kill/timeout/progress implementation
// (INV-7.6's "documented limits" and "every rejection/kill identifies the
// breached limit" both live here, once).
// ---------------------------------------------------------------------------

const KILL_ESCALATION_MS = 2000;
// Grace window before delivering a SIGTERM that was requested before the
// child even existed (a cancel/limit that raced ahead of the async probe
// step completing) — a signal sent in the very same tick a process is
// spawned can kill it via the default disposition before it finishes
// loading and registers its own handler, silently skipping any cleanup
// the child does on SIGTERM. Applies only to that pre-spawn race; a
// cancel/limit against an already-running child signals it immediately.
const PRE_SPAWN_KILL_GRACE_MS = 150;

export interface RunFfmpegEncodeInput {
  ffmpegBin: string;
  ffprobeBin: string;
  /** Full ffmpeg argv (no binary name); MUST include `-progress pipe:1` and end with the output path. */
  args: string[];
  /** Full ffprobe argv (no binary name); MUST include `-show_entries`. Pass null to skip probing (fraction stays unreported). */
  probeArgs: string[] | null;
  maxDurationMs: number;
  onProgress?: ((line: string, fraction?: number) => void) | undefined;
}

export interface RunFfmpegEncodeHandle {
  promise: Promise<MediaJobOutcome>;
  kill: () => void;
}

/**
 * A binary path ending `.mjs`/`.js`/`.cjs` (only ever the test's committed
 * fake-ffmpeg/ffprobe fixture — real ffmpeg/ffprobe never end in those
 * extensions) is run through the current Node interpreter instead of
 * executed directly, so a checked-in script's executable bit is never
 * load-bearing for the test suite.
 */
function scriptAwareSpawn(
  bin: string,
  args: string[],
  options: NonNullable<Parameters<typeof spawn>[2]> | undefined,
): ChildProcess {
  const opts = options ?? {};
  if (/\.(mjs|cjs|js)$/i.test(bin)) {
    return spawn(process.execPath, [bin, ...args], opts);
  }
  return spawn(bin, args, opts);
}

async function probeDurationSeconds(ffprobeBin: string, probeArgs: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = scriptAwareSpawn(ffprobeBin, probeArgs, undefined);
    } catch {
      resolve(null);
      return;
    }
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += String(chunk);
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const value = Number.parseFloat(stdout.trim());
      resolve(Number.isFinite(value) && value > 0 ? value : null);
    });
  });
}

function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && typeof child.pid === 'number') {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to a direct child signal (e.g. the child was not
      // spawned as its own process group leader for some reason).
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Already gone.
  }
}

export function runFfmpegEncodeChild(input: RunFfmpegEncodeInput): RunFfmpegEncodeHandle {
  let killReason: 'limit' | 'cancel' | null = null;
  let settled = false;
  let termTimer: NodeJS.Timeout | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  let child: ChildProcess | null = null;

  const doKill = (signal: NodeJS.Signals) => {
    if (!child || settled) return;
    killProcessGroup(child, signal);
  };

  const beginKill = (reason: 'limit' | 'cancel') => {
    if (killReason) return;
    killReason = reason;
    doKill('SIGTERM');
    killTimer = setTimeout(() => doKill('SIGKILL'), KILL_ESCALATION_MS);
    killTimer.unref?.();
  };

  const promise = new Promise<MediaJobOutcome>((resolve) => {
    (async () => {
      const durationSeconds = input.probeArgs
        ? await probeDurationSeconds(input.ffprobeBin, input.probeArgs)
        : null;

      let spawned: ChildProcess;
      try {
        spawned = scriptAwareSpawn(input.ffmpegBin, input.args, { detached: process.platform !== 'win32' });
      } catch (err) {
        resolve({
          ok: false,
          error: {
            code: 'FFMPEG_NOT_FOUND',
            message: `could not start ffmpeg binary "${input.ffmpegBin}": ${String((err as Error)?.message ?? err)}`,
          },
        });
        return;
      }
      child = spawned;

      // A cancel (or, in principle, a limit) can arrive while this
      // function was still awaiting probeDurationSeconds — `child` was
      // null then, so doKill() above was a no-op even though killReason
      // got set. Now that the real child exists, honor that decision — but
      // not in the same tick: a freshly spawned process has not finished
      // loading (registering its own SIGTERM handler) yet, and a signal
      // sent before that point kills it via the default disposition
      // instead of the graceful path a real ffmpeg (or this fixture) uses
      // to clean up. A short grace delay lets that finish first; this
      // path is the pre-spawn race only — a cancel/limit that arrives
      // after the child is already running signals it immediately below.
      if (killReason) {
        const preSpawnKillGraceTimer = setTimeout(() => doKill('SIGTERM'), PRE_SPAWN_KILL_GRACE_MS);
        preSpawnKillGraceTimer.unref?.();
        killTimer = setTimeout(() => doKill('SIGKILL'), PRE_SPAWN_KILL_GRACE_MS + KILL_ESCALATION_MS);
        killTimer.unref?.();
      }

      if (Number.isFinite(input.maxDurationMs) && input.maxDurationMs > 0) {
        termTimer = setTimeout(() => beginKill('limit'), input.maxDurationMs);
        termTimer.unref?.();
      }

      let stdoutBuf = '';
      let stderrBuf = '';

      spawned.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuf += String(chunk);
        let idx = stdoutBuf.indexOf('\n');
        while (idx >= 0) {
          const line = stdoutBuf.slice(0, idx).trim();
          stdoutBuf = stdoutBuf.slice(idx + 1);
          idx = stdoutBuf.indexOf('\n');
          if (!line) continue;
          const eq = line.indexOf('=');
          if (eq < 0) continue;
          const key = line.slice(0, eq);
          const value = line.slice(eq + 1);
          if (key === 'out_time_ms') {
            const ms = Number(value);
            if (Number.isFinite(ms)) {
              if (durationSeconds) {
                const fraction = Math.max(0, Math.min(1, ms / 1_000_000 / durationSeconds));
                input.onProgress?.(`encoding: ${Math.round(fraction * 100)}%`, fraction);
              } else {
                input.onProgress?.(`encoding: ${(ms / 1_000_000).toFixed(1)}s`);
              }
            }
          }
        }
      });
      spawned.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += String(chunk);
      });

      spawned.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(termTimer);
        clearTimeout(killTimer);
        if (err?.code === 'ENOENT') {
          resolve({
            ok: false,
            error: { code: 'FFMPEG_NOT_FOUND', message: `ffmpeg binary not found: ${input.ffmpegBin}` },
          });
        } else {
          resolve({ ok: false, error: { code: 'INVALID_REQUEST', message: String(err?.message ?? err) } });
        }
      });

      spawned.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(termTimer);
        clearTimeout(killTimer);
        if (killReason === 'limit') {
          resolve({
            ok: false,
            error: {
              code: 'LIMIT_EXCEEDED',
              message: `OD_MEDIA_JOB_MAX_DURATION_MS exceeded (limit ${input.maxDurationMs}ms)`,
            },
          });
          return;
        }
        if (killReason === 'cancel') {
          resolve({ ok: false, error: { code: 'CANCELED', message: 'media job canceled' } });
          return;
        }
        if (code === 0) {
          resolve({ ok: true });
        } else {
          resolve({
            ok: false,
            error: { code: 'INVALID_REQUEST', message: stderrBuf.trim() || `ffmpeg exited with code ${code}` },
          });
        }
      });
    })().catch((err: unknown) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: { code: 'INVALID_REQUEST', message: String(err instanceof Error ? err.message : err) } });
    });
  });

  return { promise, kill: () => beginKill('cancel') };
}

// ---------------------------------------------------------------------------
// Preset argument templates for the HTTP-facing encode job. `assemble.ts`'s
// concat-copy migration builds its OWN argv (it already owns the concat
// list file and absolute path resolution) and calls runFfmpegEncodeChild
// directly instead of going through this preset builder.
// ---------------------------------------------------------------------------

export interface EncodeJobRequestLike {
  preset: MediaEncodePreset;
  input?: string;
  output: string;
  inputs?: string[];
  frames?: MediaEncodeFrameInput[];
  scale?: { width: number; height: number };
}

interface BuiltEncodeArgs {
  encodeArgs: string[];
  probeArgs: string[] | null;
  outputAbs: string;
  /** A per-job scratch file (concat-copy/frames-to-mp4's list file) that must be removed once the child settles, win or lose. `null` for presets (h264-web) with no scratch file. */
  scratchFile: string | null;
}

function ffmpegBinFromEnv(): string {
  return process.env.OD_MEDIA_JOB_FFMPEG_BIN || 'ffmpeg';
}
function ffprobeBinFromEnv(): string {
  return process.env.OD_MEDIA_JOB_FFPROBE_BIN || 'ffprobe';
}

function resolveProjectRelative(projectDir: string, rel: string): string | null {
  try {
    const safe = validateProjectPath(rel);
    return path.join(projectDir, safe);
  } catch {
    return null;
  }
}

/** Public alias — the route layer uses this for the pre-flight 409 CONFLICT check before any child starts. */
export function resolveMediaJobPath(projectDir: string, rel: string): string | null {
  return resolveProjectRelative(projectDir, rel);
}

export async function mediaJobOutputExists(absPath: string): Promise<boolean> {
  return stat(absPath).then(
    () => true,
    () => false,
  );
}

function scaleFilterArgs(scale?: { width: number; height: number }): string[] {
  if (!scale || !Number.isFinite(scale.width) || !Number.isFinite(scale.height)) return [];
  return ['-vf', `scale=${Math.round(scale.width)}:${Math.round(scale.height)}`];
}

async function buildEncodeArgs(
  projectDir: string,
  request: EncodeJobRequestLike,
  overwrite: boolean,
): Promise<{ ok: true; built: BuiltEncodeArgs } | { ok: false; error: { code: MediaTaskErrorCode; message: string } }> {
  const outputAbs = resolveProjectRelative(projectDir, request.output);
  if (!outputAbs) {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: `invalid output path: ${request.output}` } };
  }
  if (!overwrite) {
    const exists = await stat(outputAbs).then(
      () => true,
      () => false,
    );
    if (exists) {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: `output already exists: ${request.output}` } };
    }
  }

  if (request.preset === 'h264-web') {
    if (!request.input) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'h264-web requires input' } };
    const inputAbs = resolveProjectRelative(projectDir, request.input);
    if (!inputAbs) return { ok: false, error: { code: 'INVALID_REQUEST', message: `invalid input path: ${request.input}` } };
    return {
      ok: true,
      built: {
        probeArgs: ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', inputAbs],
        encodeArgs: [
          '-y',
          '-i',
          inputAbs,
          ...scaleFilterArgs(request.scale),
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '23',
          '-c:a',
          'aac',
          '-movflags',
          '+faststart',
          '-progress',
          'pipe:1',
          '-nostats',
          outputAbs,
        ],
        outputAbs,
        scratchFile: null,
      },
    };
  }

  if (request.preset === 'concat-copy') {
    const inputs = request.inputs ?? [];
    if (inputs.length === 0) {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: 'concat-copy requires a non-empty inputs list' } };
    }
    const resolvedInputs: string[] = [];
    for (const rel of inputs) {
      const abs = resolveProjectRelative(projectDir, rel);
      if (!abs) return { ok: false, error: { code: 'INVALID_REQUEST', message: `invalid concat input path: ${rel}` } };
      resolvedInputs.push(abs);
    }
    const listFile = path.join(projectDir, `.media-job-concat-${randomUUID()}.txt`);
    const listBody = resolvedInputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    await mkdir(path.dirname(listFile), { recursive: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(listFile, listBody, 'utf8');
    return {
      ok: true,
      built: {
        probeArgs: ['-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1'],
        encodeArgs: ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-progress', 'pipe:1', '-nostats', outputAbs],
        outputAbs,
        scratchFile: listFile,
      },
    };
  }

  // frames-to-mp4
  const frames = request.frames ?? [];
  if (frames.length === 0) {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: 'frames-to-mp4 requires a non-empty frames list' } };
  }
  const resolvedFrames: Array<{ abs: string; durationMs: number }> = [];
  for (const frame of frames) {
    const abs = resolveProjectRelative(projectDir, frame.path);
    if (!abs) return { ok: false, error: { code: 'INVALID_REQUEST', message: `invalid frame path: ${frame.path}` } };
    resolvedFrames.push({ abs, durationMs: frame.durationMs });
  }
  const listFile = path.join(projectDir, `.media-job-frames-${randomUUID()}.txt`);
  const lines: string[] = [];
  for (const frame of resolvedFrames) {
    lines.push(`file '${frame.abs.replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${Math.max(0.01, frame.durationMs / 1000)}`);
  }
  // The concat demuxer ignores the final `duration` line unless the last
  // frame is repeated once more without one — a well-documented quirk.
  const lastFrame = resolvedFrames[resolvedFrames.length - 1];
  if (lastFrame) lines.push(`file '${lastFrame.abs.replace(/'/g, "'\\''")}'`);
  const { writeFile } = await import('node:fs/promises');
  await mkdir(path.dirname(listFile), { recursive: true });
  await writeFile(listFile, lines.join('\n'), 'utf8');
  return {
    ok: true,
    built: {
      probeArgs: null,
      encodeArgs: [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFile,
        ...scaleFilterArgs(request.scale),
        '-vsync',
        'vfr',
        '-pix_fmt',
        'yuv420p',
        '-progress',
        'pipe:1',
        '-nostats',
        outputAbs,
      ],
      outputAbs,
      scratchFile: listFile,
    },
  };
}

export interface RunMediaEncodeJobInput {
  projectDir: string;
  request: EncodeJobRequestLike;
  overwrite?: boolean;
  maxDurationMs: number;
  onProgress?: ((line: string, fraction?: number) => void) | undefined;
  /** Called synchronously with a kill function once the child is spawned, so the caller can wire up cancel. */
  onSpawned?: ((kill: () => void) => void) | undefined;
}

export async function runMediaEncodeJob(input: RunMediaEncodeJobInput): Promise<MediaJobOutcome> {
  const built = await buildEncodeArgs(input.projectDir, input.request, input.overwrite === true);
  if (!built.ok) return { ok: false, error: built.error };

  // concat-copy/frames-to-mp4 write a per-job scratch list file
  // (built.built.scratchFile) into the project directory; it must be
  // removed once the child settles, win or lose — mirrors
  // storyboards/assemble.ts's runConcatAssemble, which removes its own
  // concat list file in a finally block.
  try {
    const handle = runFfmpegEncodeChild({
      ffmpegBin: ffmpegBinFromEnv(),
      ffprobeBin: ffprobeBinFromEnv(),
      args: built.built.encodeArgs,
      probeArgs: built.built.probeArgs,
      maxDurationMs: input.maxDurationMs,
      onProgress: input.onProgress,
    });
    input.onSpawned?.(handle.kill);

    const outcome = await handle.promise;
    if (!outcome.ok) {
      await rm(built.built.outputAbs, { force: true }).catch(() => {});
      return outcome;
    }
    const stats = await stat(built.built.outputAbs);
    return {
      ok: true,
      file: {
        name: path.basename(built.built.outputAbs),
        path: input.request.output,
        size: stats.size,
        mtime: stats.mtimeMs,
        kind: 'video',
        mime: 'video/mp4',
      },
    };
  } finally {
    if (built.built.scratchFile) {
      await rm(built.built.scratchFile, { force: true }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Download job — a stricter sibling of connectionTest.ts's
// assertAndFetchExternalAsset for a USER-SUPPLIED download URL, not an
// upstream-response asset URL. Unlike that function's loopback carve-out
// (deliberate there, for local model servers a user configured), a literal
// loopback/private/link-local/CGNAT/metadata host is rejected outright
// here, before any connection is attempted. The `lookup` parameter mirrors
// Node's own `dns.lookup` callback shape (and `http.request`'s `lookup`
// option) so a caller can inject a resolver — used ONLY by
// apps/daemon/tests/media/jobs.test.ts to point a test hostname at a local
// fixture server; it is a parameter of this internal module, never
// reachable through CreateMediaJobRequest or any HTTP field, so no request
// from a real client can supply it. Every redirect hop re-validates the
// same way, capped at 3 follows.
// ---------------------------------------------------------------------------

export type DnsLookupCallback = (
  hostname: string,
  options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void,
) => void;

function isIpLiteralHostname(hostname: string): boolean {
  const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(':');
}

function resolveHostname(lookup: DnsLookupCallback, hostname: string): Promise<string[]> {
  return new Promise((resolve) => {
    lookup(hostname, { all: true, family: 0 }, (err, address) => {
      if (err || address == null) {
        resolve([]);
        return;
      }
      if (Array.isArray(address)) {
        resolve(
          address.map((entry) =>
            typeof entry === 'string' ? entry : String((entry as { address?: unknown })?.address ?? ''),
          ),
        );
        return;
      }
      resolve([String(address)]);
    });
  });
}

/**
 * Resolves `hostname` and validates it, returning the concrete address the
 * request will actually connect to. Connecting to THIS address (rather than
 * handing `lookup` to Node's own `net.connect` and hoping it re-resolves
 * the same way) also closes the classic DNS-rebinding TOCTOU gap: the
 * address that was validated is the address the socket opens against, not
 * a second, independent resolution.
 */
async function assertDownloadHostAllowed(
  hostname: string,
  lookup: DnsLookupCallback,
): Promise<{ ok: true; connectHost: string } | { ok: false; message: string }> {
  const host = hostname.toLowerCase();
  if (isIpLiteralHostname(host)) {
    if (isLoopbackApiHost(host) || isBlockedExternalApiHostname(host)) {
      return { ok: false, message: `blocked download host: ${hostname}` };
    }
    return { ok: true, connectHost: host };
  }
  const addresses = await resolveHostname(lookup, host);
  if (addresses.length === 0) {
    return { ok: false, message: `could not resolve download host: ${hostname}` };
  }
  for (const addr of addresses) {
    const lowerAddr = addr.toLowerCase();
    if (isLoopbackApiHost(lowerAddr) || isBlockedExternalApiHostname(lowerAddr)) {
      return { ok: false, message: `blocked download host: ${hostname} resolves to ${addr}` };
    }
  }
  const first = addresses[0];
  if (!first) return { ok: false, message: `could not resolve download host: ${hostname}` };
  return { ok: true, connectHost: first };
}

interface SingleGetResult {
  res?: http.IncomingMessage;
  error?: string;
}

/**
 * Fetches `urlStr` by connecting directly to `connectHost` (the address
 * {@link assertDownloadHostAllowed} already validated) rather than handing a
 * `lookup` override to Node's own connect path — Node's `net.connect` calls
 * a custom `lookup` with `{ all: true }` and expects the multi-address array
 * callback form, which a hostname->single-IP test stub does not have to
 * implement, and every other caller gets exactly the address that was
 * validated instead of a second, independent resolution. `servername` keeps
 * TLS SNI correct for an `https:` URL connected to by IP.
 */
function httpGetOnce(urlStr: string, connectHost: string, timeoutMs: number): Promise<SingleGetResult> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      resolve({ error: `invalid url: ${urlStr}` });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      resolve({ error: `unsupported protocol: ${parsed.protocol}` });
      return;
    }
    const mod = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
    const req = mod.get(
      {
        hostname: connectHost,
        port,
        path: `${parsed.pathname}${parsed.search}`,
        headers: { host: parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname },
        ...(parsed.protocol === 'https:' ? { servername: parsed.hostname } : {}),
        timeout: Math.max(1, timeoutMs),
      },
      (res) => {
        if (settled) return;
        settled = true;
        resolve({ res });
      },
    );
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ error: String((err as Error)?.message ?? err) });
    });
    req.on('timeout', () => {
      if (settled) return;
      settled = true;
      req.destroy();
      resolve({ error: 'request timed out' });
    });
  });
}

export interface RunMediaDownloadJobInput {
  projectDir: string;
  url: string;
  outputRel: string;
  maxOutputBytes: number;
  maxDurationMs: number;
  /** Node dns.lookup-shaped resolver override. Test-only in practice — see module docblock. */
  lookup?: DnsLookupCallback;
  onProgress?: ((line: string, fraction?: number) => void) | undefined;
  /** Called once a connection is open, with an abort function the caller can wire up to cancel. */
  onAbort?: ((abort: () => void) => void) | undefined;
}

const MAX_DOWNLOAD_HOPS = 3;

export async function runMediaDownloadJob(input: RunMediaDownloadJobInput): Promise<MediaJobOutcome> {
  const lookup = input.lookup ?? (realDnsLookup as unknown as DnsLookupCallback);
  const outputAbs = resolveProjectRelative(input.projectDir, input.outputRel);
  if (!outputAbs) {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: `invalid output path: ${input.outputRel}` } };
  }
  const tmpAbs = `${outputAbs}.partial-${randomUUID()}`;
  const deadline = Date.now() + Math.max(1, input.maxDurationMs);

  let currentUrl = input.url;
  let hop = 0;
  try {
    for (;;) {
      hop += 1;
      if (hop > MAX_DOWNLOAD_HOPS) {
        return { ok: false, error: { code: 'INVALID_REQUEST', message: `too many redirects (max ${MAX_DOWNLOAD_HOPS})` } };
      }

      let hostname: string;
      try {
        hostname = new URL(currentUrl).hostname;
      } catch {
        return { ok: false, error: { code: 'INVALID_REQUEST', message: `invalid url: ${currentUrl}` } };
      }
      const hostCheck = await assertDownloadHostAllowed(hostname, lookup);
      if (!hostCheck.ok) {
        return { ok: false, error: { code: 'INVALID_REQUEST', message: hostCheck.message } };
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return {
          ok: false,
          error: { code: 'LIMIT_EXCEEDED', message: `OD_MEDIA_JOB_MAX_DURATION_MS exceeded (limit ${input.maxDurationMs}ms)` },
        };
      }

      const attempt = await httpGetOnce(currentUrl, hostCheck.connectHost, remaining);
      if (!attempt.res) {
        return { ok: false, error: { code: 'UPSTREAM_ERROR', message: attempt.error ?? 'download request failed' } };
      }
      const res = attempt.res;
      let aborted = false;
      input.onAbort?.(() => {
        aborted = true;
        res.destroy();
      });
      const status = res.statusCode ?? 0;

      if (status >= 300 && status < 400 && typeof res.headers.location === 'string') {
        const nextUrl = new URL(res.headers.location, currentUrl).toString();
        res.resume();
        currentUrl = nextUrl;
        continue;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return { ok: false, error: { code: 'UPSTREAM_ERROR', message: `upstream responded ${status}` } };
      }

      const declaredLengthRaw = res.headers['content-length'];
      const declaredLength = typeof declaredLengthRaw === 'string' ? Number(declaredLengthRaw) : NaN;
      if (Number.isFinite(declaredLength) && declaredLength > input.maxOutputBytes) {
        res.resume();
        return {
          ok: false,
          error: {
            code: 'LIMIT_EXCEEDED',
            message: `OD_MEDIA_JOB_MAX_OUTPUT_BYTES exceeded: declared ${declaredLength} > limit ${input.maxOutputBytes}`,
          },
        };
      }

      await mkdir(path.dirname(tmpAbs), { recursive: true });
      const streamed = await streamResponseToFile(res, tmpAbs, {
        maxOutputBytes: input.maxOutputBytes,
        deadline,
        declaredLength: Number.isFinite(declaredLength) ? declaredLength : undefined,
        onProgress: input.onProgress,
        isCanceled: () => aborted,
      });
      if (!streamed.ok) {
        await rm(tmpAbs, { force: true }).catch(() => {});
        return streamed;
      }
      await rename(tmpAbs, outputAbs);
      const stats = await stat(outputAbs);
      const contentType = res.headers['content-type'];
      return {
        ok: true,
        file: {
          name: path.basename(outputAbs),
          path: input.outputRel,
          size: stats.size,
          mtime: stats.mtimeMs,
          kind: 'binary',
          mime: typeof contentType === 'string' ? contentType.split(';')[0]!.trim() : 'application/octet-stream',
        },
      };
    }
  } catch (err) {
    await rm(tmpAbs, { force: true }).catch(() => {});
    return { ok: false, error: { code: 'UPSTREAM_ERROR', message: String(err instanceof Error ? err.message : err) } };
  }
}

function streamResponseToFile(
  res: http.IncomingMessage,
  tmpAbs: string,
  options: {
    maxOutputBytes: number;
    deadline: number;
    declaredLength?: number | undefined;
    onProgress?: ((line: string, fraction?: number) => void) | undefined;
    isCanceled?: (() => boolean) | undefined;
  },
): Promise<MediaJobOutcome> {
  return new Promise((resolve) => {
    let received = 0;
    let settled = false;
    const out = createWriteStream(tmpAbs);

    const finish = (outcome: MediaJobOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      resolve(outcome);
    };

    const deadlineTimer = setTimeout(
      () => {
        res.destroy();
        out.destroy();
        finish({
          ok: false,
          error: { code: 'LIMIT_EXCEEDED', message: 'OD_MEDIA_JOB_MAX_DURATION_MS exceeded during transfer' },
        });
      },
      Math.max(0, options.deadline - Date.now()),
    );
    deadlineTimer.unref?.();

    res.on('data', (chunk: Buffer) => {
      if (settled) return;
      received += chunk.length;
      if (received > options.maxOutputBytes) {
        res.destroy();
        out.destroy();
        finish({
          ok: false,
          error: {
            code: 'LIMIT_EXCEEDED',
            message: `OD_MEDIA_JOB_MAX_OUTPUT_BYTES exceeded: streamed past limit ${options.maxOutputBytes}`,
          },
        });
        return;
      }
      const fraction = options.declaredLength && options.declaredLength > 0 ? Math.min(1, received / options.declaredLength) : undefined;
      options.onProgress?.(`downloaded ${received} bytes`, fraction);
    });
    res.on('error', (err) => {
      out.destroy();
      if (options.isCanceled?.()) {
        finish({ ok: false, error: { code: 'CANCELED', message: 'media job canceled' } });
        return;
      }
      finish({ ok: false, error: { code: 'UPSTREAM_ERROR', message: String((err as Error)?.message ?? err) } });
    });
    out.on('error', (err) => {
      res.destroy();
      finish({ ok: false, error: { code: 'UPSTREAM_ERROR', message: String((err as Error)?.message ?? err) } });
    });
    out.on('finish', () => finish({ ok: true }));
    res.pipe(out);
  });
}
