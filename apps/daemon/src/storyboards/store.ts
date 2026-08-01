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
