// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompositionMetrics, CompositionMetricsRecord } from '@open-design/contracts';

import { CompositionMetricsReadout } from '../../src/components/CompositionMetricsReadout';
import { en } from '../../src/i18n/locales/en';

afterEach(() => {
  cleanup();
});

function fakeMetrics(overrides: Partial<CompositionMetrics> = {}): CompositionMetrics {
  return {
    sectionCount: 5,
    outOfFlowElementCount: 1,
    transformedElementCount: 0,
    distinctSectionBackgroundCount: 1,
    distinctSectionWidthCount: 1,
    fullBleedAgainstContained: false,
    bodyFontSizePx: 14,
    maxDisplayFontSizePx: 48,
    displayToBodyFontRatio: 48 / 14,
    measuredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeRecord(overrides: Partial<CompositionMetricsRecord> = {}): CompositionMetricsRecord {
  return {
    projectId: 'proj-1',
    file: 'index.html',
    metrics: fakeMetrics(),
    isWebCloneRun: false,
    reportedAt: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

describe('CompositionMetricsReadout', () => {
  it('shows a quiet empty state before anything has been measured', () => {
    render(<CompositionMetricsReadout record={null} />);
    expect(screen.getByText(en['fileViewer.compositionMetricsEmpty'])).toBeTruthy();
  });

  it('renders the raw counts, not a score', () => {
    const record = fakeRecord({
      metrics: fakeMetrics({
        sectionCount: 3,
        outOfFlowElementCount: 1,
        distinctSectionBackgroundCount: 1,
        maxDisplayFontSizePx: 140,
        bodyFontSizePx: 14,
        displayToBodyFontRatio: 10,
      }),
    });
    render(<CompositionMetricsReadout record={record} />);
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('10.0x (140px / 14px)').textContent).toContain('10.0x');
    // No score/grade vocabulary anywhere in the rendered output.
    const container = screen.getByText(en['fileViewer.compositionMetricsSections']).closest('dl');
    expect(container?.textContent ?? '').not.toMatch(/score|grade|pass|fail/i);
  });

  it('total-suppresses the numbers for a web-clone run, showing only the exemption note', () => {
    const record = fakeRecord({ isWebCloneRun: true });
    render(<CompositionMetricsReadout record={record} />);
    expect(screen.getByText(en['fileViewer.compositionMetricsCloneExempt'])).toBeTruthy();
    expect(screen.queryByText(en['fileViewer.compositionMetricsSections'])).toBeNull();
    expect(screen.queryByText('5')).toBeNull();
  });

  it('reports full-bleed as a plain yes/no fact', () => {
    render(<CompositionMetricsReadout record={fakeRecord({ metrics: fakeMetrics({ fullBleedAgainstContained: true }) })} />);
    expect(screen.getByText('yes')).toBeTruthy();
  });
});
