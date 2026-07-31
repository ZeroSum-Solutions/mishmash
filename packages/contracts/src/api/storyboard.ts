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
