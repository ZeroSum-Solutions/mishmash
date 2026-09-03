// @vitest-environment jsdom

// Red spec for W1F.3, finding 1: the failure surface a succeeded run shows.
//
// Issue #157 reports a run that succeeded with exit 0 and was still presented
// as a failure while its agent output carried external-MCP connect noise. The
// daemon half of that claim is
// `apps/daemon/tests/mcp-noise-succeeded-run.test.ts`; this file asserts the
// half the user actually sees -- the chat's own failure alert.
//
// Fixture: run 074ab1fd-a7af-4469-aa85-ae38185c4f95, the run linked from #157.
// Its assistant row is stored `run_status: succeeded`,
// `result_delivery_state: delivered`, `session_mode: design`, with one produced
// file (`index.html`) and the verbatim MCP `tool_result` below among its
// events.

import { cleanup, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import {
  isRetryableAssistantTerminalFailure,
  resolveDesignDeliveryOutcome,
} from '../../src/runtime/design-delivery';
import type { AppConfig, ChatMessage } from '../../src/types';

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

/** Verbatim `tool_result` content persisted by run 074ab1fd; `isError` false. */
const MCP_CONNECT_NOISE =
  'No matching deferred tools found. Note: these configured MCP servers failed to connect, ' +
  'so their tools are unavailable for this session: shadcn-ui (CONNECT_TIMEOUT): ' +
  '"MCP server shadcn-ui connection timed out after 30000ms"; antv-chart (CONNECT_TIMEOUT): ' +
  '"MCP server antv-chart connection timed out after 30000ms"; mermaid (CONNECTION_CLOSED): ' +
  '"Connection closed"; fal-ai (CONNECTION_CLOSED): "Connection closed". ' +
  'Treat this as a connection failure — do not conclude the capability is unconfigured.';

const MCP_FLAP_NOISE =
  '3 deferred tools are no longer available (MCP server disconnected)\n' +
  '3 deferred tools are available again (reconnected)';

const ANSWER = 'Done. `index.html` is the full-viewport curl-noise flow field.';

const EVENTS = [
  { kind: 'status', label: 'starting', detail: 'claude' },
  { kind: 'tool_use', id: 'toolu_01HjDoqVnHsPXRkWzYZEFY7F', name: 'ToolSearch', input: {} },
  {
    kind: 'tool_result',
    toolUseId: 'toolu_01HjDoqVnHsPXRkWzYZEFY7F',
    content: MCP_CONNECT_NOISE,
    isError: false,
  },
  { kind: 'text', text: MCP_FLAP_NOISE },
  { kind: 'text', text: ANSWER },
];

const PRODUCED_FILE = {
  name: 'index.html',
  path: 'index.html',
  type: 'file',
  size: 19735,
  mtime: 1787891477074,
  kind: 'html',
  mime: 'text/html; charset=utf-8',
};

const SUCCEEDED_MESSAGE = {
  id: 'c794cb95-c5d5-4f51-9d35-1e9290e5b1a4',
  role: 'assistant',
  content: ANSWER,
  createdAt: 1787890956305,
  endedAt: 1787891501452,
  runId: '074ab1fd-a7af-4469-aa85-ae38185c4f95',
  runStatus: 'succeeded',
  resultDeliveryState: 'delivered',
  sessionMode: 'design',
  agentId: 'claude',
  events: EVENTS,
  producedFiles: [PRODUCED_FILE],
  traceObjectFiles: [PRODUCED_FILE],
} as unknown as ChatMessage;

describe('a succeeded exit-0 run with MCP noise shows no failure surface (#157)', () => {
  it('classifies the turn as delivered, not as a missing result', () => {
    expect(
      resolveDesignDeliveryOutcome({
        sessionMode: 'design',
        runStatus: 'succeeded',
        content: ANSWER,
        events: EVENTS as never,
        producedFileCount: 1,
        traceObjectFileCount: 1,
        modifiedFileCount: 0,
      }),
    ).toBe('delivered');
  });

  it('does not treat the succeeded row as a terminal failure', () => {
    expect(isRetryableAssistantTerminalFailure(SUCCEEDED_MESSAGE)).toBe(false);
  });

  it('renders no run-recovery alert for the succeeded run', () => {
    const { container } = render(
      <ChatPane
        messages={[SUCCEEDED_MESSAGE]}
        streaming={false}
        error={null}
        projectId="eb0d881b-b646-4f2e-adb7-4d4ca6baa65a"
        projectFiles={[]}
        onEnsureProject={async () => 'eb0d881b-b646-4f2e-adb7-4d4ca6baa65a'}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onRetry={vi.fn()}
        onResumeRun={vi.fn()}
        conversations={[
          {
            projectId: 'eb0d881b-b646-4f2e-adb7-4d4ca6baa65a',
            id: '954a372e-343a-4ff6-91bf-c170817150b0',
            title: 'Current',
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        activeConversationId="954a372e-343a-4ff6-91bf-c170817150b0"
        onSelectConversation={vi.fn()}
        onDeleteConversation={vi.fn()}
        config={{ agentId: 'claude', agentCliEnv: {} } as unknown as AppConfig}
      />,
    );

    expect(container.querySelector('[data-user-action-card="run-recovery"]')).toBeNull();
    expect(screen.queryByText('chat.runError.title.generic')).toBeNull();
  });
});
