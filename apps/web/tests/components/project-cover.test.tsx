// @vitest-environment jsdom
//
// S4-5 / C4-7 / C4-8 — HtmlProjectCoverFrame must never mount a live,
// network-capable iframe: browsers never parse HTML bytes as an image, so
// an <img> pointed at any src (even raw HTML) can never execute script or
// fetch subresources the way the OLD sandboxed-iframe implementation
// could. This is the permanent, repo-owned counterpart to
// scripts/waves/verify-w4.ts's C4-7 (which drives a real headless browser
// against a real canary listener).

import { cleanup, fireEvent, render, screen } from '@testing-library/react';

function requireImg(): HTMLImageElement {
  const img = document.querySelector('img');
  if (!img) throw new Error('expected an <img> element to be present');
  return img;
}
import { afterEach, describe, expect, it } from 'vitest';
import { HtmlProjectCoverFrame, renderedCoverUrl } from '../../src/components/project-cover';

afterEach(() => {
  cleanup();
});

describe('HtmlProjectCoverFrame', () => {
  it('never renders an <iframe> -- only <img> or the glyph fallback', () => {
    const { container } = render(
      <HtmlProjectCoverFrame
        src="/api/projects/p1/cover"
        initial="P"
        iframeClassName="thumb-iframe"
        glyphClassName="thumb-glyph"
        diagnostic="p1"
      />,
    );
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('renders an <img> pointed at the given src when src is present', () => {
    render(
      <HtmlProjectCoverFrame
        src="/api/projects/p1/cover"
        initial="P"
        iframeClassName="thumb-iframe"
        glyphClassName="thumb-glyph"
        diagnostic="p1"
      />,
    );
    const img = requireImg() as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('/api/projects/p1/cover');
  });

  it('shows the glyph fallback when no src is given', () => {
    render(
      <HtmlProjectCoverFrame
        src={undefined}
        initial="Q"
        iframeClassName="thumb-iframe"
        glyphClassName="thumb-glyph"
        diagnostic="p2"
      />,
    );
    expect(screen.getByText('Q')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('falls back to the glyph after the image fails to load (not-yet-rendered cover, S4-5)', () => {
    render(
      <HtmlProjectCoverFrame
        src="/api/projects/p3/cover"
        initial="R"
        iframeClassName="thumb-iframe"
        glyphClassName="thumb-glyph"
        diagnostic="p3"
      />,
    );
    const img = requireImg();
    fireEvent.error(img);
    expect(screen.getByText('R')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('re-attempts the image (clears the failed state) when src changes', () => {
    const { rerender } = render(
      <HtmlProjectCoverFrame
        src="/api/projects/p4/cover"
        initial="S"
        iframeClassName="thumb-iframe"
        glyphClassName="thumb-glyph"
        diagnostic="p4"
      />,
    );
    fireEvent.error(requireImg());
    expect(screen.getByText('S')).toBeTruthy();

    rerender(
      <HtmlProjectCoverFrame
        src="/api/projects/p4/cover?v=2"
        initial="S"
        iframeClassName="thumb-iframe"
        glyphClassName="thumb-glyph"
        diagnostic="p4"
      />,
    );
    expect(requireImg()).toBeTruthy();
  });
});

describe('renderedCoverUrl', () => {
  it('resolves to the frozen GET /api/projects/:id/cover path', () => {
    expect(renderedCoverUrl('my-project')).toBe('/api/projects/my-project/cover');
  });

  it('URI-encodes the project id', () => {
    expect(renderedCoverUrl('a b/c')).toBe('/api/projects/a%20b%2Fc/cover');
  });
});
