import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import {
  PREVIEW_PAINT_REPORT_PRODUCER_SOURCE,
  PREVIEW_PAINT_REPORT_REQUEST,
} from '@open-design/contracts/runtime/preview-paint-report';
import { ConnectorServiceError } from '../connectors/service.js';
import { sendApiError } from '../http/api-errors.js';
import { LiveArtifactRefreshAbortError } from './refresh.js';
import { LiveArtifactRefreshUnavailableError } from './refresh-service.js';
import {
  LiveArtifactRefreshLockError,
  LiveArtifactStoreValidationError,
} from './store.js';

export function sendLiveArtifactRouteError(res: Response, err: unknown): Response {
  if (err instanceof LiveArtifactStoreValidationError) {
    return sendApiError(res, 400, 'LIVE_ARTIFACT_INVALID', err.message, {
      details: {
        kind: 'validation',
        issues: err.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
    });
  }
  if (err instanceof LiveArtifactRefreshLockError) {
    return sendApiError(res, 409, 'REFRESH_LOCKED', err.message, {
      details: { artifactId: err.artifactId },
    });
  }
  if (err instanceof LiveArtifactRefreshUnavailableError) {
    return sendApiError(res, 400, 'LIVE_ARTIFACT_REFRESH_UNAVAILABLE', err.message);
  }
  if (err instanceof LiveArtifactRefreshAbortError) {
    return sendApiError(res, err.kind === 'cancelled' ? 499 : 504, 'LIVE_ARTIFACT_REFRESH_TIMEOUT', err.message, {
      details: { kind: err.kind, timeoutMs: err.timeoutMs ?? null, step: err.step ?? null },
    });
  }
  if (err instanceof ConnectorServiceError) {
    return sendApiError(res, err.status, err.code, err.message, err.details === undefined ? {} : { details: err.details });
  }
  if (isNodeErrorWithCode(err, 'ENOENT')) {
    return sendApiError(res, 404, 'LIVE_ARTIFACT_NOT_FOUND', 'live artifact not found');
  }
  return sendApiError(res, 500, 'LIVE_ARTIFACT_STORAGE_FAILED', String(err));
}

/**
 * Serve the live-artifact preview so exactly one script can run in it: the
 * paint-report producer this response carries, authorized by a nonce minted
 * for this response alone.
 *
 * The invariant, and the reason both CSP controls move together (D-17 option
 * A): a visible preview must be able to prove it rendered, and the effective
 * sandbox of a framed document is the INTERSECTION of this header's `sandbox`
 * directive with the iframe element's `sandbox` attribute. Authorizing the
 * producer by nonce alone would still leave it unable to run, because the
 * header's sandbox withheld `allow-scripts`. So the header allows scripts and
 * names the one nonce that may be one.
 *
 * What does NOT move: `allow-same-origin` stays out of both halves, so the
 * document keeps an opaque origin; `connect-src`, `object-src` and
 * `form-action` stay `'none'`, so the admitted script can reach no network, no
 * plugin, and no form target. That is the same posture the srcDoc preview
 * already runs the same agent HTML under.
 *
 * Returns the nonce, which the caller must stamp on the producer it injects —
 * `injectLiveArtifactPaintReporter` is the only intended consumer.
 */
export function setLiveArtifactPreviewHeaders(res: Response): string {
  const nonce = randomBytes(16).toString('base64');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      // The preview document declares its own asset-resolution root (see
      // projectRawAssetBaseHref); 'self' admits that base and still refuses
      // one that would send relative refs off this origin.
      "base-uri 'self'",
      `script-src 'nonce-${nonce}'`,
      "object-src 'none'",
      "connect-src 'none'",
      "form-action 'none'",
      "frame-ancestors 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'unsafe-inline'",
      'sandbox allow-scripts',
    ].join('; '),
  );
  return nonce;
}

/**
 * Append the paint-report producer to a live-artifact preview document, under
 * the nonce `setLiveArtifactPreviewHeaders` minted for the same response.
 *
 * The producer is the shared one every preview transport carries
 * (`PREVIEW_PAINT_REPORT_PRODUCER_SOURCE`), plus the request handler that
 * answers the host watchdog and the unsolicited reports a late-painting
 * document needs. Nothing else in the document can run: the response's
 * `script-src` names this nonce and nothing else.
 */
export function injectLiveArtifactPaintReporter(html: string, nonce: string): string {
  const script = `<script nonce="${nonce}" data-od-live-artifact-paint-bridge>${PREVIEW_PAINT_REPORT_PRODUCER_SOURCE}
(function(){
  if (window.__odLiveArtifactPaintBridge) return;
  window.__odLiveArtifactPaintBridge = true;
  var pending = false;
  var report = window.__odPreviewPaintReport;
  function schedule(){
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(function(){
      pending = false;
      report.post();
    });
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== '${PREVIEW_PAINT_REPORT_REQUEST}') return;
    report.rememberToken(data.token);
    // Answered synchronously: animation frames are paused in a hidden tab
    // while the host watchdog's timeout keeps running, so a scheduled answer
    // would turn a healthy backgrounded preview into a client_iframe_timeout.
    report.post();
  });
  window.addEventListener('resize', schedule);
  if (typeof ResizeObserver !== 'undefined') {
    try {
      var observer = new ResizeObserver(schedule);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
    } catch (_) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    setTimeout(schedule, 0);
  }
  setTimeout(schedule, 80);
  setTimeout(schedule, 260);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(schedule).catch(function(){});
  }
})();</script>`;
  const bodyCloseIndex = html.search(/<\/body\s*>/i);
  if (bodyCloseIndex >= 0) {
    return `${html.slice(0, bodyCloseIndex)}${script}${html.slice(bodyCloseIndex)}`;
  }
  return `${html}${script}`;
}

export function setLiveArtifactCodeHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function isNodeErrorWithCode(err: unknown, code: string): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && err.code === code);
}
