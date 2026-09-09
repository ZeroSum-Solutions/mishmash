import type { ProjectFile } from './files.js';

export const MEDIA_EXECUTION_MODES = [
  'enabled',
  'disabled',
] as const;

export type MediaExecutionMode = (typeof MEDIA_EXECUTION_MODES)[number];

export const MEDIA_SURFACES = [
  'image',
  'video',
  'audio',
] as const;

export type MediaSurface = (typeof MEDIA_SURFACES)[number];

export const MEDIA_POLICY_DENIAL_CODES = [
  'MEDIA_EXECUTION_DISABLED',
  'MEDIA_SURFACE_DENIED',
  'MEDIA_MODEL_DENIED',
] as const;

export type MediaPolicyDenialCode = (typeof MEDIA_POLICY_DENIAL_CODES)[number];

/**
 * Run-scoped policy controlling Open Design-owned media generation only.
 *
 * `allowedSurfaces` and `allowedModels` apply solely to `/api/tools/media/generate`
 * and in-run `od media generate`. External MCP media tools are intentionally
 * unaffected: provider policy for those belongs to the MCP server / orchestrator.
 */
export interface MediaExecutionPolicy {
  mode: MediaExecutionMode;
  allowedSurfaces?: MediaSurface[];
  allowedModels?: string[];
}

export const DEFAULT_MEDIA_EXECUTION_POLICY: MediaExecutionPolicy = {
  mode: 'enabled',
};

export interface MediaPolicyTarget {
  surface: MediaSurface;
  model?: string;
}

export interface MediaPolicyDenial {
  code: MediaPolicyDenialCode;
  message: string;
}

export function mediaExecutionPolicyDenial(
  policy: MediaExecutionPolicy,
  target: MediaPolicyTarget,
): MediaPolicyDenial | null {
  if (policy.mode === 'disabled') {
    return {
      code: 'MEDIA_EXECUTION_DISABLED',
      message: 'media generation is disabled for this run',
    };
  }
  if (
    Array.isArray(policy.allowedSurfaces) &&
    policy.allowedSurfaces.length > 0 &&
    !policy.allowedSurfaces.includes(target.surface)
  ) {
    return {
      code: 'MEDIA_SURFACE_DENIED',
      message: `media surface "${target.surface}" is not allowed for this run`,
    };
  }
  if (
    target.model &&
    Array.isArray(policy.allowedModels) &&
    policy.allowedModels.length > 0 &&
    !policy.allowedModels.includes(target.model)
  ) {
    return {
      code: 'MEDIA_MODEL_DENIED',
      message: `media model "${target.model}" is not allowed for this run`,
    };
  }
  return null;
}

// Public (masked) media provider configuration served by GET /api/media/config
// and returned by PUT /api/media/config
// (`apps/daemon/src/routes/media.ts`, built by `readMaskedConfig` in
// `apps/daemon/src/media/config.ts`). API keys never leave the daemon: the
// entry carries only whether a key is configured, where it came from, and the
// last four characters when the key is stored locally.
//
// These lived as private interfaces in `apps/web/src/state/config.ts` until
// DEF-3.3, and that copy also predated `aliases`, so the web app could not see
// the alias attribution the daemon has emitted since #1277.

/** Model alias map: alias name to the concrete model id it resolves to. */
export type MediaModelAliasMap = Record<string, string>;

/**
 * One provider row of the masked config.
 *
 * Every field except `model` is unconditional on the wire: `readMaskedConfig`
 * builds the row for each id in `PROVIDER_IDS` and always writes `configured`,
 * `source`, `apiKeyTail` and `baseUrl`. The web-private copy this replaced
 * declared them all optional, which is why every read site there still guards
 * with `?.` -- the optionality was defensive coding, not the wire.
 */
export interface PublicMediaProviderConfigEntry {
  configured: boolean;
  /** `'env'`, `'stored'`, an external-credential source, or `'unset'`. */
  source: string;
  /** Last four characters, and only for a locally stored key; else `''`. */
  apiKeyTail: string;
  baseUrl: string;
  model?: string;
}

/**
 * Alias attribution, so Settings can badge each entry "from env" or "from
 * media-config.json" without a second request. `effective` is `stored`
 * overlaid by `env`.
 */
export interface PublicMediaProviderAliases {
  effective: MediaModelAliasMap;
  env: MediaModelAliasMap;
  stored: MediaModelAliasMap;
}

export interface PublicMediaProviderConfigResponse {
  providers: Record<string, PublicMediaProviderConfigEntry>;
  aliases: PublicMediaProviderAliases;
}

function isMediaConfigRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMediaModelAliasMap(value: unknown): value is MediaModelAliasMap {
  return (
    isMediaConfigRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

export function isPublicMediaProviderConfigEntry(
  value: unknown,
): value is PublicMediaProviderConfigEntry {
  if (!isMediaConfigRecord(value)) return false;
  if (typeof value.configured !== 'boolean') return false;
  for (const key of ['source', 'apiKeyTail', 'baseUrl'] as const) {
    if (typeof value[key] !== 'string') return false;
  }
  if (value.model !== undefined && typeof value.model !== 'string') return false;
  return true;
}

export function isPublicMediaProviderAliases(
  value: unknown,
): value is PublicMediaProviderAliases {
  if (!isMediaConfigRecord(value)) return false;
  return (
    isMediaModelAliasMap(value.effective) &&
    isMediaModelAliasMap(value.env) &&
    isMediaModelAliasMap(value.stored)
  );
}

export function isPublicMediaProviderConfigResponse(
  value: unknown,
): value is PublicMediaProviderConfigResponse {
  if (!isMediaConfigRecord(value)) return false;
  const { providers, aliases } = value;
  if (!isMediaConfigRecord(providers)) return false;
  if (!Object.values(providers).every(isPublicMediaProviderConfigEntry)) return false;
  return isPublicMediaProviderAliases(aliases);
}

// ---------------------------------------------------------------------------
// Media tasks — the daemon-authoritative background-job wire (W7C, INV-7.6 /
// INV-7.14). Moves the shape that used to live web-private in
// apps/web/src/providers/registry.ts (DEF-7.3) into contracts so the daemon's
// three previously-divergent response shapes (`/wait`, the project task
// list, and the CLI's own untyped reader) converge on one snapshot. Mirrors
// the `LibraryTaskSnapshot` precedent in ./library.js (`LibraryTaskStatus`,
// `LibraryTaskError`, `LibraryTaskSnapshot`) with the additions media jobs
// need: an optional aggregate `fraction`, the written `file`, and the named
// job limits.
// ---------------------------------------------------------------------------

export const MEDIA_TASK_STATUSES = [
  'queued',
  'running',
  'done',
  'failed',
  'interrupted',
] as const;

export type MediaTaskStatus = (typeof MEDIA_TASK_STATUSES)[number];

export const MEDIA_TASK_ERROR_CODES = [
  'LIMIT_EXCEEDED',
  'CANCELED',
  'INVALID_REQUEST',
  'UPSTREAM_ERROR',
  'FFMPEG_NOT_FOUND',
  'DAEMON_RESTART',
  // The task exists but is not one of THIS route's tracked encode/download
  // jobs (a media-generation task, or a task another surface persisted to
  // the shared media_tasks table without registering it as a killable
  // encode/download job — e.g. a video-import download). `POST
  // /api/media/tasks/:id/cancel` answers 409 with this code rather than
  // silently no-op-ing and reporting `canceled` while the underlying work
  // keeps running (integration-grok-r1 finding 1).
  'NOT_CANCELABLE',
] as const;

export type MediaTaskErrorCode = (typeof MEDIA_TASK_ERROR_CODES)[number];

export interface MediaTaskError {
  code: MediaTaskErrorCode;
  message: string;
}

/**
 * The one shape every media-task read surface returns: `POST
 * /api/media/tasks/:id/wait`, `GET /api/projects/:id/media/tasks` (list),
 * and the CLI's `pollUntilDoneOrBudget` reader. `progress` stays a plain
 * `string[]` exactly as it is today — no per-entry progress objects — with
 * `fraction` as an optional aggregate alongside it, so a row persisted
 * before this wave (bare `string[]`, no `fraction`, and no `file` key at
 * all while non-terminal) still validates through {@link isMediaTaskSnapshot}
 * unchanged. `kind` distinguishes a media-generation task (`'generate'`,
 * the pre-existing surface) from the two NEW job kinds this track adds.
 */
export interface MediaTaskSnapshot {
  taskId: string;
  status: MediaTaskStatus;
  startedAt: number;
  endedAt: number | null;
  /** Human-readable progress lines, append-only. */
  progress: string[];
  /** Optional aggregate progress in [0, 1], when the task can compute one. */
  fraction?: number;
  /** Cursor for the next `/wait` call's `since`. */
  nextSince: number;
  /** Present once `status` is `'done'`; `null` otherwise (including pre-terminal states). */
  file: ProjectFile | null;
  error?: MediaTaskError;
  kind?: 'generate' | 'encode' | 'download';
  /** The resolved limits that governed this task, when it is an encode/download job. */
  limits?: MediaJobLimits;
}

export interface MediaTaskListResponse {
  tasks: MediaTaskSnapshot[];
}

/**
 * The daemon-resolved values behind `OD_MEDIA_JOB_MAX_DURATION_MS`,
 * `OD_MEDIA_JOB_MAX_OUTPUT_BYTES`, and `OD_MEDIA_JOB_MAX_CONCURRENT`
 * (INV-7.14). Served by `GET /api/media/jobs/limits`; `od media --help` and
 * `docs/subprocess-limits.md` must name the same env vars and defaults.
 */
export interface MediaJobLimits {
  maxDurationMs: number;
  maxOutputBytes: number;
  maxConcurrent: number;
}

export const MEDIA_ENCODE_PRESETS = ['h264-web', 'concat-copy', 'frames-to-mp4'] as const;

export type MediaEncodePreset = (typeof MEDIA_ENCODE_PRESETS)[number];

export interface MediaEncodeFrameInput {
  path: string;
  durationMs: number;
}

/**
 * `POST /api/projects/:id/media/jobs` request. A discriminated union on
 * `kind`: `'encode'` runs a whitelisted ffmpeg argument template against
 * project-relative paths; `'download'` fetches an `https` URL into a
 * project-relative path. An `output` that already exists without
 * `overwrite: true` is rejected (409 `CONFLICT`) before any child starts.
 */
export type CreateMediaJobRequest =
  | {
      kind: 'encode';
      /** Project-relative input path. */
      input: string;
      /** Project-relative output path. */
      output: string;
      preset: MediaEncodePreset;
      overwrite?: boolean;
      /** `concat-copy` only: ordered project-relative input paths. */
      inputs?: string[];
      /** `frames-to-mp4` only: ordered frame sequence. */
      frames?: MediaEncodeFrameInput[];
      scale?: { width: number; height: number };
    }
  | {
      kind: 'download';
      /** Must be `https:` (or a test-only `http:` fixture host). */
      url: string;
      /** Project-relative output path. */
      output: string;
      overwrite?: boolean;
    };

export interface CreateMediaJobResponse {
  taskId: string;
  status: MediaTaskStatus;
  startedAt: number;
}

/**
 * `POST /api/media/tasks/:id/cancel` response when the task is real but is
 * not one of this route's tracked encode/download jobs. 409, not 404: the
 * task itself exists, only the cancel request is refused. `task` carries the
 * current, unchanged snapshot so the caller can see what is still running.
 */
export interface MediaTaskCancelRefusedResponse {
  error: { code: 'NOT_CANCELABLE'; message: string };
  task: MediaTaskSnapshot;
}

function isMediaRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isMediaTaskErrorLike(value: unknown): value is MediaTaskError {
  if (!isMediaRecord(value)) return false;
  // Deliberately lenient on `code`: checked for presence/type, not pinned to
  // MEDIA_TASK_ERROR_CODES, so a historical error row (e.g. from the
  // pre-existing media-generation path, which predates this closed set)
  // still validates rather than being rejected by a guard written after it.
  return typeof value.code === 'string' && typeof value.message === 'string';
}

function isProjectFileLike(value: unknown): boolean {
  if (!isMediaRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    typeof value.size === 'number' &&
    typeof value.mtime === 'number' &&
    typeof value.kind === 'string' &&
    typeof value.mime === 'string'
  );
}

/**
 * Runtime guard for {@link MediaTaskSnapshot}. Deliberately more lenient
 * than the type in two places, both for pre-this-wave backward
 * compatibility: `file` may be entirely ABSENT (older snapshots only ever
 * set it once `status === 'done'`) as well as `null` or a `ProjectFile`;
 * `fraction` may be absent. Every other required field is checked strictly.
 */
export function isMediaTaskSnapshot(value: unknown): value is MediaTaskSnapshot {
  if (!isMediaRecord(value)) return false;
  if (typeof value.taskId !== 'string') return false;
  if (!MEDIA_TASK_STATUSES.includes(value.status as MediaTaskStatus)) return false;
  if (typeof value.startedAt !== 'number') return false;
  if (value.endedAt !== null && typeof value.endedAt !== 'number') return false;
  if (!isStringArray(value.progress)) return false;
  if (value.fraction !== undefined && typeof value.fraction !== 'number') return false;
  if (typeof value.nextSince !== 'number') return false;
  if ('file' in value && value.file !== null && value.file !== undefined && !isProjectFileLike(value.file)) {
    return false;
  }
  if (value.error !== undefined && !isMediaTaskErrorLike(value.error)) return false;
  return true;
}

export function isMediaTaskListResponse(value: unknown): value is MediaTaskListResponse {
  if (!isMediaRecord(value)) return false;
  return Array.isArray(value.tasks) && value.tasks.every(isMediaTaskSnapshot);
}

export function isMediaJobLimits(value: unknown): value is MediaJobLimits {
  if (!isMediaRecord(value)) return false;
  return (
    typeof value.maxDurationMs === 'number' &&
    typeof value.maxOutputBytes === 'number' &&
    typeof value.maxConcurrent === 'number'
  );
}

export function isMediaTaskCancelRefusedResponse(
  value: unknown,
): value is MediaTaskCancelRefusedResponse {
  if (!isMediaRecord(value)) return false;
  const { error, task } = value;
  if (!isMediaRecord(error) || error.code !== 'NOT_CANCELABLE' || typeof error.message !== 'string') {
    return false;
  }
  return isMediaTaskSnapshot(task);
}
