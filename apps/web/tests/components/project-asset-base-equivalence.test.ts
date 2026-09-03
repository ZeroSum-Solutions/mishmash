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
