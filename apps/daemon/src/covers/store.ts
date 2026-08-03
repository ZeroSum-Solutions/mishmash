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

export const COVER_IMAGE_FILENAME = 'cover.png';
export const COVER_RECORD_FILENAME = 'record.json';

/** `RUNTIME_DATA_DIR/covers` -- the covers storage root (C4-11 backup class). */
export function coversRootDir(runtimeDataDir: string): string {
  return path.join(runtimeDataDir, 'covers');
}

function projectCoverDir(runtimeDataDir: string, projectId: string): string {
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
