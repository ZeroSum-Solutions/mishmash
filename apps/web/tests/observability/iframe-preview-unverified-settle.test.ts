// @vitest-environment jsdom
// W2I.1 red spec — wave-2 round 3, finding F1 (HIGH), the host half.
//
// The producer can now say that a settle rests on evidence it could not
// corroborate: `painted: true` with an `evidence` value. The host settled that
// report exactly like proof — `status: 'painted'`, no notice, and the caveat
// event `client_iframe_paint_unverified` went to PostHog only, which is a no-op
// without a build-time key. So a visually blank document produced no user
// warning and no record in the anomaly log a maintainer actually reads.
//
// The third outcome the host owes it: `painted-unverified`. The preview stays
// as rendered — a contentful paint is real evidence and tearing the document
// down over a caveat would be worse than the caveat — while the viewer gets a
// soft named notice with a way to ask again, and the caveat becomes a
// `preview-error` record like every other preview failure.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { safetyEvents } = vi.hoisted(() => ({
  safetyEvents: [] as Array<{ name: string; properties: Record<string, unknown> }>,
}));

vi.mock('../../src/analytics/error-tracking', () => ({
  reportSafetyEvent: (name: string, properties: Record<string, unknown> = {}) => {
    safetyEvents.push({ name, properties });
  },
}));

import { trackPreviewPaint } from '../../src/observability/iframe-error';
import type { PreviewPaintState } from '../../src/observability/iframe-error';

const REPORT = 'od:preview-content-size';
const REPORT_REQUEST = 'od:preview-content-size-request';

interface MountedFrame {
  iframe: HTMLIFrameElement;
  posted: Array<Record<string, unknown>>;
}

function mountFrame(): MountedFrame {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const posted: Array<Record<string, unknown>> = [];
  Object.defineProperty(iframe.contentWindow, 'postMessage', {
    configurable: true,
    value: (data: unknown) => posted.push(data as Record<string, unknown>),
  });
  return { iframe, posted };
}

function requests(frame: MountedFrame): Array<Record<string, unknown>> {
  return frame.posted.filter((message) => message?.type === REPORT_REQUEST);
}

function latestRequestToken(frame: MountedFrame): unknown {
  const asked = requests(frame);
  return asked.length === 0 ? undefined : asked[asked.length - 1]?.token;
}

function answerFrom(frame: MountedFrame, data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data, source: frame.iframe.contentWindow }));
}

const COUNTERS = { seen: 3, hidden: 0, clipped: 0, blank: 1, imageUnverified: 0 };

interface Watched {
  frame: MountedFrame;
  states: PreviewPaintState[];
  dispose: () => void;
}

/** A watchdog over a freshly committed document, with its state transitions recorded. */
function watchCommittedFrame(): Watched {
  const frame = mountFrame();
  const states: PreviewPaintState[] = [];
  const dispose = trackPreviewPaint({
    iframe: frame.iframe,
    surface: 'file_viewer_preview',
    artifactId: 'artifact-1',
    onPaintState: (state) => states.push(state),
  });
  frame.iframe.dispatchEvent(new Event('load'));
  return { frame, states, dispose };
}

function latestState(states: PreviewPaintState[]): PreviewPaintState {
  const state = states[states.length - 1];
  expect(state, 'the watchdog reports every transition').toBeDefined();
  return state!;
}

beforeEach(() => {
  vi.useFakeTimers();
  safetyEvents.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('a settle the producer could not corroborate is its own outcome', () => {
  it('reports painted-unverified when the contentful paint stands alone', () => {
    const watched = watchCommittedFrame();
    answerFrom(watched.frame, {
      type: REPORT,
      width: 1280,
      painted: true,
      reason: 'paint-timing',
      evidence: 'paint-timing-unverified',
      counters: COUNTERS,
      token: latestRequestToken(watched.frame),
    });
    vi.advanceTimersByTime(30_000);

    const state = latestState(watched.states);
    expect(
      state.status,
      'the document rendered as far as the user agent knows, and nobody could confirm it',
    ).toBe('painted-unverified');
    expect(state.status === 'painted-unverified' && state.evidence).toBe('paint-timing-unverified');
    expect(
      safetyEvents.filter((event) => event.name === 'client_iframe_timeout'),
      'the watchdog settled; this is a caveat, not a failure',
    ).toHaveLength(0);
    expect(
      safetyEvents.filter((event) => event.name === 'client_iframe_paint_unverified'),
    ).toHaveLength(1);
    watched.dispose();
  });

  it('reports painted-unverified for unread image pixels too', () => {
    const watched = watchCommittedFrame();
    answerFrom(watched.frame, {
      type: REPORT,
      width: 1280,
      painted: true,
      reason: 'painted',
      evidence: 'image-unverified',
      counters: { ...COUNTERS, imageUnverified: 1 },
      token: latestRequestToken(watched.frame),
    });

    expect(latestState(watched.states).status).toBe('painted-unverified');
    watched.dispose();
  });

  it('still reports plain painted when the evidence needs no caveat', () => {
    const watched = watchCommittedFrame();
    answerFrom(watched.frame, {
      type: REPORT,
      width: 1280,
      painted: true,
      reason: 'painted',
      evidence: null,
      counters: COUNTERS,
      token: latestRequestToken(watched.frame),
    });

    expect(latestState(watched.states).status).toBe('painted');
    watched.dispose();
  });

  it('asks the document again on request, and upgrades when it answers with proof', () => {
    // The "Re-check" the notice offers. Automatic asking stops at a settle;
    // this is the person looking at the preview asking once more, and a report
    // that does carry corroboration must be allowed to clear the notice.
    const watched = watchCommittedFrame();
    answerFrom(watched.frame, {
      type: REPORT,
      width: 1280,
      painted: true,
      reason: 'paint-timing',
      evidence: 'paint-timing-unverified',
      counters: COUNTERS,
      token: latestRequestToken(watched.frame),
    });

    const settled = latestState(watched.states);
    expect(settled.status).toBe('painted-unverified');
    const askedBefore = requests(watched.frame).length;
    if (settled.status !== 'painted-unverified') throw new Error('unreachable');
    settled.recheck();
    expect(
      requests(watched.frame).length,
      'a re-check asks the document that is in the frame right now',
    ).toBe(askedBefore + 1);

    answerFrom(watched.frame, {
      type: REPORT,
      width: 1280,
      painted: true,
      reason: 'painted',
      evidence: null,
      counters: COUNTERS,
      token: latestRequestToken(watched.frame),
    });

    expect(
      latestState(watched.states).status,
      'the scan corroborated it this time; the notice has to go away',
    ).toBe('painted');
    watched.dispose();
  });

  it('still fails a document the producer says painted nothing', () => {
    const watched = watchCommittedFrame();
    answerFrom(watched.frame, {
      type: REPORT,
      width: 1280,
      painted: false,
      reason: 'no-visible-output',
      evidence: null,
      counters: { ...COUNTERS, blank: 3 },
      token: latestRequestToken(watched.frame),
    });
    vi.advanceTimersByTime(30_000);

    expect(latestState(watched.states).status).toBe('unproven');
    expect(
      safetyEvents.filter((event) => event.name === 'client_iframe_timeout'),
      'a decidably blank document is the named failure, not a caveat',
    ).toHaveLength(1);
    watched.dispose();
  });
});
