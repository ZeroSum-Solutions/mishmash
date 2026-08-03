// Cover persistence (S4-1). Real filesystem, real temp RUNTIME_DATA_DIR.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { coversRootDir, readCoverImageBytes, readCoverRecord, writeCover } from '../../src/covers/store.js';

let dataDir = '';

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'od-covers-store-'));
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('cover store', () => {
  it('round-trips a written cover: bytes + record both readable afterward', async () => {
    const record = await writeCover(dataDir, 'proj-1', {
      imageBytes: Buffer.from('fake-png-bytes'),
      sourceHash: 'a'.repeat(16),
      width: 1280,
      height: 800,
      generatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(record.path).toBe('covers/proj-1/cover.png');
    expect(record.width).toBe(1280);
    expect(record.height).toBe(800);

    const readBack = await readCoverRecord(dataDir, 'proj-1');
    expect(readBack).toEqual(record);

    const bytes = await readCoverImageBytes(dataDir, 'proj-1');
    expect(bytes?.toString()).toBe('fake-png-bytes');
  });

  it('stores under RUNTIME_DATA_DIR/covers (the daemon data directory contract)', async () => {
    await writeCover(dataDir, 'proj-2', {
      imageBytes: Buffer.from('x'),
      sourceHash: 'b'.repeat(16),
      width: 1,
      height: 1,
      generatedAt: new Date(),
    });
    const root = coversRootDir(dataDir);
    expect(root).toBe(path.join(dataDir, 'covers'));
    const stat = await fs.stat(path.join(root, 'proj-2', 'cover.png'));
    expect(stat.isFile()).toBe(true);
  });

  it('returns null for a project with no stored cover, never throws', async () => {
    expect(await readCoverRecord(dataDir, 'never-generated')).toBeNull();
    expect(await readCoverImageBytes(dataDir, 'never-generated')).toBeNull();
  });

  it('overwriting a cover updates both the record and the bytes', async () => {
    await writeCover(dataDir, 'proj-3', {
      imageBytes: Buffer.from('v1'),
      sourceHash: 'c'.repeat(16),
      width: 10,
      height: 10,
      generatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const second = await writeCover(dataDir, 'proj-3', {
      imageBytes: Buffer.from('v2'),
      sourceHash: 'd'.repeat(16),
      width: 20,
      height: 20,
      generatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const bytes = await readCoverImageBytes(dataDir, 'proj-3');
    expect(bytes?.toString()).toBe('v2');
    const record = await readCoverRecord(dataDir, 'proj-3');
    expect(record).toEqual(second);
    expect(record?.sourceHash).toBe('d'.repeat(16));
  });
});
