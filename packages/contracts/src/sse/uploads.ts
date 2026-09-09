// SSE events for the staged project-upload session (`GET
// /api/projects/:id/uploads/:uploadId/events`). Byte progress and the
// terminal outcome are typed events here, never an inferred percentage
// derived client-side from XHR `upload.onprogress` — INV-7.1, INV-7.3.

export interface ProjectUploadStarted {
  type: 'upload-started';
  uploadId: string;
  files: { index: number; name: string; size: number }[];
}

/** Monotonic per-file byte progress: `bytesReceived` never decreases across
 *  events carrying the same `index` within one session. */
export interface ProjectUploadProgress {
  type: 'upload-progress';
  uploadId: string;
  index: number;
  name: string;
  bytesReceived: number;
  totalBytes: number;
}

export interface ProjectUploadCommittedFile {
  name: string;
  path: string;
  size: number;
  mtime: number;
  originalName: string;
}

/** Exactly one terminal event per session: the committed files are already
 *  on disk (bytes fsynced and renamed into place) by the time this fires. */
export interface ProjectUploadCompleted {
  type: 'upload-completed';
  uploadId: string;
  files: ProjectUploadCommittedFile[];
}

export type ProjectUploadFailureCode =
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'VALIDATION_FAILED'
  | 'CANCELLED'
  | 'INVALID_REQUEST'
  | 'CONFLICT';

/** The other terminal event: nothing was committed. `limitBytes` is present
 *  only for `PAYLOAD_TOO_LARGE`; `file` names the offending file when one
 *  file caused the failure. */
export interface ProjectUploadFailed {
  type: 'upload-failed';
  uploadId: string;
  code: ProjectUploadFailureCode;
  message: string;
  limitBytes?: number;
  file?: string;
}

export type ProjectUploadSseEvent =
  | ProjectUploadStarted
  | ProjectUploadProgress
  | ProjectUploadCompleted
  | ProjectUploadFailed;

const PROJECT_UPLOAD_SSE_TYPES = new Set<ProjectUploadSseEvent['type']>([
  'upload-started',
  'upload-progress',
  'upload-completed',
  'upload-failed',
]);

/** Runtime guard so SSE consumers (web, CLI, tests) never trust an
 *  unvalidated frame body — every red-spec fixture parses events through
 *  this guard rather than asserting on a hand-typed object (D-18). */
export function isProjectUploadSseEvent(value: unknown): value is ProjectUploadSseEvent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown; uploadId?: unknown };
  if (typeof candidate.uploadId !== 'string' || !candidate.uploadId) return false;
  if (typeof candidate.type !== 'string' || !PROJECT_UPLOAD_SSE_TYPES.has(candidate.type as ProjectUploadSseEvent['type'])) {
    return false;
  }
  switch (candidate.type) {
    case 'upload-started': {
      const files = (value as ProjectUploadStarted).files;
      return Array.isArray(files) && files.every(
        (f) => f && typeof f.index === 'number' && typeof f.name === 'string' && typeof f.size === 'number',
      );
    }
    case 'upload-progress': {
      const v = value as ProjectUploadProgress;
      return (
        typeof v.index === 'number' &&
        typeof v.name === 'string' &&
        typeof v.bytesReceived === 'number' &&
        typeof v.totalBytes === 'number'
      );
    }
    case 'upload-completed': {
      const files = (value as ProjectUploadCompleted).files;
      return Array.isArray(files) && files.every(
        (f) =>
          f &&
          typeof f.name === 'string' &&
          typeof f.path === 'string' &&
          typeof f.size === 'number' &&
          typeof f.mtime === 'number' &&
          typeof f.originalName === 'string',
      );
    }
    case 'upload-failed': {
      const v = value as ProjectUploadFailed;
      return typeof v.code === 'string' && typeof v.message === 'string';
    }
    default:
      return false;
  }
}
