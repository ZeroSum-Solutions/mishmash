// @vitest-environment jsdom

/**
 * C2-9a: the real live brand egress in this file is the DISCORD_INVITE_URL
 * constant (an upstream Open Design community invite), not an
 * "open-design.ai" literal. Both feedback-flow community links must stop
 * pointing at it. The gate additionally requires the links to keep
 * resolving to SOME real, non-null href -- a removed/unreachable link
 * "cannot verify it is de-branded" -- so the fix repoints rather than
 * deletes (unlike C2-1a's newsletter block).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AssistantMessage } from '../../src/components/AssistantMessage';
import type { ChatMessage } from '../../src/types';

vi.mock('../../src/analytics/provider', () => ({
  useAnalytics: () => ({
    newRequestId: vi.fn(() => 'request-1'),
    setConfigureGlobals: vi.fn(),
    setConsent: vi.fn(),
    setIdentity: vi.fn(),
    track: vi.fn(),
  }),
}));

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(cleanup);

const LEAKED_DISCORD_INVITE = 'discord.gg/mHAjSMV6gz';

function assistantMessage(): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: 'Done.',
    agentId: 'claude',
    runId: 'run-1',
    runStatus: 'succeeded',
    events: [{ kind: 'text', text: 'Done.' } as NonNullable<ChatMessage['events']>[number]],
    producedFiles: [],
  } as ChatMessage;
}

function renderMessage() {
  render(
    <AssistantMessage
      message={assistantMessage()}
      streaming={false}
      projectId="project-1"
      conversationId="conversation-1"
      onFeedback={vi.fn()}
    />,
  );
}

describe('AssistantMessage feedback community link brand honesty (C2-9a)', () => {
  it('the positive-feedback community link is real (non-null) and does not leak the upstream Discord invite', async () => {
    renderMessage();
    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));
    const link = await screen.findByTestId('assistant-feedback-discord-positive');
    const href = link.getAttribute('href');
    expect(href).not.toBeNull();
    expect(href ?? '').not.toContain(LEAKED_DISCORD_INVITE);
  });

  it('the negative-feedback community link is real (non-null) and does not leak the upstream Discord invite', async () => {
    renderMessage();
    fireEvent.click(screen.getByRole('button', { name: 'Not helpful' }));
    const link = await screen.findByTestId('assistant-feedback-discord-negative');
    const href = link.getAttribute('href');
    expect(href).not.toBeNull();
    expect(href ?? '').not.toContain(LEAKED_DISCORD_INVITE);
  });
});
