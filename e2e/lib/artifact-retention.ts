import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type SweepStaleE2eArtifactsInput = {
  artifactRoot: string;
  maxAgeMs?: number;
  now?: number;
};

export async function sweepStaleE2eArtifacts(
  input: SweepStaleE2eArtifactsInput,
): Promise<string[]> {
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = input.now ?? Date.now();

  let entries: string[];
  try {
    entries = await readdir(input.artifactRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const removed: string[] = [];
  for (const entry of entries) {
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
