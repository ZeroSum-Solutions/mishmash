import { mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  concatListName,
  pruneStoryboardAssembleOutputs,
  STORYBOARD_ASSEMBLE_OUTPUTS_KEEP,
} from '../../src/storyboards/assemble.js';

describe('storyboard assemble scratch and output hygiene', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('gives concurrent concat runs different scratch-list names', () => {
    const first = concatListName('storyboard-1');
    const second = concatListName('storyboard-1');

    expect(first).not.toBe(second);
    expect(first).toMatch(/^\.storyboard-concat-storyboard-1-[0-9a-f-]+\.txt$/);
    expect(second).toMatch(/^\.storyboard-concat-storyboard-1-[0-9a-f-]+\.txt$/);
  });

  it('keeps the current output plus only the newest retained outputs for one storyboard', async () => {
    const projectDir = path.join(tmpdir(), `od-assemble-hygiene-${Date.now()}-${Math.random()}`);
    roots.push(projectDir);
    await mkdir(projectDir, { recursive: true });

    const storyboardId = 'storyboard-1';
    const outputs = Array.from(
      { length: STORYBOARD_ASSEMBLE_OUTPUTS_KEEP + 2 },
      (_, index) => `final-${storyboardId}-00000000-0000-4000-8000-${String(index).padStart(12, '0')}.mp4`,
    );
    for (const [index, output] of outputs.entries()) {
      await writeFile(path.join(projectDir, output), `video-${index}`);
      const timestamp = new Date(1_700_000_000_000 + index * 1_000);
      await utimes(path.join(projectDir, output), timestamp, timestamp);
    }
    await writeFile(path.join(projectDir, 'frame-unrelated.png'), 'keep me');

    const currentOutput = outputs[0]!;
    const result = await pruneStoryboardAssembleOutputs({
      projectDir,
      storyboardId,
      currentOutput,
      removeOutput: (absolutePath) => rm(absolutePath, { force: true }),
    });

    expect(result.removed).toHaveLength(2);
    const remaining = await readdir(projectDir);
    expect(remaining).toContain(currentOutput);
    expect(remaining).toContain('frame-unrelated.png');
    expect(remaining.filter((name) => name.startsWith(`final-${storyboardId}-`))).toHaveLength(
      STORYBOARD_ASSEMBLE_OUTPUTS_KEEP,
    );
  });
});
