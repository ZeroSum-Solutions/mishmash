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

/** The preview's address on the daemon's own machine. */
export function loopbackPreviewUrl(port: number): string {
  return `http://${LOOPBACK_HOST}:${port}/`;
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
 * A request with no usable `Host` falls back to loopback, the honest answer
 * for a caller we cannot place.
 */
export function previewUrlForRequestHost(hostHeader: unknown, port: number): string {
  const parsed = parseHostHeader(hostHeader);
  if (!parsed) return loopbackPreviewUrl(port);
  return `http://${parsed.hostname}:${port}/`;
}

/** Re-announce one preview session for the request that is reading it. */
export function announcePreviewOnRequestHost(
  preview: PreviewInfo,
  hostHeader: unknown,
): PreviewInfo {
  return { ...preview, url: previewUrlForRequestHost(hostHeader, preview.port) };
}
