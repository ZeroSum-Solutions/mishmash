import { mkdir, mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_AGE_MS, sweepStaleE2eArtifacts } from '@/artifact-retention';

const HOUR_MS = 60 * 60 * 1000;

async function makeArtifactRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'artifact-retention-test-'));
}

async function makeEntry(root: string, name: string, ageMs: number, now: number): Promise<void> {
  const entryPath = join(root, name);
  await mkdir(join(entryPath, 'scratch'), { recursive: true });
  await writeFile(join(entryPath, 'scratch', 'marker.txt'), 'artifact', 'utf8');
  const mtime = new Date(now - ageMs);
  await utimes(entryPath, mtime, mtime);
}

describe('sweepStaleE2eArtifacts', () => {
  it('removes entries older than maxAgeMs and keeps fresh ones', async () => {
    const now = Date.now();
    const root = await makeArtifactRoot();
    await makeEntry(root, 'playwright-1234-w0', 30 * HOUR_MS, now);
    await makeEntry(root, 'e2e-old-run-100-abc123', 48 * HOUR_MS, now);
    await makeEntry(root, 'playwright-9999-w1', 1 * HOUR_MS, now);

    const removed = await sweepStaleE2eArtifacts({ artifactRoot: root, maxAgeMs: 24 * HOUR_MS, now });

    expect(removed.sort()).toEqual(['e2e-old-run-100-abc123', 'playwright-1234-w0']);
    expect((await readdir(root)).sort()).toEqual(['playwright-9999-w1']);
  });

  it('removes stale plain files as well as directories', async () => {
    const now = Date.now();
    const root = await makeArtifactRoot();
    const stale = join(root, 'stray.log');
    await writeFile(stale, 'log', 'utf8');
    const mtime = new Date(now - 30 * HOUR_MS);
    await utimes(stale, mtime, mtime);

    const removed = await sweepStaleE2eArtifacts({ artifactRoot: root, maxAgeMs: 24 * HOUR_MS, now });

    expect(removed).toEqual(['stray.log']);
    expect(await readdir(root)).toEqual([]);
  });

  it('returns an empty list when the artifact root does not exist', async () => {
    const root = join(await makeArtifactRoot(), 'does-not-exist');

    await expect(sweepStaleE2eArtifacts({ artifactRoot: root })).resolves.toEqual([]);
  });

  it('defaults to a 24 hour retention window', () => {
    expect(DEFAULT_MAX_AGE_MS).toBe(24 * HOUR_MS);
  });
});
