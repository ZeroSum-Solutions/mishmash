import { describe, expect, it } from 'vitest';

import {
  projectRawAssetBaseHref,
  withProjectAssetBaseHref,
} from '../src/runtime/project-asset-base';

describe('projectRawAssetBaseHref', () => {
  it('points at the owner file directory under the project raw route', () => {
    expect(projectRawAssetBaseHref('p1', 'zh/index.html')).toBe('/api/projects/p1/raw/zh/');
  });

  it('points at the project root for a top-level file', () => {
    expect(projectRawAssetBaseHref('p1', 'index.html')).toBe('/api/projects/p1/raw/');
  });

  it('points at the project root for a document that is not a project file', () => {
    expect(projectRawAssetBaseHref('p1', '')).toBe('/api/projects/p1/raw/');
  });

  it('encodes each path segment on its own so slashes stay separators', () => {
    expect(projectRawAssetBaseHref('a b/c', 'my dir/sub #1/page.html')).toBe(
      '/api/projects/a%20b%2Fc/raw/my%20dir/sub%20%231/',
    );
  });

  it('drops empty segments rather than emitting a doubled or leading slash', () => {
    expect(projectRawAssetBaseHref('p1', 'a//page.html')).toBe('/api/projects/p1/raw/a/');
    expect(projectRawAssetBaseHref('p1', '/a/page.html')).toBe('/api/projects/p1/raw/a/');
  });

  it('resolves a relative ref to the project file it names', () => {
    const base = new URL(projectRawAssetBaseHref('p1', 'zh/index.html'), 'http://d');
    expect(new URL('../assets/pic.png', base).pathname).toBe('/api/projects/p1/raw/assets/pic.png');
  });
});

describe('withProjectAssetBaseHref', () => {
  it('injects the base first inside an existing head', () => {
    expect(withProjectAssetBaseHref('<html><head><title>t</title></head></html>', '/api/projects/p1/raw/')).toBe(
      '<html><head><base href="/api/projects/p1/raw/"><title>t</title></head></html>',
    );
  });

  it('wins over a base the document already declares', () => {
    const out = withProjectAssetBaseHref('<html><head><base href="/elsewhere/"></head></html>', '/api/projects/p1/raw/');
    expect(out.indexOf('/api/projects/p1/raw/')).toBeLessThan(out.indexOf('/elsewhere/'));
  });

  it('adds a head when the document has none', () => {
    expect(withProjectAssetBaseHref('<html><body>hi</body></html>', '/api/projects/p1/raw/')).toBe(
      '<html><head><base href="/api/projects/p1/raw/"></head><body>hi</body></html>',
    );
  });

  it('prefixes a fragment that has no html element', () => {
    expect(withProjectAssetBaseHref('<p>hi</p>', '/api/projects/p1/raw/')).toBe(
      '<base href="/api/projects/p1/raw/"><p>hi</p>',
    );
  });

  it('skips a head written inside a comment', () => {
    const out = withProjectAssetBaseHref(
      '<html><!-- <head><base href="/decoy/"></head> --><head><title>t</title></head></html>',
      '/api/projects/p1/raw/',
    );
    expect(out).toContain('<head><base href="/api/projects/p1/raw/"><title>t</title></head>');
    expect(out).toContain('<!-- <head><base href="/decoy/"></head> -->');
  });

  it('escapes the href so it cannot break out of the attribute', () => {
    expect(withProjectAssetBaseHref('<html><head></head></html>', '/raw/"><script>x</script>')).toContain(
      '<base href="/raw/&quot;><script>x</script>">',
    );
  });
});
