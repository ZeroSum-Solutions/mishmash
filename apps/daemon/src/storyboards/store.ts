// Storyboard storage — one JSON file per storyboard under
// `<dataDir>/storyboards/<id>.json`. Callers always pass the resolved
// `RUNTIME_DATA_DIR` (per the daemon data-directory contract in AGENTS.md);
// this module never resolves a data root of its own.

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { Storyboard } from '@open-design/contracts';

function storyboardsDir(dataDir: string): string {
  return path.join(dataDir, 'storyboards');
}

function storyboardFilePath(dataDir: string, id: string): string {
  return path.join(storyboardsDir(dataDir), `${id}.json`);
}

// Per-storyboard-id async mutex. The daemon is the single writer process for
// storyboard files, so serializing same-id read-modify-write cycles
// in-process is sufficient to make every route's readStoryboard() ->
// writeStoryboard() critical section atomic with respect to every other
// route touching the same id — closing the lost-update window no per-route
// re-read/expectedUpdatedAt check can close on its own (see routes/storyboard.ts).
// Keyed by id (not one global lock) so unrelated storyboards never wait on
// each other. Same promise-chaining idiom as project-file-versions.ts's
// withVersionLockKey.
const storyboardLocks = new Map<string, Promise<void>>();

export async function withStoryboardLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = storyboardLocks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => current, () => current);
  storyboardLocks.set(id, chained);

  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    // Only the last-enqueued waiter's chain is still the map's current
    // value once it drains — an earlier waiter deleting the entry would
    // erase a later waiter's still-pending registration. This is what keeps
    // the map from growing without bound across many storyboards.
    if (storyboardLocks.get(id) === chained) {
      storyboardLocks.delete(id);
    }
  }
}

export async function readStoryboard(dataDir: string, id: string): Promise<Storyboard | null> {
  try {
    const raw = await readFile(storyboardFilePath(dataDir, id), 'utf8');
    return JSON.parse(raw) as Storyboard;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

// Atomic write idiom mirrored from live-artifacts/store.ts's writeFileAtomic:
// write to a sibling temp file, then rename over the target. A crash mid
// plain-writeFile would otherwise truncate the JSON and corrupt it forever;
// rename() is atomic on the same filesystem, so readers only ever see the
// old complete file or the new complete file.
export async function writeStoryboard(dataDir: string, storyboard: Storyboard): Promise<void> {
  const file = storyboardFilePath(dataDir, storyboard.id);
  await mkdir(path.dirname(file), { recursive: true });
  const tempPath = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tempPath, JSON.stringify(storyboard, null, 2), 'utf8');
  await rename(tempPath, file);
}

export async function deleteStoryboard(dataDir: string, id: string): Promise<boolean> {
  try {
    await rm(storyboardFilePath(dataDir, id));
    return true;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
}

export async function listStoryboards(dataDir: string): Promise<Storyboard[]> {
  let entries: string[];
  try {
    entries = await readdir(storyboardsDir(dataDir));
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  const out: Storyboard[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const id = entry.slice(0, -'.json'.length);
    const storyboard = await readStoryboard(dataDir, id);
    if (storyboard) out.push(storyboard);
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out;
}
