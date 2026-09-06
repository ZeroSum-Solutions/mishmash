// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { streamViaDaemon } from '../../src/providers/daemon';
import { isLostRunCreateFailure } from '../../src/runtime/run-failure-reconcile';
import type { ChatMessage } from '../../src/types';

// W3E.2 red spec — the transport half of D-21 option D.
//
// `POST /api/runs` is issued WITHOUT a signal of its own
// (`providers/daemon.ts`), so an `AbortError` raised while the create request
// or its body read is in flight is never the caller asking to stop reading. It
// is the browser tearing the request down: the per-host connection budget a
// third open tab exhausts (D-21), a connection that died, a navigation. The
// create catch returned from ALL of them, so an involuntary abort and a user
// cancel produced the same thing on screen — nothing — and the user's prompt
// was lost with no error and no retry (D-21 evidence, project 61059571:
// `BadRequestError: request aborted`, conversation with 0 messages, no run).
//
// The same catch's sibling — a create the daemon REFUSED with 413 — does reach
// `onError`, but only as the raw string `daemon 413: <body>`. There is no code
// on it, so `resolveRunFailureUi` has nothing to key on and the card falls back
// to the generic "something went wrong" title: the UI cannot name the one
// failure whose cause it actually knows.
//
// The three cases below are the whole rule: an involuntary abort is reported, a
// 413 is reported under its contracts `ApiErrorCode`, and a user cancel stays
// silent.
//
// Wire provenance. The 413 body is the Express default error page
// `apps/daemon/src/server.ts`'s global `express.json({ limit: '4mb' })` produces
// for an oversized create body — no daemon route runs, so there is no
// `ApiErrorResponse` envelope to copy. Recorded off the real tools-dev daemon
// on namespace `gauntlet-w3fix-3e-2` (see the track proof file); the same wire
// drives `e2e/ui/run-create-abort-retry.test.ts` against a real daemon.

/**
 * The real Express 413 wire, recorded 2026-09-06 off a tools-dev daemon on
 * namespace `gauntlet-w3fix-3e-2` (`POST /api/runs`, 5 MiB body):
 * `HTTP/1.1 413 Payload Too Large`, `Content-Type: text/html; charset=utf-8`,
 * and this HTML page. The dev-mode stack lines inside the `<pre>` are elided —
 * they are absolute paths of the recording machine and carry nothing this test
 * reads.
 */
const REAL_413_BODY =
  '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>PayloadTooLargeError: request entity too large</pre>\n</body>\n</html>\n';

/** The `DOMException` shape a torn-down browser fetch rejects with. */
function abortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function history(): ChatMessage[] {
  return [
    { id: 'user-1', role: 'user', content: 'Design a landing page', createdAt: 1 } as ChatMessage,
  ];
}

interface CapturedError {
  message: string;
  code?: string;
  details?: unknown;
  lostRunCreate: boolean;
}

/** Read the error `onError` received without assuming the fix's exports exist. */
function capture(err: unknown): CapturedError {
  const e = err as Error & { code?: string; details?: unknown };
  return {
    message: e.message,
    code: e.code,
    details: e.details,
    lostRunCreate: isLostRunCreateFailure(e),
  };
}

function handlersWithError(seen: CapturedError[]) {
  return {
    onText: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn((err: Error) => {
      seen.push(capture(err));
    }),
    onAgentEvent: vi.fn(),
  };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('run creation that produced no run', () => {
  it('reports an involuntary abort of the create request', async () => {
    const seen: CapturedError[] = [];
    const handlers = handlersWithError(seen);
    // Nothing the caller owns has fired: this tab did not cancel anything.
    const controller = new AbortController();
    globalThis.fetch = vi.fn(async () => {
      throw abortError('The user aborted a request.');
    }) as unknown as typeof fetch;

    await streamViaDaemon({
      agentId: 'claude',
      history: history(),
      signal: controller.signal,
      handlers,
      projectId: 'project-1',
      conversationId: 'conv-1',
      assistantMessageId: 'assistant-1',
      clientRequestId: 'req-1',
    });

    expect(controller.signal.aborted).toBe(false);
    // The symptom: today this is zero. The prompt is gone and the pane says
    // nothing at all.
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    // The daemon creates and pins the run BEFORE it answers, so an abort after
    // the request was committed says nothing about whether the run exists: the
    // honest report is a LOST create response, which sends the pane to the
    // lookup in `runtime/lost-run-create.ts` rather than to a failure card.
    expect(seen[0]?.lostRunCreate).toBe(true);
    // And it carries the shared reason the UI names it by.
    expect(seen[0]?.details).toEqual({ kind: 'run-create-failure', reason: 'aborted' });
  });

  it('stays silent when the caller cancelled the turn itself', async () => {
    const seen: CapturedError[] = [];
    const handlers = handlersWithError(seen);
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = vi.fn(async () => {
      throw abortError('The user aborted a request.');
    }) as unknown as typeof fetch;

    await streamViaDaemon({
      agentId: 'claude',
      history: history(),
      signal: controller.signal,
      handlers,
      projectId: 'project-1',
      conversationId: 'conv-1',
      assistantMessageId: 'assistant-2',
      clientRequestId: 'req-2',
    });

    // A user cancel is the ONE silent abort. Nothing was lost, so nothing is
    // reported and no card appears.
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('names a create the daemon refused with 413', async () => {
    const seen: CapturedError[] = [];
    const handlers = handlersWithError(seen);
    const controller = new AbortController();
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: false,
          status: 413,
          text: async () => REAL_413_BODY,
          json: async () => {
            throw new SyntaxError('Unexpected token < in JSON');
          },
        }) as unknown as Response,
    ) as unknown as typeof fetch;

    await streamViaDaemon({
      agentId: 'claude',
      history: history(),
      signal: controller.signal,
      handlers,
      projectId: 'project-1',
      conversationId: 'conv-1',
      assistantMessageId: 'assistant-3',
      clientRequestId: 'req-3',
    });

    expect(handlers.onError).toHaveBeenCalledTimes(1);
    // The daemon refused the request, so no run exists — this is a verdict the
    // pane may paint, and `PAYLOAD_TOO_LARGE` is the contracts code that lets
    // `resolveRunFailureUi` name it instead of falling back to "generic".
    expect(seen[0]?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(seen[0]?.details).toEqual({
      kind: 'run-create-failure',
      reason: 'payload-too-large',
    });
    // The raw wire is still carried for the card's collapsible source area.
    expect(seen[0]?.message).toContain('413');
  });
});
