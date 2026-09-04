// @vitest-environment jsdom
// W2H.1 red spec — the live-artifact preview must prove it painted, and say so
// when it did not.
//
// W2G.1 left this transport on the frame's own `load` event because the daemon
// served it under `script-src 'none'` and a CSP sandbox without
// `allow-scripts`: no producer could run inside it, so there was nothing to
// ask. D-17 option A changes the response — one nonce'd producer, `allow-scripts`
// in the CSP sandbox, `allow-same-origin` still absent from the effective
// sandbox — which removes the reason this frame was exempt.
//
// So these specs pin the transport from the host side: the watchdog asks this
// frame to report itself, a frame that answers 200 and paints nothing is filed
// as a `preview-error` AND names the failure where the user is looking, and a
// frame that paints is left alone.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveArtifactViewer } from '../../src/components/FileViewer';
import { liveArtifactTabId, type LiveArtifactWorkspaceEntry } from '../../src/types';

const ANOMALY_ENDPOINT = '/api/anomalies';
const REPORT = 'od:preview-content-size';
const REPORT_REQUEST = 'od:preview-content-size-request';
const NO_RENDER_NOTICE = 'preview-no-render-notice';

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

function watchFramePostMessages(frame: HTMLIFrameElement): Array<Record<string, unknown>> {
  const posted: Array<Record<string, unknown>> = [];
  Object.defineProperty(frame.contentWindow, 'postMessage', {
    configurable: true,
    value: (data: unknown) => posted.push(data as Record<string, unknown>),
  });
  return posted;
}

function latestRequestToken(posted: ReadonlyArray<Record<string, unknown>>): unknown {
  const requests = posted.filter((message) => message?.type === REPORT_REQUEST);
  return requests.length === 0 ? undefined : requests[requests.length - 1]?.token;
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

describe('the live-artifact preview proves it painted', () => {
  it('asks the frame to report itself', async () => {
    stubFetch();

    render(<LiveArtifactViewer projectId="project-1" liveArtifact={liveArtifactEntry()} />);

    const frame = (await screen.findByTestId('live-artifact-preview-frame')) as HTMLIFrameElement;
    const posted = watchFramePostMessages(frame);

    await act(async () => {
      fireEvent.load(frame);
    });

    expect(
      posted.filter(
        (message) => message?.type === REPORT_REQUEST && typeof message?.token === 'string',
      ),
      'the response now admits one nonce’d producer, so this frame can be asked',
    ).not.toHaveLength(0);
  });

  it('names the failure and files a preview-error for a 200 that renders nothing', async () => {
    const calls = stubFetch();

    render(<LiveArtifactViewer projectId="project-1" liveArtifact={liveArtifactEntry()} />);

    const frame = (await screen.findByTestId('live-artifact-preview-frame')) as HTMLIFrameElement;
    watchFramePostMessages(frame);

    // The response arrived and the document ran. It rendered nothing.
    await act(async () => {
      fireEvent.load(frame);
    });
    await advance(16_000);

    expect(previewErrorAnomalies(calls)).toHaveLength(1);
    expect(
      screen.getByTestId(NO_RENDER_NOTICE),
      'a preview that never painted has to say so where the user is looking',
    ).toBeTruthy();
  });

  it('stays quiet, and shows no notice, when the document reports that it painted', async () => {
    const calls = stubFetch();

    render(<LiveArtifactViewer projectId="project-1" liveArtifact={liveArtifactEntry()} />);

    const frame = (await screen.findByTestId('live-artifact-preview-frame')) as HTMLIFrameElement;
    const posted = watchFramePostMessages(frame);

    await act(async () => {
      fireEvent.load(frame);
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: REPORT, width: 1280, painted: true, token: latestRequestToken(posted) },
          source: frame.contentWindow,
        }),
      );
    });
    await advance(16_000);

    expect(previewErrorAnomalies(calls)).toHaveLength(0);
    expect(screen.queryByTestId(NO_RENDER_NOTICE)).toBeNull();
  });
});
