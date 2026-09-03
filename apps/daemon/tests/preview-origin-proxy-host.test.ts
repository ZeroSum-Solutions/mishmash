import { describe, expect, it } from 'vitest';

import { loopbackPreviewUrl, previewUrlForRequestHost } from '../src/preview-origin.js';

/**
 * The announcement invariant behind a reverse proxy (issue #158).
 *
 * The daemon is reached through a front — `tailscale serve` in the reported
 * deployment, the Next dev server's `/api/*` rewrite locally. A front either
 * forwards the caller's `Host` or rewrites it to its own upstream address and
 * puts the original in `X-Forwarded-Host`. If the daemon read `Host` alone,
 * the second shape would hand every collaborator the daemon's own loopback
 * address, which is exactly the bug this track fixes.
 */
describe('preview URL for the request host', () => {
  it('keeps loopback for a caller on the daemon machine', () => {
    expect(previewUrlForRequestHost({ host: '127.0.0.1:7456' }, 8125))
      .toBe('http://127.0.0.1:8125/');
  });

  it('names the tailnet host a collaborator reached the daemon on', () => {
    expect(previewUrlForRequestHost({ host: 'devins-macbook-pro.tail908c18.ts.net:7443' }, 8125))
      .toBe('http://devins-macbook-pro.tail908c18.ts.net:8125/');
  });

  it('prefers the browsing page origin, which no proxy rewrites', () => {
    // The Next dev server's /api/* rewrite hands the daemon its own upstream
    // Host and no X-Forwarded-Host; only Origin still names the browser.
    expect(previewUrlForRequestHost(
      { origin: 'http://localhost:17622', host: '127.0.0.1:17621' },
      8125,
    )).toBe('http://localhost:8125/');
    expect(previewUrlForRequestHost(
      { origin: 'https://devins-macbook-pro.tail908c18.ts.net:7443', host: '127.0.0.1:7456' },
      8125,
    )).toBe('http://devins-macbook-pro.tail908c18.ts.net:8125/');
  });

  it('uses Referer on a same-origin GET, where a browser sends no Origin', () => {
    // The panel's own read of /api/projects/:id/previews is exactly this shape.
    expect(previewUrlForRequestHost(
      {
        referer: 'https://devins-macbook-pro.tail908c18.ts.net:7443/projects/p1',
        host: '127.0.0.1:7456',
      },
      8125,
    )).toBe('http://devins-macbook-pro.tail908c18.ts.net:8125/');
  });

  it('ignores an opaque or non-http origin and falls through to the host', () => {
    expect(previewUrlForRequestHost({ origin: 'null', host: 'client.example:443' }, 8125))
      .toBe('http://client.example:8125/');
    expect(previewUrlForRequestHost({ origin: 'file://', host: 'client.example:443' }, 8125))
      .toBe('http://client.example:8125/');
  });

  it('prefers the forwarded host when a proxy rewrote Host to its upstream', () => {
    expect(previewUrlForRequestHost(
      { host: '127.0.0.1:7456', 'x-forwarded-host': 'devins-macbook-pro.tail908c18.ts.net:7443' },
      8125,
    )).toBe('http://devins-macbook-pro.tail908c18.ts.net:8125/');
  });

  it('takes the original client from a forwarded proxy chain', () => {
    expect(previewUrlForRequestHost(
      { host: '127.0.0.1:7456', 'x-forwarded-host': 'client.example:443, edge.internal:8080' },
      8125,
    )).toBe('http://client.example:8125/');
  });

  it('carries an IPv6 literal host through unbroken', () => {
    expect(previewUrlForRequestHost({ host: '[::1]:7456' }, 8125)).toBe('http://[::1]:8125/');
  });

  it('falls back to loopback when no header can place the caller', () => {
    expect(previewUrlForRequestHost({}, 8125)).toBe(loopbackPreviewUrl(8125));
    expect(previewUrlForRequestHost({ host: '' }, 8125)).toBe(loopbackPreviewUrl(8125));
    expect(previewUrlForRequestHost({ 'x-forwarded-host': '   ' }, 8125))
      .toBe(loopbackPreviewUrl(8125));
  });
});
