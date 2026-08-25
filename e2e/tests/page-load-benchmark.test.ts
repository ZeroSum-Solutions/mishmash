import { describe, expect, it } from 'vitest';

import {
  PAGE_LOAD_TARGETS,
  evaluatePageLoad,
  summarizeSamples,
} from '../lib/playwright/page-load-benchmark.js';

describe('page-load benchmark contract', () => {
  it('covers every static Studio route in the fixed benchmark matrix', () => {
    expect(PAGE_LOAD_TARGETS.map(({ path }) => path)).toEqual([
      '/',
      '/projects',
      '/automations',
      '/plugins',
      '/design-systems',
      '/design-library',
      '/storyboard',
      '/templates',
      '/typefaces',
      '/academy',
      '/integrations',
      '/marketplace',
      '/interview',
    ]);
  });

  it('reports literal median and nearest-rank p95 values without hiding the slow tail', () => {
    expect(summarizeSamples([12, 49, 18, 24, 31, 21, 16])).toEqual({
      minMs: 12,
      medianMs: 21,
      p95Ms: 49,
      maxMs: 49,
    });
  });

  it('rejects empty and non-finite sample sets', () => {
    expect(() => summarizeSamples([])).toThrow(/sample/i);
    expect(() => summarizeSamples([18, Number.NaN])).toThrow(/finite/i);
  });

  it('fails the gate when any route p95 meets or exceeds 50 ms', () => {
    const result = evaluatePageLoad(
      [
        { path: '/', samplesMs: [12, 14, 16, 18, 20, 22, 24] },
        { path: '/templates', samplesMs: [32, 35, 38, 41, 44, 48, 50] },
      ],
      50,
    );

    expect(result.passed).toBe(false);
    expect(result.failing).toEqual([
      expect.objectContaining({ path: '/templates', p95Ms: 50 }),
    ]);
  });
});
