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

/** The one extension match every surface runs against a PUBLISHED
 *  `acceptedKinds` list (`GET .../uploads/limits`): the last `.`-segment of
 *  `name`, lower-cased, looked up across each kind's extension aliases.
 *  This is the same match the daemon performs against its own list, so the
 *  web client's pre-request rejection (INV-7.3) can never disagree with the
 *  daemon's verdict — without importing daemon internals. Returns null for
 *  no extension, an unlisted extension, or an empty list. */
export function matchAcceptedKind(name: string, kinds: UploadAcceptedKind[]): UploadAcceptedKind | null {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return null;
  const ext = name.slice(idx + 1).toLowerCase();
  if (!ext) return null;
  return kinds.find((kind) => kind.extensions.includes(ext)) ?? null;
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
  /** Project-relative destination folder (forward slashes, no leading
   *  slash), mirroring the legacy multipart route's `dir` form field. It is
   *  resolved, confined, and sanitized ONCE at session creation — a hostile
   *  or traversal-escaping value is rejected before any byte is accepted —
   *  never per file. Omitted or empty means the project root. Each
   *  `ProjectUploadCompleted.files[].path` is then project-relative
   *  INCLUDING this folder, not a bare basename. */
  dir?: string;
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
