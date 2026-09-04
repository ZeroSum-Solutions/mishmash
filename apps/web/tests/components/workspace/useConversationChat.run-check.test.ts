// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RUN_FAILURE_RECHECK_DELAY_MS,
  RUN_FAILURE_RECHECK_INTERVAL_MS,
  RUN_FAILURE_RECHECK_MAX_MISSES,
  markStreamUnadjudicated,
} from '../../../src/runtime/run-failure-reconcile';
import type { AppConfig, ChatMessage } from '../../../src/types';

// W1I.1 — the PRODUCER half of the checking state, driven through the follow it
// actually runs on.
//
// `ChatPane.failure-alert.test.tsx` renders the marker and checks what the pane
// says about it; the Playwright cases prove the card never appears. Neither
// drives the loop that DECIDES: the probes, their bound, the fallback read, and
// the wording that follows from all three. Side Chat is the cheaper of the two
// clients to drive — the same rule module, a hook rather than a whole
// ProjectView — so the decisions are pinned here.

const fetchChatRunStatus = vi.fn();
const streamViaDaemon = vi.fn();
const listMessages = vi.fn();
const saveMessage = vi.fn();

vi.mock('../../../src/providers/daemon', () => ({
  fetchChatRunStatus: (...args: unknown[]) => fetchChatRunStatus(...args),
  streamViaDaemon: (...args: unknown[]) => streamViaDaemon(...args),
}));

vi.mock('../../../src/state/projects', () => ({
  listMessages: (...args: unknown[]) => listMessages(...args),
  saveMessage: (...args: unknown[]) => saveMessage(...args),
}));

// The hook borrows five pure helpers from ProjectView. Mounting that module is
// not what this file measures.
vi.mock('../../../src/components/ProjectView', () => ({
  createBufferedTextUpdates: () => ({
    appendContent: () => {},
    appendEvent: () => {},
    flush: () => {},
    cancel: () => {},
  }),
  finalizeActiveAssistantMessagesOnStop: (messages: ChatMessage[]) => ({
    messages,
    finalized: [] as ChatMessage[],
  }),
  mergeServerMessagesIntoConversation: (current: ChatMessage[], incoming: ChatMessage[]) =>
    (incoming.length > 0 ? incoming : current),
  resolveRetryTarget: () => null,
  resolveSucceededRunStatus: () => 'succeeded' as const,
}));

const { useConversationChat } = await import('../../../src/components/workspace/useConversationChat');

const RUN_ID = 'run-unresolved';
const STREAM_ERROR = 'daemon 503: no body';

interface CapturedStream {
  handlers: { onError: (err: Error) => void; onDone: (text: string) => void };
  onRunCreated: (runId: string) => void;
}

let captured: CapturedStream | null = null;

const ctx = {
  config: { mode: 'daemon', agentId: 'codex', agentModels: {} } as unknown as AppConfig,
  agentsById: new Map(),
  locale: 'en',
  sessionMode: 'design' as const,
};

/** Answer nothing, the way a daemon that is not there answers. */
function daemonSilent() {
  fetchChatRunStatus.mockResolvedValue(null);
  listMessages.mockResolvedValue([]);
}

beforeEach(() => {
  vi.useFakeTimers();
  captured = null;
  listMessages.mockResolvedValue([]);
  saveMessage.mockResolvedValue(undefined);
  fetchChatRunStatus.mockResolvedValue(null);
  streamViaDaemon.mockImplementation(async (options: CapturedStream) => {
    captured = options;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function mountWithUnresolvedRun() {
  const hook = renderHook(() => useConversationChat('project-1', 'conv-1', ctx));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  act(() => {
    hook.result.current.onSend('Make me a page', [], []);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  act(() => {
    captured!.onRunCreated(RUN_ID);
  });
  act(() => {
    captured!.handlers.onError(markStreamUnadjudicated(new Error(STREAM_ERROR)));
  });
  return hook;
}

/**
 * Let the follow run: the first probe lands at `RUN_FAILURE_RECHECK_DELAY_MS`,
 * every later one an interval apart, so this covers `1 + intervals` probes.
 */
async function runProbes(intervals: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(
      RUN_FAILURE_RECHECK_DELAY_MS + RUN_FAILURE_RECHECK_INTERVAL_MS * intervals,
    );
  });
}

/** Later probes only; the delay is already behind us. */
async function runMoreProbes(count: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RUN_FAILURE_RECHECK_INTERVAL_MS * count);
  });
}

describe('the follow behind the checking state', () => {
  it('marks the run unresolved without painting a failure', async () => {
    const hook = await mountWithUnresolvedRun();

    expect(hook.result.current.runCheck).toMatchObject({ runId: RUN_ID, unreachable: false });
    expect(hook.result.current.error, 'the pane error slot must stay untouched').toBeNull();
    const row = hook.result.current.messages.at(-1)!;
    expect(row.runStatus, 'the row keeps its last active status').toBe('queued');
    expect(row.events ?? [], 'no error event is appended to the row').toHaveLength(0);
  });

  it('says the daemon is not answering only once the probes AND the fallback read are exhausted', async () => {
    daemonSilent();
    const hook = await mountWithUnresolvedRun();

    // One short of the bound: an outage this long is the daemon hiccup the
    // recovery exists for, and the notice must not overstate it.
    await runProbes(RUN_FAILURE_RECHECK_MAX_MISSES - 2);
    expect(hook.result.current.runCheck?.unreachable).toBe(false);

    // The bound is reached, the fallback conversation read answers nothing
    // either, and only then does the wording change.
    await runMoreProbes(2);
    expect(hook.result.current.runCheck?.unreachable).toBe(true);
    expect(hook.result.current.error, 'an unanswered daemon is still not a failed run').toBeNull();
    expect(hook.result.current.messages.at(-1)!.runStatus).toBe('queued');
  });

  it('retires that wording the moment any probe answers again', async () => {
    daemonSilent();
    const hook = await mountWithUnresolvedRun();
    await runProbes(RUN_FAILURE_RECHECK_MAX_MISSES + 1);
    expect(hook.result.current.runCheck?.unreachable).toBe(true);

    // The daemon comes back and reports the run still going. It is answering
    // every probe now, so it must not be described as silent.
    fetchChatRunStatus.mockResolvedValue({ status: 'running', updatedAt: 10 });
    await runProbes(1);
    expect(hook.result.current.runCheck?.unreachable).toBe(false);
  });

  it('takes the run own terminal and leaves the checking state', async () => {
    const hook = await mountWithUnresolvedRun();

    fetchChatRunStatus.mockResolvedValue({ status: 'succeeded', updatedAt: 42 });
    listMessages.mockResolvedValue([
      { ...hook.result.current.messages.at(-1)!, runStatus: 'succeeded', content: 'done', endedAt: 42 },
    ]);
    await runProbes(1);

    const row = hook.result.current.messages.at(-1)!;
    expect(row.runStatus).toBe('succeeded');
    expect(hook.result.current.error).toBeNull();
  });

  it('adopts the daemon own failed row rather than inventing a card', async () => {
    const hook = await mountWithUnresolvedRun();
    const rowId = hook.result.current.messages.at(-1)!.id;

    fetchChatRunStatus.mockResolvedValue({ status: 'failed', updatedAt: 42 });
    listMessages.mockResolvedValue([
      {
        id: rowId,
        role: 'assistant',
        content: '',
        createdAt: 1,
        runId: RUN_ID,
        runStatus: 'failed',
        events: [
          {
            kind: 'status',
            label: 'error',
            detail: 'Agent stalled without emitting any new output for 600s.',
            failureStage: 'tool_execution',
          },
        ],
      },
    ]);
    await runProbes(1);

    const row = hook.result.current.messages.at(-1)!;
    expect(row.runStatus).toBe('failed');
    expect(
      row.events?.[0],
      'the card must be built from the daemon facts, not from the stream error',
    ).toMatchObject({ failureStage: 'tool_execution' });
    expect(
      hook.result.current.error,
      'the stream error must not be left under the daemon own title',
    ).toBeNull();
  });

  it('takes back the generic card once the daemon row can finally be read', async () => {
    const hook = await mountWithUnresolvedRun();
    const rowId = hook.result.current.messages.at(-1)!.id;

    // First the daemon reports failed but its row cannot be read, so the pane
    // owes the user the generic card.
    fetchChatRunStatus.mockResolvedValue({ status: 'failed', updatedAt: 42 });
    listMessages.mockResolvedValue([]);
    await runProbes(1);
    expect(hook.result.current.error).toBe(STREAM_ERROR);

    // Then the read answers, and the daemon's own words replace it.
    listMessages.mockResolvedValue([
      {
        id: rowId,
        role: 'assistant',
        content: '',
        createdAt: 1,
        runId: RUN_ID,
        runStatus: 'failed',
        events: [
          {
            kind: 'status',
            label: 'error',
            detail: 'Agent stalled without emitting any new output for 600s.',
            failureStage: 'tool_execution',
          },
        ],
      },
    ]);
    await runMoreProbes(1);

    expect(hook.result.current.error, 'the superseded stream error must leave the slot').toBeNull();
    expect(hook.result.current.messages.at(-1)!.events?.[0]).toMatchObject({
      failureStage: 'tool_execution',
    });
  });

  it('falls back to the generic card when the daemon failed row cannot be read', async () => {
    const hook = await mountWithUnresolvedRun();

    fetchChatRunStatus.mockResolvedValue({ status: 'failed', updatedAt: 42 });
    listMessages.mockResolvedValue([]);
    await runProbes(1);

    const row = hook.result.current.messages.at(-1)!;
    expect(row.runStatus, 'a failed run is not a succeeded run').toBe('failed');
    expect(hook.result.current.error).toBe(STREAM_ERROR);
    expect(row.events?.at(-1)).toMatchObject({ label: 'error', detail: STREAM_ERROR });
  });

  it('re-runs the follow on Check again', async () => {
    daemonSilent();
    const hook = await mountWithUnresolvedRun();
    await runProbes(RUN_FAILURE_RECHECK_MAX_MISSES + 1);
    expect(hook.result.current.runCheck?.unreachable).toBe(true);

    fetchChatRunStatus.mockResolvedValue({ status: 'succeeded', updatedAt: 42 });
    listMessages.mockResolvedValue([
      { ...hook.result.current.messages.at(-1)!, runStatus: 'succeeded', endedAt: 42 },
    ]);
    act(() => {
      hook.result.current.onRunCheckAgain();
    });
    expect(hook.result.current.runCheck?.unreachable, 'the re-check states its own optimism').toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUN_FAILURE_RECHECK_DELAY_MS + 10);
    });
    expect(hook.result.current.messages.at(-1)!.runStatus).toBe('succeeded');
  });
});
