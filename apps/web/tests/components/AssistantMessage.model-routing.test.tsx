// @vitest-environment jsdom

/**
 * C1-2 / C1-4 / C1-11: model routing truth must be VISIBLE to a user, not
 * just recorded for a test. A substitution (the daemon launched a different
 * model than the user picked) shows both model names as real, accessible
 * text -- not a data-testid or a colour-only badge. An unverified lane
 * (e.g. Codex, whose wire format cannot echo what executed) says so
 * plainly. A verified run (no substitution, echo confirms it) renders no
 * extra noise.
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

function stubFetchWithModelRouting(routing: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ modelRouting: routing }),
    })),
  );
}

describe('AssistantMessage model routing status', () => {
  it('shows both the requested and resolved model, accessibly, when substituted', async () => {
    stubFetchWithModelRouting({
      requested: 'gpt-5.6-codex-legacy',
      resolved: 'gpt-5.6-codex-current',
      reported: null,
      displayState: 'substituted',
    });

    render(
      <AssistantMessage
        message={baseMessage()}
        streaming={false}
        projectId="p1"
        errorCardOwnerId={null}
        onFeedback={vi.fn()}
      />,
    );

    const status = await waitFor(() => screen.getByRole('status', {
      name: (name) => name.includes('gpt-5.6-codex-legacy') && name.includes('gpt-5.6-codex-current'),
    }));
    expect(status).toBeTruthy();
    // A data-testid or colour-only badge must not be the ONLY signal --
    // the visible text itself must carry both model names too.
    expect(status.textContent ?? '').toContain('gpt-5.6-codex-legacy');
    expect(status.textContent ?? '').toContain('gpt-5.6-codex-current');
  });

  it('says "unverified" plainly and accessibly for a lane that cannot echo what ran', async () => {
    stubFetchWithModelRouting({
      requested: 'gpt-5.6-codex',
      resolved: 'gpt-5.6-codex',
      reported: null,
      displayState: 'unverified',
    });

    render(
      <AssistantMessage
        message={baseMessage()}
        streaming={false}
        projectId="p1"
        errorCardOwnerId={null}
        onFeedback={vi.fn()}
      />,
    );

    const status = await waitFor(() => screen.getByRole('status', {
      name: (name) => /unverified/i.test(name),
    }));
    expect(status).toBeTruthy();
  });

  it('renders no routing status for a verified run (nothing noteworthy to say)', async () => {
    stubFetchWithModelRouting({
      requested: 'claude-sonnet-4-5',
      resolved: 'claude-sonnet-4-5',
      reported: 'claude-sonnet-4-5',
      displayState: 'verified',
    });

    render(
      <AssistantMessage
        message={baseMessage()}
        streaming={false}
        projectId="p1"
        errorCardOwnerId={null}
        onFeedback={vi.fn()}
      />,
    );

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('status', { name: /gpt|claude|codex/i })).toBeNull();
  });

  it('does not fetch routing for a still-streaming message', () => {
    stubFetchWithModelRouting({
      requested: 'claude-sonnet-4-5',
      resolved: 'claude-sonnet-4-5',
      reported: null,
      displayState: 'unverified',
    });

    render(
      <AssistantMessage
        message={baseMessage({ runStatus: undefined, endedAt: undefined })}
        streaming
        projectId="p1"
        errorCardOwnerId={null}
        onFeedback={vi.fn()}
      />,
    );

    expect(fetch).not.toHaveBeenCalled();
  });
});
