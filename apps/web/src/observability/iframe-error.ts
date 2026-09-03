// File-viewer iframe load tracker.
//
// FileViewer is the surface where the user spends the most time looking
// at generated artifacts. iframe load failures don't propagate to the
// outer `window.error` listener — they're trapped inside the frame — so
// the global resource-error observer can't see them.
//
// This helper exposes a single function the FileViewer calls when it
// mounts an iframe; it instruments the element for failure + timeout +
// success and emits scoped events. The same function returns a cleanup
// callback so the caller can remove instrumentation if the iframe is
// reused for a different artifact.

import { reportSafetyEvent } from '../analytics/error-tracking';

const LOAD_TIMEOUT_MS = 15000;

/**
 * Message the srcdoc preview bridge posts from inside the artifact document
 * once it has measured its own rendered box. Only the real artifact carries
 * that bridge — the lazy transport shell does not — so receiving it from a
 * frame is proof the artifact document is the one running in it.
 */
const ARTIFACT_DOCUMENT_REPORT = 'od:preview-content-size';

/** The bridge's on-demand half: asks a live artifact document to report now. */
const ARTIFACT_DOCUMENT_REPORT_REQUEST = 'od:preview-content-size-request';

/**
 * What counts as proof a frame is not stuck.
 *
 * - `'load'` — the frame's own `load` event. The only signal a plain
 *   URL-loaded artifact can give, so it stays the default.
 * - `'document-report'` — a report posted by the artifact document itself.
 *   `load` is NOT accepted for these frames: it fires for the empty lazy
 *   transport shell, so a frame that never receives its artifact loads
 *   "successfully" and then sits blank forever. That stuck preview is the
 *   case `client_iframe_timeout` was written for and never fired on.
 */
export type IframeSettleEvidence = 'load' | 'document-report';

interface TrackIframeOptions {
  iframe: HTMLIFrameElement;
  artifactId?: string;
  projectId?: string;
  conversationId?: string;
  // Surface label so dashboards can split file-viewer iframes from
  // deck-viewer iframes, comment-mode iframes, etc.
  surface: string;
  /** Defaults to `'load'`; see `IframeSettleEvidence`. */
  settlesOn?: IframeSettleEvidence;
}

export function trackIframeLoad(options: TrackIframeOptions): () => void {
  const { iframe, surface, settlesOn = 'load' } = options;
  const startedAt = performance.now();
  let settled = false;

  const settle = (event: string, extras: Record<string, unknown> = {}): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    reportSafetyEvent(event, {
      surface,
      duration_ms: Math.round(performance.now() - startedAt),
      artifact_id: options.artifactId,
      project_id: options.projectId,
      conversation_id: options.conversationId,
      ...extras,
    });
  };

  // We don't emit a success event — it would multiply ingest cost for the
  // most common case. Settling only stops the watchdog.
  const settleQuietly = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
  };

  // Ask the frame to report itself. A live artifact document answers within a
  // frame or two; a frame that never received one cannot answer at all, which
  // is the distinction this watchdog draws. Needed because instrumentation can
  // start AFTER the document already reported — entering a mode that flips the
  // srcDoc frame from hidden to active does exactly that, and without the ask
  // the watchdog would wait for a report that has already been made.
  const requestDocumentReport = (): void => {
    if (settlesOn !== 'document-report') return;
    try {
      iframe.contentWindow?.postMessage({ type: ARTIFACT_DOCUMENT_REPORT_REQUEST }, '*');
    } catch {
      // A torn-down frame cannot be asked; the timeout stands.
    }
  };

  const onLoad = (): void => {
    if (settlesOn === 'load') settleQuietly();
    else requestDocumentReport();
  };

  const onDocumentReport = (event: MessageEvent): void => {
    if (settlesOn !== 'document-report') return;
    if (event.source !== iframe.contentWindow) return;
    const data = event.data as { type?: string } | null;
    if (data?.type !== ARTIFACT_DOCUMENT_REPORT) return;
    settleQuietly();
  };

  const onError = (): void => {
    settle('client_iframe_error', { reason: 'error_event' });
  };

  iframe.addEventListener('load', onLoad);
  iframe.addEventListener('error', onError);
  window.addEventListener('message', onDocumentReport);

  const timer = setTimeout(() => {
    settle('client_iframe_timeout', { timeout_ms: LOAD_TIMEOUT_MS, settles_on: settlesOn });
  }, LOAD_TIMEOUT_MS);

  requestDocumentReport();

  return () => {
    clearTimeout(timer);
    iframe.removeEventListener('load', onLoad);
    iframe.removeEventListener('error', onError);
    window.removeEventListener('message', onDocumentReport);
  };
}
