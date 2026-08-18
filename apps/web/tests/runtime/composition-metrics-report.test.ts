import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionMetrics } from '@open-design/contracts';

import {
  COMPOSITION_METRICS_ENDPOINT,
  fetchCompositionMetrics,
  reportCompositionMetrics,
} from '../../src/runtime/composition-metrics-report';

const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeMetrics(): CompositionMetrics {
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
    measuredAt: new Date().toISOString(),
  };
}

describe('reportCompositionMetrics', () => {
  it('POSTs to the composition-metrics endpoint with the exact payload', () => {
    const metrics = fakeMetrics();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, record: null }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    reportCompositionMetrics({ projectId: 'proj-1', file: 'index.html', metrics });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(COMPOSITION_METRICS_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body)).toEqual({ projectId: 'proj-1', file: 'index.html', metrics });
  });

  it('calls onRecord with the daemon-returned record once the report lands', async () => {
    const metrics = fakeMetrics();
    const record = { projectId: 'proj-1', file: 'index.html', metrics, isWebCloneRun: false, reportedAt: 'now' };
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true, record }) }) as unknown as typeof fetch;

    const onRecord = vi.fn();
    reportCompositionMetrics({ projectId: 'proj-1', file: 'index.html', metrics }, onRecord);

    // reportCompositionMetrics is fire-and-forget; wait for its promise chain.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onRecord).toHaveBeenCalledWith(record);
  });

  it('never throws when fetch rejects — this is a best-effort report', () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(() => reportCompositionMetrics({ projectId: 'proj-1', file: 'index.html', metrics: fakeMetrics() })).not.toThrow();
  });

  it('never throws when the response is not ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    const onRecord = vi.fn();
    expect(() =>
      reportCompositionMetrics({ projectId: 'proj-1', file: 'index.html', metrics: fakeMetrics() }, onRecord),
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onRecord).not.toHaveBeenCalled();
  });
});

describe('fetchCompositionMetrics', () => {
  it('GETs with projectId + file as query params and returns the record', async () => {
    const record = { projectId: 'proj-1', file: 'index.html', metrics: fakeMetrics(), isWebCloneRun: false, reportedAt: 'now' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, record }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchCompositionMetrics('proj-1', 'index.html');
    expect(result).toEqual(record);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${COMPOSITION_METRICS_ENDPOINT}?projectId=proj-1&file=index.html`);
  });

  it('returns null when nothing has been reported', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, record: null }) }) as unknown as typeof fetch;
    expect(await fetchCompositionMetrics('proj-1', 'index.html')).toBeNull();
  });

  it('returns null rather than throwing on a network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await fetchCompositionMetrics('proj-1', 'index.html')).toBeNull();
  });
});
