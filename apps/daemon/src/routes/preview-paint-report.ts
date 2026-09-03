/**
 * The proof a served preview document actually ran.
 *
 * A preview iframe's own `load` event fires for a 200 that rendered nothing,
 * for an empty transport shell, and for a document whose subresources were all
 * refused. The web host therefore settles a visible preview only on
 * `od:preview-content-size` posted from inside the document, and files a
 * `preview-error` anomaly when no report arrives
 * (`apps/web/src/observability/iframe-error.ts`). The invariant that keeps that
 * watchdog honest: every preview response the daemon serves carries a producer
 * for that message, or the host has nothing to settle on but `load`.
 *
 * The project raw route carries one already, inside its URL-preview scroll
 * bridge. Live-artifact previews have no scroll bridge to carry it, so they
 * carry this one: the same two messages and nothing else.
 *
 * An explicit request is answered synchronously. `requestAnimationFrame` is
 * paused in a hidden tab while the host's timeout keeps running, so a scheduled
 * answer turns a healthy backgrounded preview into a false `preview-error`.
 */
const PREVIEW_PAINT_REPORT_MARKER = 'data-od-preview-paint-report-bridge';

const PREVIEW_PAINT_REPORT_BRIDGE = `<script ${PREVIEW_PAINT_REPORT_MARKER}>
(function(){
  if (window.__odPreviewPaintReportBridge) return;
  window.__odPreviewPaintReportBridge = true;
  function measure(){
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
      var next = Number(values[i] || 0);
      if (Number.isFinite(next) && next > width) width = next;
    }
    return width > 0 ? Math.ceil(width) : null;
  }
  function post(){
    try { window.parent.postMessage({ type: 'od:preview-content-size', width: measure() }, '*'); } catch (_) {}
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== 'od:preview-content-size-request') return;
    post();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', post);
  else setTimeout(post, 0);
  setTimeout(post, 80);
})();
</script>`;

/**
 * Add the paint-report producer to a preview document, once. Appended before
 * `</body>` so it runs after the document's own markup, and at the end when the
 * document has no body close tag.
 */
export function withPreviewPaintReport(html: string): string {
  if (html.includes(PREVIEW_PAINT_REPORT_MARKER)) return html;
  const bodyCloseIndex = html.search(/<\/body\s*>/i);
  if (bodyCloseIndex >= 0) {
    return `${html.slice(0, bodyCloseIndex)}${PREVIEW_PAINT_REPORT_BRIDGE}${html.slice(bodyCloseIndex)}`;
  }
  return `${html}${PREVIEW_PAINT_REPORT_BRIDGE}`;
}
