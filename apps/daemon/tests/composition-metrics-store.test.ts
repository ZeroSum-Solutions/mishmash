import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompositionMetrics } from '@open-design/contracts';

import {
  COMPOSITION_METRICS_MAX_ENTRIES,
  createCompositionMetricsStore,
} from '../src/composition-metrics-store.js';

let dataDir = '';

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'od-composition-metrics-store-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function fakeMetrics(overrides: Partial<CompositionMetrics> = {}): CompositionMetrics {
  return {
    sectionCount: 5,
    outOfFlowElementCount: 0,
    transformedElementCount: 0,
    distinctSectionBackgroundCount: 1,
    distinctSectionWidthCount: 1,
    fullBleedAgainstContained: false,
    bodyFontSizePx: 14,
    maxDisplayFontSizePx: 48,
    displayToBodyFontRatio: 48 / 14,
    measuredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('composition-metrics store', () => {
  it('derives its path from the data root it is given', () => {
    const store = createCompositionMetricsStore({ dataDir });
    // Daemon data-directory contract: every daemon-owned path descends from
    // the resolved data root, never from cwd or an env read of its own.
    expect(store.path.startsWith(dataDir)).toBe(true);
  });

  it('returns null for an artifact that has never been reported', async () => {
    const store = createCompositionMetricsStore({ dataDir });
    expect(await store.get('proj-1', 'index.html')).toBeNull();
  });

  it('round-trips a report through set and get', async () => {
    const store = createCompositionMetricsStore({ dataDir });
    const metrics = fakeMetrics({ sectionCount: 7, outOfFlowElementCount: 2 });

    const written = await store.set('proj-1', 'index.html', metrics, false);
    expect(written.projectId).toBe('proj-1');
    expect(written.file).toBe('index.html');
    expect(written.metrics).toEqual(metrics);
    expect(written.isWebCloneRun).toBe(false);
    expect(Date.parse(written.reportedAt)).toBeGreaterThan(Date.parse('2020-01-01T00:00:00.000Z'));

    const read = await store.get('proj-1', 'index.html');
    expect(read).toEqual(written);
  });

  it('keeps two different files in the same project separate', async () => {
    const store = createCompositionMetricsStore({ dataDir });
    await store.set('proj-1', 'index.html', fakeMetrics({ sectionCount: 3 }), false);
    await store.set('proj-1', 'about.html', fakeMetrics({ sectionCount: 9 }), false);

    expect((await store.get('proj-1', 'index.html'))?.metrics.sectionCount).toBe(3);
    expect((await store.get('proj-1', 'about.html'))?.metrics.sectionCount).toBe(9);
  });

  it('keeps the same file path separate across different projects', async () => {
    const store = createCompositionMetricsStore({ dataDir });
    await store.set('proj-1', 'index.html', fakeMetrics({ sectionCount: 3 }), false);
    await store.set('proj-2', 'index.html', fakeMetrics({ sectionCount: 9 }), false);

    expect((await store.get('proj-1', 'index.html'))?.metrics.sectionCount).toBe(3);
    expect((await store.get('proj-2', 'index.html'))?.metrics.sectionCount).toBe(9);
  });

  it('overwrites the previous report for the same (project, file) — a current value, not a log', async () => {
    const store = createCompositionMetricsStore({ dataDir });
    await store.set('proj-1', 'index.html', fakeMetrics({ sectionCount: 3 }), false);
    await store.set('proj-1', 'index.html', fakeMetrics({ sectionCount: 8 }), false);

    const record = await store.get('proj-1', 'index.html');
    expect(record?.metrics.sectionCount).toBe(8);
  });

  it('carries the caller-resolved isWebCloneRun flag through, unmodified', async () => {
    const store = createCompositionMetricsStore({ dataDir });
    await store.set('proj-1', 'index.html', fakeMetrics(), true);
    expect((await store.get('proj-1', 'index.html'))?.isWebCloneRun).toBe(true);
  });

  it('persists across store instances reading the same data dir', async () => {
    const first = createCompositionMetricsStore({ dataDir });
    await first.set('proj-1', 'index.html', fakeMetrics({ sectionCount: 6 }), false);

    const second = createCompositionMetricsStore({ dataDir });
    expect((await second.get('proj-1', 'index.html'))?.metrics.sectionCount).toBe(6);
  });

  it('evicts the oldest report once entries exceed the cap', async () => {
    const store = createCompositionMetricsStore({ dataDir });
    // One over the cap — the very first report should be the one evicted.
    for (let i = 0; i <= COMPOSITION_METRICS_MAX_ENTRIES; i += 1) {
      await store.set('proj-1', `file-${i}.html`, fakeMetrics({ sectionCount: i }), false);
    }
    expect(await store.get('proj-1', 'file-0.html')).toBeNull();
    expect((await store.get('proj-1', `file-${COMPOSITION_METRICS_MAX_ENTRIES}.html`))?.metrics.sectionCount).toBe(
      COMPOSITION_METRICS_MAX_ENTRIES,
    );
  });

  it('does not corrupt the store on concurrent reports for different files', async () => {
    const store = createCompositionMetricsStore({ dataDir });
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        store.set('proj-1', `file-${i}.html`, fakeMetrics({ sectionCount: i }), false),
      ),
    );
    for (let i = 0; i < 25; i += 1) {
      expect((await store.get('proj-1', `file-${i}.html`))?.metrics.sectionCount).toBe(i);
    }
  });
});
