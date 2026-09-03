// Cover persistence (S4-1 — cover as data). Covers live under
// RUNTIME_DATA_DIR/covers/<projectId>/ per the daemon data directory
// contract (root AGENTS.md) -- never a project-scoped or cwd-relative path.
//
//   covers/<projectId>/cover.png    -- the rendered, cropped image bytes.
//   covers/<projectId>/record.json  -- the S4-1 metadata record (path,
//                                      generatedAt, sourceHash, width,
//                                      height) -- the single source of
//                                      truth GET/restore read back.

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectCoverRecord } from '@open-design/contracts';
import { isSafeId } from '../projects.js';

export const COVER_IMAGE_FILENAME = 'cover.png';
export const COVER_RECORD_FILENAME = 'record.json';

/** `RUNTIME_DATA_DIR/covers` -- the covers storage root (C4-11 backup class). */
export function coversRootDir(runtimeDataDir: string): string {
  return path.join(runtimeDataDir, 'covers');
}

/**
 * Defense in depth: every store function below joins `projectId` straight
 * onto the covers root, so a path-traversal-shaped id ("..", "../../x")
 * must never reach path.join() here even if a future caller forgets its
 * own route-level guard (see routes/covers.ts's GET handler, which already
 * rejects this at the HTTP boundary). Mirrors isSafeId(), the same guard
 * resolveProjectDir() applies for the on-disk project root.
 */
function projectCoverDir(runtimeDataDir: string, projectId: string): string {
  if (!isSafeId(projectId)) {
    throw new Error(`invalid project id for cover storage: ${JSON.stringify(projectId)}`);
  }
  return path.join(coversRootDir(runtimeDataDir), projectId);
}

function coverImagePath(runtimeDataDir: string, projectId: string): string {
  return path.join(projectCoverDir(runtimeDataDir, projectId), COVER_IMAGE_FILENAME);
}

function coverRecordPath(runtimeDataDir: string, projectId: string): string {
  return path.join(projectCoverDir(runtimeDataDir, projectId), COVER_RECORD_FILENAME);
}

/** Data-root-relative path reported in the API record's `path` field. */
function relativeCoverPath(projectId: string): string {
  return `covers/${projectId}/${COVER_IMAGE_FILENAME}`;
}

export async function readCoverRecord(
  runtimeDataDir: string,
  projectId: string,
): Promise<ProjectCoverRecord | null> {
  try {
    const raw = await fs.readFile(coverRecordPath(runtimeDataDir, projectId), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ProjectCoverRecord>;
    if (
      typeof parsed.path !== 'string' ||
      typeof parsed.generatedAt !== 'string' ||
      typeof parsed.sourceHash !== 'string' ||
      typeof parsed.width !== 'number' ||
      typeof parsed.height !== 'number'
    ) {
      return null;
    }
    return {
      path: parsed.path,
      generatedAt: parsed.generatedAt,
      sourceHash: parsed.sourceHash,
      width: parsed.width,
      height: parsed.height,
    };
  } catch {
    return null;
  }
}

/**
 * Whether rendered cover image bytes exist for `projectId` right now — the
 * same bytes `GET /api/projects/:id/cover` serves.
 *
 * The projects list and detail responses publish this as `Project.hasCover`
 * so a client never has to discover the answer by taking a 404. An unsafe id
 * has no cover directory it is allowed to address, so it has no cover.
 *
 * This is an existence check at one instant, so it cannot be the whole answer
 * for the route, which reads the bytes in a later request — see
 * `hasAdvertisedCover` below.
 */
export async function hasCoverImage(runtimeDataDir: string, projectId: string): Promise<boolean> {
  try {
    await fs.access(coverImagePath(runtimeDataDir, projectId));
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a cover has ever been rendered for `projectId` — the condition under
 * which the daemon has published `Project.hasCover: true` and a client may
 * already be rendering the cover URL in an `<img>`.
 *
 * INVARIANT: this must stay TRUE across every way the stored bytes can stop
 * being readable, because it is what stops `GET /api/projects/:id/cover`
 * answering 404 for a cover the daemon advertised. It is therefore
 * deliberately wider than `hasCoverImage`: `writeCover` persists `record.json`
 * alongside `cover.png`, and that record outlives the image bytes when they
 * are deleted from another tab, truncated mid-replace, or made unreadable.
 * The image half of the check covers the reverse window — bytes on disk that
 * cannot be read, and the orphan-bytes case where a record was never written.
 *
 * A project with neither has advertised nothing, and the route still answers
 * 404 for it.
 */
export async function hasAdvertisedCover(runtimeDataDir: string, projectId: string): Promise<boolean> {
  if (await hasCoverImage(runtimeDataDir, projectId)) return true;
  return (await readCoverRecord(runtimeDataDir, projectId)) !== null;
}

export async function readCoverImageBytes(
  runtimeDataDir: string,
  projectId: string,
): Promise<Buffer | null> {
  try {
    return await fs.readFile(coverImagePath(runtimeDataDir, projectId));
  } catch {
    return null;
  }
}

export interface WriteCoverInput {
  imageBytes: Buffer;
  sourceHash: string;
  width: number;
  height: number;
  generatedAt: Date;
}

/**
 * Persists a freshly rendered cover: writes the image bytes then the JSON
 * record via a rename-into-place so a reader never observes a record whose
 * image bytes have not landed yet.
 */
export async function writeCover(
  runtimeDataDir: string,
  projectId: string,
  input: WriteCoverInput,
): Promise<ProjectCoverRecord> {
  const dir = projectCoverDir(runtimeDataDir, projectId);
  await fs.mkdir(dir, { recursive: true });

  const imagePath = coverImagePath(runtimeDataDir, projectId);
  const imageTmpPath = `${imagePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(imageTmpPath, input.imageBytes);
  await fs.rename(imageTmpPath, imagePath);

  const record: ProjectCoverRecord = {
    path: relativeCoverPath(projectId),
    generatedAt: input.generatedAt.toISOString(),
    sourceHash: input.sourceHash,
    width: input.width,
    height: input.height,
  };
  const recordPath = coverRecordPath(runtimeDataDir, projectId);
  const recordTmpPath = `${recordPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(recordTmpPath, JSON.stringify(record, null, 2));
  await fs.rename(recordTmpPath, recordPath);

  return record;
}
