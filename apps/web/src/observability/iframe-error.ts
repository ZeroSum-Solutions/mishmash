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
import type { PreviewPaintReport } from '@open-design/contracts/runtime/preview-paint-report';

import { reportSafetyEvent } from '../analytics/error-tracking';

const LOAD_TIMEOUT_MS = 15000;

/**
 * Second ask, after the committed document has had a moment to lay out,
 * decode its images and load its fonts. The first ask is answered at commit,
 * when a document that paints late honestly has nothing to show yet.
 */
const COMMIT_RETRY_MS = 1500;

/** Why a preview frame was never able to prove it rendered. */
export type PreviewPaintFailureReason =
  /** The document never answered the watchdog at all. */
  | 'no_document_report'
  /** The document answered, and reported no visible output. */
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
   * True when the host knows the document it wants watched has ALREADY
   * committed into this frame — a warm transport, materialised while hidden
   * and only now becoming visible, or a fast one whose `load` fired between
   * the render that pointed the frame at it and this watchdog's installation.
   * Only the caller can know that: it is the one that put the document there
   * and saw the frame load it.
   *
   * Read ONCE, at installation, so it must be read AT installation: pass a
   * value the caller computed one render earlier and a `load` that landed in
   * between is lost — the watchdog waits for one that has already happened and
   * rejects the producer's report as unsolicited. `useCommittedDocument`
   * answers this with a live read for exactly that reason; re-installing the
   * watchdog to refresh the answer instead would arm a second epoch over a
   * document that had already proved itself.
   *
   * Left false (the default) the watchdog says nothing to the frame until a
   * `load` proves the incoming document is in it. That is the point of the
   * two-phase epoch, so pass true only for a document the host has actually
   * seen commit — never as a convenience.
   */
  documentCommitted?: boolean;
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
 *  2. **A report settles only with positive VISIBLE-output evidence.** A
 *     document that runs and lays out to nothing answers too, and so does one
 *     laid out behind `visibility: hidden` or off the side of the viewport;
 *     `PreviewPaintReport.painted` is what separates "it ran" from "a user
 *     would see it". The detector's honest false-positive and false-negative
 *     profile is documented on `PREVIEW_PAINT_REPORT_PRODUCER_SOURCE` in
 *     `packages/contracts`. One class of evidence carries a caveat the report
 *     states outright — an image whose pixels the document was not allowed to
 *     read — and a settle on that is recorded rather than passed off as proof;
 *     see `recordUnverifiedEvidence`.
 *  3. **A report settles only the document the host asked.** This is a
 *     two-phase epoch, because `iframe.contentWindow` is the same WindowProxy
 *     across a navigation and neither event-source matching nor a token the
 *     outgoing document has been handed can tell the two apart:
 *
 *       - *Arming* mints a navigation token, clears what the previous document
 *         proved, and starts the 15 s deadline. It sends the frame NOTHING, so
 *         the document still occupying the frame cannot learn the token minted
 *         for its replacement and answer in its place.
 *       - *Commit* is the incoming `load`. That, and only that, discloses the
 *         token to the frame. It does not mint a second token and it does not
 *         restart the deadline: the budget covers the whole navigation, not
 *         just the part after the document arrives.
 *
 *     A report is accepted only while the epoch is unsettled, after disclosure,
 *     from `iframe.contentWindow`, carrying the current token. Everything else
 *     is counted and reported once with the eventual failure — a stuck
 *     navigation answered by its predecessor is one failure, not one anomaly
 *     per stale answer.
 *
 * The caller owns one half of this: install it only while the frame is the
 * visible transport AND carries a real artifact document. A watchdog over a
 * lazy shell, a redirect-blocked placeholder, or a frame parked at
 * `about:blank` waits for a report no document exists to make, and manufactures
 * a false timeout. The caller also owns `documentCommitted`, which is how a
 * warm transport says its document is already in the frame.
 */
export function trackPreviewPaint(options: TrackPreviewPaintOptions): () => void {
  const { iframe, surface } = options;
  let armedAt = performance.now();
  let settled = false;
  let disclosed = false;
  let reported = false;
  let staleTokenReports = 0;
  let undisclosedReports = 0;
  let latestReport: Partial<PreviewPaintReport> | null = null;
  let navigationToken = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const fail = (event: string, reason: PreviewPaintFailureReason, extras: Record<string, unknown> = {}): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    clearTimeout(retryTimer);
    reportSafetyEvent(event, {
      surface,
      reason,
      duration_ms: Math.round(performance.now() - armedAt),
      artifact_id: options.artifactId,
      project_id: options.projectId,
      conversation_id: options.conversationId,
      document_committed: disclosed,
      stale_token_reports: staleTokenReports,
      undisclosed_reports: undisclosedReports,
      report_reason: latestReport?.reason ?? null,
      report_candidates: latestReport?.counters?.seen ?? null,
      report_scan_truncated: latestReport?.scanTruncated ?? null,
      ...extras,
    });
    options.onPaintState?.({ status: 'unproven', reason });
  };

  /**
   * The invariant: a preview never settles on evidence with a caveat WITHOUT
   * that caveat being recorded.
   *
   * `evidence: 'image-unverified'` means the producer found nothing visible it
   * could decide, and one candidate it could not: a raster image that decoded
   * with intrinsic size whose pixels no canvas in that document may read (in
   * the sandboxed opaque-origin preview frame, every http(s) image). Reporting
   * it as paint is the honest call — an unread image is not evidence of a
   * blank document either — but left silent it is indistinguishable from proof
   * downstream, and a class of genuinely blank previews would settle unseen.
   *
   * This is the one exception to the watchdog's no-success-event rule, and it
   * is bounded by the same reasoning: it fires only for the caveat, never for
   * the common case.
   */
  const recordUnverifiedEvidence = (report: Partial<PreviewPaintReport>): void => {
    if (report.evidence == null) return;
    reportSafetyEvent('client_iframe_paint_unverified', {
      surface,
      report_evidence: report.evidence,
      report_image_unverified: report.counters?.imageUnverified ?? null,
      report_candidates: report.counters?.seen ?? null,
      duration_ms: Math.round(performance.now() - armedAt),
      artifact_id: options.artifactId,
      project_id: options.projectId,
      conversation_id: options.conversationId,
    });
  };

  // We don't emit a success event — it would multiply ingest cost for the
  // most common case. Settling only stops the watchdog.
  const settleQuietly = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    clearTimeout(retryTimer);
    options.onPaintState?.({ status: 'painted' });
  };

  const onTimeout = (): void => {
    fail('client_iframe_timeout', reported ? 'no_render_evidence' : 'no_document_report', {
      timeout_ms: LOAD_TIMEOUT_MS,
    });
  };

  // Ask the frame to report itself, for THIS epoch. Sent only after the
  // document committed, so the token never reaches the document being
  // replaced. Needed at all because instrumentation can start AFTER the
  // document already reported — entering a mode that flips the srcDoc frame
  // from hidden to active does exactly that, and without the ask the watchdog
  // would wait for a report that has already been made.
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

  /** Phase one: watch a navigation, and tell the frame nothing about it. */
  const armNavigation = (): void => {
    clearTimeout(timer);
    clearTimeout(retryTimer);
    settled = false;
    disclosed = false;
    reported = false;
    staleTokenReports = 0;
    undisclosedReports = 0;
    latestReport = null;
    armedAt = performance.now();
    navigationToken = mintPreviewNavigationToken();
    timer = setTimeout(onTimeout, LOAD_TIMEOUT_MS);
    options.onPaintState?.({ status: 'watching' });
  };

  /** Phase two: the document is in the frame, so it may be asked. */
  const discloseToCommittedDocument = (): void => {
    if (disclosed) return;
    disclosed = true;
    requestDocumentReport();
    // A document that paints late answers the first ask honestly with nothing.
    retryTimer = setTimeout(requestDocumentReport, COMMIT_RETRY_MS);
  };

  // A `load` event is the commit boundary. For the epoch the host armed it is
  // the moment the document arrived; for an epoch already disclosed it means a
  // DIFFERENT document now occupies the frame, so start over — this is what
  // stops a stuck replacement from inheriting its predecessor's evidence.
  const onLoad = (): void => {
    if (disclosed) armNavigation();
    discloseToCommittedDocument();
  };

  const onDocumentReport = (event: MessageEvent): void => {
    if (settled) return;
    if (event.source !== iframe.contentWindow) return;
    const data = event.data as Partial<PreviewPaintReport> | null;
    if (data?.type !== PREVIEW_PAINT_REPORT) return;
    if (!disclosed) {
      undisclosedReports += 1;
      return;
    }
    if (data.token !== navigationToken) {
      staleTokenReports += 1;
      return;
    }
    reported = true;
    latestReport = data;
    if (data.painted !== true) return;
    recordUnverifiedEvidence(data);
    settleQuietly();
  };

  const onError = (): void => {
    fail('client_iframe_error', 'error_event');
  };

  iframe.addEventListener('load', onLoad);
  iframe.addEventListener('error', onError);
  window.addEventListener('message', onDocumentReport);

  armNavigation();
  if (options.documentCommitted) discloseToCommittedDocument();

  return () => {
    clearTimeout(timer);
    clearTimeout(retryTimer);
    iframe.removeEventListener('load', onLoad);
    iframe.removeEventListener('error', onError);
    window.removeEventListener('message', onDocumentReport);
  };
}
