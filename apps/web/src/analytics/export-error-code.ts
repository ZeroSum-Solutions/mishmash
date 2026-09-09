/**
 * Classify a failed-export error into a stable, queryable analytics code for
 * `artifact_export_result.error_code`.
 *
 * The export UI used to report `err.name` for every failure, which collapses
 * to the generic `"Error"` for the common case (a plain `Error` thrown from
 * the export runtime). That made distinct failure modes indistinguishable in
 * analytics — in particular the daemon↔desktop sidecar version skew, where a
 * freshly-updated daemon sends a `render-slides` message an older desktop
 * process doesn't understand and the daemon surfaces
 * `desktop renderer unavailable: unknown desktop sidecar message: render-slides`.
 *
 * This maps the known daemon/runtime failure signatures to specific codes so
 * `error_code` separates "version-skewed mesh" from ordinary render failures
 * (timeouts, unreadable payloads, etc.). A structured `.code` on the error
 * (e.g. a future typed daemon error) always wins over message classification.
 *
 * INVARIANT: this is the GENERIC classifier used by every export path
 * (`fireShareExport`'s PDF/ZIP/HTML/Markdown/PPTX/share-link/share-page
 * failures) and must never return a `CAPTURE_*` code. Those codes mean "this
 * failure happened while a snapshot was being captured" — something only true
 * for the image-export bridge — and belong exclusively to `captureErrorCode`
 * below. A generic export that merely happens to fail with a timeout-shaped
 * message (e.g. a share-link request timeout) is not a capture failure.
 */
export function exportErrorCode(err: unknown): string {
  const structured = (err as { code?: unknown } | null | undefined)?.code;
  if (typeof structured === 'string' && structured.length > 0) return structured;
  if (!(err instanceof Error)) return 'UNKNOWN';
  const message = err.message ?? '';
  // The daemon rejected a desktop sidecar message it doesn't recognize — the
  // fingerprint of a version-skewed mesh (new daemon → old desktop). Check this
  // BEFORE the broader "renderer unavailable" branch: the daemon wraps the skew
  // as "desktop renderer unavailable: unknown desktop sidecar message: <type>",
  // so the raw text matches both patterns.
  if (/unknown \w+ sidecar message/i.test(message)) return 'DESKTOP_SIDECAR_UNKNOWN_MESSAGE';
  if (/renderer (?:is )?unavailable/i.test(message)) return 'DESKTOP_RENDERER_UNAVAILABLE';
  return err.name || 'UNKNOWN';
}

/**
 * Classify a failure that happened DURING snapshot capture — the client-bridge
 * foreignObject capture (`bridgeCaptureFailureErrorCode` in FileViewer.tsx) and
 * the capture stage of the image-export flow (`stageAwareExportErrorCode` at
 * `stage === 'capture'`).
 *
 * INVARIANT: only a failure that happened during snapshot capture may carry a
 * CAPTURE_* code. Checks the capture-specific timeout / empty-render / tainted
 * signatures first (these used to live on `exportErrorCode` itself, gated on
 * every caller instead of just the capture one); anything that doesn't match
 * falls through to the generic classification above, so a capture-stage
 * failure with, say, a structured `.code` or a sidecar-skew message still gets
 * that specific code instead of a capture-shaped guess.
 */
export function captureErrorCode(err: unknown): string {
  if (err instanceof Error) {
    const message = err.message ?? '';
    if (/timeout/i.test(message) || err.name === 'TimeoutError') return 'CAPTURE_TIMEOUT';
    if (/empty-render/i.test(message)) return 'CAPTURE_EMPTY_RENDER';
    if (err.name === 'SecurityError' || /tainted/i.test(message)) return 'CAPTURE_TAINTED';
  }
  return exportErrorCode(err);
}
