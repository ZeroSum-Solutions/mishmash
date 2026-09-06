// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import type { AppConfig, ChatMessage } from '../../src/types';

// W3E.2 red spec — the pane half of D-21 option D.
//
// Two surfaces the user is owed when a turn never started, and neither exists
// today:
//
//  1. A create the daemon refused with 413. The error reaches the pane, but the
//     card falls back to the generic "something went wrong" title because
//     nothing named the cause. The user reads a stack-trace-shaped HTML page in
//     the source area and has no idea their message was too big.
//  2. A conversation whose message read never answered. `ProjectView`'s Loading
//     pane has no bound, so the pane sat on "Loading…" with Send disabled and
//     no error at all for 7.7 minutes (D-21 evidence). Once the read is bounded,
//     the pane must show the error surface AND a Retry that re-issues the read —
//     an error card with no action is the same dead end with different words.
//
// `t` is mocked to return its key, so every assertion below names the i18n key
// the user actually reads.

vi.mock('../../src/i18n', () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => {
    if (vars && Object.keys(vars).length > 0) {
      return `${key} ${Object.values(vars).join(' ')}`;
    }
    return key;
  },
}));

vi.mock('../../src/components/AssistantMessage', () => ({
  AssistantMessage: ({ message }: { message: ChatMessage }) => (
    <div data-testid={`assistant-${message.id}`}>{message.content}</div>
  ),
}));

vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef((_props, _ref) => <div data-testid="composer" />),
}));

vi.mock('../../src/analytics/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/events')>();
  return {
    ...actual,
    trackChatPanelClick: vi.fn(),
    trackRunFailedToastSurfaceView: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * The assistant row the daemon leaves after it refused the create with 413:
 * a failed run carrying the contracts `PAYLOAD_TOO_LARGE` code and the raw
 * Express wire as its detail (see `tests/providers/daemon-run-abort.test.ts`
 * for that wire's provenance).
 */
function payloadTooLargeRow(): ChatMessage {
  return {
    id: 'assistant-413',
    role: 'assistant',
    content: '',
    createdAt: 1,
    runStatus: 'failed',
    agentId: 'claude',
    events: [
      {
        kind: 'status',
        label: 'error',
        detail: 'daemon 413: PayloadTooLargeError: request entity too large',
        code: 'PAYLOAD_TOO_LARGE',
      },
    ],
  } as unknown as ChatMessage;
}

function renderPane(overrides: Record<string, unknown>) {
  const props = {
    messages: [],
    streaming: false,
    error: null,
    projectId: 'project-1',
    projectFiles: [],
    onEnsureProject: async () => 'project-1',
    onSend: vi.fn(),
    onStop: vi.fn(),
    onRetry: vi.fn(),
    conversations: [
      { projectId: 'project-1', id: 'conv-1', title: 'Current', createdAt: 1, updatedAt: 1 },
    ],
    activeConversationId: 'conv-1',
    onSelectConversation: vi.fn(),
    onDeleteConversation: vi.fn(),
    config: { agentId: 'claude', agentCliEnv: {} } as unknown as AppConfig,
    ...overrides,
  } as unknown as ComponentProps<typeof ChatPane>;
  return render(<ChatPane {...props} />);
}

describe('a turn that never started', () => {
  it('names a 413 create refusal and offers Retry', () => {
    const onRetry = vi.fn();
    const row = payloadTooLargeRow();
    renderPane({ messages: [row], onRetry });

    // The named cause, not the generic fallback.
    expect(screen.queryByText('chat.runError.title.generic')).toBeNull();
    expect(screen.getByText('chat.runError.title.payloadTooLarge')).toBeTruthy();

    const retry = screen.getAllByRole('button', { name: 'promptTemplates.retry' });
    expect(retry).toHaveLength(1);
    fireEvent.click(retry[0]!);
    // Retry re-issues the same turn from the row that failed.
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]?.[0]?.id).toBe('assistant-413');
  });

  it('offers Retry on a conversation read that timed out', () => {
    const onRetryLoad = vi.fn();
    renderPane({
      error: 'chat.conversationLoad.timedOut',
      onRetryLoad,
    });

    expect(screen.getByText('chat.conversationLoad.timedOut')).toBeTruthy();
    const retry = screen.getAllByRole('button', { name: 'promptTemplates.retry' });
    expect(retry).toHaveLength(1);
    fireEvent.click(retry[0]!);
    expect(onRetryLoad).toHaveBeenCalledTimes(1);
  });
});
