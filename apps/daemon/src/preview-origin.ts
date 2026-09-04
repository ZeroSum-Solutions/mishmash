import type { PreviewInfo } from '@open-design/contracts';

import { parseHostHeader } from './origin-validation.js';
import { previewProxyPath } from './preview-proxy.js';

/**
 * Where a daemon-managed preview server is announced (issue #158, decision
 * D-14).
 *
 * The daemon starts preview servers on the machine it runs on and cannot make
 * them listen anywhere else, so no address that names a preview's own port is
 * true for anyone else. What IS true for every caller is the daemon's own
 * front: they reached Open Design on it. So a preview is announced as a path
 * under that front and the daemon proxies it (`preview-proxy.ts`) — the
 * announcement and the exposure are the same fact.
 */

const LOOPBACK_HOST = '127.0.0.1';

/** The subset of request headers that can name the caller's own front. */
export type PreviewRequestHeaders = {
  origin?: unknown;
  referer?: unknown;
  host?: unknown;
  'x-forwarded-host'?: unknown;
  'x-forwarded-proto'?: unknown;
};

/** The preview's address on the daemon's own machine. */
export function loopbackPreviewUrl(port: number): string {
  return `http://${LOOPBACK_HOST}:${port}/`;
}

/**
 * The origin the caller reached Open Design on, in the order the signals can
 * be trusted to survive a front.
 *
 * The browsing page's own origin first — `Origin`, then `Referer` — because a
 * browser writes both from the page it is on and a proxy rewrites neither.
 * Measured, not assumed: the Next dev server's `/api/*` rewrite hands the
 * daemon its own upstream `Host` and no `X-Forwarded-Host`, so a browser on
 * `localhost` would otherwise be told `127.0.0.1`. Both are needed: a browser
 * omits `Origin` on a same-origin GET, which is exactly the shape of the
 * panel's own read, and sends `Referer` there instead.
 *
 * `X-Forwarded-Host` next, the header a proxy that rewrites `Host` is
 * required to set, for a non-browser caller behind such a front. It may carry
 * a proxy chain; the first entry is the original client's, and
 * `X-Forwarded-Proto` reads the same way.
 *
 * `Host` last: correct for a direct caller (the `od` CLI on the daemon's own
 * machine) and for a front that forwards it unchanged.
 *
 * The scheme is carried through rather than pinned to `http:`, because the
 * preview is now served by the daemon itself: a daemon reached over TLS
 * serves its previews over the same TLS, and announcing `http:` there would
 * be both wrong and mixed content.
 */
export function previewFrontOrigin(headers: PreviewRequestHeaders): string | null {
  const fromPage = urlOrigin(headers.origin) ?? urlOrigin(headers.referer);
  if (fromPage) return fromPage;
  const forwardedHost = parseHostHeader(firstListEntry(headers['x-forwarded-host']));
  if (forwardedHost) {
    const scheme = firstListEntry(headers['x-forwarded-proto']).toLowerCase() === 'https' ? 'https' : 'http';
    return `${scheme}://${forwardedHost.host}`;
  }
  const host = parseHostHeader(headers.host);
  return host ? `http://${host.host}` : null;
}

/** Origin of an http(s) absolute URL; null for `null`, opaque, or malformed. */
function urlOrigin(value: unknown): string | null {
  const raw = headerText(value).trim();
  if (!raw || raw === 'null') return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.host ? url.origin : null;
  } catch {
    return null;
  }
}

/** First entry of a comma-separated forwarding chain: the original client's. */
function firstListEntry(value: unknown): string {
  return (headerText(value).split(',')[0] ?? '').trim();
}

function headerText(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return value === undefined || value === null ? '' : String(value);
}

/**
 * The invariant every preview read must hold: the announced URL names
 * something the caller can fetch. It is the preview's path on the daemon
 * front the request itself arrived on, which the daemon serves by proxying to
 * the loopback child — so it is reachable wherever Open Design is, under the
 * same scheme and the same authentication.
 *
 * A request no header can place gets the path alone. That is still true for
 * whoever asked, since they resolve it against the origin they used, and it
 * beats naming an address chosen on their behalf.
 */
export function previewProxyUrlForRequest(
  headers: PreviewRequestHeaders,
  preview: Pick<PreviewInfo, 'id' | 'projectId'>,
): string {
  const path = previewProxyPath(preview.projectId, preview.id);
  const origin = previewFrontOrigin(headers);
  return origin ? `${origin}${path}` : path;
}

/** Re-announce one preview session for the request that is reading it. */
export function announcePreviewOnRequestHost(
  preview: PreviewInfo,
  headers: PreviewRequestHeaders,
): PreviewInfo {
  return { ...preview, url: previewProxyUrlForRequest(headers, preview) };
}
