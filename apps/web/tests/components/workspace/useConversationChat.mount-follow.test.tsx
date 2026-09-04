// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RUN_FAILURE_RECHECK_DELAY_MS,
  RUN_FAILURE_RECHECK_INTERVAL_MS,
} from '../../../src/runtime/run-failure-reconcile';
import type { AppConfig, ChatMessage } from '../../../src/types';

// W1L.2 — the mount half of the Side Chat composer pause.
//
// W1K.3 gave `useConversationChat` a pause for any active run of its own: Send
// is disabled while a persisted assistant row still reads `queued`/`running`.
// The pause is right, but the mount-time message load is the only thing that
// ever wrote that row, and it runs once. A Side Chat mounted (or remounted)
// while its own run is still in flight therefore holds Send for a row nothing
// will move: the daemon reaches the run's terminal and the composer never
// learns, until another remount refreshes the conversation.
//
// `useConversationChat.run-check.test.ts` drives the same follow from a LIVE
// send whose stream failed. This file drives it from the other entry: a
// conversation that was already active when it mounted, with no stream error of
// its own to report.

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

const RUN_ID = 'run-active-at-mount';
const ROW_ID = 'assistant-active-at-mount';

const ctx = {
  config: { mode: 'daemon', agentId: 'codex', agentModels: {} } as unknown as AppConfig,
  agentsById: new Map(),
  locale: 'en',
  sessionMode: 'design' as const,
};

/** The persisted conversation a Side Chat mounts onto while its run is live. */
function conversationWithActiveRun(): ChatMessage[] {
  return [
    { id: 'user-1', role: 'user', content: 'Make me a page', createdAt: 1 },
    {
      id: ROW_ID,
      role: 'assistant',
      content: '',
      createdAt: 2,
      runId: RUN_ID,
      runStatus: 'running',
    },
  ] as ChatMessage[];
}

beforeEach(() => {
  vi.useFakeTimers();
  saveMessage.mockResolvedValue(undefined);
  fetchChatRunStatus.mockResolvedValue(null);
  streamViaDaemon.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** Mount the hook and let the conversation load resolve. */
async function mountConversation() {
  const hook = renderHook(() => useConversationChat('project-1', 'conv-1', ctx));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
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

describe('a conversation mounted on its own active run', () => {
  it('re-enables Send when the daemon reaches the terminal, without a remount', async () => {
    listMessages.mockResolvedValue(conversationWithActiveRun());
    const hook = await mountConversation();

    expect(
      hook.result.current.sendDisabled,
      'precondition: the active row must hold the composer',
    ).toBe(true);

    // The run reaches its terminal on the daemon. Nothing remounts this hook.
    fetchChatRunStatus.mockResolvedValue({ status: 'succeeded', updatedAt: 42 });
    listMessages.mockResolvedValue([
      { id: 'user-1', role: 'user', content: 'Make me a page', createdAt: 1 },
      {
        id: ROW_ID,
        role: 'assistant',
        content: 'Here is the page.',
        createdAt: 2,
        runId: RUN_ID,
        runStatus: 'succeeded',
        endedAt: 42,
      },
    ] as ChatMessage[]);
    await runProbes(1);

    const row = hook.result.current.messages.at(-1)!;
    expect(row.runStatus, 'the mounted row must reach the run terminal').toBe('succeeded');
    expect(row.content, 'the settled row must carry the turn the run delivered').toBe(
      'Here is the page.',
    );
    expect(
      hook.result.current.sendDisabled,
      'the composer must be usable again once the run is terminal',
    ).toBe(false);
    expect(hook.result.current.sendDisabledReason).toBeUndefined();
    expect(hook.result.current.error, 'a settled run raises no error').toBeNull();
  });

  it('adopts the daemon failed row instead of inventing a card it never saw', async () => {
    listMessages.mockResolvedValue(conversationWithActiveRun());
    const hook = await mountConversation();
    expect(hook.result.current.sendDisabled).toBe(true);

    fetchChatRunStatus.mockResolvedValue({ status: 'failed', updatedAt: 42 });
    listMessages.mockResolvedValue([
      { id: 'user-1', role: 'user', content: 'Make me a page', createdAt: 1 },
      {
        id: ROW_ID,
        role: 'assistant',
        content: '',
        createdAt: 2,
        runId: RUN_ID,
        runStatus: 'failed',
        endedAt: 42,
        events: [
          {
            kind: 'status',
            label: 'error',
            detail: 'Agent stalled without emitting any new output for 600s.',
            failureStage: 'tool_execution',
          },
        ],
      },
    ] as ChatMessage[]);
    await runProbes(1);

    const row = hook.result.current.messages.at(-1)!;
    expect(row.runStatus, 'a failed terminal releases the composer too').toBe('failed');
    expect(
      row.events?.[0],
      'the card must be built from the daemon facts',
    ).toMatchObject({ failureStage: 'tool_execution' });
    expect(hook.result.current.sendDisabled).toBe(false);
    expect(
      hook.result.current.error,
      'this pane saw no stream error, so it has none to put in the slot',
    ).toBeNull();
  });

  it('follows nothing when the conversation it mounts on has no active run', async () => {
    listMessages.mockResolvedValue([
      { id: 'user-1', role: 'user', content: 'Make me a page', createdAt: 1 },
      {
        id: ROW_ID,
        role: 'assistant',
        content: 'Here is the page.',
        createdAt: 2,
        runId: RUN_ID,
        runStatus: 'succeeded',
        endedAt: 42,
      },
    ] as ChatMessage[]);
    const hook = await mountConversation();

    await runProbes(2);

    expect(hook.result.current.sendDisabled).toBe(false);
    expect(
      fetchChatRunStatus,
      'a settled conversation must not put the daemon under a status poll',
    ).not.toHaveBeenCalled();
  });
});
