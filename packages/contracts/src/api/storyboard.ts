// Storyboard — Seedance 2.0 image-first keyframe workflow: grab/create a
// starting image, iterate on it cheaply, derive an END frame (i2i) so
// subject/angle/lighting stay identical, describe ONLY the motion, and
// render each shot with Seedance start/end keyframe pairs. Shots connect
// into a final assembled video or a self-contained sliding web export.
//
// Storage: one JSON file per storyboard under
// `RUNTIME_DATA_DIR/storyboards/<id>.json` (apps/daemon/src/storyboards/store.ts).
// All generated stills/clips live in a hidden `storyboard-media` project so
// the existing media generate + task machinery (POST
// /api/projects/:id/media/generate, POST /api/media/tasks/:id/wait) works
// untouched — see apps/daemon/src/routes/storyboard.ts.
//
// Keep this file pure TypeScript — no Node, browser, or daemon imports.

export type StoryboardFrameOrigin = 'generated' | 'derived' | 'uploaded' | 'previous-shot';

export interface StoryboardFrameRef {
  /** Path relative to the storyboard-media project, e.g. "frames/<id>.png". */
  path: string;
  origin: StoryboardFrameOrigin;
  prompt?: string;
  model?: string;
  /** Rel path of the frame this one was derived/iterated from, when known. */
  derivedFrom?: string;
}

export type StoryboardMoodDraftStatus = 'idle' | 'rendering' | 'done' | 'failed';

/** A cheap 480p one-shot t2v "mood exploration" render — not final quality. */
export interface StoryboardMoodDraft {
  id: string;
  prompt: string;
  model: string;
  taskId?: string;
  /** Path relative to the storyboard-media project once rendered. */
  output?: string;
  status: StoryboardMoodDraftStatus;
  error?: string;
}

export type StoryboardShotStatus = 'draft' | 'rendering' | 'done' | 'failed';
export type StoryboardResolution = '480p' | '720p' | '1080p';

export interface StoryboardShot {
  id: string;
  order: number;
  title?: string;
  startFrame?: StoryboardFrameRef;
  endFrame?: StoryboardFrameRef;
  /** MOTION ONLY — the web UI's copy/placeholder enforces this. */
  motionPrompt: string;
  model: string;
  resolution: StoryboardResolution;
  /** Seconds, 4-15 (Ark's Seedance duration range). */
  durationSec: number;
  taskId?: string;
  /** Path relative to the storyboard-media project once rendered. */
  output?: string;
  status: StoryboardShotStatus;
  error?: string;
}

export interface Storyboard {
  id: string;
  title: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
  ratio: string;
  moodDrafts: StoryboardMoodDraft[];
  shots: StoryboardShot[];
}

/** Lightweight row for the storyboard list view — full shot/mood-draft bodies omitted. */
export interface StoryboardSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  shotCount: number;
}

// --- Request / response DTOs ------------------------------------------------

export interface CreateStoryboardRequest {
  title?: string;
}

export interface ListStoryboardsResponse {
  storyboards: StoryboardSummary[];
}

export interface StoryboardResponse {
  storyboard: Storyboard;
}

/** PATCH /api/storyboards/:id — partial update; any subset of fields. */
export interface PatchStoryboardRequest {
  title?: string;
  ratio?: string;
  moodDrafts?: StoryboardMoodDraft[];
  shots?: StoryboardShot[];
  /**
   * Optimistic-concurrency check: the `updatedAt` the client last read.
   * When provided and it no longer matches the stored doc's `updatedAt`,
   * the PATCH is rejected with 409 (see StoryboardConflictResponse) instead
   * of silently overwriting concurrent edits. Omit to keep the previous
   * last-write-wins behavior.
   */
  expectedUpdatedAt?: string;
}

/** 409 body for PATCH /api/storyboards/:id when expectedUpdatedAt is stale. */
export interface StoryboardConflictResponse {
  error: 'storyboard changed';
  storyboard: Storyboard;
}

export interface GenerateStoryboardFrameRequest {
  prompt: string;
  model: string;
  aspect?: string;
  /** Storyboard-project-relative path to an existing frame — i2i edit source. */
  sourceImage?: string;
  /**
   * Defaults to 'image' (a still: start-frame creation, iteration, end-frame
   * derivation). 'video' backs the cheap 480p mood-exploration lane — the
   * same one-shot generate/wait dispatch, just a t2v model instead of a t2i
   * one; the moodDraft it belongs to is tracked via PATCH
   * /api/storyboards/:id's moodDrafts array, not this endpoint.
   */
  surface?: 'image' | 'video';
  /** Video surface only. Seconds. */
  durationSec?: number;
}

export interface GenerateStoryboardFrameResponse {
  taskId: string;
  /** Storyboard-project-relative path the still/clip will be written to once the task completes. */
  framePath: string;
}

// --- Upload (external image import) -----------------------------------------

/**
 * Largest external image upload accepted, in bytes. MUST NOT EXCEED the
 * media pipeline's own image cap — apps/daemon/src/media/index.ts's
 * resolveProjectImage() rejects any image over its local MAX_IMAGE_BYTES (16
 * MiB) before it can be sent to a renderer, so a bigger value here would let
 * a 17-32 MiB upload attach to a shot that can then never actually render.
 * The web UI sends the file inline as a base64 `data:` URI through POST
 * /api/storyboards/:id/uploads, which rides a dedicated 48mb JSON body limit
 * (server.ts) — base64 inflation (~33%) leaves this constant comfortable
 * headroom under that transport limit. Enforced on both surfaces (same
 * shared-constant idiom as packages/contracts/src/api/library.ts's
 * LIBRARY_UPLOAD_MAX_BYTES) so an oversized file fails with a clear message
 * instead of a generic 413.
 */
export const STORYBOARD_UPLOAD_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Exact MIME types POST /api/storyboards/:id/uploads accepts. svg is
 * excluded because it's scriptable; gif/avif are excluded because the i2i
 * providers this feature feeds don't accept them.
 */
export const STORYBOARD_UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export function isStoryboardUploadMimeAllowed(mime: string | undefined): boolean {
  return typeof mime === 'string' && (STORYBOARD_UPLOAD_MIME_TYPES as readonly string[]).includes(mime);
}

/** `accept` attribute value for a Storyboard frame upload file-picker. */
export function storyboardUploadAcceptAttr(): string {
  return STORYBOARD_UPLOAD_MIME_TYPES.join(',');
}

/** Body of POST /api/storyboards/:id/uploads. */
export interface UploadStoryboardFrameRequest {
  /** `data:image/(png|jpeg|webp);base64,<payload>` — see STORYBOARD_UPLOAD_MIME_TYPES. */
  dataUrl: string;
}

export interface UploadStoryboardFrameResponse {
  /** Storyboard-project-relative path the uploaded image was written to, e.g. "upload-<uuid>.png". */
  path: string;
}

export interface RenderStoryboardShotResponse {
  taskId: string;
}

// --- Assemble finishing pipeline (Remotion opt-in) --------------------------

/**
 * Largest narration/voiceover audio payload POST /api/storyboards/:id/assemble
 * accepts via `finish.audioDataUrl`, in bytes. It rides the same JSON body as
 * the rest of the assemble request (server.ts's body-size limit), so this
 * stays well under that — a short narration track for a finishing pass has no
 * need to approach it. Not persisted as a storyboard asset (see
 * AssembleStoryboardFinishOptions.audioDataUrl) — used only for the one
 * assemble call it's attached to.
 */
export const STORYBOARD_FINISH_AUDIO_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Exact MIME types `finish.audioDataUrl` accepts. wav/mpeg/mp4(m4a)/aac cover
 * the common narration export formats; whisper.cpp transcription re-encodes
 * to 16kHz mono internally regardless of the source format.
 */
export const STORYBOARD_FINISH_AUDIO_MIME_TYPES = ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/aac'] as const;

export function isStoryboardFinishAudioMimeAllowed(mime: string | undefined): boolean {
  return typeof mime === 'string' && (STORYBOARD_FINISH_AUDIO_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * Opt-in Remotion finishing pass for POST /api/storyboards/:id/assemble.
 * Omitting `finish` entirely (the default) keeps today's behavior: an ffmpeg
 * hard-cut concat of the ordered done-shot outputs into final.mp4. Passing
 * `{ mode: 'remotion', ... }` instead renders through Remotion: a title card,
 * crossfade transitions between shots, and (when `audioDataUrl` is supplied)
 * captions burned in from a local whisper.cpp transcription — no cloud calls.
 */
export interface AssembleStoryboardFinishOptions {
  mode: 'remotion';
  /** Show a title card at the start of the assembled video. Defaults to true. */
  titles?: boolean;
  /** Title card text; defaults to the storyboard's own title. */
  title?: string;
  /** Crossfade transitions between shots instead of hard cuts. Defaults to true. */
  transitions?: boolean;
  /**
   * Burn in captions transcribed locally (whisper.cpp) from `audioDataUrl`.
   * Requires `audioDataUrl` to be set — the request 400s otherwise. Defaults
   * to true when `audioDataUrl` is present.
   */
  captions?: boolean;
  /**
   * `data:<mime>;base64,<payload>` narration/voiceover track — see
   * STORYBOARD_FINISH_AUDIO_MIME_TYPES. Laid under the assembled video and,
   * when `captions` is true, transcribed locally for the burned-in captions.
   * Not persisted as a storyboard asset; scoped to this one assemble call.
   */
  audioDataUrl?: string;
}

/** POST /api/storyboards/:id/assemble request body. */
export interface AssembleStoryboardRequest {
  /** Omit for the existing ffmpeg concat (default, unchanged). See AssembleStoryboardFinishOptions. */
  finish?: AssembleStoryboardFinishOptions;
}

export interface AssembleStoryboardResponse {
  /** Storyboard-project-relative path to the assembled video. */
  output: string;
  /** Which pipeline produced `output` — 'concat' unless `finish` was set. */
  finish: 'concat' | 'remotion';
}

export interface ExportStoryboardSliderResponse {
  /** Storyboard-project-relative path to the exported self-contained HTML. */
  output: string;
}
