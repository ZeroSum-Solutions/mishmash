// @vitest-environment jsdom
// W2H.1 (was W2G.1 / F2) — what evidence the live-artifact transport settles on.
//
// It used to settle on the frame's own `load` event, and that was a property of
// the response: the daemon served this preview under `script-src 'none'` and a
// CSP sandbox without `allow-scripts`, so no producer placed in it could run
// and asking for a report would have filed a `preview-error` on every healthy
// preview. D-17 option A changed the response — one nonce'd producer,
// `allow-scripts` in the CSP sandbox, `allow-same-origin` still absent from the
// effective sandbox — so the exemption is gone.
//
// These specs pin what survived that change from the side the daemon test
// cannot see: the watchdog still reports a frame that never loads at all, and
// it does not file anything for a frame whose document reports that it painted.
// The new failure cases (a 200 that renders nothing, the named notice) are in
// LiveArtifactViewer.preview-no-paint.test.tsx.
//
// The paired daemon assertion (this response carries one producer, under a
// nonce, in a sandbox that runs it) is in
// apps/daemon/tests/preview-paint-report-bridge.test.ts and
// apps/daemon/tests/live-artifact-preview-paint-producer.test.ts.

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

describe('the live-artifact preview watchdog', () => {
  it('files nothing when the document reports that it painted', async () => {
    const calls = stubFetch();

    render(<LiveArtifactViewer projectId="project-1" liveArtifact={liveArtifactEntry()} />);

    const frame = (await screen.findByTestId(
      'live-artifact-preview-frame',
    )) as HTMLIFrameElement;
    const posted = watchFramePostMessages(frame);

    await act(async () => {
      fireEvent.load(frame);
    });
    const asks = posted.filter(
      (message) => (message as { type?: string } | null)?.type === DOCUMENT_REPORT_REQUEST,
    );
    const token = (asks[asks.length - 1] as { token?: string } | undefined)?.token;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'od:preview-content-size', width: 1280, painted: true, token },
          source: frame.contentWindow,
        }),
      );
    });

    await advance(16_000);

    expect(previewErrorAnomalies(calls)).toHaveLength(0);
  });

  it('still files a preview-error for a frame that never loads at all', async () => {
    const calls = stubFetch();

    render(<LiveArtifactViewer projectId="project-1" liveArtifact={liveArtifactEntry()} />);

    await screen.findByTestId('live-artifact-preview-frame');

    // No load event: the artifact file is missing, or the `od://` resolver is
    // stuck. This is the case the watchdog was written for, and it survives
    // every change to what counts as proof.
    await advance(16_000);

    const filed = previewErrorAnomalies(calls);
    expect(filed).toHaveLength(1);
    expect(filed[0]?.severity).toBe('warn');
    expect(String(filed[0]?.summary)).toMatch(/preview/i);
  });
});
