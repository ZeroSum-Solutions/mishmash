import { mkdir, mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_AGE_MS, sweepStaleE2eArtifacts } from '@/artifact-retention';

const DAY_MS = 24 * 60 * 60 * 1000;

async function makeArtifactRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'artifact-retention-test-'));
}

async function makeEmptyIpcRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'artifact-retention-ipc-'));
}

async function makeEntry(root: string, name: string, ageMs: number, now: number): Promise<void> {
  const entryPath = join(root, name);
  await mkdir(join(entryPath, 'scratch'), { recursive: true });
  await writeFile(join(entryPath, 'scratch', 'marker.txt'), 'artifact', 'utf8');
  const mtime = new Date(now - ageMs);
  await utimes(entryPath, mtime, mtime);
}

describe('sweepStaleE2eArtifacts', () => {
  it('removes harness entries older than maxAgeMs and keeps fresh ones', async () => {
    const now = Date.now();
    const root = await makeArtifactRoot();
    const ipcRoot = await makeEmptyIpcRoot();
    await makeEntry(root, 'playwright-1234-w0', 9 * DAY_MS, now);
    await makeEntry(root, 'e2e-old-run-1785603718672-abc123', 8 * DAY_MS, now);
    await makeEntry(root, 'playwright-9999-w1', 1 * DAY_MS, now);

    const removed = await sweepStaleE2eArtifacts({ artifactRoot: root, now, ipcRoot });

    expect(removed.sort()).toEqual(['e2e-old-run-1785603718672-abc123', 'playwright-1234-w0']);
    expect((await readdir(root)).sort()).toEqual(['playwright-9999-w1']);
  });

  it('never touches entries it cannot attribute to the harness (W10F-E2E-ARTIFACT-SCOPE)', async () => {
    const now = Date.now();
    const root = await makeArtifactRoot();
    const ipcRoot = await makeEmptyIpcRoot();
    await makeEntry(root, 'user-notes-w2', 30 * DAY_MS, now);
    await makeEntry(root, 'keep-me', 30 * DAY_MS, now);
    const strayFile = join(root, 'stray.log');
    await writeFile(strayFile, 'log', 'utf8');
    const mtime = new Date(now - 30 * DAY_MS);
    await utimes(strayFile, mtime, mtime);

    const removed = await sweepStaleE2eArtifacts({ artifactRoot: root, now, ipcRoot });

    expect(removed).toEqual([]);
    expect((await readdir(root)).sort()).toEqual(['keep-me', 'stray.log', 'user-notes-w2']);
  });

  it('skips namespaces with a live IPC directory regardless of age', async () => {
    const now = Date.now();
    const root = await makeArtifactRoot();
    const ipcRoot = await makeEmptyIpcRoot();
    await makeEntry(root, 'playwright-4242-w0', 30 * DAY_MS, now);
    await mkdir(join(ipcRoot, 'playwright-4242-w0'), { recursive: true });

    const removed = await sweepStaleE2eArtifacts({ artifactRoot: root, now, ipcRoot });

    expect(removed).toEqual([]);
    expect(await readdir(root)).toEqual(['playwright-4242-w0']);
  });

  it('returns an empty list when the artifact root does not exist', async () => {
    const root = join(await makeArtifactRoot(), 'does-not-exist');

    await expect(sweepStaleE2eArtifacts({ artifactRoot: root })).resolves.toEqual([]);
  });

  it('pins the default window to the W10F-RETENTION-WINDOWS inactive-namespace ruling (7 days)', () => {
    expect(DEFAULT_MAX_AGE_MS).toBe(7 * DAY_MS);
  });
});
