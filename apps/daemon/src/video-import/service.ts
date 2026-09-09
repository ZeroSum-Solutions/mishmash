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
// Progress fraction is tracked in a side map keyed by taskId rather than on
// the `LiveMediaTask` object itself: that type (media/tasks.ts, 7C-owned)
// has no `fraction` field, and this track must not edit that file.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type Database from 'better-sqlite3';
import type { ProjectFile, VideoImportJob, VideoImportProvider } from '@open-design/contracts';

import { readProjectFileEntry, writeProjectFile } from '../projects.js';
import { createMediaTaskStore } from '../media/task-store.js';

import { FileVideoImportCredentialStore } from './credentials.js';
import { resolveVideoImportMaxBytes, resolveVideoImportTimeoutMs, resolveVimeoConfig } from './config.js';
import {
  VideoImportLimitExceededError,
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
  private readonly fractions = new Map<string, number>();

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
    const task = this.mediaTaskStore.createMediaTask(taskId, input.projectId, {});
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

  getJob(jobId: string): VideoImportJob | null {
    const task = this.mediaTaskStore.getLiveMediaTask(jobId);
    if (!task) return null;
    return this.snapshot(task, 'vimeo');
  }

  private async runVimeoDownload(
    task: ReturnType<VideoImportService['mediaTaskStore']['createMediaTask']>,
    opts: { projectId: string; destName: string; downloadUrl: string; maxBytes: number; timeoutMs: number },
  ): Promise<void> {
    const stagingDir = path.join(this.deps.runtimeDataDir, 'video-import', 'staging');
    let stagingPath: string | null = null;
    try {
      const staged = await downloadVimeoVideoToStaging({
        downloadUrl: opts.downloadUrl,
        maxBytes: opts.maxBytes,
        timeoutMs: opts.timeoutMs,
        stagingDir,
        onProgress: (bytesRead, declaredTotal) => {
          if (declaredTotal && declaredTotal > 0) {
            this.fractions.set(task.id, Math.min(1, bytesRead / declaredTotal));
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
      this.fractions.set(task.id, 1);
      this.mediaTaskStore.appendTaskProgress(task, `wrote ${opts.destName} (${staged.bytes} bytes)`);
      this.mediaTaskStore.persistMediaTask(task);
      this.mediaTaskStore.notifyTaskWaiters(task);
    } catch (err) {
      if (stagingPath) await fs.promises.unlink(stagingPath).catch(() => {});
      const limitBreach = err instanceof VideoImportLimitExceededError;
      task.status = 'failed';
      task.error = {
        message: err instanceof Error ? err.message : String(err),
        code: limitBreach ? 'LIMIT_EXCEEDED' : 'UPSTREAM_ERROR',
      };
      task.endedAt = Date.now();
      this.mediaTaskStore.persistMediaTask(task);
      this.mediaTaskStore.notifyTaskWaiters(task);
    }
  }

  private snapshot(
    task: ReturnType<VideoImportService['mediaTaskStore']['createMediaTask']>,
    provider: VideoImportProvider,
  ): VideoImportJob {
    const base = this.mediaTaskStore.mediaTaskSnapshot(task);
    const fraction = this.fractions.get(task.id);
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
