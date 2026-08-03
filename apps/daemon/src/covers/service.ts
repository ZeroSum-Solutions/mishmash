// Cover generation orchestration (S4-1..S4-4): resolve the project's own
// HTML entry, compute the transitive content hash, reuse the stored cover
// when the hash is unchanged (invalidation is content-driven, never
// mtime-driven -- C4-4), otherwise render + crop + persist a fresh one.

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectCoverRecord } from '@open-design/contracts';
import { computeTransitiveSourceHash } from './hash.js';
import { NoRenderableEntryError } from './errors.js';
import { readCoverRecord, writeCover } from './store.js';
import { renderCoverImage } from './renderer.js';

const HTML_EXT_RE = /\.html?$/i;

interface FileEntry {
  path?: string;
  name: string;
  mtime: number;
}

/** Picks the project's own render entry: `index.html` at the project root
 * when present, otherwise the most recently modified `.html` file anywhere
 * in the project -- mirrors apps/web/src/components/project-cover.tsx's
 * existing `selectProjectFileCover` convention so "the project's own HTML"
 * means the same thing on both sides of the wire. */
async function findEntryRelPath(projectRoot: string): Promise<string | null> {
  const rootIndex = path.join(projectRoot, 'index.html');
  try {
    const stat = await fs.stat(rootIndex);
    if (stat.isFile()) return 'index.html';
  } catch {
    /* fall through to a directory walk */
  }

  const candidates: FileEntry[] = [];
  await walkForHtml(projectRoot, projectRoot, candidates);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.path ?? null;
}

async function walkForHtml(root: string, dir: string, out: FileEntry[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      await walkForHtml(root, abs, out);
    } else if (entry.isFile() && HTML_EXT_RE.test(entry.name)) {
      try {
        const stat = await fs.stat(abs);
        out.push({ path: path.relative(root, abs), name: entry.name, mtime: stat.mtimeMs });
      } catch {
        /* file disappeared mid-walk */
      }
    }
  }
}

export interface GenerateCoverOptions {
  runtimeDataDir: string;
  projectRoot: string;
  projectId: string;
}

/** Generates (or reuses, per C4-4 content-driven invalidation) the cover
 * for a project. Throws RenderTimeoutError / RenderMemoryLimitError /
 * NoRenderableEntryError -- routes/covers.ts maps these onto the frozen
 * HTTP error envelope. */
export async function generateProjectCover(options: GenerateCoverOptions): Promise<ProjectCoverRecord> {
  const { runtimeDataDir, projectRoot, projectId } = options;

  const entryRelPath = await findEntryRelPath(projectRoot);
  if (!entryRelPath) throw new NoRenderableEntryError();

  const { sourceHash } = await computeTransitiveSourceHash(projectRoot, entryRelPath);

  const existing = await readCoverRecord(runtimeDataDir, projectId);
  if (existing && existing.sourceHash === sourceHash) {
    return existing;
  }

  const entryAbsPath = path.join(projectRoot, entryRelPath);
  const rendered = await renderCoverImage(entryAbsPath);

  return writeCover(runtimeDataDir, projectId, {
    imageBytes: rendered.imageBytes,
    sourceHash,
    width: rendered.width,
    height: rendered.height,
    generatedAt: new Date(),
  });
}
