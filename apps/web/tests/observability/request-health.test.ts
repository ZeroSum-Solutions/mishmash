// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SLOW_REQUEST_MS,
  __resetRequestHealthObserverForTests,
  installRequestHealthObserver,
  loggablePath,
  shouldObservePath,
} from '../../src/observability/request-health';

// Reports land as POSTs to /api/anomalies, which the observer itself must ignore
// — so the recorded reports are exactly the calls it chose to flag.
function collectReports(): { bodies: any[]; underlying: ReturnType<typeof vi.fn> } {
  const bodies: any[] = [];
  const underlying = vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    if (url.includes('/api/anomalies')) {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response('{"ok":true}', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  return { bodies, underlying };
}

let teardown: (() => void) | null = null;

beforeEach(() => {
  __resetRequestHealthObserverForTests();
});

afterEach(() => {
  teardown?.();
  teardown = null;
  __resetRequestHealthObserverForTests();
  vi.restoreAllMocks();
});

describe('request path selection', () => {
  it('only considers same-origin API paths', () => {
    expect(loggablePath('/api/projects')).toBe('/api/projects');
    // Query strings are dropped: that is where tokens live, and the path is
    // what identifies the endpoint.
    expect(loggablePath('/api/projects?token=secret')).toBe('/api/projects');
    expect(loggablePath('https://us.i.posthog.com/i/v0/e/')).toBeNull();
    expect(loggablePath('/static/app.css')).toBeNull();
    expect(loggablePath('not a url at all')).toBeNull();
  });

  it('skips its own endpoint and long-lived streams', () => {
    expect(shouldObservePath('/api/projects')).toBe(true);
    expect(shouldObservePath('/api/anomalies')).toBe(false);
    expect(shouldObservePath('/api/observability/event')).toBe(false);
    expect(shouldObservePath('/api/library/events')).toBe(false);
    expect(shouldObservePath('/api/runs/abc/stream')).toBe(false);
  });
});

describe('request health observer', () => {
  it('records a 5xx as an error naming the method and path', async () => {
    const { bodies, underlying } = collectReports();
    underlying.mockImplementationOnce(async () => new Response('{}', { status: 503 }));
    window.fetch = underlying as unknown as typeof window.fetch;
    teardown = installRequestHealthObserver();

    const response = await window.fetch('/api/runs', { method: 'POST' });

    // Pass-through: the caller sees the real response, unchanged.
    expect(response.status).toBe(503);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].kind).toBe('request-failed');
    expect(bodies[0].severity).toBe('error');
    expect(bodies[0].summary).toContain('POST /api/runs');
    expect(bodies[0].summary).toContain('503');
  });

  it('leaves a 4xx alone — the caller was told "no" correctly', async () => {
    const { bodies, underlying } = collectReports();
    underlying.mockImplementationOnce(async () => new Response('{}', { status: 404 }));
    window.fetch = underlying as unknown as typeof window.fetch;
    teardown = installRequestHealthObserver();

    await window.fetch('/api/projects/missing');

    expect(bodies).toHaveLength(0);
  });

  it('records a call that never answered, and still throws to its caller', async () => {
    const { bodies, underlying } = collectReports();
    const failure = new TypeError('Failed to fetch');
    underlying.mockImplementationOnce(async () => {
      throw failure;
    });
    window.fetch = underlying as unknown as typeof window.fetch;
    teardown = installRequestHealthObserver();

    await expect(window.fetch('/api/projects')).rejects.toBe(failure);

    expect(bodies).toHaveLength(1);
    expect(bodies[0].kind).toBe('request-unreachable');
    expect(bodies[0].summary).toContain('Failed to fetch');
  });

  it('does not record an abort — that is the app cancelling its own request', async () => {
    const { bodies, underlying } = collectReports();
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    underlying.mockImplementationOnce(async () => {
      throw aborted;
    });
    window.fetch = underlying as unknown as typeof window.fetch;
    teardown = installRequestHealthObserver();

    await expect(window.fetch('/api/search?q=a')).rejects.toBe(aborted);

    expect(bodies).toHaveLength(0);
  });

  it('records a slow call once it crosses the budget', async () => {
    const { bodies, underlying } = collectReports();
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    underlying.mockImplementationOnce(async () => {
      now += SLOW_REQUEST_MS + 250;
      return new Response('{}', { status: 200 });
    });
    window.fetch = underlying as unknown as typeof window.fetch;
    teardown = installRequestHealthObserver();

    await window.fetch('/api/projects');

    expect(bodies).toHaveLength(1);
    expect(bodies[0].kind).toBe('request-slow');
    expect(bodies[0].detail.durationMs).toBeGreaterThanOrEqual(SLOW_REQUEST_MS);
  });

  it('says nothing about a fast, successful call', async () => {
    const { bodies, underlying } = collectReports();
    window.fetch = underlying as unknown as typeof window.fetch;
    teardown = installRequestHealthObserver();

    await window.fetch('/api/projects');

    expect(bodies).toHaveLength(0);
  });

  it('never reports on its own endpoint, which would feed back on itself', async () => {
    const { bodies, underlying } = collectReports();
    underlying.mockImplementation(async () => new Response('{}', { status: 500 }));
    window.fetch = underlying as unknown as typeof window.fetch;
    teardown = installRequestHealthObserver();

    await window.fetch('/api/anomalies', { method: 'POST', body: '{}' });

    expect(bodies).toHaveLength(0);
  });

  it('restores the original fetch on teardown', async () => {
    const { underlying } = collectReports();
    window.fetch = underlying as unknown as typeof window.fetch;
    const dispose = installRequestHealthObserver();

    expect(window.fetch).not.toBe(underlying);
    dispose();
    expect(window.fetch).toBe(underlying);
  });
});
