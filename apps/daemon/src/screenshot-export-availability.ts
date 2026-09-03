// Whether this daemon can serve a screenshot export at all.
//
// `POST /api/projects/:id/export/image` (and its pdf-image / pptx siblings)
// rasterize through a desktop renderer reached over sidecar IPC. When the
// daemon was started without one — a plain `od daemon` boot, and every web
// runtime in this fork, which ships no `apps/desktop` — `handleScreenshotExport`
// answers 501 UPSTREAM_UNAVAILABLE and there is nothing a caller can do about
// it. `apps/daemon/src/export-cli-routing.ts` maps `od export --format image`
// straight onto that route, so the CLI form 501s in exactly the same runtimes.
//
// INVARIANT: nothing may instruct an agent to run the image export unless
// this predicate holds for the running daemon. The agent charter reads it at
// compose time (see `apps/daemon/src/prompts/core-slim.ts`), which is what
// keeps the prompt and the route from disagreeing.

/** The message the 501 carries; shared so the route and this module agree. */
export const SCREENSHOT_EXPORT_UNAVAILABLE_MESSAGE =
  'screenshot export is only available in the desktop runtime';

export interface ScreenshotExportRenderers {
  desktopSlideRenderer?: unknown;
  desktopArtifactExporter?: unknown;
}

/**
 * True when an image export can be rasterized: `handleScreenshotExport` uses
 * the slide renderer when it has one and falls back to the artifact exporter
 * for `format === 'image'`, so either renderer is enough. Fail-closed — an
 * unwired daemon reports false.
 */
export function isImageScreenshotExportAvailable(
  renderers: ScreenshotExportRenderers | null | undefined,
): boolean {
  return (
    typeof renderers?.desktopSlideRenderer === 'function' ||
    typeof renderers?.desktopArtifactExporter === 'function'
  );
}
