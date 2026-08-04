// Red spec for the multi-.fig snapshot subdir derivation. The daemon now
// honors the `subdir` field on /figma/import, so the client-derived name is
// what actually lands on disk — it must be a clean `figma-<slug>` segment
// (no stray extensions) and unique per file within one staging batch.

import { describe, expect, it } from 'vitest';
import { figmaSnapshotSubdir } from '../../src/components/DesignSystemFlow';

describe('figmaSnapshotSubdir', () => {
  it('derives figma-<slug> from the file name without any extension residue', () => {
    expect(figmaSnapshotSubdir('Button Kit.fig', 0)).toBe('figma-button-kit');
  });

  it('uses the leaf name of a nested drop path', () => {
    expect(figmaSnapshotSubdir('drop/folder/Homepage.fig', 2)).toBe('figma-homepage');
  });

  it('falls back to an index-based name when the slug comes out empty', () => {
    expect(figmaSnapshotSubdir('™™.fig', 3)).toBe('figma-file-3');
  });

  it('disambiguates same-named files within one batch via the used set', () => {
    const used = new Set<string>();
    expect(figmaSnapshotSubdir('a/Design.fig', 0, used)).toBe('figma-design');
    expect(figmaSnapshotSubdir('b/Design.fig', 1, used)).toBe('figma-design-2');
  });

  it('keeps probing when the disambiguation suffix itself collides with a file-derived name', () => {
    const used = new Set<string>();
    expect(figmaSnapshotSubdir('Design-2.fig', 0, used)).toBe('figma-design-2');
    expect(figmaSnapshotSubdir('a/Design.fig', 1, used)).toBe('figma-design');
    expect(figmaSnapshotSubdir('b/Design.fig', 2, used)).toBe('figma-design-3');
  });
});
