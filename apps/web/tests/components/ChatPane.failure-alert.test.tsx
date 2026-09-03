// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import type { AppConfig, ChatMessage } from '../../src/types';

// Red spec for W1.4 (B-04 / F-07 / T-01..T-04 / T-11): a failure alert must
// name the step that failed and the cause, state plainly whether files were
// changed, and offer a recovery action.
//
// Every fixture below is a real run from the team daemon's run log
// (.od/runs/<id>/events.jsonl), reduced to the fields the chat receives:
//
//   0291fa4d  "Your computer went to sleep mid-response."
//             AGENT_EXECUTION_FAILED / process_exit / stream_error  (5 runs)
//   578cbce8  "permission check failed for write_file" (user denied)
//             AGENT_EXECUTION_FAILED / process_exit / exit_nonzero  (1 run)
//   9f783b59  "json-rpc Authentication required"
//             AGENT_EXECUTION_FAILED / auth / auth_required         (1 run)
//   63fc304f  "Agent stalled without emitting any new output for 600s"
//             AGENT_EXECUTION_FAILED / timeout / inactivity_timeout (5 runs)
//
// On the base commit the daemon classifies all four but the alert renders
// "Task failed" for three of them, never names the step, and never says
// whether files changed — which is exactly the ux-error-log complaint.

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

interface FailedRunFixture {
  id: string;
  detail: string;
  code: string;
  failureCategory: string;
  failureDetail: string;
  failureStage: string;
  artifactCount: number;
  resumable?: boolean;
}

function failedMessage(fixture: FailedRunFixture): ChatMessage {
  return {
    id: `msg-${fixture.id}`,
    role: 'assistant',
    content: '',
    createdAt: 1,
    runId: `run-${fixture.id}`,
    runStatus: 'failed',
    agentId: 'claude',
    ...(fixture.resumable ? { resumable: true } : {}),
    events: [
      {
        kind: 'status',
        label: 'error',
        detail: fixture.detail,
        code: fixture.code,
        failureCategory: fixture.failureCategory,
        failureDetail: fixture.failureDetail,
        failureStage: fixture.failureStage,
        artifactCount: fixture.artifactCount,
      },
    ],
  } as unknown as ChatMessage;
}

function renderFailure(fixture: FailedRunFixture) {
  return render(
    <ChatPane
      messages={[failedMessage(fixture)]}
      streaming={false}
      error={null}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      onRetry={vi.fn()}
      onResumeRun={vi.fn()}
      conversations={[
        { projectId: 'project-1', id: 'conv-1', title: 'Current', createdAt: 1, updatedAt: 1 },
      ]}
      activeConversationId="conv-1"
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
      config={{ agentId: 'claude', agentCliEnv: {} } as unknown as AppConfig}
    />,
  );
}

const SLEEP_RUN: FailedRunFixture = {
  id: '0291fa4d',
  detail: 'Your computer went to sleep mid-response.',
  code: 'AGENT_EXECUTION_FAILED',
  failureCategory: 'process_exit',
  failureDetail: 'stream_error',
  failureStage: 'child_close',
  artifactCount: 0,
};

const DENIED_PERMISSION_RUN: FailedRunFixture = {
  id: '578cbce8',
  detail: 'permission check failed for write_file',
  code: 'AGENT_EXECUTION_FAILED',
  failureCategory: 'process_exit',
  failureDetail: 'exit_nonzero',
  failureStage: 'child_close',
  artifactCount: 0,
};

const AUTH_RUN: FailedRunFixture = {
  id: '9f783b59',
  detail: 'json-rpc Authentication required',
  code: 'AGENT_EXECUTION_FAILED',
  failureCategory: 'auth',
  failureDetail: 'auth_required',
  failureStage: 'session_init',
  artifactCount: 0,
};

const STALL_RUN: FailedRunFixture = {
  id: '63fc304f',
  detail: 'Agent stalled without emitting any new output for 600s.',
  code: 'AGENT_EXECUTION_FAILED',
  failureCategory: 'timeout',
  failureDetail: 'inactivity_timeout',
  failureStage: 'tool_execution',
  artifactCount: 4,
  resumable: true,
};

describe('ChatPane failure alert names the step, the cause, and the file-change state', () => {
  it.each([
    ['sleep / dropped stream', SLEEP_RUN],
    ['denied write permission', DENIED_PERMISSION_RUN],
    ['agent not signed in', AUTH_RUN],
  ])('names the cause instead of "Task failed" (%s)', (_label, fixture) => {
    const { container } = renderFailure(fixture);

    expect(container.querySelector('[data-user-action-card="run-recovery"]')).toBeTruthy();
    // The daemon classified this failure; the alert must not fall back to the
    // catch-all title.
    expect(screen.queryByText('chat.runError.title.generic')).toBeNull();
  });

  it.each([
    ['sleep / dropped stream', SLEEP_RUN, 'child_close'],
    ['denied write permission', DENIED_PERMISSION_RUN, 'child_close'],
    ['agent not signed in', AUTH_RUN, 'session_init'],
    ['stalled for 600s', STALL_RUN, 'tool_execution'],
  ])('names the step that failed (%s)', (_label, fixture, stage) => {
    const { container } = renderFailure(fixture);

    const step = container.querySelector('[data-run-failure-step]');
    expect(step).toBeTruthy();
    expect(step?.getAttribute('data-run-failure-step')).toBe(stage);
    expect((step?.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('states that no files were changed when the run produced nothing', () => {
    const { container } = renderFailure(SLEEP_RUN);

    const files = container.querySelector('[data-run-failure-files]');
    expect(files).toBeTruthy();
    expect(files?.getAttribute('data-run-failure-files')).toBe('0');
    expect((files?.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('states how many files were changed when the run wrote some before failing', () => {
    const { container } = renderFailure(STALL_RUN);

    const files = container.querySelector('[data-run-failure-files]');
    expect(files).toBeTruthy();
    expect(files?.getAttribute('data-run-failure-files')).toBe('4');
    expect(files?.textContent).toContain('4');
  });

  it('offers resume on a resumable failure and a from-scratch retry otherwise', () => {
    renderFailure(STALL_RUN);
    expect(screen.getByRole('button', { name: 'chat.resumeRunCta' })).toBeTruthy();
    cleanup();

    renderFailure(SLEEP_RUN);
    expect(screen.getByRole('button', { name: 'promptTemplates.retry' })).toBeTruthy();
  });
});
