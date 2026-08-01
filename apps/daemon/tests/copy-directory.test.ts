import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { copyDirectoryContents, type CopyDirectoryState } from '../src/copy-directory.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function freshState(): CopyDirectoryState {
  return { copiedFiles: 0, copiedBytes: 0, skippedFiles: 0, warnings: [] };
}

const DEFAULT_OPTIONS = {
  excludedDirNames: new Set(['.git', 'node_modules', '__MACOSX']),
  excludedFileNames: new Set(['.DS_Store']),
  limits: { maxFiles: 1000, maxBytes: 10 * 1024 * 1024 },
};

class TestIncompleteError extends Error {
  readonly reason: string;
  readonly relPath: string;

  constructor(reason: string, relPath: string) {
    super(`${reason} (${relPath})`);
    this.reason = reason;
    this.relPath = relPath;
  }
}

function onIncomplete(reason: string, relPath: string): never {
  throw new TestIncompleteError(reason, relPath);
}

// Windows non-admin runners can't create symlinks; probe once and skip the
// symlink-rejection case there instead of failing (same pattern as
// tests/design-library/routes.test.ts).
const canSymlink = (() => {
  try {
    const probeDir = mkdtempSync(path.join(tmpdir(), 'od-copy-directory-symlink-probe-'));
    writeFileSync(path.join(probeDir, 'a'), '');
    symlinkSync(path.join(probeDir, 'a'), path.join(probeDir, 'b'));
    rmSync(probeDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
})();

describe('copyDirectoryContents', () => {
  it('copies nested files and reports the final counts', async () => {
    const root = await makeTempRoot('od-copy-directory-basic-');
    const source = path.join(root, 'source');
    const dest = path.join(root, 'dest');
    await mkdir(path.join(source, 'nested'), { recursive: true });
    await writeFile(path.join(source, 'a.txt'), 'hello', 'utf8');
    await writeFile(path.join(source, 'nested', 'b.txt'), 'world', 'utf8');

    const state = freshState();
    await copyDirectoryContents(source, dest, state, { ...DEFAULT_OPTIONS, onIncomplete });

    expect(state.copiedFiles).toBe(2);
    expect(state.skippedFiles).toBe(0);
    expect(await readFile(path.join(dest, 'a.txt'), 'utf8')).toBe('hello');
    expect(await readFile(path.join(dest, 'nested', 'b.txt'), 'utf8')).toBe('world');
  });

  it('skips excluded directory and file names without descending into them', async () => {
    const root = await makeTempRoot('od-copy-directory-skip-');
    const source = path.join(root, 'source');
    const dest = path.join(root, 'dest');
    await mkdir(path.join(source, '.git'), { recursive: true });
    await mkdir(path.join(source, 'node_modules'), { recursive: true });
    await mkdir(path.join(source, '__MACOSX'), { recursive: true });
    await writeFile(path.join(source, '.git', 'HEAD'), 'ref: refs/heads/main', 'utf8');
    await writeFile(path.join(source, 'node_modules', 'pkg.json'), '{}', 'utf8');
    await writeFile(path.join(source, '.DS_Store'), 'junk', 'utf8');
    await writeFile(path.join(source, 'keep.txt'), 'keep', 'utf8');

    const state = freshState();
    await copyDirectoryContents(source, dest, state, { ...DEFAULT_OPTIONS, onIncomplete });

    expect(state.copiedFiles).toBe(1);
    // Four top-level entries are skipped: .git, node_modules, __MACOSX
    // (excluded dir names) and .DS_Store (an excluded file name).
    expect(state.skippedFiles).toBe(4);
    await expect(readFile(path.join(dest, 'keep.txt'), 'utf8')).resolves.toBe('keep');
    await expect(readFile(path.join(dest, '.git', 'HEAD'), 'utf8')).rejects.toThrow();
  });

  it.runIf(canSymlink)('calls onIncomplete for a symlinked entry instead of copying it', async () => {
    const root = await makeTempRoot('od-copy-directory-symlink-');
    const source = path.join(root, 'source');
    const dest = path.join(root, 'dest');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'target.txt'), 'asset', 'utf8');
    await symlink('target.txt', path.join(source, 'linked.txt'));

    const state = freshState();
    await expect(
      copyDirectoryContents(source, dest, state, { ...DEFAULT_OPTIONS, onIncomplete }),
    ).rejects.toMatchObject({ reason: 'symbolic links are not supported', relPath: 'linked.txt' });
  });

  it('calls onIncomplete once the file-count cap would be exceeded', async () => {
    const root = await makeTempRoot('od-copy-directory-file-cap-');
    const source = path.join(root, 'source');
    const dest = path.join(root, 'dest');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'a.txt'), 'a', 'utf8');
    await writeFile(path.join(source, 'b.txt'), 'b', 'utf8');

    const state = freshState();
    await expect(
      copyDirectoryContents(source, dest, state, {
        ...DEFAULT_OPTIONS,
        limits: { maxFiles: 1, maxBytes: 10 * 1024 * 1024 },
        onIncomplete,
      }),
    ).rejects.toMatchObject({ reason: 'file limit would skip required files' });
  });

  it('calls onIncomplete once the byte cap would be exceeded', async () => {
    const root = await makeTempRoot('od-copy-directory-byte-cap-');
    const source = path.join(root, 'source');
    const dest = path.join(root, 'dest');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'big.txt'), 'x'.repeat(64), 'utf8');

    const state = freshState();
    await expect(
      copyDirectoryContents(source, dest, state, {
        ...DEFAULT_OPTIONS,
        limits: { maxFiles: 1000, maxBytes: 32 },
        onIncomplete,
      }),
    ).rejects.toMatchObject({ reason: 'size limit would skip a required file' });
  });

  it('skips the top-level skipSourcePath entry without copying or counting it', async () => {
    const root = await makeTempRoot('od-copy-directory-skip-source-');
    const source = path.join(root, 'source');
    const dest = path.join(root, 'dest');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'index.html'), '<html></html>', 'utf8');
    await writeFile(path.join(source, 'style.css'), 'body{}', 'utf8');

    const state = freshState();
    await copyDirectoryContents(source, dest, state, {
      ...DEFAULT_OPTIONS,
      skipSourcePath: path.resolve(source, 'index.html'),
      onIncomplete,
    });

    expect(state.copiedFiles).toBe(1);
    await expect(readFile(path.join(dest, 'style.css'), 'utf8')).resolves.toBe('body{}');
    await expect(readFile(path.join(dest, 'index.html'), 'utf8')).rejects.toThrow();
  });
});
