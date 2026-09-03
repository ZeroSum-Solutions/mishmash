// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectView } from '../../src/components/ProjectView';
import { isRetryableAssistantTerminalFailure } from '../../src/runtime/design-delivery';
import type { ChatMessage } from '../../src/types';

// Red spec for W1F.1: a mounted chat client must drop its stale failure state
// when the run's own succeeded terminal event arrives, with no page reload and
// no manual refetch.
//
// Track 1.1 (#163) repaired the PERSISTED assistant row and proved it through
// the replayed daemon event stream. It never attached a chat client, and the
// builder recorded the gap in `1.1-glm-r2-response.md:100`: "A web client
// holding a stale in-memory failure renders it until refetch."
//
// The client cannot tell a dead run from a dead connection, so when its SSE
// stream drops it marks its OWN assistant row `failed` and paints the pane's
// run-recovery alert. The run usually survives and reaches `end: succeeded`.
// `ChatPane` renders that "Task failed" alert from EITHER carrier — see
// `displayError` (ChatPane.tsx:1269) and `retryableAssistantMessage`
// (ChatPane.tsx:3858), which asks `isRetryableAssistantTerminalFailure`
// (runtime/design-delivery.ts:62). So the reconciliation has to clear both.
//
// This spec drives the real mounted `ProjectView`: it lets the reattached
// stream drop after content has already been delivered, then replays the
// run's succeeded terminal event into the same mounted client and asserts
// that nothing on screen still describes the turn as failed.

const listConversations = vi.fn();
const listMessages = vi.fn();
const fetchPreviewComments = vi.fn();
const loadTabs = vi.fn();
const fetchProjectFiles = vi.fn();
const fetchProjectDesignSystemPackageAudit = vi.fn();
const fetchLiveArtifacts = vi.fn();
const fetchSkill = vi.fn();
const fetchDesignSystem = vi.fn();
const getTemplate = vi.fn();
const fetchChatRunStatus = vi.fn();
const listActiveChatRuns = vi.fn();
const listProjectRuns = vi.fn();
const reattachDaemonRun = vi.fn();
const publishDaemonRunFinishedEvent = vi.fn();
const streamViaDaemon = vi.fn();
const saveMessage = vi.fn();
const createConversation = vi.fn();
const patchConversation = vi.fn();
const patchProject = vi.fn();
const saveTabs = vi.fn();


/** The two carriers `ChatPane` paints its run-recovery alert from. */
interface PaneFailureState {
  paneError: string | null;
  lastAssistant: ChatMessage | undefined;
}

const chatPaneHarness = vi.hoisted(() => ({
  props: null as null | { messages: ChatMessage[]; error: string | null },
}));

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (value: string) => value,
  }),
  useT: () => ((value: string) => value),
}));

vi.mock('../../src/providers/anthropic', () => ({
  streamMessage: vi.fn(),
}));

vi.mock('../../src/providers/daemon', () => ({
  GENERIC_DAEMON_DISCONNECT_CODE: 'GENERIC_DAEMON_DISCONNECT',
  GENERIC_DAEMON_DISCONNECT_MESSAGE: 'daemon stream disconnected before run completed',
  fetchChatRunStatus: (...args: unknown[]) => fetchChatRunStatus(...args),
  listActiveChatRuns: (...args: unknown[]) => listActiveChatRuns(...args),
  listProjectRuns: (...args: unknown[]) => listProjectRuns(...args),
  publishDaemonRunFinishedEvent: (...args: unknown[]) => publishDaemonRunFinishedEvent(...args),
  reattachDaemonRun: (...args: unknown[]) => reattachDaemonRun(...args),
  streamViaDaemon: (...args: unknown[]) => streamViaDaemon(...args),
}));

vi.mock('../../src/providers/registry', () => ({
  deletePreviewComment: vi.fn(),
  fetchPreviewComments: (...args: unknown[]) => fetchPreviewComments(...args),
  fetchDesignSystem: (...args: unknown[]) => fetchDesignSystem(...args),
  fetchProjectDesignSystemPackageAudit: (...args: unknown[]) =>
    fetchProjectDesignSystemPackageAudit(...args),
  fetchLiveArtifacts: (...args: unknown[]) => fetchLiveArtifacts(...args),
  fetchProjectFiles: (...args: unknown[]) => fetchProjectFiles(...args),
  fetchSkill: (...args: unknown[]) => fetchSkill(...args),
  patchPreviewCommentStatus: vi.fn(),
  upsertPreviewComment: vi.fn(),
  writeProjectTextFile: vi.fn(),
}));

vi.mock('../../src/providers/project-events', () => ({
  useProjectFileEvents: vi.fn(),
}));

vi.mock('../../src/router', () => ({
  navigate: vi.fn(),
}));

vi.mock('../../src/state/projects', () => ({
  cacheTabsLocally: vi.fn((projectId: string, tabs: unknown) => ({ projectId, tabs })),
  createConversation: (...args: unknown[]) => createConversation(...args),
  deleteConversation: vi.fn(),
  getTemplate: (...args: unknown[]) => getTemplate(...args),
  listConversations: (...args: unknown[]) => listConversations(...args),
  listMessages: (...args: unknown[]) => listMessages(...args),
  loadTabs: (...args: unknown[]) => loadTabs(...args),
  patchConversation: (...args: unknown[]) => patchConversation(...args),
  patchProject: (...args: unknown[]) => patchProject(...args),
  persistTabsToDaemonNow: vi.fn(),
  saveMessage: (...args: unknown[]) => saveMessage(...args),
  saveTabs: (...args: unknown[]) => saveTabs(...args),
}));

vi.mock('../../src/components/AppChromeHeader', () => ({
  AppChromeHeader: () => null,
}));

vi.mock('../../src/components/AvatarMenu', () => ({
  AvatarMenu: () => null,
}));

vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: (props: { messages: ChatMessage[]; error: string | null }) => {
    chatPaneHarness.props = props;
    return null;
  },
}));

vi.mock('../../src/components/FileWorkspace', () => ({
  DESIGN_SYSTEM_TAB: '__design_system__',
  FileWorkspace: () => null,
}));

vi.mock('../../src/components/Loading', () => ({
  CenteredLoader: () => null,
}));

function renderProjectView() {
  return render(
    <ProjectView
      project={
        { id: 'project-1', name: 'Project', skillId: null, designSystemId: null } as never
      }
      routeFileName={null}
      config={
        {
          mode: 'daemon',
          agentId: 'agent-1',
          notifications: undefined,
          agentModels: {},
        } as never
      }
      agents={[{ id: 'agent-1', name: 'OpenCode', models: [] } as never]}
      skills={[]}
      designTemplates={[]}
      designSystems={[]}
      daemonLive
      onModeChange={() => {}}
      onAgentChange={() => {}}
      onAgentModelChange={() => {}}
      onRefreshAgents={() => {}}
      onOpenSettings={() => {}}
      onBack={() => {}}
      onClearPendingPrompt={() => {}}
      onTouchProject={() => {}}
      onProjectChange={() => {}}
      onProjectsRefresh={() => {}}
    />,
  );
}

/** What the mounted pane would paint the run-recovery alert from right now. */
function paneFailureState(): PaneFailureState {
  const props = chatPaneHarness.props;
  const messages = props?.messages ?? [];
  const assistants = messages.filter((m) => m.role === 'assistant');
  return {
    paneError: props?.error ?? null,
    lastAssistant: assistants[assistants.length - 1],
  };
}

/** The error `consumeDaemonRun` raises when a reconnect GET answers non-OK. */
const STREAM_DROP_MESSAGE = 'daemon 503: no body';

interface ReattachAttempt {
  onDone: () => void | Promise<void>;
  onError: (err: Error) => void | Promise<void>;
  onRunStatus: (status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled') => void;
}

describe('a mounted chat client drops its stale failure when the succeeded end event arrives', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    chatPaneHarness.props = null;
    window.sessionStorage.clear();
  });

  it('drops the failure alert once the run\'s succeeded terminal reaches the mounted client', async () => {
    const startedAt = Date.now();
    const runningRow = {
      id: 'msg-drop',
      role: 'assistant',
      content: 'Here is the deck so far.',
      createdAt: startedAt,
      startedAt,
      runId: 'run-drop',
      runStatus: 'running',
      preTurnFileNames: [],
    } satisfies ChatMessage;

    listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
    listMessages.mockResolvedValue([runningRow]);
    fetchPreviewComments.mockResolvedValue([]);
    loadTabs.mockResolvedValue({ tabs: [], activeTabId: null });
    fetchProjectFiles.mockResolvedValue([]);
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    listActiveChatRuns.mockResolvedValue([]);
    listProjectRuns.mockResolvedValue([]);
    // While the browser's stream is down the daemon still reports the run as in
    // flight — the ambiguity that makes the client guess "failed".
    fetchChatRunStatus.mockResolvedValue({
      id: 'run-drop',
      status: 'running',
      createdAt: startedAt,
      updatedAt: startedAt,
      exitCode: null,
      signal: null,
    });

    const attempts: ReattachAttempt[] = [];
    reattachDaemonRun.mockImplementation(async (options: {
      handlers: { onDone: () => void; onError: (err: Error) => void };
      onRunStatus: ReattachAttempt['onRunStatus'];
    }) => {
      attempts.push({
        onDone: options.handlers.onDone,
        onError: options.handlers.onError,
        onRunStatus: options.onRunStatus,
      });
      return new Promise<void>(() => {});
    });

    renderProjectView();
    await waitFor(() => expect(reattachDaemonRun).toHaveBeenCalledTimes(1));

    // 1. The run's event stream answers non-OK while the daemon is briefly
    //    unavailable. `consumeDaemonRun` surfaces that as a plain
    //    `daemon <status>` error with no disconnect code
    //    (providers/daemon.ts:1099) and stops reading. The client cannot tell a
    //    dead run from a dead connection, so it marks its own row failed and
    //    raises the pane's "Task failed" alert.
    await act(async () => {
      await attempts[0]!.onError(new Error(STREAM_DROP_MESSAGE));
    });

    await waitFor(() => {
      const state = paneFailureState();
      expect(state.paneError).toBe(STREAM_DROP_MESSAGE);
      expect(isRetryableAssistantTerminalFailure(state.lastAssistant!)).toBe(true);
    });

    // 2. The run survives and reaches its succeeded terminal event. The daemon
    //    repairs the stored row (track 1.1, #163) and the mounted client picks
    //    that authoritative row up through its post-run conversation refresh —
    //    no page reload, no manual refetch.
    listMessages.mockResolvedValue([
      {
        ...runningRow,
        runStatus: 'succeeded',
        endedAt: startedAt + 1,
      } satisfies ChatMessage,
    ]);
    fetchChatRunStatus.mockResolvedValue({
      id: 'run-drop',
      status: 'succeeded',
      createdAt: startedAt,
      updatedAt: startedAt + 1,
      exitCode: 0,
      signal: null,
    });

    await waitFor(() => {
      expect(paneFailureState().lastAssistant?.runStatus).toBe('succeeded');
    });

    // 3. Nothing the mounted client still shows may describe the turn as
    //    failed. `ChatPane` paints the run-recovery alert from either carrier.
    expect(isRetryableAssistantTerminalFailure(paneFailureState().lastAssistant!)).toBe(false);
    expect(paneFailureState().paneError).toBeNull();
  });
});
