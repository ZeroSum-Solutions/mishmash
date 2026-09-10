// W8C item 3: `readBuildStamp` reads `<dir>/build-stamp.json` (written at
// build time by `scripts/write-build-stamp.ts`) and falls back to
// `{commit: 'unknown', builtAt: 'unknown'}` on any read/parse failure --
// missing file, malformed JSON, or non-string fields -- so `/api/health`
// and `od --version` never throw when a stamp was never written (running
// from source under tsx/vitest, a tarball install, a `.git`-less checkout).
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// RED on base: `../src/build-stamp.js` does not exist yet.
import { readBuildStamp } from '../src/build-stamp.js';

describe('readBuildStamp', () => {
  it('falls back to unknown/unknown when no stamp file exists at the given directory', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'od-build-stamp-missing-'));
    try {
      expect(readBuildStamp(dir)).toEqual({ commit: 'unknown', builtAt: 'unknown' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to unknown/unknown on malformed JSON', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'od-build-stamp-malformed-'));
    try {
      await writeFile(path.join(dir, 'build-stamp.json'), '{not json');
      expect(readBuildStamp(dir)).toEqual({ commit: 'unknown', builtAt: 'unknown' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to unknown/unknown when fields are not strings', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'od-build-stamp-badshape-'));
    try {
      await writeFile(path.join(dir, 'build-stamp.json'), JSON.stringify({ commit: 42, builtAt: null }));
      expect(readBuildStamp(dir)).toEqual({ commit: 'unknown', builtAt: 'unknown' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads a real stamp file written at the given directory', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'od-build-stamp-real-'));
    try {
      const stamp = { commit: 'abc1234', builtAt: '2026-09-09T00:00:00.000Z' };
      await writeFile(path.join(dir, 'build-stamp.json'), JSON.stringify(stamp));
      expect(readBuildStamp(dir)).toEqual(stamp);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('defaults to its own compiled directory when no dir is passed, and does not throw', () => {
    // Under tsx/vitest there is no sibling `build-stamp.json` next to
    // `src/build-stamp.ts` (that file only exists next to compiled
    // `dist/cli.js` after a real build) -- this is the deterministic
    // no-stamp path the daemon actually runs under in every test file.
    expect(readBuildStamp()).toEqual({ commit: 'unknown', builtAt: 'unknown' });
  });
});
