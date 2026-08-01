// Shared recursive directory-copy engine. Extracted from
// plugins/duplicate-project.ts so a second caller (routes/design-library.ts,
// the licensed-kit "start project" flow) can reuse the same walk, skip-list,
// and symlink-rejection semantics with its own file/byte caps and its own
// incomplete-copy error.
//
// This module owns only the walk. Callers own what an incomplete copy means
// for their domain (HTTP status, error code, message) via `onIncomplete`.

import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface CopyDirectoryLimits {
  maxFiles: number;
  maxBytes: number;
}

export interface CopyDirectoryState {
  copiedFiles: number;
  copiedBytes: number;
  skippedFiles: number;
  warnings: string[];
}

export interface CopyDirectoryOptions {
  /** Directory names skipped entirely (not descended into), e.g. `.git`. */
  excludedDirNames: Set<string>;
  /** File names skipped entirely, e.g. `.DS_Store`. */
  excludedFileNames: Set<string>;
  limits: CopyDirectoryLimits;
  /**
   * Absolute source path to skip at the top level — used when the caller
   * already handled that entry separately (e.g. an index.html rewritten
   * before being written back).
   */
  skipSourcePath?: string;
  /**
   * Called for any condition that would silently truncate the copy: a
   * symlink, a special file, or a file/byte cap breach. Must throw — the
   * caller decides the concrete error type (HTTP status, code, message).
   */
  onIncomplete: (reason: string, relPath: string) => never;
}

export async function copyDirectoryContents(
  sourceDir: string,
  destDir: string,
  state: CopyDirectoryState,
  options: CopyDirectoryOptions,
): Promise<void> {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  await mkdir(destDir, { recursive: true });
  for (const entry of entries) {
    if (shouldSkipEntry(entry.name, entry.isDirectory(), options)) {
      state.skippedFiles += 1;
      continue;
    }
    const source = path.join(sourceDir, entry.name);
    const destination = path.join(destDir, entry.name);
    if (options.skipSourcePath && path.resolve(source) === options.skipSourcePath) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      options.onIncomplete('symbolic links are not supported', path.relative(sourceDir, source) || entry.name);
    }
    if (entry.isDirectory()) {
      await copyDirectoryContents(source, destination, state, options);
      continue;
    }
    if (!entry.isFile()) {
      options.onIncomplete('special files are not supported', path.relative(sourceDir, source) || entry.name);
    }
    if (state.copiedFiles >= options.limits.maxFiles) {
      options.onIncomplete('file limit would skip required files', path.relative(sourceDir, source) || entry.name);
    }
    const sourceInfo = await stat(source);
    if (state.copiedBytes + sourceInfo.size > options.limits.maxBytes) {
      options.onIncomplete('size limit would skip a required file', path.relative(sourceDir, source) || entry.name);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    state.copiedFiles += 1;
    state.copiedBytes += sourceInfo.size;
  }
}

function shouldSkipEntry(name: string, isDirectory: boolean, options: CopyDirectoryOptions): boolean {
  return isDirectory ? options.excludedDirNames.has(name) : options.excludedFileNames.has(name);
}
