// Project cover contract (W4 — local project covers & scale).
//
// FROZEN routes (see scripts/waves/verify-w4.ts header): the generate
// endpoint is SYNCHRONOUS -- it blocks until the render job finishes
// (success, failure, or internal timeout) and returns the final result in
// the response body. Changing the route shape, field names, or error codes
// below requires a reviewed gate amendment.

export function projectCoverGeneratePath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/cover/generate`;
}

export function projectCoverFetchPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/cover`;
}

/**
 * Response header on `GET /api/projects/:id/cover`, set to `1` when the image
 * bytes in the body are the neutral placeholder rather than the project's
 * stored cover.
 *
 * The route answers 200 for every cover the daemon has advertised, including
 * one whose stored bytes it cannot read at that instant -- otherwise the
 * `<img>` a client opened on the strength of `Project.hasCover` breaks and
 * files a `resource-failed` anomaly for a resource the daemon itself
 * advertised. This header is how a caller that wants the real answer
 * (`od cover show`, a script, a future UI affordance) still tells the two
 * apart, without a second endpoint.
 *
 * Absent on a 200 carrying the stored cover, and on every 404.
 */
export const PROJECT_COVER_PLACEHOLDER_HEADER = 'x-cover-placeholder';

/** Persisted cover record (S4-1 — cover as data). */
export interface ProjectCoverRecord {
  /** Data-root-relative path to the stored cover image bytes. */
  path: string;
  /** ISO 8601 timestamp of the render that produced this record. */
  generatedAt: string;
  /**
   * Content hash spanning the TRANSITIVE local render graph (entry HTML
   * plus every linked local CSS/image/font file it references) — see
   * S4-4/C4-3. Always >= 8 hex characters.
   */
  sourceHash: string;
  width: number;
  height: number;
}

/** Typed failure codes a caller can distinguish a proven-enforced bound
 * (timeout / memory ceiling) from an incidental renderer crash. */
export type ProjectCoverErrorCode = 'RENDER_TIMEOUT' | 'RENDER_MEMORY_LIMIT' | (string & {});

export interface ProjectCoverError {
  code: ProjectCoverErrorCode;
  message: string;
}

export interface ProjectCoverGenerateSuccessResponse {
  ok: true;
  cover: ProjectCoverRecord;
}

export interface ProjectCoverGenerateFailureResponse {
  ok: false;
  error: ProjectCoverError;
}

export type ProjectCoverGenerateResponse =
  | ProjectCoverGenerateSuccessResponse
  | ProjectCoverGenerateFailureResponse;
