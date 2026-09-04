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

import {
  PREVIEW_PAINT_REPORT,
  PREVIEW_PAINT_REPORT_REQUEST,
  mintPreviewNavigationToken,
} from '@open-design/contracts/runtime/preview-paint-report';

import { reportSafetyEvent } from '../analytics/error-tracking';

const LOAD_TIMEOUT_MS = 15000;

/** Why a preview frame was never able to prove it rendered. */
export type PreviewPaintFailureReason =
  /** The document never answered the watchdog at all. */
  | 'no_document_report'
  /** The document answered, and reported no laid-out box with area. */
  | 'no_render_evidence'
  /** The frame raised an `error` event. */
  | 'error_event';

/**
 * What the watchdog currently knows about the document in the frame. Reported
 * to the caller so the surface can name a failure and, just as importantly,
 * stop naming one: a frame that fails and then reloads into a document that
 * paints must not keep showing "did not render" over rendered content.
 */
export type PreviewPaintState =
  /** A document is being watched and nothing is known about it yet. */
  | { status: 'watching' }
  /** The document reported positive render evidence. */
  | { status: 'painted' }
  /** The document never proved it rendered. */
  | { status: 'unproven'; reason: PreviewPaintFailureReason };

interface TrackPreviewPaintOptions {
  iframe: HTMLIFrameElement;
  artifactId?: string;
  projectId?: string;
  conversationId?: string;
  // Surface label so dashboards can split file-viewer iframes from
  // deck-viewer iframes, comment-mode iframes, etc.
  surface: string;
  /**
   * Called on every transition: a new document is being watched, the document
   * proved it rendered, or it failed to. The caller owns what the user sees;
   * the watchdog only says what it knows.
   */
  onPaintState?: (state: PreviewPaintState) => void;
}

/**
 * Watch a VISIBLE preview frame. It settles only on proof its document painted,
 * and only from the document it is currently watching.
 *
 * Three rules, and every visible preview transport is held to all three:
 *
 *  1. **The frame's own `load` event is not evidence.** It fires for an empty
 *     shell, for a 200 that rendered nothing, and for a document whose
 *     subresources were all refused. Only `od:preview-content-size`, posted
 *     from inside the document by the producer each transport carries, says the
 *     artifact document is the one running in this frame.
 *  2. **A report settles only with positive render evidence.** A document that
 *     runs and lays out to nothing answers too; `PreviewPaintReport.painted`
 *     is what separates "it ran" from "it produced geometry". The detector's
 *     honest false-positive and false-negative profile is documented on
 *     `PREVIEW_PAINT_REPORT_PRODUCER_SOURCE` in `packages/contracts`.
 *  3. **A report settles only the document it was asked of.**
 *     `iframe.contentWindow` is the same WindowProxy across a navigation, so
 *     event-source matching cannot tell the outgoing document from its
 *     replacement. Each arming mints a navigation token the producer echoes,
 *     and a `load` event re-arms — a new document in the frame is a new
 *     document to watch, whatever the previous one had already proved.
 *
 * The caller owns one half of this: install it only while the frame is the
 * visible transport AND carries a real artifact document. A watchdog over a
 * lazy shell, a redirect-blocked placeholder, or a frame parked at
 * `about:blank` waits for a report no document exists to make, and manufactures
 * a false timeout.
 */
export function trackPreviewPaint(options: TrackPreviewPaintOptions): () => void {
  const { iframe, surface } = options;
  let startedAt = performance.now();
  let settled = false;
  let reported = false;
  let navigationToken = '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fail = (event: string, reason: PreviewPaintFailureReason, extras: Record<string, unknown> = {}): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    reportSafetyEvent(event, {
      surface,
      reason,
      duration_ms: Math.round(performance.now() - startedAt),
      artifact_id: options.artifactId,
      project_id: options.projectId,
      conversation_id: options.conversationId,
      ...extras,
    });
    options.onPaintState?.({ status: 'unproven', reason });
  };

  // We don't emit a success event — it would multiply ingest cost for the
  // most common case. Settling only stops the watchdog.
  const settleQuietly = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    options.onPaintState?.({ status: 'painted' });
  };

  const onTimeout = (): void => {
    fail('client_iframe_timeout', reported ? 'no_render_evidence' : 'no_document_report', {
      timeout_ms: LOAD_TIMEOUT_MS,
    });
  };

  // Ask the frame to report itself, for THIS arming. A live artifact document
  // answers within a frame or two; a frame that never received one cannot
  // answer at all, which is the distinction this watchdog draws. Needed because
  // instrumentation can start AFTER the document already reported — entering a
  // mode that flips the srcDoc frame from hidden to active does exactly that,
  // and without the ask the watchdog would wait for a report that has already
  // been made.
  const requestDocumentReport = (): void => {
    try {
      iframe.contentWindow?.postMessage(
        { type: PREVIEW_PAINT_REPORT_REQUEST, token: navigationToken },
        '*',
      );
    } catch {
      // A torn-down frame cannot be asked; the timeout stands.
    }
  };

  const arm = (): void => {
    clearTimeout(timer);
    settled = false;
    reported = false;
    startedAt = performance.now();
    navigationToken = mintPreviewNavigationToken();
    timer = setTimeout(onTimeout, LOAD_TIMEOUT_MS);
    options.onPaintState?.({ status: 'watching' });
    requestDocumentReport();
  };

  // A `load` event means a different document now occupies the frame. Whatever
  // the previous one proved was about the previous one, so start over: this is
  // what stops a stuck replacement from inheriting its predecessor's evidence.
  const onLoad = (): void => {
    arm();
  };

  const onDocumentReport = (event: MessageEvent): void => {
    if (event.source !== iframe.contentWindow) return;
    const data = event.data as { type?: string; painted?: unknown; token?: unknown } | null;
    if (data?.type !== PREVIEW_PAINT_REPORT) return;
    if (data.token !== navigationToken) return;
    reported = true;
    if (data.painted !== true) return;
    settleQuietly();
  };

  const onError = (): void => {
    fail('client_iframe_error', 'error_event');
  };

  iframe.addEventListener('load', onLoad);
  iframe.addEventListener('error', onError);
  window.addEventListener('message', onDocumentReport);

  arm();

  return () => {
    clearTimeout(timer);
    iframe.removeEventListener('load', onLoad);
    iframe.removeEventListener('error', onError);
    window.removeEventListener('message', onDocumentReport);
  };
}
