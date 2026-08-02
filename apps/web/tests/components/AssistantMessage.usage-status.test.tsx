// @vitest-environment jsdom

/**
 * C1-9: a run whose lane emits genuinely NO usage signal (e.g. antigravity's
 * plain stream) must render as pricing "unavailable" on its own message --
 * never a bare confident $0.00, and never silently absent either (round 2 of
 * the gate's own fidelity pass made "no indication rendered at all" a
 * failure, not merely a bare zero).
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

// Both useModelRoutingForRun (GET /api/runs/:id) and useRunUsageForRun
// (GET /api/runs/:id/usage) fire from the same render; branch on the URL so
// each hook gets a shape it can actually parse.
function stubFetchWithRunUsage(
  usage: {
    costUsd: number | null;
    pricingVersion: string;
    model?: string | null;
    inputTokensEffective?: number | null;
    outputTokens?: number | null;
  } | null,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/usage')) {
        return {
          ok: usage !== null,
          json: async () => usage,
        };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
}

describe('AssistantMessage run pricing status', () => {
  it('shows "unavailable" pricing, accessibly, for a run with no usage signal', async () => {
    stubFetchWithRunUsage({ costUsd: null, pricingVersion: 'unavailable' });

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
      name: (name) => /unavailable/i.test(name),
    }));
    expect(status).toBeTruthy();
    expect(status.textContent ?? '').toMatch(/unavailable/i);
    // Never a bare confident zero alongside/instead of the qualifier.
    expect(status.textContent ?? '').not.toMatch(/\$\s?0(\.0{1,2})?(?!\d)/);
  });

  // SS-2. A claude-lane run DOES report tokens; when the model just isn't in
  // the pricing table the banner used to claim "this run's lane reported no
  // usage data" — blaming the lane for a gap in the price list. The two
  // states are different facts and must render as different sentences.
  it('blames the price table, not the lane, when tokens were reported but the model is unpriceable', async () => {
    stubFetchWithRunUsage({
      costUsd: null,
      pricingVersion: 'unavailable',
      model: 'claude-opus-5[1m]',
      inputTokensEffective: 123_456,
      outputTokens: 7_890,
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
      name: (name) => /unavailable/i.test(name),
    }));
    expect(status.textContent ?? '').toContain('no price data for claude-opus-5[1m]');
    expect(status.textContent ?? '').not.toMatch(/reported no usage data/i);
  });

  it('renders no pricing status for a normally-priced run', async () => {
    stubFetchWithRunUsage({ costUsd: 0.0123, pricingVersion: 'estimated' });

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
    expect(screen.queryByRole('status', { name: /unavailable/i })).toBeNull();
  });

  it('does not fetch usage status for a still-streaming message', () => {
    stubFetchWithRunUsage({ costUsd: null, pricingVersion: 'unavailable' });

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
