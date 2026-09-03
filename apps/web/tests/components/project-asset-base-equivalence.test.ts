// FileViewer's disk-written preview used to spell its asset base out as
// `projectRawUrl(projectId, assetBaseDirFor(file.name))` and now reads it from
// the shared rule in @open-design/contracts. This pins that the swap changed no
// string, so a preview, deck thumbnail rail, or version preview cannot silently
// start resolving its assets somewhere else.
import { describe, expect, it } from 'vitest';

import { projectRawAssetBaseHref } from '@open-design/contracts/runtime/project-asset-base';

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
