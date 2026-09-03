// @vitest-environment jsdom

/**
 * T-05: the native-session resume path is hot — the live run logs record
 * `native_session_recovery` reaching `resumed` 190 times, `resume_attempted`
 * 216, `no_recoverable_session` 82, `captured_not_resumed` 66 — and the chat
 * never said so. Whether a turn continued the agent's existing CLI session or
 * started from nothing changes what the agent could remember, which is the
 * user's business when they read the answer.
 *
 * Only the two states that actually changed what the agent saw are worth a
 * line: `resumed` and `auto_reseeded`. Ordinary operation (a fresh session, a
 * runtime with no resume at all) stays silent — the chat must not narrate
 * every healthy run.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AssistantMessage } from '../../src/components/AssistantMessage';
import type { ChatMessage } from '../../src/types';

beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => store.clear(),
      getItem: (k: string) => store.get(k) ?? null,
      removeItem: (k: string) => store.delete(k),
      setItem: (k: string, v: string) => store.set(k, v),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function baseMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'Done.',
    runId: 'run-1',
    runStatus: 'succeeded',
    startedAt: 1700000000,
    endedAt: 1700000005,
    events: [],
    producedFiles: [],
    ...overrides,
  } as ChatMessage;
}

// Routed by URL so the recovery payload can only reach the hook that asks the
// run status endpoint for it. The other run-scoped hooks in this component
// (usage, routing telemetry) hit their own endpoints and must get their own
// empty answer — a single catch-all stub would hide a hook reading the wrong URL.
const RUN_STATUS_URL = '/api/runs/run-1';

function stubFetchWithRecoveryState(state: string | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url !== RUN_STATUS_URL) return { ok: true, json: async () => ({}) };
      return {
        ok: true,
        json: async () => (state === null ? {} : {
          nativeSessionRecovery: {
            agentId: 'claude',
            state,
            acquisition: 'stream-captured',
            continuation: 'native-resume-by-id',
            handle: { present: true, kind: 'opaque-id', display: null, sha256: null, redacted: true },
            guardReason: null,
            fallbackReason: null,
            updatedAt: 1700000004,
          },
        }),
      };
    }),
  );
}

function renderMessage(overrides: Partial<ChatMessage> = {}, streaming = false) {
  render(
    <AssistantMessage
      message={baseMessage(overrides)}
      streaming={streaming}
      projectId="p1"
      errorCardOwnerId={null}
      onFeedback={vi.fn()}
    />,
  );
}

describe('AssistantMessage native session recovery status', () => {
  it('says the turn continued the agent session when the run resumed one', async () => {
    stubFetchWithRecoveryState('resumed');
    renderMessage();

    const status = await waitFor(() => screen.getByRole('status', {
      name: (name) => /session recovered/i.test(name),
    }));
    expect(status.textContent ?? '').toMatch(/continued/i);
    // The state was read from the run's own status record, not from whichever
    // endpoint happened to answer first.
    expect(vi.mocked(fetch).mock.calls.map((call) => String(call[0])))
      .toContain(RUN_STATUS_URL);
  });

  it('says the session was rebuilt when the daemon auto-reseeded it mid-run', async () => {
    stubFetchWithRecoveryState('auto_reseeded');
    renderMessage();

    const status = await waitFor(() => screen.getByRole('status', {
      name: (name) => /session recovered/i.test(name),
    }));
    expect(status.textContent ?? '').toMatch(/rebuilt/i);
  });

  it('stays silent for a run that recovered nothing', async () => {
    stubFetchWithRecoveryState('no_recoverable_session');
    renderMessage();

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('status', { name: /session recovered/i })).toBeNull();
  });

  it('stays silent for a run that reports no recovery metadata at all', async () => {
    stubFetchWithRecoveryState(null);
    renderMessage();

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('status', { name: /session recovered/i })).toBeNull();
  });

  it('does not fetch recovery state for a still-streaming message', () => {
    stubFetchWithRecoveryState('resumed');
    renderMessage({ runStatus: undefined, endedAt: undefined }, true);

    expect(fetch).not.toHaveBeenCalled();
  });
});
