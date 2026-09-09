// Red spec: `.od-upload-<uploadId>-<index>.part` — the destination-side temp
// name a staged upload promotes through before its final rename
// (`routes/project/uploads.ts`'s `promote()`) — never produces a
// `file-changed` event through `makeIgnored`; every other file name is
// unaffected.
//
// RED on base (8487362f0): the predicate has no such exclusion, so this
// name is NOT ignored (the assertion below is `false` on base — a
// behavioral difference, not a compile error).
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { makeIgnored } from '../src/project-watchers.js';

describe('makeIgnored excludes the upload promotion temp name', () => {
  const root = '/tmp/fake-project-root';
  const ignored = makeIgnored(root);

  it('ignores .od-upload-<uploadId>-<index>.part at the project root', () => {
    expect(ignored(path.join(root, '.od-upload-3f9c2b7a-1e4d-4a90-9b7e-0a5c6d8f2b11-0.part'))).toBe(true);
  });

  it('ignores it inside a subfolder too', () => {
    expect(ignored(path.join(root, 'imagery', '.od-upload-abc-2.part'))).toBe(true);
  });

  it('does not ignore an ordinary file with a similar-looking name', () => {
    expect(ignored(path.join(root, 'od-upload-notes.part'))).toBe(false);
    expect(ignored(path.join(root, '.od-upload-plan.md'))).toBe(false);
    expect(ignored(path.join(root, 'hero.png'))).toBe(false);
  });
});
