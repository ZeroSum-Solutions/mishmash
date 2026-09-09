// Video import — Vimeo OAuth source pulling first, YouTube declared but
// disabled (Part 8 F-05). Only the provider/connect surface lives here;
// the import-job wire (CreateVideoImportRequest, VideoImportJob,
// VideoImportResponse) is added once packages/contracts/src/api/media.ts
// carries MediaTaskStatus/MediaTaskSnapshot — this file never defines a
// local status union while that lands.

export const VIDEO_IMPORT_PROVIDERS = ['vimeo', 'youtube'] as const;

export type VideoImportProvider = (typeof VIDEO_IMPORT_PROVIDERS)[number];

export function isVideoImportProvider(value: unknown): value is VideoImportProvider {
  return value === 'vimeo' || value === 'youtube';
}

export interface VideoImportProviderAccount {
  name: string;
}

/**
 * Non-secret provider status for the Settings "Video sources" card and
 * `od video-import status`. `credentialSource` says WHERE the app
 * credentials (client id/secret) came from — never their value — so the UI
 * can tell "not configured" apart from "configured but not yet connected"
 * without the daemon ever echoing a token or secret back into the DOM.
 */
export interface VideoImportProviderStatus {
  provider: VideoImportProvider;
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  credentialSource: 'env' | 'unset';
  account?: VideoImportProviderAccount;
}

export interface VideoImportProvidersResponse {
  providers: VideoImportProviderStatus[];
}

export interface VideoImportConnectResponse {
  authorizeUrl: string;
}

function isVideoImportProviderAccount(value: unknown): value is VideoImportProviderAccount {
  return (
    value !== null
    && typeof value === 'object'
    && typeof (value as Record<string, unknown>).name === 'string'
  );
}

export function isVideoImportProviderStatus(value: unknown): value is VideoImportProviderStatus {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    isVideoImportProvider(candidate.provider)
    && typeof candidate.enabled === 'boolean'
    && typeof candidate.configured === 'boolean'
    && typeof candidate.connected === 'boolean'
    && (candidate.credentialSource === 'env' || candidate.credentialSource === 'unset')
    && (candidate.account === undefined || isVideoImportProviderAccount(candidate.account))
  );
}

export function isVideoImportProvidersResponse(value: unknown): value is VideoImportProvidersResponse {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.providers) && candidate.providers.every(isVideoImportProviderStatus);
}

export function isVideoImportConnectResponse(value: unknown): value is VideoImportConnectResponse {
  if (value === null || typeof value !== 'object') return false;
  return typeof (value as Record<string, unknown>).authorizeUrl === 'string';
}
