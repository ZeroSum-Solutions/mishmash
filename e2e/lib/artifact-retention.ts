import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

// Retention window for namespace roots under .tmp/e2e, mirroring the
// founder-recorded W10F-RETENTION-WINDOWS ruling (docs/plans/waves/
// DECISIONS.md): runtime files for INACTIVE namespaces = 7 days. The
// entries swept here are whole namespace roots (they hold scratch/data
// runtime dirs, not just reports), so the namespace window applies, not
// the 3-day artifact window. tests/artifact-retention.test.ts pins this
// value against the ruling so code and policy cannot drift.
export const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Only entries provably created by the two harness namespace factories are
// collectable: playwright/suite.ts (`playwright-<base>-w<idx>` via
// sanitizeSegment) and vitest/suite.ts (`e2e-<slug>-<ts>-<rand>`). Per
// W10F-E2E-ARTIFACT-SCOPE, anything a user could plausibly have placed in
// the directory is out of scope entirely — the sweep fails closed on names
// it cannot attribute to the harness.
const HARNESS_ENTRY_SHAPES: readonly RegExp[] = [
  /^playwright-\d+-w\d+$/,
  /^e2e-[A-Za-z0-9._-]+-\d{13}-[a-z0-9]{1,8}$/,
];

// Live tools-dev namespaces keep POSIX IPC sockets under this fixed root
// (root AGENTS.md "Boundary constraints"). Nested writes never refresh a
// namespace root's own mtime, so age alone cannot prove a namespace is
// inactive — a killed run can leave its detached daemon alive. Presence of
// the namespace's IPC directory therefore vetoes collection.
export const DEFAULT_IPC_ROOT = '/tmp/open-design/ipc';

export type SweepStaleE2eArtifactsInput = {
  artifactRoot: string;
  maxAgeMs?: number;
  now?: number;
  ipcRoot?: string;
};

export async function sweepStaleE2eArtifacts(
  input: SweepStaleE2eArtifactsInput,
): Promise<string[]> {
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = input.now ?? Date.now();
  const ipcRoot = input.ipcRoot ?? DEFAULT_IPC_ROOT;

  let entries: string[];
  try {
    entries = await readdir(input.artifactRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!HARNESS_ENTRY_SHAPES.some((shape) => shape.test(entry))) continue;
    if (await pathExists(join(ipcRoot, entry))) continue;

    const entryPath = join(input.artifactRoot, entry);
    let stats;
    try {
      stats = await lstat(entryPath);
    } catch {
      // Entry vanished between readdir and lstat — a concurrent run cleaned
      // up after itself. Nothing left to remove.
      continue;
    }
    if (now - stats.mtimeMs < maxAgeMs) continue;
    await rm(entryPath, { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
