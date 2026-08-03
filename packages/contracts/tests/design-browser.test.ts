import { describe, expect, it } from 'vitest';

import { frameEmbeddingVerdictFromHeaders } from '../src/api/design-browser.js';

const verdict = (xfo: string | null, csp: string | null) =>
  frameEmbeddingVerdictFromHeaders({ xFrameOptions: xfo, contentSecurityPolicy: csp });

describe('frameEmbeddingVerdictFromHeaders', () => {
  it('passes clean headers', () => {
    expect(verdict(null, null)).toEqual({ blocked: false });
  });

  it('blocks on X-Frame-Options DENY and SAMEORIGIN, case-insensitively', () => {
    expect(verdict('DENY', null)).toMatchObject({ blocked: true, blockedBy: 'x-frame-options' });
    expect(verdict('sameorigin', null)).toMatchObject({ blocked: true, blockedBy: 'x-frame-options' });
  });

  it('blocks on a comma-joined X-Frame-Options list containing a blocking token', () => {
    expect(verdict('bogus, SAMEORIGIN', null)).toMatchObject({
      blocked: true,
      blockedBy: 'x-frame-options',
      header: 'bogus, SAMEORIGIN',
    });
  });

  it('ignores obsolete ALLOW-FROM the way every evergreen browser does', () => {
    expect(verdict('ALLOW-FROM https://partner.example', null)).toEqual({ blocked: false });
  });

  it('ignores unrecognized X-Frame-Options values', () => {
    expect(verdict('ALLOWALL', null)).toEqual({ blocked: false });
  });

  it('blocks on CSP frame-ancestors without a * source', () => {
    expect(verdict(null, "default-src 'self'; frame-ancestors 'self' https://a.example")).toMatchObject({
      blocked: true,
      blockedBy: 'csp-frame-ancestors',
    });
    expect(verdict(null, "frame-ancestors 'none'")).toMatchObject({ blocked: true });
  });

  it('allows CSP frame-ancestors *', () => {
    expect(verdict(null, 'frame-ancestors *')).toEqual({ blocked: false });
  });

  it('lets a frame-ancestors directive override X-Frame-Options entirely (browser precedence)', () => {
    expect(verdict('DENY', 'frame-ancestors *')).toEqual({ blocked: false });
    expect(verdict(null, "frame-ancestors 'self'")).toMatchObject({ blocked: true });
  });

  it('intersects multiple delivered CSP policies: all must allow', () => {
    // Two headers joined by the Fetch API: one allows, one restricts -> blocked.
    expect(verdict(null, "frame-ancestors *, frame-ancestors 'self'")).toMatchObject({
      blocked: true,
      blockedBy: 'csp-frame-ancestors',
    });
    // Both allow -> embeddable.
    expect(verdict(null, 'frame-ancestors *, frame-ancestors *')).toEqual({ blocked: false });
  });

  it('honors only the first frame-ancestors occurrence within a single policy', () => {
    // Browsers ignore duplicate directive names inside one policy, so the
    // trailing 'self' must not flip the verdict.
    expect(verdict(null, "frame-ancestors *; frame-ancestors 'self'")).toEqual({ blocked: false });
  });

  it('a policy without frame-ancestors imposes no framing restriction', () => {
    expect(verdict(null, "default-src 'self'; img-src *")).toEqual({ blocked: false });
  });
});
