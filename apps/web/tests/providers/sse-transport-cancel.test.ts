import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHAT_SSE_PROTOCOL_VERSION } from '@open-design/contracts';
import type { ChatSseEvent, SseEventPayload } from '@open-design/contracts';

import { streamViaDaemon } from '../../src/providers/daemon';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The message a real transport failure carries: a connection the browser did
 * not close itself (connection reset, proxy idle timeout, tab backgrounded).
 * `consumeDaemonRun` sees it as a rejected `reader.read()`.
 */
const TRANSPORT_ERROR_MESSAGE = 'network error: connection reset by peer';

/**
 * `event: start` built from the contracts wire type, not hand-written: the
 * daemon opens every run stream with this frame, so a transport failure that
 * happens mid-stream must be preceded by one for the fixture to be a real
 * failure rather than an empty response.
 */
function startFrame(runId: string): string {
  const payload: SseEventPayload<ChatSseEvent, 'start'> = {
    runId,
    agentId: 'mock',
    bin: 'mock',
    protocolVersion: CHAT_SSE_PROTOCOL_VERSION,
  };
  return `event: start\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * A 200 SSE response whose body delivers `frames` (when non-empty) and then
 * ERRORS instead of closing. This is the shape a real transport failure takes:
 * the `ReadableStream` moves to the errored state, so `reader.read()` rejects
 * AND every later `reader.cancel()` on that same reader returns an already
 * rejected promise. A response that merely closes cannot reproduce it.
 */
function transportFailureSseResponse(frames: string): Response {
  const encoder = new TextEncoder();
  let delivered = frames.length === 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (delivered) throw new Error(TRANSPORT_ERROR_MESSAGE);
        delivered = true;
        controller.enqueue(encoder.encode(frames));
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

/**
 * Run stream that fails in transport on every attempt — the first attempt after
 * a `start` frame, the reconnects with nothing at all — while `/api/runs/:id`
 * still reports the run RUNNING. That drains the reconnect budget the same way
 * a real drop does and leaves the loss unadjudicated (W1K.1 / W1K.3).
 */
function stubTransportFailureFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/runs') {
      return new Response(JSON.stringify({ runId: 'run-1' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/runs/run-1/events') {
      const first = fetchMock.mock.calls.filter(([i]) => String(i) === '/api/runs/run-1/events').length === 1;
      return transportFailureSseResponse(first ? startFrame('run-1') : '');
    }
    if (url === '/api/runs/run-1') {
      return new Response(
        JSON.stringify({
          id: 'run-1',
          status: 'running',
          createdAt: 1,
          updatedAt: 2,
          exitCode: null,
          signal: null,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function createDaemonHandlers() {
  return {
    onDelta: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    onAgentEvent: vi.fn(),
  };
}

/** Give Node a full turn of the event loop to publish `unhandledRejection`. */
async function settleUnhandledRejections(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe('consumeDaemonRun transport failure', () => {
  it('never leaks an unhandled rejection from the reader cancel', async () => {
    const leaked: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      leaked.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      stubTransportFailureFetch();

      await streamViaDaemon({
        agentId: 'mock',
        history: [{ id: '1', role: 'user', content: 'hello' }],
        systemPrompt: '',
        signal: new AbortController().signal,
        handlers: createDaemonHandlers(),
      });

      await settleUnhandledRejections();

      expect(
        leaked.map((reason) => (reason instanceof Error ? reason.message : String(reason))),
        'cancelling an errored run-event stream must not leave a rejected promise unattended',
      ).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('still reports the loss as an unadjudicated disconnect', async () => {
    const handlers = createDaemonHandlers();
    const onRunStatus = vi.fn();
    const fetchMock = stubTransportFailureFetch();

    await streamViaDaemon({
      agentId: 'mock',
      history: [{ id: '1', role: 'user', content: 'hello' }],
      systemPrompt: '',
      signal: new AbortController().signal,
      handlers,
      onRunStatus,
    });

    expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/runs/run-1')).toBe(true);
    expect(
      onRunStatus.mock.calls.map(([status]) => status),
      'a transport failure is this client’s report about itself, never a terminal for the run',
    ).not.toContain('failed');
    expect(handlers.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'daemon stream disconnected before run completed',
        code: 'DAEMON_STREAM_DISCONNECTED',
      }),
    );
    expect(handlers.onDone).not.toHaveBeenCalled();
  });
});
