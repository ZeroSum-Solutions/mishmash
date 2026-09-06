// Red spec for W3B (PRD 3.3, INV-3.4 / INV-3.5, web half).
//
// `fetchAgentsStream` hand-parses `event:` / `data:` lines and casts the JSON
// body to `AgentInfo` with no contract-owned decoder, and it shares nothing
// between callers: `App.tsx` opens one `?stream=1` request at boot and
// `refreshAgents` opens another, so two overlapping callers make the daemon
// run two detections. The generation counter in `App.tsx` only discards the
// stale result — it does not stop the second stream from opening.
//
// Frame bodies here are typed as the contracts union, so the fixture cannot
// drift from a shape the daemon does not emit.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo, AgentRegistrySseEvent } from '@open-design/contracts';

import { fetchAgentsStream } from '../../src/providers/registry';

const codex: AgentInfo = {
  id: 'codex',
  name: 'Codex CLI',
  bin: 'codex',
  available: true,
  models: [{ id: 'default', label: 'Default' }],
};

const claude: AgentInfo = {
  id: 'claude',
  name: 'Claude Code',
  bin: 'claude',
  available: true,
  models: [{ id: 'default', label: 'Default' }],
};

const frames: AgentRegistrySseEvent[] = [
  { event: 'agent', data: codex },
  { event: 'agent', data: claude },
  { event: 'done', data: {} },
];

function encodeFrames(events: AgentRegistrySseEvent[]): string {
  return events
    .map((frame) => `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`)
    .join('');
}

function streamResponse(text: string, chunkSize = text.length): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let index = 0; index < text.length; index += chunkSize) {
          controller.enqueue(encoder.encode(text.slice(index, index + chunkSize)));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('fetchAgentsStream contract frames', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('paints each agent as its probe settles and ends on the single done frame', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(encodeFrames(frames), 16)));
    const painted: string[] = [];

    const collected = await fetchAgentsStream({
      onAgent: (agent) => painted.push(agent.id),
    });

    expect(painted).toEqual(['codex', 'claude']);
    expect(collected.map((agent) => agent.id)).toEqual(['codex', 'claude']);
  });

  it('ignores a frame name the daemon never emits instead of painting it', async () => {
    const withUnknown = `event: heartbeat\ndata: {"id":"ghost"}\n\n${encodeFrames(frames)}`;
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(withUnknown)));
    const painted: string[] = [];

    await fetchAgentsStream({ onAgent: (agent) => painted.push(agent.id) });

    expect(painted).toEqual(['codex', 'claude']);
  });

  it('surfaces a terminal error frame as a rejection', async () => {
    const errorFrame: AgentRegistrySseEvent = {
      event: 'error',
      data: { error: 'detection blew up' },
    };
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(encodeFrames([errorFrame]))));

    await expect(fetchAgentsStream({ onAgent: vi.fn() })).rejects.toThrow('detection blew up');
  });

  it('shares one in-flight stream between the boot call and a concurrent refresh', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await gate;
      return streamResponse(encodeFrames(frames));
    });
    vi.stubGlobal('fetch', fetchMock);

    const boot = fetchAgentsStream({ onAgent: vi.fn() });
    const refresh = fetchAgentsStream({ onAgent: vi.fn() });
    release();
    const [bootAgents, refreshAgents] = await Promise.all([boot, refresh]);

    // Red on base: `App.tsx:903` (boot) and `App.tsx:1466` (`refreshAgents`)
    // each open their own `?stream=1`, so the daemon runs the probes twice.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bootAgents.map((agent) => agent.id)).toEqual(['codex', 'claude']);
    expect(refreshAgents.map((agent) => agent.id)).toEqual(['codex', 'claude']);
  });

  it('paints into every joined caller, not just the one that opened the stream', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate;
        return streamResponse(encodeFrames(frames));
      }),
    );
    const bootPainted: string[] = [];
    const refreshPainted: string[] = [];

    const boot = fetchAgentsStream({ onAgent: (agent) => bootPainted.push(agent.id) });
    const refresh = fetchAgentsStream({ onAgent: (agent) => refreshPainted.push(agent.id) });
    release();
    await Promise.all([boot, refresh]);

    expect(bootPainted).toEqual(['codex', 'claude']);
    expect(refreshPainted).toEqual(['codex', 'claude']);
  });

  it('cancels the request when the last caller lets go, but not before', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // One entry per request the provider actually opened, so the assertion
    // below reads the signal of THE shared request rather than whichever call
    // happened to run last.
    const seenSignals: (AbortSignal | undefined)[] = [];
    // The mock honours its AbortSignal the way a real fetch does. Without
    // that, an implementation that hands the caller's OWN signal to fetch is
    // indistinguishable from one that owns a shared controller: the request
    // simply keeps running and the test times out instead of failing on the
    // claim it makes.
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal ?? undefined;
      seenSignals.push(signal);
      return new Promise<Response>((resolve, reject) => {
          const onAbort = () => reject(signal?.reason ?? new Error('aborted'));
          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener('abort', onAbort, { once: true });
        void gate.then(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve(streamResponse(encodeFrames(frames)));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const boot = new AbortController();
    const bootCall = fetchAgentsStream({ onAgent: vi.fn(), signal: boot.signal });
    const refreshCall = fetchAgentsStream({ onAgent: vi.fn() });

    boot.abort();
    await expect(bootCall).rejects.toBeTruthy();
    // Both callers joined ONE request, and it is still running because the peer
    // has not let go. Assert the count first: on the base each caller opens its
    // own request, and that is the claim this case is about.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seenSignals).toHaveLength(1);
    expect(seenSignals[0]?.aborted).toBe(false);

    release();
    await expect(refreshCall).resolves.toHaveLength(2);
  });

  it('does not let a forced refresh join an older in-flight stream', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      await gate;
      return streamResponse(encodeFrames(frames));
    });
    vi.stubGlobal('fetch', fetchMock);

    const boot = fetchAgentsStream({ onAgent: vi.fn() });
    const forced = fetchAgentsStream({ onAgent: vi.fn(), forceRefresh: true });
    release();
    await Promise.all([boot, forced]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      '/api/agents?stream=1',
      '/api/agents?stream=1&refresh=1',
    ]);
  });
});
