// Storyboard — Seedance 2.0 image-first keyframe workflow (see
// packages/contracts/src/api/storyboard.ts for the full shape). Every
// storyboard is a single JSON file under RUNTIME_DATA_DIR/storyboards/<id>.json
// (apps/daemon/src/storyboards/store.ts); every generated still/clip lives in
// a hidden `storyboard-media` project so the existing media generate + task
// machinery (POST /api/projects/:id/media/generate, POST
// /api/media/tasks/:id/wait) works untouched — this module dispatches into
// the same generateMedia()/task-store primitives registerMediaRoutes uses,
// rather than duplicating the HTTP hop.
//
// Frame/shot output filenames are a best-effort prediction (see
// GenerateStoryboardFrameResponse.framePath doc): image renderers may return
// a different byte format than requested (nanobanana/openrouter/fal all
// sniff the real extension from the response bytes), so the FINAL name can
// differ from the one predicted here. Callers should treat the completed
// media task's `file.name` (from POST /api/media/tasks/:id/wait) as
// authoritative once the task is done — video renders don't have this
// ambiguity (every video renderer hardcodes `.mp4`).

import { spawn } from 'node:child_process';
import { lstat, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Express } from 'express';
import type {
  AssembleStoryboardFinishOptions,
  DraftStoryboardShotsRequest,
  Storyboard,
  StoryboardCommercialBrief,
  StoryboardFrameRef,
  StoryboardMoodDraft,
  StoryboardResolution,
  StoryboardShot,
  StoryboardShotStatus,
  StoryboardSummary,
  StoryboardTakeReceipt,
  StoryboardTakeScores,
} from '@open-design/contracts';
import {
  isStoryboardUploadMimeAllowed,
  STORYBOARD_DRAFT_BRIEF_MAX_CHARS,
  STORYBOARD_DRAFT_SHOT_COUNT_DEFAULT,
  STORYBOARD_DRAFT_SHOT_COUNT_MAX,
  STORYBOARD_DRAFT_SHOT_COUNT_MIN,
  STORYBOARD_MOOD_DRAFT_STATUSES as MOOD_DRAFT_STATUS_VALUES,
  STORYBOARD_SHOT_STATUSES as SHOT_STATUS_VALUES,
  STORYBOARD_UPLOAD_MAX_BYTES,
} from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import type { createFilesystemWriteGateway } from '../filesystem/write-gateway.js';
import {
  FinalizeUpstreamError,
  isFinalizeProviderProtocol,
  isProviderCredentialRejection,
  providerLabel,
} from '../design/finalize-design.js';
import { resolveProviderConfig } from '../media/config.js';
import { modelsForSurface } from '../media/models.js';
import { isSafeId, mimeFor } from '../projects.js';
import { assembleStoryboard, getDoneShots, pruneStoryboardAssembleOutputs } from '../storyboards/assemble.js';
import {
  DRAFT_TEXT_PROVIDER_IDS,
  draftShotsFromBrief,
  resolveDraftTextProvider,
} from '../storyboards/draft-from-brief.js';
import {
  deleteStoryboard,
  listStoryboards,
  readStoryboard,
  withStoryboardLock,
  writeStoryboard,
} from '../storyboards/store.js';
import {
  composeStyledMediaPrompt,
  styleReferenceFromDesignMd,
} from '../storyboards/style-reference.js';
import { createHeroProductCommercial } from '../storyboards/product-commercial.js';
import {
  buildStoryboardTakeReceipt,
  publishTerminalAfterReceipt,
  storyboardShotOutputName,
} from '../storyboards/provenance.js';

export interface RegisterStoryboardRoutesDeps
  extends RouteDeps<'http' | 'paths' | 'ids' | 'db' | 'projectStore' | 'projectFiles' | 'media' | 'validation'> {
  filesystem: { create: typeof createFilesystemWriteGateway };
}

/** Hidden project every generated storyboard still/clip lives under. Auto-created on first use. */
const STORYBOARD_MEDIA_PROJECT_ID = 'storyboard-media';
const STORYBOARD_RESOLUTIONS = new Set<StoryboardResolution>(['480p', '720p', '1080p']);
// Derived from the contract's own tuples (OBS-1) — a hand-relisted copy here
// is how the two nearly-identical vocabularies get crossed.
const STORYBOARD_SHOT_STATUSES = new Set<StoryboardShotStatus>(SHOT_STATUS_VALUES);
const STORYBOARD_MOOD_STATUSES = new Set<string>(MOOD_DRAFT_STATUS_VALUES);
const STORYBOARD_FRAME_ORIGINS = new Set(['generated', 'derived', 'uploaded', 'previous-shot']);
const MIN_SHOT_DURATION_SEC = 4;
const MAX_SHOT_DURATION_SEC = 15;
// export-slider base64-inlines every selected frame into one HTML file —
// cap the total so a storyboard with a pile of oversized frames can't
// inflate an unbounded response/HTML file in memory.
const STORYBOARD_SLIDER_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
// `data:<mime>;base64,<payload>` shape — the mime capture is intentionally
// generic (not anchored to the allowlist) so an unsupported-but-well-formed
// type still gets a clear "must be png|jpeg|webp" 400 instead of falling
// through to the stricter base64-payload check below.
const STORYBOARD_UPLOAD_DATA_URL_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.*)$/i;
const STORYBOARD_UPLOAD_BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** mime is guaranteed one of STORYBOARD_UPLOAD_MIME_TYPES by the caller. */
function storyboardUploadExtFor(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg'; // conventional extension for the jpeg subtype
  return 'webp';
}

// Frame refs (StoryboardFrameRef.path) and shot render outputs
// (StoryboardShot.output) are client-controllable — PATCH accepts a whole
// shots array, so an agent (or a hallucinated value) could set either to
// `../../../etc/passwd` or similar. Reject unsafe values at validation time
// (boundary validation) rather than relying solely on the containment
// checks already inside resolveProjectImage/readProjectFile — those exist,
// but a value that never should have been stored in the first place is the
// more robust invariant, and assemble's ffmpeg concat list has no such
// internal check at all today.
function isSafeStoryboardRelPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  // Control characters (including \n \r) can break the ffmpeg concat list's
  // line-based `file '<path>'` grammar even inside a quoted segment.
  if (/[\x00-\x1f]/.test(value)) return false;
  if (value.includes('\\')) return false;
  if (path.isAbsolute(value)) return false;
  return value.split('/').every((segment) => segment !== '..' && segment !== '.' && segment !== '');
}

/**
 * Re-resolves a client-supplied relative path against the storyboard-media
 * project directory and requires the result to stay inside it — same
 * containment idiom as static-resource.ts's `/api/skills/:id/assets/*`
 * route. Returns null (never throws) when the path is missing, malformed,
 * or escapes; callers turn that into a 400.
 */
function resolveWithinStoryboardMediaDir(projectDir: string, rel: unknown): string | null {
  if (!isSafeStoryboardRelPath(rel)) return null;
  const target = path.resolve(projectDir, rel);
  if (target !== projectDir && !target.startsWith(projectDir + path.sep)) return null;
  return target;
}

/**
 * Symlink-aware re-validation for READS of a client-influenced path that has
 * already cleared resolveWithinStoryboardMediaDir's lexical check. The
 * lexical check alone is fooled by a symlink *inside* the storyboard-media
 * project pointing outside it — the literal path stays under the project
 * dir, but the OS follows the link at open() time. Same attack class as
 * design-library.ts's withinReal / projects.ts's resolveSafeReal. The target
 * must already exist; returns null (never throws) on any failure so callers
 * turn it into a uniform 400.
 */
async function resolveWithinStoryboardMediaDirReal(projectDir: string, rel: unknown): Promise<string | null> {
  const target = resolveWithinStoryboardMediaDir(projectDir, rel);
  if (!target) return null;
  const baseReal = await realpath(projectDir).catch(() => projectDir);
  let targetReal: string;
  try {
    targetReal = await realpath(target);
  } catch {
    return null;
  }
  if (targetReal !== baseReal && !targetReal.startsWith(baseReal + path.sep)) return null;
  return targetReal;
}

/**
 * Guards a WRITE target inside the storyboard-media project dir against a
 * previously-planted symlink. Unlike the read-side helper above, a write
 * NEVER follows an existing symlink at the target — even one that would
 * resolve back inside the project — since following it would let an
 * attacker alias the write onto an arbitrary file (e.g. `slider.html`, or
 * an assemble run's per-storyboard concat-list file, replaced with a
 * symlink to some other path before the route writes to it). Also
 * realpath-validates the target's parent directory so a symlinked ancestor
 * can't redirect the write outside the project tree. `absoluteTarget` is
 * always built by the route itself (fixed/randomUUID-based names), never
 * taken verbatim from client input. Returns null (never throws) on failure.
 */
async function assertSafeStoryboardWriteTarget(projectDir: string, absoluteTarget: string): Promise<boolean> {
  try {
    const st = await lstat(absoluteTarget);
    if (st.isSymbolicLink()) return false;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
  const parent = path.dirname(absoluteTarget);
  const baseReal = await realpath(projectDir).catch(() => projectDir);
  const parentReal = await realpath(parent).catch(() => null);
  if (!parentReal || (parentReal !== baseReal && !parentReal.startsWith(baseReal + path.sep))) {
    return false;
  }
  return true;
}

/**
 * Per-shot duration for a drafted shot when the storyboard has no existing
 * shot to inherit one from. Inside the MIN/MAX shot duration range.
 */
const DEFAULT_DRAFT_SHOT_DURATION_SEC = 5;

/**
 * The media catalog's own default video model. Drafting into an empty
 * storyboard needs a model id, and reading it from the catalog avoids
 * planting a second, drifting opinion about which model is the default.
 */
function defaultVideoModelId(): string {
  const videoModels = modelsForSurface('video');
  return videoModels.find((entry) => entry.default)?.id ?? videoModels[0]?.id ?? '';
}

function nowIso(): string {
  return new Date().toISOString();
}

function newStoryboard(id: string, title: string): Storyboard {
  const ts = nowIso();
  return {
    id,
    title: title || 'Untitled storyboard',
    createdAt: ts,
    updatedAt: ts,
    ratio: '16:9',
    moodDrafts: [],
    shots: [],
  };
}

const COMMERCIAL_BRIEF_LIMITS: Record<keyof StoryboardCommercialBrief, number> = {
  productName: 120,
  audience: 240,
  promise: 240,
  visualDirection: 500,
  callToAction: 240,
};

function validateCommercialBrief(
  raw: unknown,
): { ok: true; value: StoryboardCommercialBrief } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: 'commercialBrief must be an object' };
  const value = {} as StoryboardCommercialBrief;
  for (const [field, max] of Object.entries(COMMERCIAL_BRIEF_LIMITS) as Array<
    [keyof StoryboardCommercialBrief, number]
  >) {
    const candidate = raw[field];
    if (typeof candidate !== 'string' || !candidate.trim()) {
      return { ok: false, error: `commercialBrief.${field} must be a non-empty string` };
    }
    if (candidate.trim().length > max) {
      return { ok: false, error: `commercialBrief.${field} must be ${max} characters or fewer` };
    }
    value[field] = candidate.trim();
  }
  return { ok: true, value };
}

function summarize(storyboard: Storyboard): StoryboardSummary {
  return {
    id: storyboard.id,
    title: storyboard.title,
    createdAt: storyboard.createdAt,
    updatedAt: storyboard.updatedAt,
    shotCount: storyboard.shots.length,
    ...(storyboard.recipe ? { recipe: storyboard.recipe } : {}),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validates and normalizes one incoming FrameRef-shaped object; null on failure. */
function validateFrameRef(raw: unknown, fieldLabel: string): { ok: true; value: StoryboardFrameRef } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: `${fieldLabel} must be an object` };
  if (!isSafeStoryboardRelPath(raw.path)) {
    return {
      ok: false,
      error: `${fieldLabel}.path must be a safe relative path (no ".." segments, no leading "/", no backslashes or control characters)`,
    };
  }
  if (typeof raw.origin !== 'string' || !STORYBOARD_FRAME_ORIGINS.has(raw.origin as any)) {
    return { ok: false, error: `${fieldLabel}.origin must be one of generated|derived|uploaded|previous-shot` };
  }
  const value: StoryboardFrameRef = {
    path: raw.path.trim(),
    origin: raw.origin as StoryboardFrameRef['origin'],
    ...(typeof raw.prompt === 'string' ? { prompt: raw.prompt } : {}),
    ...(typeof raw.model === 'string' ? { model: raw.model } : {}),
    ...(typeof raw.derivedFrom === 'string' ? { derivedFrom: raw.derivedFrom } : {}),
  };
  return { ok: true, value };
}

function validateShot(raw: unknown, index: number): { ok: true; value: StoryboardShot } | { ok: false; error: string } {
  const label = `shots[${index}]`;
  if (!isPlainObject(raw)) return { ok: false, error: `${label} must be an object` };
  if (typeof raw.id !== 'string' || !raw.id.trim()) return { ok: false, error: `${label}.id must be a non-empty string` };
  if (typeof raw.order !== 'number' || !Number.isFinite(raw.order)) {
    return { ok: false, error: `${label}.order must be a number` };
  }
  if (typeof raw.motionPrompt !== 'string') {
    return { ok: false, error: `${label}.motionPrompt must be a string` };
  }
  if (typeof raw.model !== 'string' || !raw.model.trim()) {
    return { ok: false, error: `${label}.model must be a non-empty string` };
  }
  if (typeof raw.resolution !== 'string' || !STORYBOARD_RESOLUTIONS.has(raw.resolution as any)) {
    return { ok: false, error: `${label}.resolution must be one of 480p|720p|1080p` };
  }
  if (typeof raw.durationSec !== 'number' || raw.durationSec < MIN_SHOT_DURATION_SEC || raw.durationSec > MAX_SHOT_DURATION_SEC) {
    return { ok: false, error: `${label}.durationSec must be a number between ${MIN_SHOT_DURATION_SEC} and ${MAX_SHOT_DURATION_SEC}` };
  }
  if (typeof raw.status !== 'string' || !STORYBOARD_SHOT_STATUSES.has(raw.status as any)) {
    return { ok: false, error: `${label}.status must be one of draft|rendering|done|failed` };
  }
  let startFrame: StoryboardFrameRef | undefined;
  if (raw.startFrame !== undefined) {
    const parsed = validateFrameRef(raw.startFrame, `${label}.startFrame`);
    if (!parsed.ok) return parsed;
    startFrame = parsed.value;
  }
  let endFrame: StoryboardFrameRef | undefined;
  if (raw.endFrame !== undefined) {
    const parsed = validateFrameRef(raw.endFrame, `${label}.endFrame`);
    if (!parsed.ok) return parsed;
    endFrame = parsed.value;
  }
  if (endFrame && !startFrame) {
    return { ok: false, error: `${label}.endFrame requires ${label}.startFrame` };
  }
  // `output` feeds ffmpeg's concat list verbatim in the assemble route
  // (no containment check of its own there) — validate it here too, same
  // as frame refs, so an unsafe value never persists in the first place.
  if (raw.output !== undefined && !isSafeStoryboardRelPath(raw.output)) {
    return {
      ok: false,
      error: `${label}.output must be a safe relative path (no ".." segments, no leading "/", no backslashes or control characters)`,
    };
  }
  const value: StoryboardShot = {
    id: raw.id.trim(),
    order: raw.order,
    ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
    ...(startFrame ? { startFrame } : {}),
    ...(endFrame ? { endFrame } : {}),
    motionPrompt: raw.motionPrompt,
    model: raw.model.trim(),
    resolution: raw.resolution as StoryboardResolution,
    durationSec: raw.durationSec,
    ...(typeof raw.taskId === 'string' ? { taskId: raw.taskId } : {}),
    ...(typeof raw.output === 'string' ? { output: raw.output } : {}),
    status: raw.status as StoryboardShotStatus,
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
  };
  return { ok: true, value };
}

function validateMoodDraft(raw: unknown, index: number): { ok: true; value: StoryboardMoodDraft } | { ok: false; error: string } {
  const label = `moodDrafts[${index}]`;
  if (!isPlainObject(raw)) return { ok: false, error: `${label} must be an object` };
  if (typeof raw.id !== 'string' || !raw.id.trim()) return { ok: false, error: `${label}.id must be a non-empty string` };
  if (typeof raw.prompt !== 'string') return { ok: false, error: `${label}.prompt must be a string` };
  if (typeof raw.model !== 'string' || !raw.model.trim()) return { ok: false, error: `${label}.model must be a non-empty string` };
  if (typeof raw.status !== 'string' || !STORYBOARD_MOOD_STATUSES.has(raw.status)) {
    return { ok: false, error: `${label}.status must be one of idle|rendering|done|failed` };
  }
  const value: StoryboardMoodDraft = {
    id: raw.id.trim(),
    prompt: raw.prompt,
    model: raw.model.trim(),
    ...(typeof raw.taskId === 'string' ? { taskId: raw.taskId } : {}),
    ...(typeof raw.output === 'string' ? { output: raw.output } : {}),
    status: raw.status as StoryboardMoodDraft['status'],
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
  };
  return { ok: true, value };
}

/**
 * Validates the optional `finish` field of POST /api/storyboards/:id/assemble.
 * `undefined` keeps today's default ffmpeg concat behavior unchanged; any
 * other shape must be `{ mode: 'remotion', ... }` — see
 * AssembleStoryboardFinishOptions. Default application (titles/transitions
 * default true, captions defaults to whether audioDataUrl is set) happens in
 * storyboards/assemble.ts, not here — this only checks the wire shape, plus
 * one cross-field rule enforced eagerly: `captions: true` requires
 * `audioDataUrl` to be set on the SAME request (checked again, defensively,
 * in storyboards/assemble.ts's runRemotionAssemble for any caller that
 * bypasses this validator).
 */
function validateAssembleFinish(
  raw: unknown,
): { ok: true; value: AssembleStoryboardFinishOptions | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!isPlainObject(raw)) return { ok: false, error: 'finish must be an object' };
  if (raw.mode !== 'remotion') return { ok: false, error: 'finish.mode must be "remotion"' };
  if (raw.titles !== undefined && typeof raw.titles !== 'boolean') {
    return { ok: false, error: 'finish.titles must be a boolean' };
  }
  if (raw.title !== undefined && typeof raw.title !== 'string') {
    return { ok: false, error: 'finish.title must be a string' };
  }
  if (raw.transitions !== undefined && typeof raw.transitions !== 'boolean') {
    return { ok: false, error: 'finish.transitions must be a boolean' };
  }
  if (raw.captions !== undefined && typeof raw.captions !== 'boolean') {
    return { ok: false, error: 'finish.captions must be a boolean' };
  }
  if (raw.audioDataUrl !== undefined && typeof raw.audioDataUrl !== 'string') {
    return { ok: false, error: 'finish.audioDataUrl must be a string' };
  }
  if (raw.captions === true && !raw.audioDataUrl) {
    return { ok: false, error: 'finish.captions requires finish.audioDataUrl' };
  }
  const value: AssembleStoryboardFinishOptions = {
    mode: 'remotion',
    ...(typeof raw.titles === 'boolean' ? { titles: raw.titles } : {}),
    ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
    ...(typeof raw.transitions === 'boolean' ? { transitions: raw.transitions } : {}),
    ...(typeof raw.captions === 'boolean' ? { captions: raw.captions } : {}),
    ...(typeof raw.audioDataUrl === 'string' ? { audioDataUrl: raw.audioDataUrl } : {}),
  };
  return { ok: true, value };
}

export function registerStoryboardRoutes(app: Express, ctx: RegisterStoryboardRoutesDeps) {
  const { isLocalSameOrigin, resolvedPortRef, sendApiError } = ctx.http;
  const { validateExternalApiBaseUrl } = ctx.validation;
  const { PROJECT_ROOT, PROJECTS_DIR, RUNTIME_DATA_DIR } = ctx.paths;
  const { randomUUID } = ctx.ids;
  const db = ctx.db;
  const { getProject, insertProject } = ctx.projectStore;
  const { ensureProject, resolveProjectDir, readProjectFile } = ctx.projectFiles;
  const { generateMedia, createMediaTask, persistMediaTask, appendTaskProgress, notifyTaskWaiters } = ctx.media;
  const getResolvedPort = () => resolvedPortRef.current;

  const requireLocal = (req: any, res: any): boolean => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      sendApiError(res, 403, 'FORBIDDEN', 'cross-origin request rejected: storyboards are restricted to the local UI / CLI');
      return false;
    }
    return true;
  };

  // Idempotent: only the first caller actually inserts the project row /
  // creates the directory; concurrent callers await the same promise.
  let ensureMediaProjectPromise: Promise<void> | null = null;
  function ensureStoryboardMediaProject(): Promise<void> {
    if (!ensureMediaProjectPromise) {
      ensureMediaProjectPromise = (async () => {
        if (!getProject(db, STORYBOARD_MEDIA_PROJECT_ID)) {
          const ts = Date.now();
          insertProject(db, {
            id: STORYBOARD_MEDIA_PROJECT_ID,
            name: 'Storyboard Media',
            metadata: { internal: true, kind: 'storyboard-media' },
            createdAt: ts,
            updatedAt: ts,
          });
        }
        await ensureProject(PROJECTS_DIR, STORYBOARD_MEDIA_PROJECT_ID);
      })().catch((err) => {
        // Let the next call retry instead of caching a permanent failure.
        ensureMediaProjectPromise = null;
        throw err;
      });
    }
    return ensureMediaProjectPromise;
  }

  function dispatchMediaTask(input: {
    taskId?: string | undefined;
    surface: 'image' | 'video';
    model: string;
    prompt: string;
    output: string;
    aspect?: string | undefined;
    length?: number | undefined;
    image?: string | undefined;
    endImage?: string | undefined;
    onSettled?: ((outcome: {
      taskId: string;
      status: 'done' | 'failed';
      startedAt: number;
      endedAt: number;
      file?: any;
      error?: string;
    }) => Promise<void>) | undefined;
  }): { taskId: string; task: ReturnType<typeof createMediaTask> } {
    const taskId = input.taskId ?? randomUUID();
    const task = createMediaTask(taskId, STORYBOARD_MEDIA_PROJECT_ID, { surface: input.surface, model: input.model });
    task.status = 'running';
    persistMediaTask(task);

    void (async () => {
      let outcome:
        | { status: 'done'; endedAt: number; file: any }
        | { status: 'failed'; endedAt: number; error: { message: string; status: number; code?: string } };
      try {
        const file = await generateMedia({
          projectRoot: PROJECT_ROOT,
          projectsRoot: PROJECTS_DIR,
          projectId: STORYBOARD_MEDIA_PROJECT_ID,
          surface: input.surface,
          model: input.model,
          prompt: input.prompt,
          output: input.output,
          aspect: input.aspect,
          length: input.length,
          image: input.image,
          endImage: input.endImage,
          onProgress: (line: any) => appendTaskProgress(task, line),
        });
        outcome = { status: 'done', endedAt: Date.now(), file };
      } catch (err: any) {
        outcome = {
          status: 'failed',
          endedAt: Date.now(),
          error: {
            message: String(err && err.message ? err.message : err),
            status: typeof err?.status === 'number' ? err.status : 400,
            ...(typeof err?.code === 'string' ? { code: err.code } : {}),
          },
        };
      }

      await publishTerminalAfterReceipt({
        persistReceipt: async () => {
          if (!input.onSettled) return;
          await input.onSettled({
            taskId,
            status: outcome.status,
            startedAt: task.startedAt,
            endedAt: outcome.endedAt,
            ...(outcome.status === 'done'
              ? { file: outcome.file }
              : { error: outcome.error.message }),
          });
        },
        publishTerminal: () => {
          task.endedAt = outcome.endedAt;
          if (outcome.status === 'done') {
            task.file = outcome.file;
            task.error = null;
          } else {
            task.file = null;
            task.error = outcome.error;
          }
          task.status = outcome.status;
          try {
            persistMediaTask(task);
            notifyTaskWaiters(task);
          } catch (persistErr) {
            console.error(`[storyboard] failed to persist ${outcome.status} media task`, persistErr);
          }
        },
        onReceiptError: (settleErr) => {
          // Fail closed: without the daemon-owned receipt this task stays
          // non-terminal, so /wait can never claim a durable render that the
          // storyboard cannot account for.
          console.error(`[storyboard] refusing to publish ${outcome.status} task without durable provenance`, settleErr);
        },
      });
    })();

    return { taskId, task };
  }

  function providerIdForVideoModel(modelId: string): string {
    return modelsForSurface('video').find((entry) => entry.id === modelId)?.provider ?? 'unknown';
  }

  async function appendShotTake(
    storyboardId: string,
    shotId: string,
    receipt: StoryboardTakeReceipt,
  ): Promise<void> {
    await withStoryboardLock(storyboardId, async () => {
      const current = await readStoryboard(RUNTIME_DATA_DIR, storyboardId);
      if (!current) throw new Error(`storyboard ${storyboardId} disappeared before its take receipt was persisted`);
      const shot = current.shots.find((entry) => entry.id === shotId);
      if (!shot) throw new Error(`shot ${shotId} disappeared before its take receipt was persisted`);
      const existing = shot.takes ?? [];
      if (existing.some((take) => take.id === receipt.id)) return;
      shot.takes = [...existing, receipt];

      // Multiple takes can render concurrently. Every receipt survives, but
      // only the currently-active task may drive the shot's latest status.
      if (shot.taskId === receipt.taskId) {
        if (receipt.status === 'done' && receipt.output) {
          shot.status = 'done';
          shot.output = receipt.output;
          delete shot.error;
        } else if (receipt.status === 'failed') {
          shot.status = 'failed';
          shot.error = receipt.error ?? 'render failed';
        }
      }
      current.updatedAt = nowIso();
      await writeStoryboard(RUNTIME_DATA_DIR, current);
    });
  }

  app.get('/api/storyboards', async (req, res) => {
    if (!requireLocal(req, res)) return;
    const storyboards = await listStoryboards(RUNTIME_DATA_DIR);
    res.json({ storyboards: storyboards.map(summarize) });
  });

  app.post('/api/storyboards', async (req, res) => {
    if (!requireLocal(req, res)) return;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const recipe = req.body?.recipe;
    if (recipe !== undefined && recipe !== 'hero-product-commercial') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'recipe must be hero-product-commercial when provided');
    }
    if (recipe === undefined && req.body?.commercialBrief !== undefined) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'commercialBrief requires recipe hero-product-commercial');
    }
    const id = randomUUID();
    let storyboard: Storyboard;
    if (recipe === 'hero-product-commercial') {
      const parsedBrief = validateCommercialBrief(req.body?.commercialBrief);
      if (!parsedBrief.ok) return sendApiError(res, 400, 'BAD_REQUEST', parsedBrief.error);
      const ratio = typeof req.body?.ratio === 'string' && req.body.ratio.trim() ? req.body.ratio.trim() : '16:9';
      const requestedModel = req.body?.model;
      if (requestedModel !== undefined && (typeof requestedModel !== 'string' || !requestedModel.trim())) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'model must be a non-empty string');
      }
      const catalogModel = typeof requestedModel === 'string'
        ? modelsForSurface('video').find((entry) => entry.id === requestedModel.trim())
        : undefined;
      if (requestedModel !== undefined && (!catalogModel || !catalogModel.caps?.includes('i2v'))) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'model must be a known image-to-video model');
      }
      const model = catalogModel?.id ?? defaultVideoModelId();
      const resolution: StoryboardResolution = model.endsWith(':1080p') ? '1080p' : model.endsWith(':480p') ? '480p' : '720p';
      storyboard = createHeroProductCommercial({
        id,
        now: nowIso(),
        model,
        resolution,
        ratio,
        brief: parsedBrief.value,
      });
    } else {
      storyboard = newStoryboard(id, title);
    }
    await writeStoryboard(RUNTIME_DATA_DIR, storyboard);
    res.status(201).json({ storyboard });
  });

  app.get('/api/storyboards/:id', async (req, res) => {
    if (!requireLocal(req, res)) return;
    if (!isSafeId(req.params.id)) return sendApiError(res, 400, 'BAD_REQUEST', 'invalid storyboard id');
    let storyboard = await readStoryboard(RUNTIME_DATA_DIR, req.params.id);
    if (!storyboard) return sendApiError(res, 404, 'NOT_FOUND', 'storyboard not found');

    if (storyboard.finalOutput) {
      const projectDir = resolveProjectDir(PROJECTS_DIR, STORYBOARD_MEDIA_PROJECT_ID);
      const outputPath = await resolveWithinStoryboardMediaDirReal(projectDir, storyboard.finalOutput);
      const outputExists = outputPath ? await stat(outputPath).then((entry) => entry.isFile()).catch(() => false) : false;
      if (!outputExists) {
        await withStoryboardLock(req.params.id, async () => {
          const current = await readStoryboard(RUNTIME_DATA_DIR, req.params.id);
          if (!current || current.finalOutput !== storyboard?.finalOutput) return;
          delete current.finalOutput;
          current.updatedAt = nowIso();
          await writeStoryboard(RUNTIME_DATA_DIR, current);
          storyboard = current;
        });
      }
    }
    res.json({ storyboard });
  });

  app.patch('/api/storyboards/:id', async (req, res) => {
    if (!requireLocal(req, res)) return;
    if (!isSafeId(req.params.id)) return sendApiError(res, 400, 'BAD_REQUEST', 'invalid storyboard id');
    // The whole read-validate-write cycle is the critical section: two
    // concurrent PATCHes must not both read the same snapshot and have the
    // second writer's whole-document write silently erase the first's.
    await withStoryboardLock(req.params.id, async () => {
      const storyboard = await readStoryboard(RUNTIME_DATA_DIR, req.params.id);
      if (!storyboard) return sendApiError(res, 404, 'NOT_FOUND', 'storyboard not found');

      const patch = req.body ?? {};
      // Optimistic concurrency: when the caller passes the updatedAt it last
      // read, reject a PATCH built from a stale snapshot instead of silently
      // last-write-wins clobbering concurrent edits made by another client in
      // the meantime. Omitting the field keeps the previous behavior.
      if (patch.expectedUpdatedAt !== undefined) {
        if (typeof patch.expectedUpdatedAt !== 'string') {
          return sendApiError(res, 400, 'BAD_REQUEST', 'expectedUpdatedAt must be a string');
        }
        if (patch.expectedUpdatedAt !== storyboard.updatedAt) {
          return res.status(409).json({ error: 'storyboard changed', storyboard });
        }
      }
      if (patch.title !== undefined) {
        if (typeof patch.title !== 'string' || !patch.title.trim()) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'title must be a non-empty string');
        }
      }
      if (patch.ratio !== undefined && (typeof patch.ratio !== 'string' || !patch.ratio.trim())) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'ratio must be a non-empty string');
      }
      let nextMoodDrafts: StoryboardMoodDraft[] | undefined;
      if (patch.moodDrafts !== undefined) {
        if (!Array.isArray(patch.moodDrafts)) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'moodDrafts must be an array');
        }
        const parsed: StoryboardMoodDraft[] = [];
        for (let i = 0; i < patch.moodDrafts.length; i++) {
          const result = validateMoodDraft(patch.moodDrafts[i], i);
          if (!result.ok) return sendApiError(res, 400, 'BAD_REQUEST', result.error);
          parsed.push(result.value);
        }
        nextMoodDrafts = parsed;
      }
      let nextShots: StoryboardShot[] | undefined;
      if (patch.shots !== undefined) {
        if (!Array.isArray(patch.shots)) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'shots must be an array');
        }
        const parsed: StoryboardShot[] = [];
        // Guards against a duplicated shot id reaching storage — e.g. a
        // client-side 409 retry that re-applies an append mutator onto a doc
        // that (for whatever reason) already contains the shot it was trying
        // to add. The client-side fix (storyboard-persist.ts's
        // appendShotIfAbsent) makes this unreachable from the shipped UI, but
        // the server is the actual boundary: any other caller (CLI, a future
        // integration, a hallucinated agent PATCH) must not be able to
        // persist two shots sharing an id.
        const seenShotIds = new Set<string>();
        const currentShotsById = new Map(storyboard.shots.map((entry) => [entry.id, entry]));
        for (let i = 0; i < patch.shots.length; i++) {
          const result = validateShot(patch.shots[i], i);
          if (!result.ok) return sendApiError(res, 400, 'BAD_REQUEST', result.error);
          if (seenShotIds.has(result.value.id)) {
            return sendApiError(res, 400, 'BAD_REQUEST', 'duplicate shot id');
          }
          seenShotIds.add(result.value.id);
          const rawShot = patch.shots[i] as Record<string, unknown>;
          const currentShot = currentShotsById.get(result.value.id);
          for (const field of ['takes', 'takeReviews', 'selectedTakeId'] as const) {
            if (
              rawShot[field] !== undefined &&
              JSON.stringify(rawShot[field]) !== JSON.stringify(currentShot?.[field])
            ) {
              return sendApiError(
                res,
                400,
                'BAD_REQUEST',
                'take history, reviews, and selection are daemon-owned; use the take review route',
              );
            }
          }
          parsed.push({
            ...result.value,
            ...(currentShot?.takes ? { takes: currentShot.takes } : {}),
            ...(currentShot?.takeReviews ? { takeReviews: currentShot.takeReviews } : {}),
            ...(currentShot?.selectedTakeId ? { selectedTakeId: currentShot.selectedTakeId } : {}),
          });
        }
        nextShots = parsed;
      }

      if (typeof patch.title === 'string' && patch.title.trim()) storyboard.title = patch.title.trim();
      if (typeof patch.ratio === 'string' && patch.ratio.trim()) storyboard.ratio = patch.ratio.trim();
      if (nextMoodDrafts) storyboard.moodDrafts = nextMoodDrafts;
      if (nextShots) storyboard.shots = nextShots;
      storyboard.updatedAt = nowIso();

      await writeStoryboard(RUNTIME_DATA_DIR, storyboard);
      res.json({ storyboard });
    });
  });

  app.delete('/api/storyboards/:id', async (req, res) => {
    if (!requireLocal(req, res)) return;
    if (!isSafeId(req.params.id)) return sendApiError(res, 400, 'BAD_REQUEST', 'invalid storyboard id');
    // Same lock as every writer for this id: a delete racing a concurrent
    // PATCH/render/draft-shots write must not let the write resurrect a
    // file the delete already removed (or vice versa).
    await withStoryboardLock(req.params.id, async () => {
      const deleted = await deleteStoryboard(RUNTIME_DATA_DIR, req.params.id);
      if (!deleted) return sendApiError(res, 404, 'NOT_FOUND', 'storyboard not found');
      res.status(204).end();
    });
  });

  // Sets/replaces the storyboard's style reference by extracting a style
  // profile from pasted DESIGN.md through the brand engine's deterministic
  // design-md leg (see storyboards/style-reference.ts). Only the extracted
  // profile is persisted — never the raw paste. Runs under the same
  // per-storyboard lock and optimistic-concurrency semantics as PATCH.
  app.post('/api/storyboards/:id/style-reference', async (req, res) => {
    if (!requireLocal(req, res)) return;
    if (!isSafeId(req.params.id)) return sendApiError(res, 400, 'BAD_REQUEST', 'invalid storyboard id');
    const designMd = req.body?.designMd;
    if (typeof designMd !== 'string' || !designMd.trim()) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'designMd must be a non-empty string');
    }
    const expectedUpdatedAt = req.body?.expectedUpdatedAt;
    if (expectedUpdatedAt !== undefined && typeof expectedUpdatedAt !== 'string') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'expectedUpdatedAt must be a string');
    }
    await withStoryboardLock(req.params.id, async () => {
      const storyboard = await readStoryboard(RUNTIME_DATA_DIR, req.params.id);
      if (!storyboard) return sendApiError(res, 404, 'NOT_FOUND', 'storyboard not found');
      if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== storyboard.updatedAt) {
        return res.status(409).json({ error: 'storyboard changed', storyboard });
      }
      const styleReference = styleReferenceFromDesignMd(designMd);
      if (!styleReference) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'designMd did not yield a style profile');
      }
      storyboard.styleReference = styleReference;
      storyboard.updatedAt = nowIso();
      await writeStoryboard(RUNTIME_DATA_DIR, storyboard);
      res.json({ storyboard });
    });
  });

  app.delete('/api/storyboards/:id/style-reference', async (req, res) => {
    if (!requireLocal(req, res)) return;
    if (!isSafeId(req.params.id)) return sendApiError(res, 400, 'BAD_REQUEST', 'invalid storyboard id');
    const expectedUpdatedAt = req.body?.expectedUpdatedAt;
    if (expectedUpdatedAt !== undefined && typeof expectedUpdatedAt !== 'string') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'expectedUpdatedAt must be a string');
    }
    await withStoryboardLock(req.params.id, async () => {
      const storyboard = await readStoryboard(RUNTIME_DATA_DIR, req.params.id);
      if (!storyboard) return sendApiError(res, 404, 'NOT_FOUND', 'storyboard not found');
      if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== storyboard.updatedAt) {
        return res.status(409).json({ error: 'storyboard changed', storyboard });
      }
      delete storyboard.styleReference;
      storyboard.updatedAt = nowIso();
      await writeStoryboard(RUNTIME_DATA_DIR, storyboard);
      res.json({ storyboard });
    });
  });

  // Reveals the hidden storyboard-media project folder in the OS file
  // browser — same fire-and-forget `open` spawn as design-library's
  // POST /api/design-library/open.
  app.post('/api/storyboards/:id/open-folder', async (req, res) => {
    if (!requireLocal(req, res)) return;
    if (!isSafeId(req.params.id)) return sendApiError(res, 400, 'BAD_REQUEST', 'invalid storyboard id');
    const storyboard = await readStoryboard(RUNTIME_DATA_DIR, req.params.id);
    if (!storyboard) return sendApiError(res, 404, 'NOT_FOUND', 'storyboard not found');
    await ensureStoryboardMediaProject();
    const target = resolveProjectDir(PROJECTS_DIR, STORYBOARD_MEDIA_PROJECT_ID);
    const child = spawn('open', [target], { detached: true, stdio: 'ignore' });
    // A spawn failure (e.g. ENOENT) emits an unhandled 'error' event with no
    // listener otherwise, which crashes the daemon — the 204 below may
    // already be on the wire by the time it fires, which is fine; this is
    // fire-and-forget UX (reveal in Finder), not a request the caller awaits.
    child.on('error', () => {});
    child.unref();
    res.status(204).end();
  });

  /**
   * Turn a free-text creative brief into several draft shots appended to this
   * storyboard.
   *
   * Every validation and the optimistic-concurrency check run BEFORE the text
   * provider is resolved or called, so a malformed or stale request can never
   * reach — or bill — a provider. Drafted shots land as `draft` status with no
   * frames: they are a starting point the user then edits and renders, exactly
   * like a hand-added shot.
   */
  app.post('/api/storyboards/:id/draft-shots', async (req, res) => {
    if (!requireLocal(req, res)) return;
    if (!isSafeId(req.params.id)) return sendApiError(res, 400, 'BAD_REQUEST', 'invalid storyboard id');
    const storyboard = await readStoryboard(RUNTIME_DATA_DIR, req.params.id);
    if (!storyboard) return sendApiError(res, 404, 'NOT_FOUND', 'storyboard not found');

    const body = (req.body ?? {}) as DraftStoryboardShotsRequest;

    const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
    if (!brief) return sendApiError(res, 400, 'BAD_REQUEST', 'brief must be a non-empty string');
    if (brief.length > STORYBOARD_DRAFT_BRIEF_MAX_CHARS) {
      return sendApiError(
        res,
        400,
        'BAD_REQUEST',
        `brief must be at most ${STORYBOARD_DRAFT_BRIEF_MAX_CHARS} characters`,
      );
    }

    let shotCount = STORYBOARD_DRAFT_SHOT_COUNT_DEFAULT;
    if (body.shotCount !== undefined) {
      if (
        typeof body.shotCount !== 'number' ||
        !Number.isInteger(body.shotCount) ||
        body.shotCount < STORYBOARD_DRAFT_SHOT_COUNT_MIN ||
        body.shotCount > STORYBOARD_DRAFT_SHOT_COUNT_MAX
      ) {
        return sendApiError(
          res,
          400,
          'BAD_REQUEST',
          `shotCount must be an integer between ${STORYBOARD_DRAFT_SHOT_COUNT_MIN} and ${STORYBOARD_DRAFT_SHOT_COUNT_MAX}`,
        );
      }
      shotCount = body.shotCount;
    }

    // Per-shot settings inherit from the storyboard's last shot so a draft
    // appended to work in progress matches what is already on the board; an
    // empty storyboard falls back to the catalog's own default video model
    // rather than a hardcoded id.
    const lastShot = storyboard.shots.length ? storyboard.shots[storyboard.shots.length - 1] : undefined;

    let durationSec = lastShot?.durationSec ?? DEFAULT_DRAFT_SHOT_DURATION_SEC;
    if (body.durationSec !== undefined) {
      if (
        typeof body.durationSec !== 'number' ||
        body.durationSec < MIN_SHOT_DURATION_SEC ||
        body.durationSec > MAX_SHOT_DURATION_SEC
      ) {
        return sendApiError(
          res,
          400,
          'BAD_REQUEST',
          `durationSec must be a number between ${MIN_SHOT_DURATION_SEC} and ${MAX_SHOT_DURATION_SEC}`,
        );
      }
      durationSec = body.durationSec;
    }

    let resolution: StoryboardResolution = lastShot?.resolution ?? '720p';
    if (body.resolution !== undefined) {
      if (typeof body.resolution !== 'string' || !STORYBOARD_RESOLUTIONS.has(body.resolution as any)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'resolution must be one of 480p|720p|1080p');
      }
      resolution = body.resolution;
    }

    let model = lastShot?.model ?? defaultVideoModelId();
    if (body.model !== undefined) {
      if (typeof body.model !== 'string' || !body.model.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'model must be a non-empty string');
      }
      model = body.model.trim();
    }
    if (!model) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'model is required: no existing shot to inherit one from');
    }

    if (body.expectedUpdatedAt !== undefined) {
      if (typeof body.expectedUpdatedAt !== 'string') {
        return sendApiError(res, 400, 'BAD_REQUEST', 'expectedUpdatedAt must be a string');
      }
      if (body.expectedUpdatedAt !== storyboard.updatedAt) {
        return res.status(409).json({ error: 'storyboard changed', storyboard });
      }
    }

    // BYOK credentials, when supplied, are used for this one call and never
    // stored — same posture as the finalize route.
    let override;
    if (body.textProvider !== undefined) {
      const supplied = body.textProvider as Partial<DraftStoryboardShotsRequest['textProvider']>;
      if (!supplied || typeof supplied !== 'object') {
        return sendApiError(res, 400, 'BAD_REQUEST', 'textProvider must be an object');
      }
      if (!isFinalizeProviderProtocol(supplied.protocol)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'textProvider.protocol is not a supported protocol');
      }
      if (typeof supplied.apiKey !== 'string' || !supplied.apiKey.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'textProvider.apiKey must be a non-empty string');
      }
      if (typeof supplied.model !== 'string' || !supplied.model.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'textProvider.model must be a non-empty string');
      }
      if (supplied.baseUrl !== undefined && typeof supplied.baseUrl !== 'string') {
        return sendApiError(res, 400, 'BAD_REQUEST', 'textProvider.baseUrl must be a string');
      }
      // A caller-supplied baseUrl makes the DAEMON issue an outbound request
      // on the caller's behalf, so it must clear the same DNS-aware SSRF
      // guard the finalize route applies to the identical field. requireLocal
      // is not a substitute: it constrains who may call us, not where we may
      // then connect — loopback ports and RFC1918 hosts the browser could
      // never reach directly are reachable from here.
      if (supplied.baseUrl) {
        const validated = await validateExternalApiBaseUrl(supplied.baseUrl);
        if (validated.error) {
          return sendApiError(
            res,
            validated.forbidden ? 403 : 400,
            validated.forbidden ? 'FORBIDDEN' : 'BAD_REQUEST',
            validated.error,
          );
        }
      }
      override = {
        protocol: supplied.protocol,
        apiKey: supplied.apiKey.trim(),
        model: supplied.model.trim(),
        ...(supplied.baseUrl ? { baseUrl: supplied.baseUrl } : {}),
      };
    }

    const provider = await resolveDraftTextProvider(
      (providerId) => resolveProviderConfig(PROJECT_ROOT, providerId),
      override,
    );
    if (!provider) {
      return sendApiError(
        res,
        400,
        'NO_TEXT_PROVIDER',
        `drafting from a brief needs a text-capable provider: add an API key for one of ${DRAFT_TEXT_PROVIDER_IDS.join(', ')} under Settings, or send textProvider with this request`,
      );
    }

    // Abort the provider call if the client goes away, so a browser tab that
    // closes mid-draft stops the outbound request instead of leaving the
    // daemon holding it (and paying for it) to completion.
    const clientGone = new AbortController();
    const abortOnClose = () => clientGone.abort();
    req.on('close', abortOnClose);

    let drafted;
    try {
      drafted = await draftShotsFromBrief({ brief, shotCount, provider, signal: clientGone.signal });
    } catch (err) {
      // A rejected credential must say it's the credential — Google answers
      // an invalid key with 400, so without this classification the user is
      // told only "upstream Google Gemini returned 400" and reads a stale
      // key as a broken feature (BUG-10). Message is composed here, never
      // echoed from the upstream body.
      if (err instanceof FinalizeUpstreamError && isProviderCredentialRejection(err)) {
        const label = providerLabel(provider.protocol);
        return sendApiError(
          res,
          401,
          'UNAUTHORIZED',
          `${label} rejected its API key — update the stored credential under Settings → Media providers (or the textProvider sent with this request) and retry`,
          { details: { kind: 'provider-error', providerErrorKind: 'invalid-credential', provider: label } },
        );
      }
      // Deliberately surfaces only the error's own message — never the raw
      // upstream body, which can echo request content back.
      const message = err instanceof Error ? err.message : 'text provider call failed';
      return sendApiError(res, 502, 'UPSTREAM_UNAVAILABLE', message);
    } finally {
      req.off('close', abortOnClose);
    }

    // Re-read before writing, INSIDE the per-storyboard lock. The provider
    // call above is a multi-second network round-trip and must stay outside
    // the lock — holding it here would serialize every other write to this
    // storyboard (and, on a hung provider, block them indefinitely). The
    // lock instead wraps only this tail: re-read the current doc, apply the
    // drafted shots on top of it, and write — the same atomic
    // read-modify-write guarantee every other mutating route gets, closing
    // the residual event-loop-width race a re-read alone cannot (a second
    // writer's own full read-modify-write cycle landing inside this window).
    await withStoryboardLock(req.params.id, async () => {
      const current = await readStoryboard(RUNTIME_DATA_DIR, req.params.id);
      if (!current) return sendApiError(res, 404, 'NOT_FOUND', 'storyboard was deleted while drafting');
      if (body.expectedUpdatedAt !== undefined && current.updatedAt !== storyboard.updatedAt) {
        // The caller asked for optimistic concurrency explicitly, so a write
        // that landed mid-draft is reported rather than silently merged.
        return res.status(409).json({ error: 'storyboard changed', storyboard: current });
      }

      const nextOrder = current.shots.reduce((max, shot) => Math.max(max, shot.order), -1) + 1;
      const appended: StoryboardShot[] = drafted.map((spec, index) => ({
        id: randomUUID(),
        order: nextOrder + index,
        title: spec.title,
        motionPrompt: spec.motionPrompt,
        model,
        resolution,
        durationSec,
        status: 'draft',
      }));

      current.shots = [...current.shots, ...appended];
      current.updatedAt = nowIso();
      await writeStoryboard(RUNTIME_DATA_DIR, current);
      res.json({ storyboard: current, drafted: appended.length });
    });
  });

  // Generates a still (or, for the mood-exploration lane, a cheap t2v clip)
  // via the same media-generate path as POST /api/projects/:id/media/generate,
  // scoped to the hidden storyboard-media project. i2i when sourceImage is
  // given (start-frame creation, iteration, and end-frame derivation all go
  // through this one route with the default image surface). `framePath` in
  // the response is a best-effort prediction — see the module doc comment
  // above.
  app.post('/api/storyboards/:id/frames', async (req, res) => {
    if (!requireLocal(req, res)) return;
    if (!isSafeId(req.params.id)) return sendApiError(res, 400, 'BAD_REQUEST', 'invalid storyboard id');
    const storyboard = await readStoryboard(RUNTIME_DATA_DIR, req.params.id);
    if (!storyboard) return sendApiError(res, 404, 'NOT_FOUND', 'storyboard not found');

    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) return sendApiError(res, 400, 'BAD_REQUEST', 'prompt is required');
    const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    if (!model) return sendApiError(res, 400, 'BAD_REQUEST', 'model is required');
    const aspect = typeof req.body?.aspect === 'string' ? req.body.aspect : undefined;
    let sourceImage: string | undefined;
    if (req.body?.sourceImage !== undefined && req.body?.sourceImage !== '') {
      if (!isSafeStoryboardRelPath(req.body.sourceImage)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'sourceImage must be a safe relative path');
      }
      sourceImage = req.body.sourceImage;
    }
    const surface = req.body?.surface === 'video' ? 'video' : 'image';
    const durationSec = typeof req.body?.durationSec === 'number' ? req.body.durationSec : undefined;

    await ensureStoryboardMediaProject();
    const mediaProjectDir = resolveProjectDir(PROJECTS_DIR, STORYBOARD_MEDIA_PROJECT_ID);
    if (sourceImage && !(await resolveWithinStoryboardMediaDirReal(mediaProjectDir, sourceImage))) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'sourceImage escapes the storyboard project directory');
    }

    const framePath = surface === 'video' ? `frame-${randomUUID()}.mp4` : `frame-${randomUUID()}.png`;
    const { taskId } = dispatchMediaTask({
      surface,
      model,
      prompt: composeStyledMediaPrompt(prompt, storyboard.styleReference),
      output: framePath,
      aspect,
      length: surface === 'video' ? durationSec : undefined,
      image: surface === 'image' ? sourceImage : undefined,
    });

    res.status(202).json({ taskId, framePath });
  });

  // Accepts a single external image (file-picker or drag-and-drop) into the
  // hidden storyboard-media project so it can immediately be used as a shot
  // start/end frame or an i2i sourceImage — same directory every generated
  // frame lives in (see storyboardFrameUrl's doc comment in registry.ts), so
  // no new serving route is needed. The extension is derived from the
  // validated MIME type only, never a client-supplied filename, so the
  // stored name has no traversal surface at all.
  app.post('/api/storyboards/:id/uploads', async (req, res) => {
    if (!requireLocal(req, res)) return;
    if (!isSafeId(req.params.id)) return sendApiError(res, 400, 'BAD_REQUEST', 'invalid storyboard id');
    const storyboard = await readStoryboard(RUNTIME_DATA_DIR, req.params.id);
    if (!storyboard) return sendApiError(res, 404, 'NOT_FOUND', 'storyboard not found');

    const dataUrl = typeof req.body?.dataUrl === 'string' ? req.body.dataUrl : '';
    const structureMatch = STORYBOARD_UPLOAD_DATA_URL_RE.exec(dataUrl);
    const mime = structureMatch?.[1]?.toLowerCase() ?? '';
    if (!structureMatch || !isStoryboardUploadMimeAllowed(mime)) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'dataUrl must be data:image/(png|jpeg|webp);base64,<payload>');
    }
    const payload = structureMatch[2] ?? '';
    // Buffer.from(…, 'base64') silently drops invalid characters instead of
    // throwing, so the charset/padding shape must be checked explicitly —
    // otherwise a garbled payload would decode to a truncated (but
    // "successful") image instead of failing loudly.
    if (!STORYBOARD_UPLOAD_BASE64_RE.test(payload) || payload.length % 4 !== 0) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'malformed base64 payload');
    }
    // Reject an oversized payload BEFORE Buffer.from decodes it into memory —
    // base64 groups 3 input bytes into 4 output chars, so
    // 4*ceil(MAX_BYTES/3) is the largest encoded length any payload
    // decoding to <= STORYBOARD_UPLOAD_MAX_BYTES bytes could ever have.
    // (ceil(MAX_BYTES*4/3) looks equivalent but isn't when MAX_BYTES isn't a
    // multiple of 3 — it under-counts by one char and would 413 a payload
    // that decodes to exactly the limit.) Deferring this check to the
    // decoded byte length (below) still catches every oversized upload
    // correctly, but only after paying the allocation cost this guard
    // avoids.
    if (payload.length > 4 * Math.ceil(STORYBOARD_UPLOAD_MAX_BYTES / 3)) {
      return sendApiError(
        res,
        413,
        'PAYLOAD_TOO_LARGE',
        `decoded image exceeds the ${STORYBOARD_UPLOAD_MAX_BYTES}-byte upload limit`,
      );
    }
    const bytes = Buffer.from(payload, 'base64');
    if (bytes.length === 0) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'malformed base64 payload');
    }
    if (bytes.length > STORYBOARD_UPLOAD_MAX_BYTES) {
      return sendApiError(
        res,
        413,
        'PAYLOAD_TOO_LARGE',
        `decoded image (${bytes.length} bytes) exceeds the ${STORYBOARD_UPLOAD_MAX_BYTES}-byte upload limit`,
      );
    }

    await ensureStoryboardMediaProject();
    const mediaProjectDir = resolveProjectDir(PROJECTS_DIR, STORYBOARD_MEDIA_PROJECT_ID);
    const relPath = `upload-${randomUUID()}.${storyboardUploadExtFor(mime)}`;
    const targetPath = path.join(mediaProjectDir, relPath);
    if (!(await assertSafeStoryboardWriteTarget(mediaProjectDir, targetPath))) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'upload target is unsafe');
    }
    // Atomic write, same temp+rename idiom as storyboards/store.ts's
    // writeStoryboard: a crash mid-write must never leave a truncated file
    // where a complete one is expected.
    const tempPath = `${targetPath}.tmp-${randomUUID()}`;
    try {
      await writeFile(tempPath, bytes);
      await rename(tempPath, targetPath);
    } catch (err) {
      // A failed write or rename must not leave the temp file orphaned in
      // the media project dir — best-effort cleanup, then rethrow so the
      // caller still sees the original failure.
      await rm(tempPath, { force: true }).catch(() => {});
      throw err;
    }

    res.status(201).json({ path: relPath });
  });

  // Validates start frame present + non-empty motion prompt, dispatches a
  // video generate (image=startFrame, endImage=endFrame when set), and
  // marks the shot 'rendering' with the dispatched taskId. Does NOT wait
  // for completion. Once the task settles, this daemon route records the
  // terminal shot state and immutable receipt; clients only need to refresh
  // the storyboard. This keeps the route fast and reuses the existing task
  // machinery instead of a second long-poll loop.
  app.post('/api/storyboards/:id/shots/:shotId/render', async (req, res) => {
    if (!requireLocal(req, res)) return;
    if (!isSafeId(req.params.id)) return sendApiError(res, 400, 'BAD_REQUEST', 'invalid storyboard id');
    const storyboard = await readStoryboard(RUNTIME_DATA_DIR, req.params.id);
    if (!storyboard) return sendApiError(res, 404, 'NOT_FOUND', 'storyboard not found');
    const shot = storyboard.shots.find((s) => s.id === req.params.shotId);
    if (!shot) return sendApiError(res, 404, 'NOT_FOUND', 'shot not found');
    if (!shot.startFrame?.path) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'shot needs a start frame before it can render');
    }
    // Early rejection only. The prompt actually dispatched is re-derived from
    // the locked re-read below, for the same reason the model and frames are:
    // a concurrent edit to the motion prompt must not leave the stored shot
    // showing new text while the encode runs on the old.
    if (!(typeof shot.motionPrompt === 'string' && shot.motionPrompt.trim())) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'motion prompt is required');
    }

    const body = (req.body ?? {}) as { expectedUpdatedAt?: unknown };
    if (body.expectedUpdatedAt !== undefined) {
      if (typeof body.expectedUpdatedAt !== 'string') {
        return sendApiError(res, 400, 'BAD_REQUEST', 'expectedUpdatedAt must be a string');
      }
      if (body.expectedUpdatedAt !== storyboard.updatedAt) {
        return res.status(409).json({ error: 'storyboard changed', storyboard });
      }
    }

    await ensureStoryboardMediaProject();
    const mediaProjectDir = resolveProjectDir(PROJECTS_DIR, STORYBOARD_MEDIA_PROJECT_ID);

    // Everything the render is BUILT from is read inside the lock, and the
    // containment checks run against those same freshly-read values.
    //
    // Validating the entry-time snapshot and then dispatching from it looks
    // safe — those are the paths that passed containment — but it silently
    // reintroduces the staleness this lock exists to remove: a PATCH landing
    // during `ensureStoryboardMediaProject()` can change the shot's frames,
    // model, duration or the storyboard's ratio, and the job would then encode
    // the OLD values while the stored shot (and the UI) shows the new ones.
    // Reading and validating together inside the lock keeps the dispatched job
    // and the persisted record describing the same thing. Containment is two
    // local `realpath` calls, so holding the lock across them is cheap; the
    // provider/network work happens later, outside, in the task runner.
    //
    // Dispatch fires only after every rejection (missing shot, escaping path,
    // stale expectedUpdatedAt) has been decided against this fresh read, so a
    // rejected request never leaves an abandoned media task behind.
    await withStoryboardLock(req.params.id, async () => {
      const current = await readStoryboard(RUNTIME_DATA_DIR, req.params.id);
      if (!current) return sendApiError(res, 404, 'NOT_FOUND', 'storyboard was deleted while rendering');
      const currentShot = current.shots.find((s) => s.id === shot.id);
      if (!currentShot) return sendApiError(res, 404, 'NOT_FOUND', 'shot not found');
      if (body.expectedUpdatedAt !== undefined && current.updatedAt !== storyboard.updatedAt) {
        // The caller asked for optimistic concurrency explicitly, so a write
        // that landed mid-request is reported rather than silently merged.
        return res.status(409).json({ error: 'storyboard changed', storyboard: current });
      }
      const motionPrompt =
        typeof currentShot.motionPrompt === 'string' ? currentShot.motionPrompt.trim() : '';
      if (!motionPrompt) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'motion prompt is required');
      }
      const startFramePath = currentShot.startFrame?.path;
      if (!startFramePath) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'shot needs a start frame before it can render');
      }
      if (!(await resolveWithinStoryboardMediaDirReal(mediaProjectDir, startFramePath))) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'shot startFrame.path escapes the storyboard project directory');
      }
      const endFramePath = currentShot.endFrame?.path;
      if (endFramePath && !(await resolveWithinStoryboardMediaDirReal(mediaProjectDir, endFramePath))) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'shot endFrame.path escapes the storyboard project directory');
      }

      const taskId = randomUUID();
      const outputPath = storyboardShotOutputName(currentShot.id, taskId);
      const effectivePrompt = composeStyledMediaPrompt(motionPrompt, current.styleReference);
      const fallbackProviderId = providerIdForVideoModel(currentShot.model);
      dispatchMediaTask({
        taskId,
        surface: 'video',
        model: currentShot.model,
        prompt: effectivePrompt,
        output: outputPath,
        aspect: current.ratio,
        length: currentShot.durationSec,
        image: startFramePath,
        endImage: endFramePath,
        onSettled: async (outcome) => {
          const file = outcome.file ?? {};
          const receipt = buildStoryboardTakeReceipt({
            taskId: outcome.taskId,
            status: outcome.status,
            startedAt: outcome.startedAt,
            endedAt: outcome.endedAt,
            providerId:
              typeof file.providerId === 'string' && file.providerId.trim()
                ? file.providerId
                : fallbackProviderId,
            modelId: currentShot.model,
            motionPrompt,
            effectivePrompt,
            startFrame: startFramePath,
            ...(endFramePath ? { endFrame: endFramePath } : {}),
            aspect: current.ratio,
            durationSec: currentShot.durationSec,
            ...(typeof file.name === 'string' ? { output: file.name } : {}),
            ...(typeof file.providerNote === 'string' ? { providerNote: file.providerNote } : {}),
            ...(Array.isArray(file.warnings)
              ? { warnings: file.warnings.filter((entry: unknown): entry is string => typeof entry === 'string') }
              : {}),
            ...(outcome.error ? { error: outcome.error } : {}),
          });
          await appendShotTake(current.id, currentShot.id, receipt);
        },
      });

      currentShot.status = 'rendering';
      currentShot.taskId = taskId;
      delete currentShot.error;
      current.updatedAt = nowIso();
      await writeStoryboard(RUNTIME_DATA_DIR, current);

      res.status(202).json({ taskId });
    });
  });

  app.put('/api/storyboards/:id/shots/:shotId/takes/:takeId/review', async (req, res) => {
    if (!requireLocal(req, res)) return;
    if (!isSafeId(req.params.id)) return sendApiError(res, 400, 'BAD_REQUEST', 'invalid storyboard id');
    const decision = req.body?.decision;
    if (decision !== 'approved' && decision !== 'rejected') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'decision must be approved or rejected');
    }
    const note = req.body?.note;
    if (note !== undefined && typeof note !== 'string') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'note must be a string');
    }
    if (typeof note === 'string' && note.trim().length > 500) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'note must be 500 characters or fewer');
    }

    let scores: StoryboardTakeScores | undefined;
    if (req.body?.scores !== undefined) {
      if (!isPlainObject(req.body.scores)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'scores must be an object');
      }
      const scoreFields = ['brandFit', 'motionQuality', 'artifactControl', 'revisionEase'] as const;
      const parsed = {} as StoryboardTakeScores;
      for (const field of scoreFields) {
        const value = req.body.scores[field];
        if (!Number.isInteger(value) || value < 1 || value > 5) {
          return sendApiError(res, 400, 'BAD_REQUEST', `scores.${field} must be an integer from 1 to 5`);
        }
        parsed[field] = value;
      }
      scores = parsed;
    }

    await withStoryboardLock(req.params.id, async () => {
      const storyboard = await readStoryboard(RUNTIME_DATA_DIR, req.params.id);
      if (!storyboard) return sendApiError(res, 404, 'NOT_FOUND', 'storyboard not found');
      const shot = storyboard.shots.find((entry) => entry.id === req.params.shotId);
      if (!shot) return sendApiError(res, 404, 'NOT_FOUND', 'shot not found');
      const take = shot.takes?.find((entry) => entry.id === req.params.takeId);
      if (!take) return sendApiError(res, 404, 'NOT_FOUND', 'take not found');
      let approvedOutput: string | undefined;
      if (decision === 'approved') {
        if (take.status !== 'done' || !take.output) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'only a completed take can be approved');
        }
        approvedOutput = take.output;
      }

      shot.takeReviews = {
        ...(shot.takeReviews ?? {}),
        [take.id]: {
          decision,
          updatedAt: nowIso(),
          ...(typeof note === 'string' && note.trim() ? { note: note.trim() } : {}),
          ...(scores ? { scores } : {}),
        },
      };
      if (approvedOutput) {
        shot.selectedTakeId = take.id;
        shot.output = approvedOutput;
        shot.status = 'done';
        delete shot.error;
      } else if (shot.selectedTakeId === take.id) {
        delete shot.selectedTakeId;
      }
      storyboard.updatedAt = nowIso();
      await writeStoryboard(RUNTIME_DATA_DIR, storyboard);
      res.json({ storyboard });
    });
  });

  // Delegates to storyboards/assemble.ts, which owns both finishing modes:
  // the default ffmpeg hard-cut concat, and the opt-in Remotion finishing
  // pass (title card + crossfade transitions + burned-in captions) selected
  // via `finish: { mode: 'remotion', ... }`. This route owns request
  // validation and the storyboard-media containment checks (the same
  // resolveWithinStoryboardMediaDirReal/assertSafeStoryboardWriteTarget
  // helpers every other route in this file uses) and turns the module's
  // structured outcome into an HTTP response.
  app.post('/api/storyboards/:id/assemble', async (req, res) => {
    if (!requireLocal(req, res)) return;
    if (!isSafeId(req.params.id)) return sendApiError(res, 400, 'BAD_REQUEST', 'invalid storyboard id');
    const storyboard = await readStoryboard(RUNTIME_DATA_DIR, req.params.id);
    if (!storyboard) return sendApiError(res, 404, 'NOT_FOUND', 'storyboard not found');

    const parsedFinish = validateAssembleFinish((req.body as { finish?: unknown } | undefined)?.finish);
    if (!parsedFinish.ok) return sendApiError(res, 400, 'BAD_REQUEST', parsedFinish.error);

    if (
      storyboard.recipe === 'hero-product-commercial' &&
      storyboard.shots.some((shot) => {
        const selected = shot.takes?.find((take) => take.id === shot.selectedTakeId);
        return !selected || selected.status !== 'done' || !selected.output;
      })
    ) {
      return sendApiError(
        res,
        400,
        'BAD_REQUEST',
        'choose a take for each shot before assembling this commercial',
      );
    }

    // Fail fast BEFORE ensureStoryboardMediaProject — a zero-shot assemble
    // must 400 without provisioning the hidden storyboard-media project
    // (DB row + directory) as a side effect.
    if (getDoneShots(storyboard).length === 0) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'no rendered shots to assemble — render at least one shot first');
    }

    await ensureStoryboardMediaProject();
    const projectDir = resolveProjectDir(PROJECTS_DIR, STORYBOARD_MEDIA_PROJECT_ID);

    const outcome = await assembleStoryboard({
      storyboard,
      projectDir,
      runtimeDataDir: RUNTIME_DATA_DIR,
      ...(parsedFinish.value ? { finish: parsedFinish.value } : {}),
      resolveWithinProjectDirReal: resolveWithinStoryboardMediaDirReal,
      assertSafeWriteTarget: assertSafeStoryboardWriteTarget,
    });
    if (!outcome.ok) return sendApiError(res, outcome.status, outcome.code, outcome.message);

    // Persist which file is now "the" current assembled output for this
    // storyboard. assembleStoryboard() gives every run its own uniquely
    // named file (see storyboards/assemble.ts's assembleOutputName), so
    // without this a caller has no way to find the winning run's output
    // again after this response — the whole point of per-run naming is
    // that it can no longer be guessed from a fixed name. Re-read inside
    // the lock rather than reusing the entry-time snapshot: the encode
    // above can take a while, and a PATCH landing during it must not be
    // clobbered by writing back a stale copy of the doc.
    await withStoryboardLock(req.params.id, async () => {
      const current = await readStoryboard(RUNTIME_DATA_DIR, req.params.id);
      if (!current) return; // storyboard was deleted mid-assemble; nothing to persist onto
      current.finalOutput = outcome.output;
      current.updatedAt = nowIso();
      await writeStoryboard(RUNTIME_DATA_DIR, current);
    });

    try {
      const writeGateway = ctx.filesystem.create({ runtimeDataRoot: RUNTIME_DATA_DIR });
      const managedProjects = await writeGateway.managedProject(PROJECTS_DIR);
      await pruneStoryboardAssembleOutputs({
        projectDir,
        storyboardId: req.params.id,
        currentOutput: outcome.output,
        removeOutput: (absolutePath) => writeGateway.rm(managedProjects, absolutePath, { force: true }),
      });
    } catch (err) {
      console.warn(`[storyboard] could not prune old assembled outputs for ${req.params.id}`, err);
    }

    res.json({ output: outcome.output, finish: outcome.finish });
  });

  // Writes a self-contained slider.html: the ordered shot start/end frames
  // (base64-inlined) as a full-viewport scroll-snap + crossfade interaction.
  // GSAP-free per the repo's design-authority licensing boundary (see
  // docs/decisions/gsap-licensing.md) — plain CSS scroll-snap/crossfade at
  // the repo's own fixed easing/timing, no per-slide authoring surface.
  app.post('/api/storyboards/:id/export-slider', async (req, res) => {
    if (!requireLocal(req, res)) return;
    if (!isSafeId(req.params.id)) return sendApiError(res, 400, 'BAD_REQUEST', 'invalid storyboard id');
    const storyboard = await readStoryboard(RUNTIME_DATA_DIR, req.params.id);
    if (!storyboard) return sendApiError(res, 404, 'NOT_FOUND', 'storyboard not found');

    const ordered = [...storyboard.shots]
      .sort((a, b) => a.order - b.order)
      .filter((shot) => shot.startFrame?.path);
    if (ordered.length === 0) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'no frames to export — add a start frame to at least one shot first');
    }

    await ensureStoryboardMediaProject();
    const mediaProjectDir = resolveProjectDir(PROJECTS_DIR, STORYBOARD_MEDIA_PROJECT_ID);

    // Re-resolve + containment-check every frame path against the
    // storyboard-media project dir before reading it — readProjectFile has
    // its own containment check too (resolveSafeReal), but that is a deep
    // internal safety net; validating at this boundary means a bad value is
    // rejected here with a clean 400 instead of relying solely on that.
    // realpath (not just the lexical check) so a symlink planted inside the
    // project can't redirect the read outside it.
    const framePaths: string[] = [];
    for (const shot of ordered) {
      const startReal = await resolveWithinStoryboardMediaDirReal(mediaProjectDir, shot.startFrame!.path);
      if (!startReal) {
        return sendApiError(res, 400, 'BAD_REQUEST', `shot ${shot.id} startFrame.path escapes the storyboard project directory`);
      }
      framePaths.push(startReal);
      if (shot.endFrame?.path) {
        const endReal = await resolveWithinStoryboardMediaDirReal(mediaProjectDir, shot.endFrame.path);
        if (!endReal) {
          return sendApiError(res, 400, 'BAD_REQUEST', `shot ${shot.id} endFrame.path escapes the storyboard project directory`);
        }
        framePaths.push(endReal);
      }
    }

    // Every frame gets base64-inlined into one HTML file — sum sizes up
    // front so a storyboard with a pile of oversized frames can't inflate an
    // unbounded response/HTML file in memory.
    let totalFrameBytes = 0;
    for (const framePath of framePaths) {
      totalFrameBytes += (await stat(framePath)).size;
    }
    if (totalFrameBytes > STORYBOARD_SLIDER_MAX_TOTAL_BYTES) {
      return sendApiError(
        res,
        413,
        'PAYLOAD_TOO_LARGE',
        `total frame size (${totalFrameBytes} bytes) exceeds the ${STORYBOARD_SLIDER_MAX_TOTAL_BYTES}-byte slider export limit`,
      );
    }

    const slides: Array<{ title: string; startDataUrl: string; endDataUrl: string | null }> = [];
    for (const shot of ordered) {
      const start = await readProjectFile(PROJECTS_DIR, STORYBOARD_MEDIA_PROJECT_ID, shot.startFrame!.path);
      const startDataUrl = `data:${mimeFor(shot.startFrame!.path)};base64,${start.buffer.toString('base64')}`;
      let endDataUrl: string | null = null;
      if (shot.endFrame?.path) {
        const end = await readProjectFile(PROJECTS_DIR, STORYBOARD_MEDIA_PROJECT_ID, shot.endFrame.path);
        endDataUrl = `data:${mimeFor(shot.endFrame.path)};base64,${end.buffer.toString('base64')}`;
      }
      slides.push({ title: shot.title || `Shot ${shot.order + 1}`, startDataUrl, endDataUrl });
    }

    const html = buildSliderHtml(storyboard.title, slides);
    const outputName = 'slider.html';
    const sliderPath = path.join(mediaProjectDir, outputName);
    if (!(await assertSafeStoryboardWriteTarget(mediaProjectDir, sliderPath))) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'slider output target is unsafe');
    }
    await writeFile(sliderPath, html, 'utf8');

    res.json({ output: outputName });
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Self-contained sliding web export: full-viewport CSS scroll-snap
 * sections, one per shot, crossfading from its start frame to its end
 * frame (when present) as the section becomes fully in view. No GSAP, no
 * per-slide authoring controls — a one-shot export, not an editing surface
 * (see the repo's GSAP-conditional design-authority boundary).
 */
function buildSliderHtml(
  title: string,
  slides: Array<{ title: string; startDataUrl: string; endDataUrl: string | null }>,
): string {
  const easing = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const slideMarkup = slides
    .map((slide, index) => `
    <section class="slide" data-index="${index}">
      <img class="frame frame-start" src="${slide.startDataUrl}" alt="" />
      ${slide.endDataUrl ? `<img class="frame frame-end" src="${slide.endDataUrl}" alt="" />` : ''}
      <span class="label">${escapeHtml(slide.title)}</span>
    </section>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} — storyboard slider</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  .slider { height: 100vh; overflow-y: scroll; scroll-snap-type: y mandatory; }
  .slide {
    height: 100vh;
    scroll-snap-align: start;
    position: relative;
    overflow: hidden;
    background: #000;
  }
  .slide .frame {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .slide .frame-end { opacity: 0; transition: opacity 200ms ${easing}; }
  .slide.show-end .frame-start { opacity: 0; transition: opacity 140ms ${easing}; }
  .slide.show-end .frame-end { opacity: 1; }
  .slide .label {
    position: absolute;
    bottom: 24px;
    left: 24px;
    color: #fff;
    font: 500 14px/1.4 -apple-system, BlinkMacSystemFont, sans-serif;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  }
</style>
</head>
<body>
<div class="slider" id="slider">${slideMarkup}
</div>
<script>
  // Minimal, dependency-free: crossfade to the end frame once a slide is
  // essentially fully in view; back to the start frame otherwise. No
  // authoring surface — durations/easing above are fixed at export time.
  var slides = document.querySelectorAll('.slide');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        entry.target.classList.toggle('show-end', entry.intersectionRatio > 0.98);
      });
    }, { threshold: [0, 0.5, 0.98, 1] });
    slides.forEach(function (slide) { io.observe(slide); });
  }
</script>
</body>
</html>
`;
}
