// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import type { AppConfig, ChatMessage } from '../../src/types';

// W1F.4 red spec — the consumer half.
//
// The failure alert must name the exact cause, the step that stopped, and
// whether the user's files changed, for every failure the team daemon reported.
//
// Every fixture below carries the persisted `status:error` event that
// `apps/daemon/tests/run-failure-alert-facts.test.ts` proves a real daemon
// writes for that cause: same category, same detail, same stage — each pinned
// to an exact value there, resolved from raw agent output with nothing
// pre-supplied. The one field taken from elsewhere is STALL_RUN's
// `artifactCount: 4`, which is run 63fc304f's own recorded count; the daemon
// spec proves that field travels for every cause, and this fixture is what
// exercises the "N files were changed" sentence, which a zero count cannot.
//
// This file therefore measures only what this layer owns: which sentence a
// carried fact becomes, and which messages get an alert at all. The end-to-end
// chain through a real daemon and the real chat is
// `e2e/ui/run-failure-alert-causes.test.ts`.
//
// The reported runs (`.od/runs/<id>/state.json`) behind the fixtures:
//
//   63fc304f  the agent stalled for 600s      -> timeout / inactivity_timeout
//   7557ed43  the machine slept mid-response  -> process_exit / stream_error
//   0291fa4d  the configured endpoint refused -> upstream_unavailable / network_error
//   578cbce8  the user denied a write_file    -> process_exit / permission_denied
//   (quota)   the provider refused for quota  -> rate_limit / hard_quota
//
// and the two cancellations, which are not the same event: a Stop the user
// pressed must stay silent, and a shutdown that took the turn from them must
// name itself.

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

interface TerminalRunFixture {
  id: string;
  /** Terminal run status the daemon stored on the assistant row. */
  runStatus: 'failed' | 'canceled';
  detail: string;
  code?: string;
  failureCategory?: string;
  failureDetail?: string;
  failureStage?: string;
  artifactCount?: number;
  resumable?: boolean;
  /** A user Stop stores no error event at all — see the daemon spec. */
  withoutErrorEvent?: boolean;
  /** Events an earlier attempt left on the same assistant row. */
  priorEvents?: unknown[];
}

function terminalMessage(fixture: TerminalRunFixture): ChatMessage {
  return {
    id: `msg-${fixture.id}`,
    role: 'assistant',
    content: '',
    createdAt: 1,
    runId: `run-${fixture.id}`,
    runStatus: fixture.runStatus,
    agentId: 'claude',
    ...(fixture.resumable ? { resumable: true } : {}),
    events: fixture.withoutErrorEvent
      ? [...(fixture.priorEvents ?? [])]
      : [
          ...(fixture.priorEvents ?? []),
          {
            kind: 'status',
            label: 'error',
            detail: fixture.detail,
            ...(fixture.code ? { code: fixture.code } : {}),
            ...(fixture.failureCategory ? { failureCategory: fixture.failureCategory } : {}),
            ...(fixture.failureDetail ? { failureDetail: fixture.failureDetail } : {}),
            ...(fixture.failureStage ? { failureStage: fixture.failureStage } : {}),
            ...(fixture.artifactCount === undefined ? {} : { artifactCount: fixture.artifactCount }),
          },
        ],
  } as unknown as ChatMessage;
}

function renderFailure(fixture: TerminalRunFixture) {
  return render(
    <ChatPane
      messages={[terminalMessage(fixture)]}
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

// The reported failures, each carrying the persisted error event the daemon
// spec proves a real daemon writes for it. `detail` is the run's own error text
// from `.od/runs/<id>/state.json`.

const SLEEP_RUN: TerminalRunFixture = {
  id: '7557ed43',
  runStatus: 'failed',
  detail: 'API Error: Your computer went to sleep mid-response. The response above may be incomplete.',
  code: 'AGENT_EXECUTION_FAILED',
  failureCategory: 'process_exit',
  failureDetail: 'stream_error',
  failureStage: 'child_close',
  artifactCount: 0,
};

const ENDPOINT_DOWN_RUN: TerminalRunFixture = {
  id: '0291fa4d',
  runStatus: 'failed',
  detail: 'Claude Code could not reach the configured custom Anthropic endpoint.',
  code: 'AGENT_EXECUTION_FAILED',
  failureCategory: 'upstream_unavailable',
  failureDetail: 'network_error',
  failureStage: 'first_token_wait',
  artifactCount: 0,
};

const QUOTA_RUN: TerminalRunFixture = {
  id: 'quota',
  runStatus: 'failed',
  detail: 'API Error: You have exceeded your current quota. Please upgrade your plan to continue.',
  code: 'AGENT_EXECUTION_FAILED',
  failureCategory: 'rate_limit',
  failureDetail: 'hard_quota',
  failureStage: 'session_init',
  artifactCount: 0,
};

const DENIED_PERMISSION_RUN: TerminalRunFixture = {
  id: '578cbce8',
  runStatus: 'failed',
  detail: 'Error: permission check failed for write_file "index.html": user denied permission for write_file(index.html)',
  code: 'AGENT_EXECUTION_FAILED',
  failureCategory: 'process_exit',
  failureDetail: 'permission_denied',
  failureStage: 'tool_execution',
  artifactCount: 0,
};

const STALL_RUN: TerminalRunFixture = {
  id: '63fc304f',
  runStatus: 'failed',
  detail: 'Agent stalled without emitting any new output for 600s.',
  code: 'AGENT_EXECUTION_FAILED',
  failureCategory: 'timeout',
  failureDetail: 'inactivity_timeout',
  failureStage: 'tool_execution',
  artifactCount: 4,
  resumable: true,
};

// The user pressed Stop. The daemon names the cause on the run record but
// deliberately writes no error event onto the message.
const USER_STOP_RUN: TerminalRunFixture = {
  id: 'user-stop',
  runStatus: 'canceled',
  detail: '',
  withoutErrorEvent: true,
};

// The daemon shut down under an in-flight turn. Nobody stopped this run; it was
// taken from the user, so the daemon classifies it as an interruption and does
// write the error event.
const SHUTDOWN_CANCEL_RUN: TerminalRunFixture = {
  id: 'shutdown-cancel',
  runStatus: 'canceled',
  detail: 'MishMash shut down while this turn was running, so the turn was interrupted.',
  failureCategory: 'process_exit',
  failureDetail: 'interrupted',
  failureStage: 'first_token_wait',
  artifactCount: 0,
};

// W1H.2 — the OTHER shutdown shape. The daemon did not shut down under the
// turn; it died with the turn in flight and never reached `shutdownActive`, so
// nothing classified the run until startup reconciliation did
// (`apps/daemon/src/runtimes/run-terminal-reconciliation.ts`). The event below
// is what that pass now stores, and the alert owes this run the same three
// facts it owes every other failure.
const DAEMON_RESTART_RUN: TerminalRunFixture = {
  id: 'daemon-restart',
  runStatus: 'failed',
  detail: 'Run interrupted because the daemon restarted.',
  code: 'DAEMON_RESTARTED',
  failureCategory: 'process_exit',
  failureDetail: 'interrupted',
  failureStage: 'tool_execution',
  artifactCount: 2,
};

describe('the failure alert names the exact cause, the step, and the file-change state', () => {
  it.each([
    ['the agent stalled for 600s', STALL_RUN, 'chat.runError.title.timedOut'],
    ['the machine slept mid-response', SLEEP_RUN, 'chat.runError.title.connectionDropped'],
    ['the configured endpoint refused the connection', ENDPOINT_DOWN_RUN, 'chat.runError.title.connectionDropped'],
    ['the provider refused the request for quota', QUOTA_RUN, 'chat.runError.title.quotaExhausted'],
    ['the user denied a write_file permission', DENIED_PERMISSION_RUN, 'chat.runError.title.permissionBlocked'],
    ['the daemon shut down under the turn', SHUTDOWN_CANCEL_RUN, 'chat.runError.title.stopped'],
    ['the daemon restarted under the turn', DAEMON_RESTART_RUN, 'chat.runError.title.daemonRestarted'],
  ])('names the exact cause when %s', (_label, fixture, titleKey) => {
    const { container } = renderFailure(fixture);

    const card = container.querySelector('[data-user-action-card="run-recovery"]');
    expect(card, 'a classified terminal failure must show the recovery alert').toBeTruthy();
    // The exact user-facing name, not merely "some name other than the generic
    // one": three of these causes rendered a different, wrong title before.
    expect(screen.getByText(titleKey)).toBeTruthy();
    expect(screen.queryByText('chat.runError.title.generic')).toBeNull();
  });

  it.each([
    ['the agent stalled for 600s', STALL_RUN, 'tool_execution', 'chat.runError.step.toolExecution'],
    ['the machine slept mid-response', SLEEP_RUN, 'child_close', 'chat.runError.step.childClose'],
    ['the configured endpoint refused the connection', ENDPOINT_DOWN_RUN, 'first_token_wait', 'chat.runError.step.firstTokenWait'],
    ['the provider refused the request for quota', QUOTA_RUN, 'session_init', 'chat.runError.step.sessionInit'],
    ['the user denied a write_file permission', DENIED_PERMISSION_RUN, 'tool_execution', 'chat.runError.step.toolExecution'],
    ['the daemon shut down under the turn', SHUTDOWN_CANCEL_RUN, 'first_token_wait', 'chat.runError.step.firstTokenWait'],
    ['the daemon restarted under the turn', DAEMON_RESTART_RUN, 'tool_execution', 'chat.runError.step.toolExecution'],
  ])('names the step that stopped when %s', (_label, fixture, stage, stepKey) => {
    const { container } = renderFailure(fixture);

    const step = container.querySelector('[data-run-failure-step]');
    expect(step).toBeTruthy();
    expect(step?.getAttribute('data-run-failure-step')).toBe(stage);
    expect(step?.textContent).toBe(stepKey);
  });

  it('states that no files were changed when the run produced nothing', () => {
    const { container } = renderFailure(SLEEP_RUN);

    const files = container.querySelector('[data-run-failure-files]');
    expect(files).toBeTruthy();
    expect(files?.getAttribute('data-run-failure-files')).toBe('0');
    expect(files?.textContent).toBe('chat.runError.filesUnchanged');
  });

  it('states the file-change state of a turn a daemon restart interrupted', () => {
    const { container } = renderFailure(DAEMON_RESTART_RUN);

    const files = container.querySelector('[data-run-failure-files]');
    expect(files, 'the restart alert states whether the user\'s files changed').toBeTruthy();
    expect(files?.getAttribute('data-run-failure-files')).toBe('2');
    expect(files?.textContent).toContain('2');
  });

  it('states how many files were changed when the run wrote some before failing', () => {
    const { container } = renderFailure(STALL_RUN);

    const files = container.querySelector('[data-run-failure-files]');
    expect(files).toBeTruthy();
    expect(files?.getAttribute('data-run-failure-files')).toBe('4');
    expect(files?.textContent).toContain('4');
  });

  it('shows the daemon\'s own words for a turn its shutdown ended', () => {
    renderFailure(SHUTDOWN_CANCEL_RUN);

    expect(screen.getByText(SHUTDOWN_CANCEL_RUN.detail)).toBeTruthy();
  });

  it('offers resume on a resumable failure and a from-scratch retry otherwise', () => {
    renderFailure(STALL_RUN);
    expect(screen.getByRole('button', { name: 'chat.resumeRunCta' })).toBeTruthy();
    cleanup();

    renderFailure(SLEEP_RUN);
    expect(screen.getByRole('button', { name: 'promptTemplates.retry' })).toBeTruthy();
  });

  it('stays silent about a Stop that follows an earlier failed attempt', () => {
    // A client may reuse one assistant message id across attempts, so an older
    // attempt's classified error can still be sitting on the row when the user
    // stops the retry. The daemon rewrites the last error event to
    // `user_cancelled` for a Stop — proved on a real daemon by
    // run-failure-alert-facts.test.ts, "rewrites an earlier attempt's error
    // event when the user stops the retry" — so the alert must read that event
    // and not the stale one underneath it.
    const { container } = renderFailure({
      id: 'stop-after-failed-attempt',
      runStatus: 'canceled',
      detail: '',
      priorEvents: [
        {
          kind: 'status',
          label: 'error',
          detail: SLEEP_RUN.detail,
          code: 'AGENT_EXECUTION_FAILED',
          failureCategory: 'process_exit',
          failureDetail: 'stream_error',
          failureStage: 'child_close',
          artifactCount: 0,
        },
      ],
      failureCategory: 'user_cancel',
      failureDetail: 'user_cancelled',
      failureStage: 'first_token_wait',
    });

    expect(container.querySelector('[data-user-action-card="run-recovery"]')).toBeNull();
  });

  it('stays silent about a Stop the user pressed', () => {
    const { container } = renderFailure(USER_STOP_RUN);

    // The user ended this turn themselves and knows why. An alert here would
    // report their own action back to them as a failure.
    expect(container.querySelector('[data-user-action-card="run-recovery"]')).toBeNull();
    expect(screen.queryByText('chat.runError.title.generic')).toBeNull();
    expect(screen.queryByText('chat.runError.title.stopped')).toBeNull();
  });
});

// W1I.2 red spec — the consumer half.
//
// B-04/F-07 asks every failed run to state whether files changed. W1H.2 left
// the restart path silent for two shapes it could not prove a POSITIVE write
// for: a run whose event log recorded no write, and a run with no event log at
// all. The daemon now decides both from the durable pre-turn file list
// (`apps/daemon/src/runtimes/run-terminal-reconciliation.ts`) and, when even
// that cannot decide, persists an explicit `fileChangeState: 'unknown'`.
//
// This block owns the rendering half of that contract: a measured zero reads
// exactly as the live failed path's zero already reads, and an unknown gets its
// own sentence instead of no sentence.

interface FileChangeStateFixture {
  id: string;
  artifactCount?: number;
  fileChangeState?: string;
}

function fileChangeStateMessage(fixture: FileChangeStateFixture): ChatMessage {
  return {
    id: `msg-${fixture.id}`,
    role: 'assistant',
    content: '',
    createdAt: 1,
    runId: `run-${fixture.id}`,
    runStatus: 'failed',
    agentId: 'claude',
    events: [
      {
        kind: 'status',
        label: 'error',
        detail: 'Run interrupted because the daemon restarted.',
        code: 'DAEMON_RESTARTED',
        failureCategory: 'process_exit',
        failureDetail: 'interrupted',
        ...(fixture.artifactCount === undefined ? {} : { artifactCount: fixture.artifactCount }),
        ...(fixture.fileChangeState ? { fileChangeState: fixture.fileChangeState } : {}),
      },
    ],
  } as unknown as ChatMessage;
}

function renderFileChangeState(fixture: FileChangeStateFixture) {
  return render(
    <ChatPane
      messages={[fileChangeStateMessage(fixture)]}
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

describe('a restart-interrupted alert states the file-change state on every shape', () => {
  it('reads a measured zero exactly as the live failed path\'s zero reads', () => {
    const { container } = renderFileChangeState({
      id: 'restart-measured-zero',
      artifactCount: 0,
      fileChangeState: 'unchanged',
    });

    const files = container.querySelector('[data-run-failure-files]');
    expect(files, 'a measured zero is stated, not left silent').toBeTruthy();
    expect(files?.getAttribute('data-run-failure-files')).toBe('0');
    expect(files?.textContent).toBe('chat.runError.filesUnchanged');
  });

  it('gives the undecidable case its own sentence instead of no sentence', () => {
    const { container } = renderFileChangeState({
      id: 'restart-unknown',
      fileChangeState: 'unknown',
    });

    const files = container.querySelector('[data-run-failure-files]');
    expect(files, 'an unknown file-change state still produces a file line').toBeTruthy();
    expect(files?.getAttribute('data-run-failure-files')).toBe('unknown');
    expect(files?.textContent).toBe('chat.runError.filesUnknown');
  });
});
