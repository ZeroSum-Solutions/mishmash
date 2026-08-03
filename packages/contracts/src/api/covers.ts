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
