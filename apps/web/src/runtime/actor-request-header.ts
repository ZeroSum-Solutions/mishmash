import { ACTOR_HEADER_NAME } from '@open-design/contracts';

import { getStoredActorName } from './actor-identity';

let installed = false;

/**
 * Requests that may carry the actor name: same-origin, under `/api/`.
 *
 * INVARIANT: the name is a person's name, so it goes to this user's own daemon
 * and nowhere else. Cross-origin is refused outright — a PostHog ingest call, a
 * CDN font, a provider API — and so is a same-origin request outside `/api/`,
 * which is a static asset with no attribution meaning.
 *
 * This mirrors `observability/request-health.ts`'s `loggablePath` check
 * deliberately, but cannot live in that module: its wrapper documents itself as
 * an observer that forwards the request untouched, and this one mutates it.
 */
function isAttributableRequest(rawUrl: string): boolean {
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost';
    const parsed = new URL(rawUrl, base);
    if (typeof window !== 'undefined' && parsed.origin !== window.location.origin) return false;
    return parsed.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

function requestUrl(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return null;
}

/**
 * Wraps `window.fetch` so every same-origin `/api/*` call carries `x-od-actor`.
 *
 * The name is read per request, not captured at install: a user who sets or
 * changes their name mid-session is attributed correctly from the next request
 * on, with no re-install. When no name is stored the request goes out untouched
 * — an unattributed request sends no header rather than an empty one.
 *
 * Returns an uninstaller that restores the previous `fetch`, and only if
 * nothing else has wrapped it since.
 */
export function installActorRequestHeader(): () => void {
  if (installed) return () => undefined;
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return () => undefined;
  installed = true;

  const previous = window.fetch;
  const original = previous.bind(window);

  const wrapped: typeof window.fetch = (input, init) => {
    const rawUrl = requestUrl(input);
    const actorName = getStoredActorName();
    if (!actorName || rawUrl == null || !isAttributableRequest(rawUrl)) {
      return original(input as RequestInfo, init);
    }
    const headers = new Headers(
      init?.headers
        ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined),
    );
    headers.set(ACTOR_HEADER_NAME, actorName);
    return original(input as RequestInfo, { ...init, headers });
  };

  window.fetch = wrapped;

  return () => {
    if (window.fetch === wrapped) window.fetch = previous;
    installed = false;
  };
}

/** Test-only — lets a spec install the wrapper more than once per module load. */
export function __resetActorRequestHeaderForTests(): void {
  installed = false;
}
