// Video import — Vimeo OAuth source pulling first, YouTube declared but
// disabled (Part 8 F-05). Provider/connect surface plus the create-import
// job wire. `MediaTaskStatus` comes from ./media.js (7C, cherry-picked
// 488a925e) — this file never defines a local status union.

import type { ProjectFile } from './files.js';
import type { MediaTaskStatus } from './media.js';

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

// ---------------------------------------------------------------------------
// Create-import job wire (`POST /api/projects/:id/video-imports`,
// `GET /api/projects/:id/video-imports/:jobId`). The job is a media task
// (kind: 'download'): no new DB table, `jobId` is that task's `taskId`.
// ---------------------------------------------------------------------------

/**
 * `POST /api/projects/:id/video-imports` request body. `as` is an optional
 * project-relative destination path; when omitted the daemon derives one
 * from the provider's video name.
 */
export interface CreateVideoImportRequest {
  provider: VideoImportProvider;
  url: string;
  as?: string;
}

export interface VideoImportJob {
  jobId: string;
  taskId: string;
  provider: VideoImportProvider;
  status: MediaTaskStatus;
  /** Human-readable progress lines, append-only (mirrors MediaTaskSnapshot). */
  progress: string[];
  /** Aggregate progress in [0, 1], when known (declared Content-Length / bytes so far). */
  fraction?: number;
  /** Present once `status` is `'done'`. */
  file?: ProjectFile;
  error?: { code: string; message: string };
}

export interface VideoImportResponse {
  job: VideoImportJob;
}

function isProjectFileLike(value: unknown): value is ProjectFile {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === 'string'
    && typeof candidate.size === 'number'
    && typeof candidate.mtime === 'number'
    && typeof candidate.kind === 'string'
    && typeof candidate.mime === 'string'
  );
}

export function isVideoImportJob(value: unknown): value is VideoImportJob {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.jobId !== 'string') return false;
  if (typeof candidate.taskId !== 'string') return false;
  if (!isVideoImportProvider(candidate.provider)) return false;
  if (typeof candidate.status !== 'string') return false;
  if (!Array.isArray(candidate.progress) || !candidate.progress.every((line) => typeof line === 'string')) {
    return false;
  }
  if (candidate.fraction !== undefined && typeof candidate.fraction !== 'number') return false;
  if (candidate.file !== undefined && !isProjectFileLike(candidate.file)) return false;
  if (candidate.error !== undefined) {
    if (candidate.error === null || typeof candidate.error !== 'object') return false;
    const error = candidate.error as Record<string, unknown>;
    if (typeof error.code !== 'string' || typeof error.message !== 'string') return false;
  }
  return true;
}

export function isVideoImportResponse(value: unknown): value is VideoImportResponse {
  if (value === null || typeof value !== 'object') return false;
  return isVideoImportJob((value as Record<string, unknown>).job);
}
