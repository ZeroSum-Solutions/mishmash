// Contracts for the staged project-upload session (Part 2 item 2.17,
// re-derived for MishMash — nothing copied from ONE BOX). A session
// separates SUBSCRIBING to an upload's progress from SENDING its bytes: a
// client creates the session (JSON), subscribes to `GET .../events`, then
// PUTs each file's raw bytes — a client can never watch the same request
// that carries the bytes it is watching (r2 W7-R2-08).

/** One accepted upload kind: which extensions map to which MIME, and how the
 *  daemon verifies the declared type against the actual bytes. */
export interface UploadAcceptedKind {
  extensions: string[];
  mime: string;
  sniff: 'magic' | 'text' | 'zip';
}

/** Published, resolved upload limits — the ONE number every surface (web
 *  drop UI, `od project upload --help`, the daemon's own enforcement) reads,
 *  instead of a hardcoded copy drifting out of sync with the real ceiling. */
export interface UploadLimitsResponse {
  maxFileBytes: number;
  maxFilesPerRequest: number;
  maxTotalBytes: number;
  acceptedKinds: UploadAcceptedKind[];
}

export interface CreateProjectUploadFile {
  name: string;
  size: number;
  mime: string;
}

export interface CreateProjectUploadRequest {
  files: CreateProjectUploadFile[];
}

/** `token` is a distinct, unguessable per-session bearer. It is never placed
 *  in a URL or query string — every transfer/events/cancel call sends
 *  `Authorization: Bearer <token>`. */
export interface CreateProjectUploadResponse {
  uploadId: string;
  token: string;
  expiresAt: number;
  limits: UploadLimitsResponse;
}
