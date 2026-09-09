import { describe, expect, it } from 'vitest';

import {
  VIDEO_IMPORT_PROVIDERS,
  isVideoImportConnectResponse,
  isVideoImportJob,
  isVideoImportProvider,
  isVideoImportProviderStatus,
  isVideoImportProvidersResponse,
  isVideoImportResponse,
  type VideoImportJob,
  type VideoImportProviderStatus,
} from '../src/index';

describe('video import provider contracts', () => {
  it('lists exactly vimeo and youtube', () => {
    expect(VIDEO_IMPORT_PROVIDERS).toEqual(['vimeo', 'youtube']);
    expect(isVideoImportProvider('vimeo')).toBe(true);
    expect(isVideoImportProvider('youtube')).toBe(true);
    expect(isVideoImportProvider('dailymotion')).toBe(false);
  });

  it('validates a provider status without ever requiring a secret field', () => {
    const connected: VideoImportProviderStatus = {
      provider: 'vimeo',
      enabled: true,
      configured: true,
      connected: true,
      credentialSource: 'env',
      account: { name: 'Fixture Account' },
    };
    expect(isVideoImportProviderStatus(connected)).toBe(true);

    const disabled: VideoImportProviderStatus = {
      provider: 'youtube',
      enabled: false,
      configured: false,
      connected: false,
      credentialSource: 'unset',
    };
    expect(isVideoImportProviderStatus(disabled)).toBe(true);

    expect(isVideoImportProviderStatus({ ...connected, credentialSource: 'stored' })).toBe(false);
    expect(isVideoImportProviderStatus({ ...connected, accessToken: 'secret' })).toBe(true);
  });

  it('validates the providers-response envelope', () => {
    const response = {
      providers: [
        { provider: 'vimeo', enabled: true, configured: false, connected: false, credentialSource: 'unset' },
        { provider: 'youtube', enabled: false, configured: false, connected: false, credentialSource: 'unset' },
      ],
    };
    expect(isVideoImportProvidersResponse(response)).toBe(true);
    expect(isVideoImportProvidersResponse({ providers: [{ provider: 'vimeo' }] })).toBe(false);
    expect(isVideoImportProvidersResponse(null)).toBe(false);
  });

  it('validates the connect-response envelope', () => {
    expect(isVideoImportConnectResponse({ authorizeUrl: 'https://api.vimeo.com/oauth/authorize' })).toBe(true);
    expect(isVideoImportConnectResponse({})).toBe(false);
  });

  it('validates a video import job across its lifecycle shapes', () => {
    const queued: VideoImportJob = {
      jobId: 'task-1',
      taskId: 'task-1',
      provider: 'vimeo',
      status: 'queued',
      progress: [],
    };
    expect(isVideoImportJob(queued)).toBe(true);

    const running: VideoImportJob = {
      ...queued,
      status: 'running',
      progress: ['downloading'],
      fraction: 0.42,
    };
    expect(isVideoImportJob(running)).toBe(true);

    const done: VideoImportJob = {
      ...running,
      status: 'done',
      fraction: 1,
      file: { name: 'clip.mp4', size: 10, mtime: 0, kind: 'video', mime: 'video/mp4' },
    };
    expect(isVideoImportJob(done)).toBe(true);
    expect(isVideoImportResponse({ job: done })).toBe(true);

    const failed: VideoImportJob = {
      ...running,
      status: 'failed',
      error: { code: 'LIMIT_EXCEEDED', message: 'exceeded OD_VIDEO_IMPORT_MAX_BYTES' },
    };
    expect(isVideoImportJob(failed)).toBe(true);

    expect(isVideoImportJob({ ...queued, provider: 'dailymotion' })).toBe(false);
    expect(isVideoImportJob({ ...queued, progress: 'nope' })).toBe(false);
    expect(isVideoImportResponse({ job: { ...queued, jobId: 1 } })).toBe(false);
    expect(isVideoImportResponse(null)).toBe(false);
  });
});
