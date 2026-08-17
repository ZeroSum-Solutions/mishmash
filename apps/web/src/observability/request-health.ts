// Request-health observer.
//
// Catches the two failures the user feels most directly and that no existing
// probe saw: a daemon call that answers with an error, and one that takes long
// enough to read as "stuck". The daemon records its own side of this in
// `routes/anomalies.ts`, but only for requests that reached it and got a
// response out — a call that never connected, was aborted by the proxy, or died
// in transit leaves no server-side trace at all. That gap is what this covers.
//
// Why wrap `fetch` rather than instrument call sites: the web app issues its
// daemon calls through bare `fetch` from dozens of modules, with no shared
// client. One wrapper sees all of them, including calls added later, and needs
// no call-site churn.
//
// The wrapper is strictly an observer. It forwards its arguments untouched,
// returns the original promise's value, and re-throws the original error, so it
// cannot change what any caller sees. It measures time-to-response-headers —
// which is when `fetch()` settles — so a streaming or server-sent-event response
// is timed by how long the server took to start answering, not by how long the
// user kept the stream open.

import { reportAnomaly } from './anomaly-report';

/**
 * A daemon call slower than this is recorded. Matches the daemon-side budget in
 * `routes/anomalies.ts` so the same request is not called slow by one side and
 * healthy by the other.
 */
export const SLOW_REQUEST_MS = 4_000;

/**
 * Paths that are long-lived or self-referential and must not be measured:
 * streams settle their headers fast but are otherwise atypical, and reporting an
 * anomaly about the anomaly endpoint feeds back on itself.
 */
const IGNORED_PATTERNS: readonly RegExp[] = [
  /^\/api\/anomalies/i,
  /^\/api\/observability\/event/i,
  /events(\?|$)/i,
  /^\/api\/runs\/[^/]+\/stream/i,
];

let installed = false;

function requestUrl(input: unknown): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return null;
}

function requestMethod(input: unknown, init?: RequestInit): string {
  if (typeof init?.method === 'string' && init.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

/**
 * Reduces a URL to a loggable path. Only same-origin daemon calls are of
 * interest; a cross-origin URL (PostHog ingest, a CDN font) returns null and is
 * left alone. The query string is dropped — it is where tokens live, and the
 * path is what identifies the endpoint.
 */
export function loggablePath(rawUrl: string): string | null {
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost';
    const parsed = new URL(rawUrl, base);
    if (typeof window !== 'undefined' && parsed.origin !== window.location.origin) return null;
    if (!parsed.pathname.startsWith('/api/')) return null;
    return parsed.pathname;
  } catch {
    return null;
  }
}

export function shouldObservePath(path: string): boolean {
  return !IGNORED_PATTERNS.some((pattern) => pattern.test(path));
}

export function installRequestHealthObserver(): () => void {
  if (installed) return () => undefined;
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return () => undefined;
  installed = true;

  // Two references on purpose: `previous` is what teardown puts back, so the
  // page is left exactly as it was found. `original` is the bound copy used for
  // calling, since a native `fetch` invoked without its `window` receiver throws
  // an illegal-invocation error in some engines.
  const previous = window.fetch;
  const original = previous.bind(window);

  const wrapped: typeof window.fetch = async (input, init) => {
    const rawUrl = requestUrl(input);
    const path = rawUrl == null ? null : loggablePath(rawUrl);
    if (path == null || !shouldObservePath(path)) return original(input as RequestInfo, init);

    const method = requestMethod(input, init);
    const startedAt = performance.now();
    try {
      const response = await original(input as RequestInfo, init);
      const durationMs = Math.round(performance.now() - startedAt);
      if (response.status >= 500) {
        reportAnomaly({
          kind: 'request-failed',
          severity: 'error',
          summary: `${method} ${path} answered ${response.status}`,
          detail: { method, path, status: response.status, durationMs },
        });
      } else if (durationMs >= SLOW_REQUEST_MS) {
        reportAnomaly({
          kind: 'request-slow',
          severity: 'warn',
          summary: `${method} ${path} took ${(durationMs / 1000).toFixed(1)}s`,
          detail: { method, path, status: response.status, durationMs },
        });
      }
      return response;
    } catch (err) {
      const durationMs = Math.round(performance.now() - startedAt);
      // An abort is the app cancelling its own request — a navigation away, a
      // superseded search keystroke. That is the feature working, not a failure.
      const name = (err as { name?: unknown } | null)?.name;
      if (name !== 'AbortError') {
        reportAnomaly({
          kind: 'request-unreachable',
          severity: 'error',
          summary: `${method} ${path} never answered: ${
            (err as { message?: unknown } | null)?.message ?? 'network error'
          }`,
          detail: { method, path, durationMs, error: String(name ?? 'Error') },
        });
      }
      // Re-thrown unchanged: the observer must not alter what the caller sees.
      throw err;
    }
  };

  window.fetch = wrapped;

  return () => {
    // Only restore if nothing else has wrapped fetch since; clobbering a later
    // wrapper would break whoever installed it.
    if (window.fetch === wrapped) window.fetch = previous;
    installed = false;
  };
}

/** Test-only — lets a spec install the observer more than once per module load. */
export function __resetRequestHealthObserverForTests(): void {
  installed = false;
}
