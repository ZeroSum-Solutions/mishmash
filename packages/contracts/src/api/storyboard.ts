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

export interface AssembleStoryboardResponse {
  /** Storyboard-project-relative path to the assembled video. */
  output: string;
}

export interface ExportStoryboardSliderResponse {
  /** Storyboard-project-relative path to the exported self-contained HTML. */
  output: string;
}
