// @vitest-environment jsdom
//
// Red spec for INV-3.2 / D-21 option C — the per-tab stream budget.
//
// A browser allows six concurrent HTTP/1.1 connections per origin. Every
// long-lived stream a tab holds spends one of those six for as long as the tab
// stays open, and a request that finds the pool full waits inside the browser
// without ever reaching the daemon. Measured against a real tools-dev runtime
// on 2026-09-05 (proof file `W3E red spec - a message PUT persists ...`): a
// project tab held `/api/memory/events` plus `/api/projects/:id/events`, three
// tabs held all six sockets, and a message PUT issued from the third tab never
// arrived at the daemon at all.
//
// These cases pin the half of that budget the web memory surfaces own:
// a tab opens the memory stream at most once, and holds none while hidden.

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemorySection } from '../../src/components/MemorySection';
import { MemoryToast } from '../../src/components/MemoryToast';

const MEMORY_EVENTS_URL = '/api/memory/events';

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  url: string;
  readyState: number;
  closed: boolean;

  constructor(url: string) {
    this.url = url;
    this.readyState = FakeEventSource.OPEN;
    this.closed = false;
    openedStreams.push(this);
  }

  addEventListener(): void { /* the budget, not the payload, is under test */ }
  removeEventListener(): void { /* no-op */ }

  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
}

let openedStreams: FakeEventSource[] = [];
let visibility: DocumentVisibilityState = 'visible';

function memoryStreams(): FakeEventSource[] {
  return openedStreams.filter((s) => s.url === MEMORY_EVENTS_URL);
}

function liveMemoryStreams(): FakeEventSource[] {
  return memoryStreams().filter((s) => !s.closed);
}

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  openedStreams = [];
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => visibility === 'hidden',
  });
  vi.stubGlobal('EventSource', FakeEventSource);
  // Both surfaces read their initial state over `fetch`. The budget under test
  // is the long-lived stream count, not the panel body, so every read stays
  // pending: the surfaces mount, open their streams, and render nothing else.
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => { /* pending */ })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('per-tab memory stream budget', () => {
  it('opens one memory-events connection for a tab showing both memory surfaces', async () => {
    render(<MemoryToast />);
    render(<MemorySection />);

    await waitFor(() => expect(memoryStreams().length).toBeGreaterThan(0));

    expect(liveMemoryStreams()).toHaveLength(1);
  });

  it('releases the memory-events connection while the document is hidden', async () => {
    render(<MemoryToast />);

    await waitFor(() => expect(liveMemoryStreams()).toHaveLength(1));

    setVisibility('hidden');
    await waitFor(() => expect(liveMemoryStreams()).toHaveLength(0));

    setVisibility('visible');
    await waitFor(() => expect(liveMemoryStreams()).toHaveLength(1));
  });
});
