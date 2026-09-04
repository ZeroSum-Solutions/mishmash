/**
 * The preview paint-report protocol: how a previewed document tells the host
 * that it rendered, and which document the host is allowed to believe.
 *
 * Three transports carry a producer — the srcDoc pipeline
 * (`apps/web/src/runtime/srcdoc.ts`), the daemon's project raw/powered routes,
 * and the daemon's live-artifact preview route. They must all report the same
 * shape or the host's watchdog cannot compare them, and the detector must be
 * one implementation or the three drift apart. Both live here because
 * `packages/contracts` is the only place web and daemon may share a rule.
 *
 * Pure strings and types: no DOM, no fetch, no Node APIs. The producer source
 * is JavaScript text the transports embed; it runs in the previewed document,
 * never here.
 */

/** Report a previewed document posts to its host. */
export const PREVIEW_PAINT_REPORT = 'od:preview-content-size';

/** Host's ask: "report yourself now, for this navigation". */
export const PREVIEW_PAINT_REPORT_REQUEST = 'od:preview-content-size-request';

/** What a previewed document posts about its own rendering. */
export interface PreviewPaintReport {
  type: typeof PREVIEW_PAINT_REPORT;
  /** Widest laid-out box, for the host's zoom fitting. `null` when nothing measured. */
  width: number | null;
  /** Positive render evidence — see `previewPaintReportProducerSource`. */
  painted: boolean;
  /**
   * The navigation token the host last asked with, echoed back. `null` before
   * the host has asked. A report whose token is not the host's current one
   * came from a document the host is no longer watching.
   */
  token: string | null;
}

/**
 * Source of the shared producer half, as JavaScript text.
 *
 * Defines `window.__odPreviewPaintReport` once per document (idempotent, so a
 * document carrying two bridges installs one detector) with:
 *
 *   - `rememberToken(token)` — records the host's navigation token. Ignores a
 *     non-string, so the untokened zoom-fitting request keeps the token the
 *     watchdog set.
 *   - `post()` — posts a `PreviewPaintReport` to the host.
 *
 * **What `painted` means.** True when the document has at least one laid-out
 * box with area: the `<body>` border box, or failing that any element under it
 * (bounded scan, `PAINT_SCAN_LIMIT` elements). It is positive evidence that
 * the document produced geometry, which the frame's `load` event and a bare
 * measurement are not.
 *
 * **False negatives** (says not painted while something is visible): a document
 * whose only visible mark is a root background with a zero-height body, and a
 * document that paints later than the host's watchdog window — the producer
 * re-reports on resize, fonts-ready and its own timers, so a late painter
 * settles when it paints, but one slower than the watchdog is filed. A
 * deliberately blank artifact is reported as not painted, which is the same
 * signal as a broken one; the host cannot tell those apart from outside the
 * frame and reports what it can see.
 *
 * **False positives** (says painted while the user sees nothing): geometry
 * without pixels — a laid-out box that is transparent, `visibility: hidden`,
 * `opacity: 0`, or scrolled out of view. `display: none` has no box and is not
 * counted.
 */
export const PREVIEW_PAINT_REPORT_PRODUCER_SOURCE = `(function(){
  if (window.__odPreviewPaintReport) return;
  var PAINT_SCAN_LIMIT = 300;
  var token = null;
  function num(value){
    var next = Number(value || 0);
    return Number.isFinite(next) ? next : 0;
  }
  function measureWidth(){
    var root = document.documentElement;
    var body = document.body || root;
    if (!root) return null;
    var values = [
      root.scrollWidth,
      body && body.scrollWidth,
      root.offsetWidth,
      body && body.offsetWidth,
      root.clientWidth,
      body && body.clientWidth
    ];
    var width = 0;
    for (var i = 0; i < values.length; i += 1) {
      var next = num(values[i]);
      if (next > width) width = next;
    }
    return width > 0 ? Math.ceil(width) : null;
  }
  function hasArea(el){
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    var rect = el.getBoundingClientRect();
    return !!rect && num(rect.width) > 0 && num(rect.height) > 0;
  }
  function painted(){
    var body = document.body;
    if (!body) return false;
    if (hasArea(body)) return true;
    var nodes;
    try { nodes = body.querySelectorAll('*'); } catch (_) { return false; }
    if (!nodes) return false;
    var limit = Math.min(nodes.length, PAINT_SCAN_LIMIT);
    for (var i = 0; i < limit; i += 1) {
      if (hasArea(nodes[i])) return true;
    }
    return false;
  }
  window.__odPreviewPaintReport = {
    rememberToken: function(next){
      if (typeof next === 'string' && next) token = next;
    },
    post: function(){
      try {
        window.parent.postMessage({
          type: '${PREVIEW_PAINT_REPORT}',
          width: measureWidth(),
          painted: painted(),
          token: token
        }, '*');
      } catch (_) {}
    }
  };
})();`;

/**
 * Mints a navigation token. One per watchdog arming, so a report carrying an
 * earlier token is recognisable as an answer from a document the host has
 * stopped watching.
 */
export function mintPreviewNavigationToken(): string {
  const random = Math.random().toString(36).slice(2);
  return `pnv-${Date.now().toString(36)}-${random}`;
}
