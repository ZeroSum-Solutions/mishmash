import { describe, expect, it } from 'vitest';

import { previewFrontOrigin, previewProxyUrlForRequest } from '../src/preview-origin.js';

/**
 * The announcement invariant behind a reverse proxy (issue #158, D-14).
 *
 * The daemon is reached through a front — `tailscale serve` in the reported
 * deployment, the Next dev server's `/api/*` rewrite locally. A front either
 * forwards the caller's `Host` or rewrites it to its own upstream address and
 * puts the original in `X-Forwarded-Host`. If the daemon read `Host` alone,
 * the second shape would hand every collaborator the daemon's own loopback
 * address, and the preview path would be announced on an origin that does not
 * serve it.
 */
describe('the front a preview is announced on', () => {
  it('keeps loopback for a caller on the daemon machine', () => {
    expect(previewFrontOrigin({ host: '127.0.0.1:7456' })).toBe('http://127.0.0.1:7456');
  });

  it('names the tailnet front a collaborator reached the daemon on', () => {
    expect(previewFrontOrigin({ host: 'devins-macbook-pro.tail908c18.ts.net:7443' }))
      .toBe('http://devins-macbook-pro.tail908c18.ts.net:7443');
  });

  it('prefers the browsing page origin, which no proxy rewrites', () => {
    // The Next dev server's /api/* rewrite hands the daemon its own upstream
    // Host and no X-Forwarded-Host; only Origin still names the browser.
    expect(previewFrontOrigin({ origin: 'http://localhost:17622', host: '127.0.0.1:17621' }))
      .toBe('http://localhost:17622');
  });

  it('carries the front scheme, so a TLS front is not announced as plain http', () => {
    // The preview is served by the daemon now, so its scheme is the daemon's.
    expect(previewFrontOrigin({
      origin: 'https://devins-macbook-pro.tail908c18.ts.net:7443',
      host: '127.0.0.1:7456',
    })).toBe('https://devins-macbook-pro.tail908c18.ts.net:7443');
    expect(previewFrontOrigin({
      host: '127.0.0.1:7456',
      'x-forwarded-host': 'devins-macbook-pro.tail908c18.ts.net',
      'x-forwarded-proto': 'https',
    })).toBe('https://devins-macbook-pro.tail908c18.ts.net');
  });

  it('uses Referer on a same-origin GET, where a browser sends no Origin', () => {
    // The panel's own read of /api/projects/:id/previews is exactly this shape.
    expect(previewFrontOrigin({
      referer: 'https://devins-macbook-pro.tail908c18.ts.net:7443/projects/p1',
      host: '127.0.0.1:7456',
    })).toBe('https://devins-macbook-pro.tail908c18.ts.net:7443');
  });

  it('ignores an opaque or non-http origin and falls through to the host', () => {
    expect(previewFrontOrigin({ origin: 'null', host: 'client.example:443' }))
      .toBe('http://client.example:443');
    expect(previewFrontOrigin({ origin: 'file://', host: 'client.example:443' }))
      .toBe('http://client.example:443');
  });

  it('prefers the forwarded host when a proxy rewrote Host to its upstream', () => {
    expect(previewFrontOrigin({
      host: '127.0.0.1:7456',
      'x-forwarded-host': 'devins-macbook-pro.tail908c18.ts.net:7443',
    })).toBe('http://devins-macbook-pro.tail908c18.ts.net:7443');
  });

  it('takes the original client from a forwarded proxy chain', () => {
    expect(previewFrontOrigin({
      host: '127.0.0.1:7456',
      'x-forwarded-host': 'client.example:443, edge.internal:8080',
      'x-forwarded-proto': 'https, http',
    })).toBe('https://client.example:443');
  });

  it('carries an IPv6 literal host through unbroken', () => {
    expect(previewFrontOrigin({ host: '[::1]:7456' })).toBe('http://[::1]:7456');
  });

  it('reports no front when no header can place the caller', () => {
    expect(previewFrontOrigin({})).toBeNull();
    expect(previewFrontOrigin({ host: '' })).toBeNull();
    expect(previewFrontOrigin({ 'x-forwarded-host': '   ' })).toBeNull();
  });
});

describe('the announced preview URL', () => {
  const preview = { id: 'pv 1', projectId: 'p/1' };

  it('is the preview path on the front the request arrived on', () => {
    expect(previewProxyUrlForRequest({ host: 'devins-macbook-pro.tail908c18.ts.net:7443' }, preview))
      .toBe('http://devins-macbook-pro.tail908c18.ts.net:7443/api/projects/p%2F1/previews/pv%201/proxy/');
  });

  it('falls back to the path alone when no header can place the caller', () => {
    // Still true for whoever asked: they resolve it against the origin they
    // used, which beats naming an address chosen on their behalf.
    expect(previewProxyUrlForRequest({}, preview))
      .toBe('/api/projects/p%2F1/previews/pv%201/proxy/');
  });
});
