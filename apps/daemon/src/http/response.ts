import type { Response } from 'express';
import { createApiErrorResponse, type ApiError, type ApiErrorCode } from '@open-design/contracts';

export function sendJson(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}

export function sendApiError(res: Response, status: number, error: ApiError): void {
  res.status(status).json(createApiErrorResponse(error));
}

const ERROR_STATUS_BY_CODE: Partial<Record<ApiErrorCode, number>> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  VALIDATION_FAILED: 422,
  // Routing policy refused to dispatch. 422 rather than 403: the caller is
  // entitled to the operation, so this is not an authorization failure, and
  // rather than the unmapped-code 500 default, because nothing is broken --
  // the request was well-formed and policy declined it.
  ROUTING_BLOCKED: 422,
  RATE_LIMITED: 429,
  PROJECT_NOT_FOUND: 404,
  FILE_NOT_FOUND: 404,
  ARTIFACT_NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
  AGENT_UNAVAILABLE: 503,
  UPSTREAM_UNAVAILABLE: 502,
};

export function statusForError(error: ApiError): number {
  return ERROR_STATUS_BY_CODE[error.code] ?? 500;
}
