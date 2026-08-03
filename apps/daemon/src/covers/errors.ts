// Typed renderer failures (C4-5). The typed code is what distinguishes a
// PROVEN enforced bound from an incidental crash -- routes/covers.ts maps
// these directly onto the frozen `{ ok: false, error: { code, message } }`
// envelope.

export class RenderTimeoutError extends Error {
  readonly code = 'RENDER_TIMEOUT' as const;
  constructor(message = 'cover render exceeded the per-job timeout') {
    super(message);
    this.name = 'RenderTimeoutError';
  }
}

export class RenderMemoryLimitError extends Error {
  readonly code = 'RENDER_MEMORY_LIMIT' as const;
  constructor(message = 'cover render exceeded the enforced memory ceiling') {
    super(message);
    this.name = 'RenderMemoryLimitError';
  }
}

export class NoRenderableEntryError extends Error {
  readonly code = 'NO_RENDERABLE_ENTRY' as const;
  constructor(message = 'project has no HTML entry file to render') {
    super(message);
    this.name = 'NoRenderableEntryError';
  }
}

export function isTypedCoverError(
  err: unknown,
): err is RenderTimeoutError | RenderMemoryLimitError | NoRenderableEntryError {
  return (
    err instanceof RenderTimeoutError ||
    err instanceof RenderMemoryLimitError ||
    err instanceof NoRenderableEntryError
  );
}
