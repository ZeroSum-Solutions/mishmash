// @vitest-environment jsdom
//
// Sunk-tile contract for the "newest" sort order: default mode-seeds and
// no-preview tiles (pluginPopularity.ts's SINK set) must never surface
// mid-grid just because their timestamps land among real content. Pins the
// sinkToBottom call in usePluginFacets' newest branch — pre-fix, the newest
// slice skipped the sink pass entirely and a sunk tile with the freshest
// updatedAt led the grid.

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { InstalledPluginRecord } from '@open-design/contracts';
import { usePluginFacets } from '../../src/components/plugins-home/usePluginFacets';
import { ALWAYS_LAST } from '../../src/components/plugins-home/pluginPopularity';

function fixture(overrides: { id: string; updatedAt: number }): InstalledPluginRecord {
  return {
    id: overrides.id,
    title: overrides.id,
    version: '0.1.0',
    sourceKind: 'bundled',
    source: '/tmp',
    trust: 'bundled',
    capabilitiesGranted: ['prompt:inject'],
    manifest: { name: overrides.id, version: '0.1.0' },
    fsPath: '/tmp',
    installedAt: 0,
    updatedAt: overrides.updatedAt,
  };
}

describe('usePluginFacets newest sort', () => {
  it('keeps sunk tiles at the tail even when they carry the freshest timestamp', () => {
    const sunkId = ALWAYS_LAST[0]!;
    const plugins = [
      fixture({ id: 'real-older', updatedAt: 100 }),
      // The sunk tile is deliberately the NEWEST record — pre-fix it would
      // have led the newest-ordered grid.
      fixture({ id: sunkId, updatedAt: 900 }),
      fixture({ id: 'real-newer', updatedAt: 500 }),
    ];

    const { result } = renderHook(() =>
      usePluginFacets({ plugins, savedPluginIds: new Set(), preferDefaultFacet: false, locale: 'en' }),
    );
    act(() => result.current.setSortOrder('newest'));

    const ids = result.current.filtered.map((p) => p.id);
    // Real content stays chronological (newest first); the sunk tile is last
    // despite having the freshest updatedAt.
    expect(ids).toEqual(['real-newer', 'real-older', sunkId]);
  });
});
