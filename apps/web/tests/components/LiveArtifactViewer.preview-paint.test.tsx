// @vitest-environment jsdom
// W2G.1 / F2 — the live-artifact transport settles on its outer load event.
//
// `LiveArtifactViewer` instruments its preview iframe with `trackIframeLoad`
// and passes no `settlesOn`, so it takes the `'load'` default. The frame's own
// `load` event fires for any HTTP 200 — including a rendered document that
// paints nothing and one whose subresources were all refused — so a blank live
// artifact settles quietly and files no anomaly. `load` is not paint evidence
// for this transport any more than it is for the srcDoc one.
//
// The fix gives the live-artifact preview response the same
// `od:preview-content-size` producer the project raw route already injects, so
// the document can prove it ran. These specs pin both directions.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveArtifactViewer } from '../../src/components/FileViewer';
import { liveArtifactTabId, type LiveArtifactWorkspaceEntry } from '../../src/types';

const ANOMALY_ENDPOINT = '/api/anomalies';
const DOCUMENT_REPORT = 'od:preview-content-size';

function liveArtifactEntry(): LiveArtifactWorkspaceEntry {
  return {
    kind: 'live-artifact',
    tabId: liveArtifactTabId('artifact-1'),
    artifactId: 'artifact-1',
    projectId: 'project-1',
    title: 'Headshot drafts',
    slug: 'headshot-drafts',
    status: 'active',
    refreshStatus: 'idle',
    pinned: false,
    preview: { type: 'html', entry: 'index.html' },
    hasDocument: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

interface RecordedCall {
  url: string;
  body: string | null;
}

function stubFetch(): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : null });
      if (url === ANOMALY_ENDPOINT) return new Response('{"ok":true}', { status: 200 });
      // Everything the viewer asks for answers 200 — including the preview
      // itself. That is exactly the shape of the bug: a healthy-looking
      // response whose document renders nothing.
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

function previewErrorAnomalies(calls: readonly RecordedCall[]): Array<Record<string, unknown>> {
  return calls
    .filter((call) => call.url === ANOMALY_ENDPOINT && call.body != null)
    .map((call) => JSON.parse(call.body as string) as Record<string, unknown>)
    .filter((record) => record.kind === 'preview-error');
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the live-artifact preview transport reports its own paint', () => {
  it('does not accept the frame load event as proof the artifact rendered', async () => {
    const calls = stubFetch();

    render(<LiveArtifactViewer projectId="project-1" liveArtifact={liveArtifactEntry()} />);

    const frame = (await screen.findByTestId(
      'live-artifact-preview-frame',
    )) as HTMLIFrameElement;

    // 200 in, nothing painted. The outer load event still fires.
    await act(async () => {
      fireEvent.load(frame);
    });

    await advance(16_000);

    const filed = previewErrorAnomalies(calls);
    expect(filed).toHaveLength(1);
    expect(filed[0]?.severity).toBe('warn');
    expect(String(filed[0]?.summary)).toMatch(/preview/i);
  });

  it('files nothing when the live-artifact document reports itself', async () => {
    const calls = stubFetch();

    render(<LiveArtifactViewer projectId="project-1" liveArtifact={liveArtifactEntry()} />);

    const frame = (await screen.findByTestId(
      'live-artifact-preview-frame',
    )) as HTMLIFrameElement;

    await act(async () => {
      fireEvent.load(frame);
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: DOCUMENT_REPORT, width: 1280 },
          source: frame.contentWindow,
        }),
      );
    });

    await advance(16_000);

    expect(previewErrorAnomalies(calls)).toHaveLength(0);
  });
});
