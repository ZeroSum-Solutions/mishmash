import { describe, expect, it } from 'vitest';

import {
  VIDEO_IMPORT_PROVIDERS,
  isVideoImportConnectResponse,
  isVideoImportProvider,
  isVideoImportProviderStatus,
  isVideoImportProvidersResponse,
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
});
