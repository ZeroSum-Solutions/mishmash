// One base-href rule for every preview path.
//
// A project HTML page resolves its relative asset refs against its own
// directory inside the project's raw-file route, whichever way the page
// arrived. `withProjectAssetBaseHref` (@open-design/contracts) is that rule:
// it finds the document's real head with an HTML start-tag scan, drops every
// `<base>` the parser would hoist ahead of the injected one, and forges no
// markup the input did not contain.
//
// `buildSrcdoc` used to carry its own copy of the rule, a source-text regex
// that inserted after the first `<head` it could match and removed no earlier
// base. A page that writes a real `<base>` before its `<head>` — which the
// parser hoists into the head it creates, ahead of everything in it — kept
// resolving against its own base, so the FileViewer srcDoc preview and the
// live-artifact preview disagreed about where the same page's assets live.
//
// These cases pin the srcDoc side of the parity claim. The live-artifact side
// is pinned in apps/daemon/tests/live-artifact-preview-relative-assets.test.ts,
// and the two are byte-compared against each other in
// apps/web/tests/components/project-asset-base-equivalence.test.ts.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { buildSrcdoc } from '../../src/runtime/srcdoc';

const BASE = '/api/projects/p1/raw/zh/';
const PREVIEW_URL = 'http://d/preview';
const BODY = '<body><img src="asset.png"></body>';

function parse(html: string) {
  const { document } = new JSDOM(html, { url: PREVIEW_URL }).window;
  return {
    baseURI: document.baseURI,
    img: document.querySelector('img')?.src,
    bases: Array.from(document.querySelectorAll('base'), (base) => base.getAttribute('href')),
  };
}

describe('buildSrcdoc resolves relative assets through the shared project-asset base rule', () => {
  it('a real base written before <head> does not win over the injected project base', () => {
    const input = `<!doctype html><base href="/elsewhere/"><html><head><title>t</title></head>${BODY}</html>`;

    // Untransformed, the page rebases itself: the parser hoists the stray base
    // into the head it creates, ahead of the title.
    expect(parse(input).baseURI).toBe('http://d/elsewhere/');

    const parsed = parse(buildSrcdoc(input, { baseHref: BASE }));
    expect(parsed.bases).toEqual([BASE]);
    expect(parsed.baseURI).toBe(`http://d${BASE}`);
    expect(parsed.img).toBe(`http://d${BASE}asset.png`);
  });

  it('a base a --!> comment close turns into a real element does not win either', () => {
    const input = `<!doctype html><!-- --!><base href="/elsewhere/"> --><html><head><title>t</title></head>${BODY}</html>`;
    expect(parse(input).baseURI).toBe('http://d/elsewhere/');

    const parsed = parse(buildSrcdoc(input, { baseHref: BASE }));
    expect(parsed.bases).toEqual([BASE]);
    expect(parsed.img).toBe(`http://d${BASE}asset.png`);
  });

  it('a base the parser reads past a stray `<` does not win either', () => {
    const input = `<!doctype html><<base href="/elsewhere/">base href="/x/"><html><head><title>t</title></head>${BODY}</html>`;
    expect(parse(input).baseURI).toBe('http://d/elsewhere/');

    const parsed = parse(buildSrcdoc(input, { baseHref: BASE }));
    expect(parsed.bases).toEqual([BASE]);
    expect(parsed.img).toBe(`http://d${BASE}asset.png`);
  });

  it('a base a script double-escape does not hide does not win either', () => {
    const input =
      `<!doctype html><script><!--<script>-->y</script><base href="/elsewhere/">--></script><html><head><title>t</title></head>${BODY}</html>`;
    expect(parse(input).baseURI).toBe('http://d/elsewhere/');

    const parsed = parse(buildSrcdoc(input, { baseHref: BASE }));
    expect(parsed.bases).toEqual([BASE]);
    expect(parsed.img).toBe(`http://d${BASE}asset.png`);
  });

  // The properties the deleted srcDoc-local injector supplied, restated against
  // the shared rule so the swap cannot drop one silently.
  it('gives a document with no head of its own one, just after <html>', () => {
    const parsed = parse(buildSrcdoc('<html><body><img src="asset.png"></body></html>', { baseHref: BASE }));
    expect(parsed.bases).toEqual([BASE]);
    expect(parsed.img).toBe(`http://d${BASE}asset.png`);
  });

  it('escapes the href so a quote in the base cannot end its attribute', () => {
    const hostile = '/api/projects/p"><script>window.PWNED=1;</script><x y="/raw/';
    const out = buildSrcdoc(`<!doctype html><html><head><title>t</title></head>${BODY}</html>`, {
      baseHref: hostile,
    });
    const { document } = new JSDOM(out, { url: PREVIEW_URL }).window;
    expect(document.querySelector('base')?.getAttribute('href')).toBe(hostile);
    expect(document.querySelectorAll('script[data-od-preview-redirect-guard]')).toHaveLength(1);
  });

  it('escapes an ampersand in the href so it cannot open a character reference', () => {
    const href = '/api/projects/p&amp/raw/';
    const out = buildSrcdoc(`<!doctype html><html><head><title>t</title></head>${BODY}</html>`, {
      baseHref: href,
    });
    const { document } = new JSDOM(out, { url: PREVIEW_URL }).window;
    expect(document.querySelector('base')?.getAttribute('href')).toBe(href);
  });
});
