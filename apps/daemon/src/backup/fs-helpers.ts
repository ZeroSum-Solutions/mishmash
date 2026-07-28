// Small filesystem primitives shared by create.ts / restore.ts. Kept
// dependency-free (no better-sqlite3 here) so both sides of the engine can
// import this without pulling in the sqlite driver.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function sha256File(absPath: string): string {
  return createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

export function sha256Bytes(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Recursively lists every regular file under `root`, as paths relative to `root` (POSIX separators, deterministic order). */
export function listFilesRecursive(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  (function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      // Never follow symlinks into or out of the tree being archived/restored.
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  })(root);
  return out;
}

/** Copies `srcDir` (if present) to `destDir` and returns a relFile -> sha256 map computed from the COPIED bytes. Creates an empty `destDir` when `srcDir` is absent so the archive entry still exists. */
export function copyDirWithChecksums(srcDir: string, destDir: string): Record<string, string> {
  fs.mkdirSync(destDir, { recursive: true });
  if (!fs.existsSync(srcDir)) return {};
  fs.cpSync(srcDir, destDir, { recursive: true, dereference: false, verbatimSymlinks: false, filter: (src) => !fs.lstatSync(src).isSymbolicLink() });
  const checksums: Record<string, string> = {};
  for (const rel of listFilesRecursive(destDir)) {
    checksums[rel] = sha256File(path.join(destDir, rel));
  }
  return checksums;
}

/** Verifies every recorded checksum against the files actually present under `dir`, and that no extra/missing files exist. Returns problems (empty = clean). */
export function verifyDirChecksums(dir: string, checksums: Record<string, string>): string[] {
  const problems: string[] = [];
  const recordedFiles = Object.keys(checksums).sort();
  const actualFiles = listFilesRecursive(dir).sort();
  const recordedSet = new Set(recordedFiles);
  const actualSet = new Set(actualFiles);
  for (const rel of recordedFiles) {
    if (!actualSet.has(rel)) {
      problems.push(`missing file: ${rel}`);
      continue;
    }
    const actualHash = sha256File(path.join(dir, rel));
    const expected = checksums[rel];
    if (actualHash !== expected) problems.push(`checksum mismatch: ${rel} (expected ${expected}, got ${actualHash})`);
  }
  for (const rel of actualFiles) {
    if (!recordedSet.has(rel)) problems.push(`unexpected file not in manifest: ${rel}`);
  }
  return problems;
}

/** Atomically stage-then-promote a directory or file into `destPath`, replacing whatever (if anything) is already there. `srcPath` is removed as part of the promotion when it's on the same filesystem (rename); falls back to copy+remove across devices (EXDEV). */
export function promoteIntoPlace(srcPath: string, destPath: string): void {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.rmSync(destPath, { recursive: true, force: true });
  try {
    fs.renameSync(srcPath, destPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    fs.cpSync(srcPath, destPath, { recursive: true });
    fs.rmSync(srcPath, { recursive: true, force: true });
  }
}
