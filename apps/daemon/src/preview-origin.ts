import type { PreviewInfo } from '@open-design/contracts';

import { parseHostHeader } from './origin-validation.js';

/**
 * Where a daemon-managed preview server is announced (issue #158).
 *
 * The daemon starts preview servers on the machine it runs on, so
 * `http://127.0.0.1:<port>/` names them correctly only for a caller on that
 * same machine. Open Design is routinely reached from a second computer over
 * a tailnet, and there the announced loopback address resolves to the
 * CALLER's own loopback: the preview is reported live while their browser
 * gets `ERR_CONNECTION_REFUSED`, and an iframe pointed at it retries forever.
 */

const LOOPBACK_HOST = '127.0.0.1';

/** The subset of request headers that can name the caller's own front. */
export type PreviewRequestHeaders = {
  origin?: unknown;
  host?: unknown;
  'x-forwarded-host'?: unknown;
};

/** The preview's address on the daemon's own machine. */
export function loopbackPreviewUrl(port: number): string {
  return `http://${LOOPBACK_HOST}:${port}/`;
}

/**
 * The host the caller reached Open Design on, in the order the signals can be
 * trusted to survive a front.
 *
 * `Origin` first, because a browser sets it from the page's own address and
 * no proxy rewrites it. Measured, not assumed: the Next dev server's
 * `/api/*` rewrite hands the daemon its own upstream `Host` and no
 * `X-Forwarded-Host`, so a browser on `localhost` would otherwise be told
 * `127.0.0.1` — the loopback answer this track exists to stop giving. It is
 * also the safest of the three: `origin-validation.ts` has already rejected
 * any request whose `Origin` is neither same-origin nor in
 * `OD_ALLOWED_ORIGINS`, so an arbitrary host cannot be smuggled in here.
 *
 * `X-Forwarded-Host` next, the header a proxy that rewrites `Host` is
 * required to set, for a non-browser caller behind such a front. It may
 * carry a proxy chain; the first entry is the original client's.
 *
 * `Host` last: correct for a direct caller (the `od` CLI on the daemon's own
 * machine) and for a front that forwards it unchanged.
 */
function requestHostname(headers: PreviewRequestHeaders): string | null {
  const fromOrigin = originHostname(headers.origin);
  if (fromOrigin) return fromOrigin;
  const forwarded = headerText(headers['x-forwarded-host']).split(',')[0] ?? '';
  const parsed = parseHostHeader(forwarded.trim()) ?? parseHostHeader(headers.host);
  return parsed ? parsed.hostname : null;
}

/** Hostname of an http(s) `Origin`; null for `null`, opaque, or malformed. */
function originHostname(value: unknown): string | null {
  const raw = headerText(value).trim();
  if (!raw || raw === 'null') return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname || null;
  } catch {
    return null;
  }
}

function headerText(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return value === undefined || value === null ? '' : String(value);
}

/**
 * The invariant every preview read must hold: the announced URL names the
 * host the request itself arrived on, carrying the preview's own port. A
 * request that arrived on loopback keeps loopback; one that arrived on a
 * tailnet name gets that name back and is reachable from the machine that
 * asked.
 *
 * The scheme stays `http:` because the preview process speaks plain HTTP on
 * its port whatever scheme fronted the daemon — announcing `https:` because
 * the daemon was reached over TLS would be a URL nothing is listening on.
 * A request with no usable host falls back to loopback, the honest answer
 * for a caller we cannot place.
 */
export function previewUrlForRequestHost(headers: PreviewRequestHeaders, port: number): string {
  const hostname = requestHostname(headers);
  return hostname ? `http://${hostname}:${port}/` : loopbackPreviewUrl(port);
}

/** Re-announce one preview session for the request that is reading it. */
export function announcePreviewOnRequestHost(
  preview: PreviewInfo,
  headers: PreviewRequestHeaders,
): PreviewInfo {
  return { ...preview, url: previewUrlForRequestHost(headers, preview.port) };
}
