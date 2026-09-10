// @vitest-environment jsdom

// W8D / F-03 — the web fetch wrapper that stamps `x-od-actor`.
//
// Disclosed red shape: red on base only because the module does not exist yet
// (same disclosure 7B used for its own helper test, `briefs/w7/7B.md` item 4).
// Its purpose is a refactor guard on the two properties that matter and cannot
// be read off the source at a glance:
//   1. the header goes on same-origin `/api/*` requests only — never
//      cross-origin, never a non-`/api` same-origin asset;
//   2. the wrapper never drops a caller-supplied header, body, or method, and
//      returns the response untouched.
//
// It is a DISTINCT module from `observability/request-health.ts`, whose own
// docblock states the wrapper "must not alter what the caller sees". This one
// deliberately does alter the request, so it may not live there.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ACTOR_HEADER_NAME = 'x-od-actor';

async function load() {
  return (await import('../../src/runtime/actor-request-header')) as {
    installActorRequestHeader: () => () => void;
  };
}

interface SeenRequest {
  url: string;
  method: string;
  actor: string | null;
  custom: string | null;
}

let seen: SeenRequest[] = [];
let originalFetch: typeof window.fetch;
let uninstall: (() => void) | undefined;

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  seen = [];
  originalFetch = window.fetch;
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    seen.push({
      url,
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
      actor: headers.get(ACTOR_HEADER_NAME),
      custom: headers.get('x-custom'),
    });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof window.fetch;
});

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  window.fetch = originalFetch;
  window.localStorage.clear();
});

async function installWithName(name: string | null): Promise<void> {
  const identity = (await import('../../src/runtime/actor-identity')) as {
    setStoredActorName: (n: string | null) => void;
  };
  identity.setStoredActorName(name);
  const mod = await load();
  uninstall = mod.installActorRequestHeader();
}

describe('W8D: the web actor header wrapper', () => {
  it('stamps the stored name on a same-origin /api request', async () => {
    await installWithName('Devin');
    await window.fetch('/api/runs', { method: 'POST', body: '{}' });
    expect(seen.length).toBe(1);
    expect(seen[0]?.actor).toBe('Devin');
    expect(seen[0]?.method).toBe('POST');
  });

  it('never stamps a cross-origin request', async () => {
    await installWithName('Devin');
    await window.fetch('https://api.vimeo.com/oauth/access_token', { method: 'POST' });
    expect(seen.length).toBe(1);
    expect(seen[0]?.actor).toBeNull();
  });

  it('never stamps a same-origin request outside /api', async () => {
    await installWithName('Devin');
    await window.fetch('/static/fonts/inter.woff2');
    expect(seen.length).toBe(1);
    expect(seen[0]?.actor).toBeNull();
  });

  it('sends nothing when no name is stored', async () => {
    await installWithName(null);
    await window.fetch('/api/runs');
    expect(seen[0]?.actor).toBeNull();
  });

  it('preserves caller-supplied headers', async () => {
    await installWithName('Devin');
    await window.fetch('/api/runs', { headers: { 'x-custom': 'keep-me' } });
    expect(seen[0]?.custom).toBe('keep-me');
    expect(seen[0]?.actor).toBe('Devin');
  });

  it('reads the current stored name on every call, not once at install', async () => {
    await installWithName('Devin');
    const identity = (await import('../../src/runtime/actor-identity')) as {
      setStoredActorName: (n: string | null) => void;
    };
    identity.setStoredActorName('Sam');
    await window.fetch('/api/runs');
    expect(seen[0]?.actor).toBe('Sam');
  });

  it('restores the previous fetch on teardown', async () => {
    await installWithName('Devin');
    const wrapped = window.fetch;
    uninstall?.();
    uninstall = undefined;
    expect(window.fetch).not.toBe(wrapped);
    await window.fetch('/api/runs');
    expect(seen[0]?.actor).toBeNull();
  });
});
