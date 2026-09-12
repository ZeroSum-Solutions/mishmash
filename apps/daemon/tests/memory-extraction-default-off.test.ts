import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  extractFromMessage,
  listMemoryEntries,
  readMemoryConfig,
  readMemoryEntry,
  writeMemoryConfig,
} from '../src/memory.js';

let dataDir = '';

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'od-memory-default-'));
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('chat auto-extraction default', () => {
  it('defaults chatExtractionEnabled to OFF when no config exists', async () => {
    const cfg = await readMemoryConfig(dataDir);
    expect(cfg.enabled).toBe(true);
    expect(cfg.chatExtractionEnabled).toBe(false);
    // Injection-side hooks stay on: memory the user typed still reaches
    // the prompt; only the extraction pipelines are retired.
    expect(cfg.profileEnabled).toBe(true);
  });

  it('defaults chatExtractionEnabled to OFF for configs written before the flag existed', async () => {
    await fsp.mkdir(path.join(dataDir, 'memory'), { recursive: true });
    await fsp.writeFile(
      path.join(dataDir, 'memory', '.config.json'),
      JSON.stringify({ enabled: true }),
    );
    const cfg = await readMemoryConfig(dataDir);
    expect(cfg.chatExtractionEnabled).toBe(false);
  });

  it('writes nothing for marker-looking chat messages under the default config', async () => {
    // Real production false positives from the retired regex pack: the
    // progressive-aspect "我在…" and the form round-trip both minted junk
    // "user location" / "user goal" entries.
    const changed = await extractFromMessage(
      dataDir,
      '别问了，给我在首屏补一张决定性 hero 图，直接开做：',
    );
    expect(changed).toEqual([]);
    expect(await listMemoryEntries(dataDir)).toEqual([]);
  });

  it('still honors an explicit opt-in', async () => {
    await writeMemoryConfig(dataDir, { chatExtractionEnabled: true });
    const changed = await extractFromMessage(dataDir, '记住：主色永远用品牌绿');
    expect(changed.length).toBeGreaterThan(0);
  });

  it.each([
    {
      message:
        'Please save this to durable notes: Use the Vimeo API for drag-and-drop video editing.',
      type: 'project',
      body: 'Use the Vimeo API for drag-and-drop video editing.',
    },
    {
      message: 'Save this to durable memory — Keep exported videos non-destructive.',
      type: 'project',
      body: 'Keep exported videos non-destructive.',
    },
    {
      message: 'Log this in the Mishmag log log: Add inline video trimming.',
      type: 'project',
      body: 'Add inline video trimming.',
    },
    {
      message: 'Remember this: Prefer non-destructive media edits.',
      type: 'feedback',
      body: 'Prefer non-destructive media edits.',
    },
    {
      message: 'Log a bug: The canvas drops the selected layer after undo.',
      type: 'feedback',
      body: 'The canvas drops the selected layer after undo.',
    },
    {
      message: 'Log an idea: Add reusable timeline presets.',
      type: 'project',
      body: 'Add reusable timeline presets.',
    },
    {
      message: 'Lo,g of a feature: Support Vimeo imports.',
      type: 'project',
      body: 'Support Vimeo imports.',
    },
  ])('saves explicit natural-language memory commands while passive extraction is off: $message', async ({
    message,
    type,
    body,
  }) => {
    const changed = await extractFromMessage(dataDir, message);

    expect(changed).toHaveLength(1);
    expect(changed[0]?.type).toBe(type);
    const entry = await readMemoryEntry(dataDir, changed[0]!.id);
    expect(entry?.body).toContain(body);
  });

  it('does not treat discussion of logging as an explicit save command', async () => {
    const changed = await extractFromMessage(
      dataDir,
      'When we log a feature, the UI should confirm it clearly.',
    );

    expect(changed).toEqual([]);
    expect(await listMemoryEntries(dataDir)).toEqual([]);
  });

  it('does not create an empty memory from a command with no note content', async () => {
    const changed = await extractFromMessage(dataDir, 'Log a feature');

    expect(changed).toEqual([]);
    expect(await listMemoryEntries(dataDir)).toEqual([]);
  });

  it('deduplicates an explicitly logged note by its normalized content', async () => {
    const message = 'Log an idea: Add reusable timeline presets.';

    await extractFromMessage(dataDir, message);
    const duplicate = await extractFromMessage(dataDir, message);

    expect(duplicate).toEqual([]);
    expect(await listMemoryEntries(dataDir)).toHaveLength(1);
  });

  it('round-trips an explicit opt-in through writeMemoryConfig', async () => {
    await writeMemoryConfig(dataDir, { chatExtractionEnabled: true });
    expect((await readMemoryConfig(dataDir)).chatExtractionEnabled).toBe(true);
    // Patching an unrelated flag must not silently re-enable extraction.
    await writeMemoryConfig(dataDir, { verifyEnabled: false });
    expect((await readMemoryConfig(dataDir)).chatExtractionEnabled).toBe(true);
    await writeMemoryConfig(dataDir, { chatExtractionEnabled: false });
    expect((await readMemoryConfig(dataDir)).chatExtractionEnabled).toBe(false);
  });
});
