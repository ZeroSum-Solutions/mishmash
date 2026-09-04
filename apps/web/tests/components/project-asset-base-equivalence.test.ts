// FileViewer's disk-written preview used to spell its asset base out as
// `projectRawUrl(projectId, assetBaseDirFor(file.name))` and now reads it from
// the shared rule in @open-design/contracts. This pins that the swap changed no
// string, so a preview, deck thumbnail rail, or version preview cannot silently
// start resolving its assets somewhere else.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import {
  projectRawAssetBaseHref,
  withProjectAssetBaseHref,
} from '@open-design/contracts/runtime/project-asset-base';

import { assetBaseDirFor } from '../../src/components/file-viewer-preview-assets';
import { projectRawUrl } from '../../src/providers/registry';

const CASES: Array<[projectId: string, fileName: string]> = [
  ['p1', 'index.html'],
  ['p1', 'zh/index.html'],
  ['p1', 'a/b/c/page.html'],
  ['p1', 'my dir/page.html'],
  ['p1', 'dir #1/page.html'],
  ['p1', 'dir%20already/page.html'],
  ['p1', 'dir+plus/page.html'],
  ['p1', "o'brien/page.html"],
  ['p1', 'ümläut/страница.html'],
  ['p1', '汉字/页面.html'],
  ['p1', 'dir&amp/page.html'],
  ['p1', 'dir?query/page.html'],
  ['project with spaces', 'index.html'],
  ['project/with/slashes', 'zh/index.html'],
  ['項目', 'ümläut/index.html'],
];

describe('projectRawAssetBaseHref matches the composition it replaced, on every project file path', () => {
  for (const [projectId, fileName] of CASES) {
    it(`${projectId} :: ${fileName}`, () => {
      expect(projectRawAssetBaseHref(projectId, fileName)).toBe(
        projectRawUrl(projectId, assetBaseDirFor(fileName)),
      );
    });
  }
});

// The one input class where the two differ, recorded rather than hidden: the old
// composition preserved empty path segments; the shared rule drops them. No
// FileViewer call site can reach it — `collectFiles`
// (apps/daemon/src/projects.ts) builds every `file.name` by joining real
// directory entries, so `/api/projects/:id/files` never reports a name with a
// doubled or leading slash.
describe('empty path segments — the one documented divergence', () => {
  it('collapses a doubled slash the old composition preserved', () => {
    expect(projectRawAssetBaseHref('p1', 'a//page.html')).toBe('/api/projects/p1/raw/a/');
    expect(projectRawUrl('p1', assetBaseDirFor('a//page.html'))).toBe('/api/projects/p1/raw/a//');
  });

  it('collapses a leading slash the old composition preserved', () => {
    expect(projectRawAssetBaseHref('p1', '/a/page.html')).toBe('/api/projects/p1/raw/a/');
    expect(projectRawUrl('p1', assetBaseDirFor('/a/page.html'))).toBe('/api/projects/p1/raw//a/');
  });
});

// F13 in proof/w2/codex-wave-r1.json: the drop that keeps the injected base
// first in tree order used to splice raw source text, which could join the bytes
// around a removal into markup the input never had. The exact bytes are pinned
// in packages/contracts/tests/project-asset-base.test.ts; what that suite cannot
// see is how a parser reads the result, because `packages/contracts` carries no
// DOM dependency. jsdom is a web devDependency, so the parsed-shape half of the
// claim lives here, next to the other consumer of the same shared rule. Both
// inputs are verbatim from the 2.4 fresh review (proof/w2/2.4-review-r2.json).
describe('withProjectAssetBaseHref forges no element the input did not contain', () => {
  const BASE = '/api/projects/p1/raw/';
  const PREVIEW_URL = 'http://d/preview';

  function parse(html: string) {
    const { document } = new JSDOM(html, { url: PREVIEW_URL }).window;
    return {
      bases: Array.from(document.querySelectorAll('base'), (base) => base.getAttribute('href')),
      scripts: document.querySelectorAll('script').length,
      baseURI: document.baseURI,
    };
  }

  it('mints no base element out of `<ba<base href="x">se href="/evil/">`', () => {
    const input = '<ba<base href="x">se href="/evil/"><html><head><title>t</title></head></html>';
    expect(parse(input).bases).toEqual([]);

    const parsed = parse(withProjectAssetBaseHref(input, BASE));
    expect(parsed.bases).toEqual([BASE]);
    expect(parsed.baseURI).toBe(`http://d${BASE}`);
  });

  it('mints no script element out of `<scr<base href="x">ipt>`', () => {
    const input = '<scr<base href="x">ipt>window.PWNED=1;</script><html><head></head></html>';
    expect(parse(input).scripts).toBe(0);

    expect(parse(withProjectAssetBaseHref(input, BASE)).scripts).toBe(0);
  });
});

// Round-1 track audit (proof/w2fix/2G.4-glm-r1.json), findings 1 and 2, in the
// same parsed-shape terms as the block above.
describe('withProjectAssetBaseHref stays first in tree order for inputs the audit found', () => {
  const BASE = '/api/projects/p1/raw/';
  const PREVIEW_URL = 'http://d/preview';

  function parse(html: string) {
    const { document } = new JSDOM(html, { url: PREVIEW_URL }).window;
    return {
      bases: Array.from(document.querySelectorAll('base'), (base) => base.getAttribute('href')),
      scripts: document.querySelectorAll('script').length,
      baseURI: document.baseURI,
    };
  }

  it('mints no base when the base it removes sat behind a stray `<`', () => {
    const input = '<<base href="x">base href="/evil/"><html><head><title>t</title></head></html>';
    expect(parse(input).bases).toEqual(['x']);

    const parsed = parse(withProjectAssetBaseHref(input, BASE));
    expect(parsed.bases).toEqual([BASE]);
    expect(parsed.baseURI).toBe(`http://d${BASE}`);
  });

  it('mints no script when the base it removes sat behind a stray `<`', () => {
    const input = '<<base href="x">script>window.PWNED=1;</script><html><head></head></html>';
    expect(parse(input).scripts).toBe(0);

    expect(parse(withProjectAssetBaseHref(input, BASE)).scripts).toBe(0);
  });

  it('still carries a base when the document breaks off inside its head tag', () => {
    expect(parse(withProjectAssetBaseHref('<html><head', BASE)).baseURI).toBe(`http://d${BASE}`);
  });
});

// Round-3 track audit (proof/w2fix/2G.4-glm-r3.json): the same claim in parsed
// terms -- the script element's text must survive the transform unchanged.
describe('withProjectAssetBaseHref does not edit script text past a nested </script>', () => {
  const BASE = '/api/projects/p1/raw/';

  it('keeps the script body byte for byte and still bases the document', () => {
    const input =
      '<script><!--<script></script><base href="/evil/">--></script><head><title>t</title></head>';
    const before = new JSDOM(input, { url: 'http://d/preview' }).window.document;
    const after = new JSDOM(withProjectAssetBaseHref(input, BASE), { url: 'http://d/preview' })
      .window.document;

    expect(before.querySelectorAll('base')).toHaveLength(0);
    expect(after.querySelector('script')?.textContent).toBe(
      before.querySelector('script')?.textContent,
    );
    expect(after.baseURI).toBe(`http://d${BASE}`);
  });
});

// Round-4 track audit (proof/w2fix/2G.4-glm-r4.json), finding 3, in parsed
// terms: a `<base>` written after a `--!>` comment close is a real element the
// parser hoists into the head, so the document resolves against it unless the
// transform drops it.
describe('withProjectAssetBaseHref stays first in tree order past a --!> comment close', () => {
  const BASE = '/api/projects/p1/raw/';
  const PREVIEW_URL = 'http://d/preview';

  function parse(html: string) {
    const { document } = new JSDOM(html, { url: PREVIEW_URL }).window;
    return {
      bases: Array.from(document.querySelectorAll('base'), (base) => base.getAttribute('href')),
      baseURI: document.baseURI,
    };
  }

  it('resolves against the injected base, not one written after a --!> close', () => {
    const input = '<!-- --!><base href="/evil/"> --><html><head><title>t</title></head></html>';
    expect(parse(input).baseURI).toBe('http://d/evil/');

    const parsed = parse(withProjectAssetBaseHref(input, BASE));
    expect(parsed.bases).toEqual([BASE]);
    expect(parsed.baseURI).toBe(`http://d${BASE}`);
  });
});

// Round-5 track audit (proof/w2fix/2G.4-glm-r5.json), finding 1, in parsed
// terms: `--!->` does not close a comment, so the `<base href="/evil/">` behind
// it is comment content and never becomes an element. Dropping it would edit
// bytes that are not markup -- the second half of what F13 names.
describe('withProjectAssetBaseHref leaves a base a --!-> keeps inside a comment', () => {
  const BASE = '/api/projects/p1/raw/';
  const PREVIEW_URL = 'http://d/preview';

  function parse(html: string) {
    const { document } = new JSDOM(html, { url: PREVIEW_URL }).window;
    return {
      bases: Array.from(document.querySelectorAll('base'), (base) => base.getAttribute('href')),
      baseURI: document.baseURI,
    };
  }

  it('resolves against the injected base and forges no element from comment content', () => {
    const input = '<!-- x --!-><base href="/evil/"> --><html><head><title>t</title></head></html>';
    expect(parse(input).bases).toEqual([]);
    expect(parse(input).baseURI).toBe(PREVIEW_URL);

    const parsed = parse(withProjectAssetBaseHref(input, BASE));
    expect(parsed.bases).toEqual([BASE]);
    expect(parsed.baseURI).toBe(`http://d${BASE}`);
  });
});

// Round-6 track audit (proof/w2fix/2G.4-glm-r6.json), its one LOW, in parsed
// terms. Foreign content is read as HTML rather than tracked, and what matters
// is the direction of the error: whichever way the parser resolves the subtree,
// the injected base still comes first and the page cannot re-root itself.
describe('withProjectAssetBaseHref stays first in tree order across foreign content', () => {
  const BASE = '/api/projects/p1/raw/';
  const PREVIEW_URL = 'http://d/preview';

  function parse(html: string) {
    const { document } = new JSDOM(html, { url: PREVIEW_URL }).window;
    return { baseURI: document.baseURI };
  }

  it('resolves against the injected base when a head sits inside an svg subtree', () => {
    const input = '<svg><head></head></svg><html><head><base href="/evil/"><title>t</title></head></html>';
    expect(parse(input).baseURI).toBe('http://d/evil/');
    expect(parse(withProjectAssetBaseHref(input, BASE)).baseURI).toBe(`http://d${BASE}`);
  });
});

// Round-7 track audit (proof/w2fix/2G.4-glm-r7.json). Its HIGH says `-->` does
// not leave a script's double-escaped region, so the round-4 pin for this input
// asserts the wrong bytes; its MEDIUM says the jsdom run behind that pin was
// referenced and never shown. The run is now in the proof file, and these are
// the parse assertions the byte pins could not make: the byte-exact cases below
// cannot see whether the injected tag lands inside raw text, and these can.
describe('withProjectAssetBaseHref reads a script double-escape the way the parser does', () => {
  const BASE = '/api/projects/p1/raw/';
  const PREVIEW_URL = 'http://d/preview';

  function parse(html: string) {
    const { document } = new JSDOM(html, { url: PREVIEW_URL }).window;
    return {
      scriptTexts: Array.from(document.querySelectorAll('script'), (s) => s.textContent),
      bases: Array.from(document.querySelectorAll('base'), (b) => b.getAttribute('href')),
      baseURI: document.baseURI,
    };
  }

  it('ends the script at the first </script> after a --> and injects a real base', () => {
    const input =
      '<script><!--<script>-->y</script><head></head>--></script><html><head><title>t</title></head>';
    expect(parse(input).scriptTexts).toEqual(['<!--<script>-->y']);

    const parsed = parse(withProjectAssetBaseHref(input, BASE));
    expect(parsed.scriptTexts).toEqual(['<!--<script>-->y']);
    expect(parsed.bases).toEqual([BASE]);
    expect(parsed.baseURI).toBe(`http://d${BASE}`);
  });

  it('drops a base that follows a --> because the parser makes it a real element', () => {
    const input =
      '<script><!--<script>-->y</script><base href="/evil/">--></script><head><title>t</title></head>';
    expect(parse(input).bases).toEqual(['/evil/']);
    expect(parse(input).baseURI).toBe('http://d/evil/');

    const parsed = parse(withProjectAssetBaseHref(input, BASE));
    expect(parsed.scriptTexts).toEqual(['<!--<script>-->y']);
    expect(parsed.bases).toEqual([BASE]);
    expect(parsed.baseURI).toBe(`http://d${BASE}`);
  });

  it('leaves a base alone inside a double-escaped region no --> closes', () => {
    const input =
      '<script><!--<script>y</script><base href="/evil/"></script><head><title>t</title></head>';
    const scriptText = '<!--<script>y</script><base href="/evil/">';
    expect(parse(input).scriptTexts).toEqual([scriptText]);
    expect(parse(input).bases).toEqual([]);

    const parsed = parse(withProjectAssetBaseHref(input, BASE));
    expect(parsed.scriptTexts).toEqual([scriptText]);
    expect(parsed.bases).toEqual([BASE]);
    expect(parsed.baseURI).toBe(`http://d${BASE}`);
  });
});
