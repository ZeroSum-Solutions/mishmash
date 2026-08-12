import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertStaticExportHasNoSourceMaps } from '../../scripts/assert-static-export-sourcemaps.mjs';

let outputRoot: string;

beforeEach(async () => {
  outputRoot = await mkdtemp(join(tmpdir(), 'mishmash-static-export-'));
});

afterEach(async () => {
  await rm(outputRoot, { recursive: true, force: true });
});

describe('static export source-map audit', () => {
  it('accepts a static export with no source maps', async () => {
    await mkdir(join(outputRoot, '_next', 'static', 'chunks'), { recursive: true });
    await writeFile(join(outputRoot, '_next', 'static', 'chunks', 'app.js'), '/* bundle */');

    await expect(assertStaticExportHasNoSourceMaps({ outputRoot })).resolves.toEqual({
      checked: true,
      maps: [],
    });
  });

  it('rejects any nested source map in the served export', async () => {
    const chunksRoot = join(outputRoot, '_next', 'static', 'chunks');
    await mkdir(chunksRoot, { recursive: true });
    await writeFile(join(chunksRoot, 'app.js.map'), '{}');

    await expect(assertStaticExportHasNoSourceMaps({ outputRoot })).rejects.toThrow(
      'static export contains 1 source map(s): _next/static/chunks/app.js.map',
    );
  });

  it('skips the static-export audit for packaged server output', async () => {
    await rm(outputRoot, { recursive: true, force: true });

    await expect(
      assertStaticExportHasNoSourceMaps({ outputRoot, webOutputMode: 'server' }),
    ).resolves.toEqual({ checked: false, maps: [] });
  });

  it('fails when a static build did not produce the expected output root', async () => {
    await rm(outputRoot, { recursive: true, force: true });

    await expect(assertStaticExportHasNoSourceMaps({ outputRoot })).rejects.toThrow(
      'static export output is missing',
    );
  });
});
