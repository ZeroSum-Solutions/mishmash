import { describe, expect, it } from 'vitest';
import {
  isMediaJobLimits,
  isMediaTaskListResponse,
  isMediaTaskSnapshot,
  type CreateMediaJobRequest,
  type MediaTaskSnapshot,
} from '../src/api/media.js';

describe('isMediaTaskSnapshot', () => {
  it('accepts a full snapshot with fraction, file, and error', () => {
    const snapshot: MediaTaskSnapshot = {
      taskId: 'task_1',
      status: 'done',
      startedAt: 1_000,
      endedAt: 2_000,
      progress: ['probing input', 'encoding: 100%'],
      fraction: 1,
      nextSince: 2,
      file: { name: 'out.mp4', size: 1024, mtime: 2_000, kind: 'video', mime: 'video/mp4' },
      kind: 'encode',
      limits: { maxDurationMs: 1_800_000, maxOutputBytes: 2 * 1024 ** 3, maxConcurrent: 2 },
    };
    expect(isMediaTaskSnapshot(snapshot)).toBe(true);
  });

  it('accepts a row persisted before this wave: bare string[] progress, no fraction, no file key while running', () => {
    const preWaveRunning = {
      taskId: 'task_2',
      status: 'running',
      startedAt: 1_000,
      endedAt: null,
      progress: ['provider task accepted'],
      nextSince: 1,
      // no `fraction`, no `file` key at all — matches mediaTaskSnapshot()'s
      // pre-this-wave behaviour, which only ever set `file` for `done`.
    };
    expect(isMediaTaskSnapshot(preWaveRunning)).toBe(true);
  });

  it('accepts a pre-existing DAEMON_RESTART interrupted row (reconcileMediaTasksOnBoot)', () => {
    const interrupted = {
      taskId: 'task_3',
      status: 'interrupted',
      startedAt: 1_000,
      endedAt: 1_500,
      progress: ['queued provider request'],
      nextSince: 1,
      error: { code: 'DAEMON_RESTART', message: 'media task interrupted by daemon restart' },
    };
    expect(isMediaTaskSnapshot(interrupted)).toBe(true);
  });

  it('rejects a body missing taskId or status', () => {
    expect(isMediaTaskSnapshot({ progress: ['whatever'] })).toBe(false);
    expect(isMediaTaskSnapshot({ taskId: 'task_4', progress: [] })).toBe(false);
  });

  it('rejects a non-array progress and a non-numeric fraction', () => {
    const base = { taskId: 'task_5', status: 'running', startedAt: 1, endedAt: null, nextSince: 0 };
    expect(isMediaTaskSnapshot({ ...base, progress: 'not an array' })).toBe(false);
    expect(isMediaTaskSnapshot({ ...base, progress: [], fraction: '0.5' })).toBe(false);
  });
});

describe('isMediaTaskListResponse', () => {
  it('accepts a list of valid snapshots and rejects one with an invalid entry', () => {
    const valid = { tasks: [{ taskId: 't1', status: 'queued', startedAt: 0, endedAt: null, progress: [], nextSince: 0 }] };
    expect(isMediaTaskListResponse(valid)).toBe(true);
    expect(isMediaTaskListResponse({ tasks: [{ status: 'queued' }] })).toBe(false);
  });
});

describe('isMediaJobLimits', () => {
  it('accepts the three resolved limit values', () => {
    expect(
      isMediaJobLimits({ maxDurationMs: 1_800_000, maxOutputBytes: 2 * 1024 ** 3, maxConcurrent: 2 }),
    ).toBe(true);
    expect(isMediaJobLimits({ maxDurationMs: 1_800_000 })).toBe(false);
  });
});

describe('CreateMediaJobRequest discriminated union', () => {
  it('accepts a well-formed encode and download request shape (compile-time check)', () => {
    const encode: CreateMediaJobRequest = {
      kind: 'encode',
      input: 'in.mp4',
      output: 'out.mp4',
      preset: 'h264-web',
    };
    const download: CreateMediaJobRequest = {
      kind: 'download',
      url: 'https://example.com/fixture.bin',
      output: 'fixture.bin',
    };
    expect(encode.kind).toBe('encode');
    expect(download.kind).toBe('download');
  });
});
