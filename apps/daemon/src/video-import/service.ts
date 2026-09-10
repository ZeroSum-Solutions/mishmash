// Video import job orchestration (INV-7.7). The job IS a media task — no
// new DB table (db.ts is 7C's, and the brief is explicit: "if you need a
// column, stop and report needsOwner"). This wraps its own
// `createMediaTaskStore(db)` instance (media/task-store.ts, 7C-owned but
// freely importable) rather than threading the daemon's single shared
// generate-flow instance through server.ts: both instances persist to and
// read from the SAME `media_tasks` SQLite table, so a video-import task
// still shows up anywhere that reads the table directly; only the two
// stores' in-process live-task maps (and therefore `/api/media/tasks/:id
// /wait`'s waiter notifications) stay independent of this module's own job
// route, which is the only consumer this track's red spec requires.
//
// The two stores DO share one thing that matters for cancellation:
// `media/jobs.ts`'s module-level `activeJobs` kill map is keyed by taskId
// alone, not by store instance. Registering this service's own abort there
// (`registerActiveMediaJob`) is what makes `POST /api/media/tasks/:id/cancel`
// — which reads the OTHER store — able to stop a download running here
// (INV-7.6).

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type Database from 'better-sqlite3';
import type { ProjectFile, VideoImportJob, VideoImportProvider } from '@open-design/contracts';

import { readProjectFileEntry, writeProjectFile } from '../projects.js';
import { createMediaTaskStore } from '../media/task-store.js';
import { registerActiveMediaJob, unregisterActiveMediaJob } from '../media/jobs.js';

import { FileVideoImportCredentialStore } from './credentials.js';
import { resolveVideoImportMaxBytes, resolveVideoImportTimeoutMs, resolveVimeoConfig } from './config.js';
import {
  VideoImportCanceledError,
  VideoImportLimitExceededError,
  VideoImportTimeoutError,
  downloadVimeoVideoToStaging,
  fetchVimeoVideoMetadata,
  parseVimeoVideoId,
} from './providers/vimeo.js';
import { YOUTUBE_DISABLED_REASON } from './providers/youtube.js';

export interface CreateVideoImportInput {
  projectId: string;
  provider: VideoImportProvider;
  url: string;
  as?: string;
}

export type CreateVideoImportFailure = { ok: false; status: number; code: string; message: string };
export type CreateVideoImportResult = { ok: true; job: VideoImportJob } | CreateVideoImportFailure;

// `LiveMediaTask.surface` (media/task-store.ts, 7C-owned but freely settable
// at creation) doubles as this service's own-job marker: a generic
// `media_tasks` row inserted by another feature (e.g. `od media generate`)
// never carries this value, so `getJob` can refuse to hand it back
// mislabeled as a Vimeo import (Grok r1 MEDIUM finding: cross-kind read).
// Exported so `routes/media.ts`'s cancel route names the same constant
// instead of repeating the literal: `surface` is the ONLY thing a
// video-import task carries across the two store instances (`kind` is
// in-memory only and never persisted).
export const VIDEO_IMPORT_TASK_SURFACE = 'video-import';

function defaultDestName(videoName: string, videoId: string): string {
  const slug = videoName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || `vimeo-${videoId}`}.mp4`;
}

export class VideoImportService {
  private readonly mediaTaskStore: ReturnType<typeof createMediaTaskStore>;
  private readonly credentialStore: FileVideoImportCredentialStore;

  constructor(
    _db: Database.Database,
    private readonly deps: { projectsRoot: string; runtimeDataDir: string },
  ) {
    this.mediaTaskStore = createMediaTaskStore(_db);
    this.credentialStore = new FileVideoImportCredentialStore(deps.runtimeDataDir);
  }

  async createImport(input: CreateVideoImportInput): Promise<CreateVideoImportResult> {
    if (input.provider === 'youtube') {
      return { ok: false, status: 409, code: 'CONFLICT', message: YOUTUBE_DISABLED_REASON };
    }
    if (input.provider !== 'vimeo') {
      return { ok: false, status: 404, code: 'NOT_FOUND', message: `unknown video import provider: ${input.provider}` };
    }

    const cfg = resolveVimeoConfig();
    if (!cfg.configured) {
      return { ok: false, status: 409, code: 'CONFLICT', message: 'Vimeo is not configured: set VIMEO_CLIENT_ID and VIMEO_CLIENT_SECRET' };
    }
    const record = this.credentialStore.get('vimeo');
    if (!record) {
      return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Vimeo is not connected' };
    }

    const videoId = parseVimeoVideoId(input.url);
    if (!videoId) {
      return { ok: false, status: 400, code: 'VALIDATION_FAILED', message: 'url is not a recognizable Vimeo video link' };
    }

    const maxBytes = resolveVideoImportMaxBytes();
    const timeoutMs = resolveVideoImportTimeoutMs();
    const metaResult = await fetchVimeoVideoMetadata({
      apiBaseUrl: cfg.apiBaseUrl,
      accessToken: record.accessToken,
      videoId,
      maxBytes,
    });
    if (!metaResult.ok) {
      const status = metaResult.code === 'NOT_FOUND' ? 404 : metaResult.code === 'NO_DOWNLOAD' ? 409 : 502;
      const code = metaResult.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION_FAILED';
      return { ok: false, status, code, message: metaResult.message };
    }

    const taskId = randomUUID();
    const task = this.mediaTaskStore.createMediaTask(taskId, input.projectId, { surface: VIDEO_IMPORT_TASK_SURFACE });
    // Reserve the kill-map slot synchronously, the same placeholder pattern
    // media/jobs.ts documents (jobs.ts:85-96) and routes/media.ts already
    // uses: a cancel that arrives before `runVimeoDownload` has its own
    // controller is remembered rather than lost, and re-fires against the
    // real abort the moment that registration replaces this one
    // (`registerActiveMediaJob`'s re-registration branch, jobs.ts:97-105).
    registerActiveMediaJob(taskId, () => {});
    task.status = 'running';
    this.mediaTaskStore.persistMediaTask(task);
    this.mediaTaskStore.appendTaskProgress(task, `resolved "${metaResult.metadata.name}" (${metaResult.metadata.downloadSize} bytes)`);

    const destName = (typeof input.as === 'string' && input.as.trim()) || defaultDestName(metaResult.metadata.name, videoId);

    // Fire-and-forget: the route returns the queued/running job immediately
    // (mirrors `od media generate`'s taskId-then-poll shape); progress and
    // terminal state land on the same media task the caller polls.
    void this.runVimeoDownload(task, {
      projectId: input.projectId,
      destName,
      downloadUrl: metaResult.metadata.downloadUrl,
      maxBytes,
      timeoutMs,
    });

    return { ok: true, job: this.snapshot(task, 'vimeo') };
  }

  getJob(projectId: string, jobId: string): VideoImportJob | null {
    const task = this.mediaTaskStore.getLiveMediaTask(jobId);
    if (!task || task.projectId !== projectId || task.surface !== VIDEO_IMPORT_TASK_SURFACE) return null;
    return this.snapshot(task, 'vimeo');
  }

  private async runVimeoDownload(
    task: ReturnType<VideoImportService['mediaTaskStore']['createMediaTask']>,
    opts: { projectId: string; destName: string; downloadUrl: string; maxBytes: number; timeoutMs: number },
  ): Promise<void> {
    const stagingDir = path.join(this.deps.runtimeDataDir, 'video-import', 'staging');
    let stagingPath: string | null = null;
    // The real kill for this task, replacing createImport's placeholder. It
    // is the ONE thing that makes `POST /api/media/tasks/:id/cancel` able to
    // stop this download (INV-7.6): that route reads the daemon's other
    // media-task store, but jobs.ts's activeJobs map is keyed by taskId.
    const cancelController = new AbortController();
    registerActiveMediaJob(task.id, () => cancelController.abort());
    try {
      const staged = await downloadVimeoVideoToStaging({
        downloadUrl: opts.downloadUrl,
        maxBytes: opts.maxBytes,
        timeoutMs: opts.timeoutMs,
        stagingDir,
        cancelSignal: cancelController.signal,
        onProgress: (bytesRead, declaredTotal) => {
          if (declaredTotal && declaredTotal > 0) {
            task.fraction = Math.min(1, bytesRead / declaredTotal);
          }
        },
      });
      stagingPath = staged.stagingPath;

      const buffer = await fs.promises.readFile(staged.stagingPath);
      await writeProjectFile(this.deps.projectsRoot, opts.projectId, opts.destName, buffer, {});
      await fs.promises.unlink(staged.stagingPath).catch(() => {});
      stagingPath = null;

      const entry = (await readProjectFileEntry(this.deps.projectsRoot, opts.projectId, opts.destName)) as ProjectFile | null;
      task.status = 'done';
      task.file = entry;
      task.endedAt = Date.now();
      task.fraction = 1;
      this.mediaTaskStore.appendTaskProgress(task, `wrote ${opts.destName} (${staged.bytes} bytes)`);
      this.mediaTaskStore.persistMediaTask(task);
      this.mediaTaskStore.notifyTaskWaiters(task);
    } catch (err) {
      if (stagingPath) await fs.promises.unlink(stagingPath).catch(() => {});
      // A cancel is checked FIRST: it aborts the same controller the deadline
      // does, so a caller-driven stop would otherwise be reported as the
      // timeout the user never hit.
      const canceled = err instanceof VideoImportCanceledError;
      const limitBreach = err instanceof VideoImportLimitExceededError;
      const timeoutBreach = err instanceof VideoImportTimeoutError;
      task.status = 'failed';
      task.error = {
        message: err instanceof Error ? err.message : String(err),
        code: canceled
          ? 'CANCELED'
          : limitBreach
            ? 'LIMIT_EXCEEDED'
            : timeoutBreach
              ? 'TIMEOUT'
              : 'UPSTREAM_ERROR',
      };
      task.endedAt = Date.now();
      this.mediaTaskStore.persistMediaTask(task);
      this.mediaTaskStore.notifyTaskWaiters(task);
    } finally {
      unregisterActiveMediaJob(task.id);
    }
  }

  private snapshot(
    task: ReturnType<VideoImportService['mediaTaskStore']['createMediaTask']>,
    provider: VideoImportProvider,
  ): VideoImportJob {
    const base = this.mediaTaskStore.mediaTaskSnapshot(task);
    const fraction = base.fraction;
    const job: VideoImportJob = {
      jobId: task.id,
      taskId: task.id,
      provider,
      status: base.status,
      progress: base.progress,
    };
    if (fraction !== undefined) job.fraction = fraction;
    if (task.status === 'done' && task.file) job.file = task.file as ProjectFile;
    if (task.error) job.error = { code: task.error.code ?? 'UPSTREAM_ERROR', message: task.error.message };
    return job;
  }
}
