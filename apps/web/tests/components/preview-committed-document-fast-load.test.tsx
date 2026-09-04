// @vitest-environment jsdom
// W2I.2 red spec (F3) — a document that loads before the watchdog effect
// attaches is still disclosed to the producer.
//
// `trackPreviewPaint` refuses to accept the frame's own `load` as proof and
// asks the document to report itself instead. It only asks a document it knows
// is in the frame: either because it saw the `load` itself, or because the host
// vouched for it through `useCommittedDocument`.
//
// A fast document — a cached srcDoc, a tiny HTML file — commits before React
// runs the passive effect that installs the watchdog. React's own `onLoad` has
// already fired by then, so the watchdog's `load` listener will never see it,
// and the host is the only one left who can say the document is there. If the
// host's answer is fixed at render time it is still `false` when the effect
// reads it, nothing re-triggers the effect, and the frame is never asked: the
// producer's own report arrives unsolicited and is rejected
// (`undisclosedReports`), and a preview that rendered perfectly reaches the
// watchdog's named failure.
//
// The harness below mirrors `FileViewer`'s preview wiring — the hook, the
// `onLoad={noteLoaded}` prop, and the effect that installs the watchdog — and
// puts the `load` where the race puts it: after React committed the DOM (so
// `onLoad` is attached and fires) and before the passive effect runs.

import { useEffect, useLayoutEffect, useRef } from 'react';

import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCommittedDocument } from '../../src/components/preview-committed-document';
import { trackPreviewPaint } from '../../src/observability/iframe-error';

const REPORT = 'od:preview-content-size';
const REPORT_REQUEST = 'od:preview-content-size-request';

/** Every message the host posted into the frame. */
const asked: Array<Record<string, unknown>> = [];

/**
 * A preview whose document is in the frame before React's passive effects run.
 *
 * The layout effect is the race: it runs in the same commit that gave the
 * iframe its document and attached React's `onLoad`, and before any passive
 * effect. Dispatching `load` there is exactly a document that finished loading
 * between the two.
 */
function FastLoadingPreview({ target }: { target: string }): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewDocument = useCommittedDocument(target);

  useLayoutEffect(() => {
    const node = iframeRef.current;
    if (!node) return;
    // The document in this frame answers the watchdog like the real producer:
    // whenever it is asked, it reports itself with the token it was asked with.
    Object.defineProperty(node.contentWindow, 'postMessage', {
      configurable: true,
      value: (data: unknown) => {
        const message = data as Record<string, unknown>;
        asked.push(message);
        if (message?.type !== REPORT_REQUEST) return;
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: REPORT, width: 1280, painted: true, token: message.token },
            source: node.contentWindow,
          }),
        );
      },
    });
    node.dispatchEvent(new Event('load'));
  }, [target]);

  // `FileViewer`'s three watchdog effects read the latch here, inside the
  // effect body, and depend only on the document they are watching. Both halves
  // are copied deliberately: the read happens at INSTALLATION, which is the
  // last moment before the watchdog can miss anything, and the effect does not
  // re-run on the latch, so a document that already answered is never re-armed.
  useEffect(() => {
    const node = iframeRef.current;
    if (!node) return undefined;
    return trackPreviewPaint({
      iframe: node,
      surface: 'file_viewer_preview',
      documentCommitted: previewDocument.committed,
    });
  }, [target]);

  return <iframe ref={iframeRef} onLoad={previewDocument.noteLoaded} />;
}

function anomalyPosts(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter((call) => call[0] === '/api/anomalies')
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>);
}

describe('a document that beat the watchdog into the frame is still disclosed', () => {
  beforeEach(() => {
    asked.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('asks the frame to report itself, so the producer is not left unsolicited', () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<FastLoadingPreview target="artifact.html" />);

    expect(
      asked.filter((message) => message?.type === REPORT_REQUEST).length,
      'the host saw this document load, so the watchdog must disclose its token to it',
    ).toBeGreaterThan(0);
  });

  it('accepts the report and files nothing for a preview that rendered', () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = render(<FastLoadingPreview target="artifact.html" />);

    // The producer also reports on its own schedule. Undisclosed, that report
    // is counted and thrown away.
    const frame = document.querySelector('iframe');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: REPORT, width: 1280, painted: true, token: 'unsolicited' },
        source: frame?.contentWindow,
      }),
    );

    vi.advanceTimersByTime(30_000);
    unmount();

    expect(
      anomalyPosts(fetchMock),
      'the preview painted and said so; filing a failure for it is the bug',
    ).toHaveLength(0);
  });
});
