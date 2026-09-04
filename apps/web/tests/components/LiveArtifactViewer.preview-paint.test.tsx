// @vitest-environment jsdom
// W2G.1 / F2 — what evidence the live-artifact transport is allowed to settle on.
//
// Every other visible preview transport settles only on
// `od:preview-content-size` posted from inside its document, because the
// frame's own `load` event fires for a 200 that painted nothing. This one
// cannot: the daemon serves the live-artifact preview under
// `script-src 'none'` and a CSP sandbox without `allow-scripts`
// (`setLiveArtifactPreviewHeaders`, apps/daemon/src/live-artifacts/http-helpers.ts,
// pinned by apps/daemon/tests/routes/live-artifacts.test.ts), so no producer
// placed in that response could run, and the iframe's own sandbox attribute
// cannot re-grant what the CSP sandbox removed.
//
// So this frame takes the weaker `load` evidence, deliberately. These specs
// pin that decision from the side the daemon test cannot see: the watchdog must
// not ask a document that can never answer, because a report that never arrives
// would file a `preview-error` on every healthy live-artifact preview 15
// seconds after it loaded. The watchdog itself stays — a frame that never loads
// at all is still reported.
//
// The paired daemon assertion (this response carries no producer, and refuses
// the scripts that would run one) is in
// apps/daemon/tests/preview-paint-report-bridge.test.ts.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveArtifactViewer } from '../../src/components/FileViewer';
import { liveArtifactTabId, type LiveArtifactWorkspaceEntry } from '../../src/types';

const ANOMALY_ENDPOINT = '/api/anomalies';
const DOCUMENT_REPORT_REQUEST = 'od:preview-content-size-request';

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

/**
 * Observe what the watchdog posts INTO the frame. jsdom gives the iframe a real
 * `contentWindow`; intercepting its `postMessage` is how a request for a
 * document report becomes visible to the test.
 */
function watchFramePostMessages(frame: HTMLIFrameElement): unknown[] {
  const posted: unknown[] = [];
  Object.defineProperty(frame.contentWindow, 'postMessage', {
    configurable: true,
    value: (data: unknown) => posted.push(data),
  });
  return posted;
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

describe('the live-artifact preview transport settles on load, because it cannot report', () => {
  it('never asks a script-free response to report, and files nothing when it loads', async () => {
    const calls = stubFetch();

    render(<LiveArtifactViewer projectId="project-1" liveArtifact={liveArtifactEntry()} />);

    const frame = (await screen.findByTestId(
      'live-artifact-preview-frame',
    )) as HTMLIFrameElement;
    const posted = watchFramePostMessages(frame);

    await act(async () => {
      fireEvent.load(frame);
    });

    await advance(16_000);

    expect(
      posted.filter(
        (message) => (message as { type?: string } | null)?.type === DOCUMENT_REPORT_REQUEST,
      ),
      'this response is served under script-src none, so asking it for a report would file a preview-error on every healthy preview',
    ).toHaveLength(0);
    expect(previewErrorAnomalies(calls)).toHaveLength(0);
  });

  it('still files a preview-error for a frame that never loads at all', async () => {
    const calls = stubFetch();

    render(<LiveArtifactViewer projectId="project-1" liveArtifact={liveArtifactEntry()} />);

    await screen.findByTestId('live-artifact-preview-frame');

    // No load event: the artifact file is missing, or the `od://` resolver is
    // stuck. Weak evidence still catches this one, and it is the case the
    // watchdog was written for.
    await advance(16_000);

    const filed = previewErrorAnomalies(calls);
    expect(filed).toHaveLength(1);
    expect(filed[0]?.severity).toBe('warn');
    expect(String(filed[0]?.summary)).toMatch(/preview/i);
  });
});
