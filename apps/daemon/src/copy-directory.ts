// Shared recursive directory-copy engine. Extracted from
// plugins/duplicate-project.ts so a second caller (routes/design-library.ts,
// the licensed-kit "start project" flow) can reuse the same walk, skip-list,
// and symlink-rejection semantics with its own file/byte caps and its own
// incomplete-copy error.
//
// This module owns only the walk. Callers own what an incomplete copy means
// for their domain (HTTP status, error code, message) via `onIncomplete`.
//
// Threat model / residual risk: every entry (including the source root
// itself, see below) is lstat-checked before it is trusted, but the checks
// and the later mkdir/copyFile calls are separate syscalls -- a local
// process with write access to the source tree can still swap a validated
// directory for a symlink in the gap between them (TOCTOU). This is a local
// daemon operating on local disk; defending against a concurrent adversarial
// writer on the same machine is out of scope, same threat model as the rest
// of the daemon's filesystem surface. Callers that need cross-request
// consistency (e.g. rights-tiered content) must still re-validate their own
// source root immediately before calling in, as routes/design-library.ts
// does.

import { copyFile, lstat, mkdir, readdir, stat } from 'node:fs/promises';
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
  await walkAndCopy(sourceDir, destDir, state, options, sourceDir);
}

// Recursive walk behind copyDirectoryContents. `copyRoot` stays pinned to
// the ORIGINAL source root across recursion so every onIncomplete relPath
// names the entry by its full path from the copied directory's root (e.g.
// `.next/cache/webpack/client-development/29.pack`). Rebasing against the
// per-level `sourceDir` collapsed that to the bare filename, which made cap
// and symlink errors unlocatable for anything nested.
async function walkAndCopy(
  sourceDir: string,
  destDir: string,
  state: CopyDirectoryState,
  options: CopyDirectoryOptions,
  copyRoot: string,
): Promise<void> {
  const relFromRoot = (target: string, fallback: string): string =>
    path.relative(copyRoot, target) || fallback;
  // The per-entry symlink check below only ever sees entries discovered by
  // walking INTO a directory -- it never re-examines the directory it is
  // about to walk. Without this, a caller that resolves a source root via
  // lexical containment (target stays under some base by string prefix) but
  // never lstats the root itself would happily walk through a root that is
  // itself a symlink, copying whatever it points at under the caller's
  // believed-safe label. Applying the check on every recursive call (not
  // just the outermost one) is redundant but harmless -- each directory
  // this function is about to descend into gets re-verified as a real
  // directory, not a symlink, immediately before the walk.
  const rootInfo = await lstat(sourceDir).catch(() => null);
  if (rootInfo?.isSymbolicLink()) {
    options.onIncomplete('symbolic links are not supported', relFromRoot(sourceDir, '.'));
  }
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
      options.onIncomplete('symbolic links are not supported', relFromRoot(source, entry.name));
    }
    if (entry.isDirectory()) {
      await walkAndCopy(source, destination, state, options, copyRoot);
      continue;
    }
    if (!entry.isFile()) {
      options.onIncomplete('special files are not supported', relFromRoot(source, entry.name));
    }
    if (state.copiedFiles >= options.limits.maxFiles) {
      options.onIncomplete('file limit would skip required files', relFromRoot(source, entry.name));
    }
    const sourceInfo = await stat(source);
    if (state.copiedBytes + sourceInfo.size > options.limits.maxBytes) {
      options.onIncomplete('size limit would skip a required file', relFromRoot(source, entry.name));
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    state.copiedFiles += 1;
    state.copiedBytes += sourceInfo.size;
  }
}

function shouldSkipEntry(name: string, isDirectory: boolean, options: CopyDirectoryOptions): boolean {
  const normalized = name.toLowerCase();
  const contains = (names: Set<string>): boolean =>
    [...names].some((candidate) => candidate.toLowerCase() === normalized);
  return isDirectory ? contains(options.excludedDirNames) : contains(options.excludedFileNames);
}
