// @vitest-environment jsdom
//
// W7B / INV-7.4 closing guard (wave 7, spec-audit-r2 disposition §C "7B"):
// sound and desktop completion notifications are independent decisions.
// These cases already pass on base (`8487362f0`) through the existing
// inline logic in `ProjectView.notifyCompletedRun` (`ProjectView.tsx:2208
// -2252`) — this file is a closing-VERIFIED guard collecting the matrix
// in one place, not the red proof for this track (see the CLI and config
// red specs for that). After the helper lands in
// `src/runtime/notification-decision.ts` and `notifyCompletedRun` is wired
// to call it (post 3E.2 merge), this file continues to guard the observable
// behaviour so that refactor cannot silently change it.
//
// Unlike the sibling run-isolation/api-empty-response suites, this file
// does NOT mock `showCompletionNotification` — the desktop assertions run
// the real function, through a stubbed `Notification` global, so the
// permission-denied case is proven through the real chain rather than by
// construction.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectView } from '../../src/components/ProjectView';
import type {
  AgentInfo,
  AppConfig,
  ChatMessage,
  Conversation,
  NotificationsConfig,
  PreviewComment,
  Project,
} from '../../src/types';

const listConversations = vi.fn();
const listMessages = vi.fn();
const fetchPreviewComments = vi.fn();
const loadTabs = vi.fn();
const fetchProjectFiles = vi.fn();
const fetchLiveArtifacts = vi.fn();
const fetchSkill = vi.fn();
const fetchDesignSystem = vi.fn();
const patchPreviewCommentStatus = vi.fn();
const getTemplate = vi.fn();
const fetchChatRunStatus = vi.fn();
const listActiveChatRuns = vi.fn();
const listProjectRuns = vi.fn();
const reattachDaemonRun = vi.fn();
const publishDaemonRunFinishedEvent = vi.fn();
const fetchVelaLoginStatus = vi.fn();
const fetchAmrWalletSnapshot = vi.fn();
const launchAntigravityOauth = vi.fn();
const streamViaDaemon = vi.fn();
const streamMessage = vi.fn();
const saveMessage = vi.fn();
const createConversation = vi.fn();
const patchConversation = vi.fn();
const patchProject = vi.fn();
const saveTabs = vi.fn();
const playSound = vi.fn();
const analyticsTrackMock = vi.fn();

vi.mock('../../src/analytics/provider', () => ({
  useAnalytics: () => ({
    track: analyticsTrackMock,
  }),
}));

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (key: string) => key,
  }),
  useT: () => (key: string) => key,
}));

vi.mock('../../src/providers/anthropic', () => ({
  streamMessage: (...args: unknown[]) => streamMessage(...args),
}));

vi.mock('../../src/providers/daemon', () => ({
  GENERIC_DAEMON_DISCONNECT_CODE: 'GENERIC_DAEMON_DISCONNECT',
  GENERIC_DAEMON_DISCONNECT_MESSAGE: 'daemon stream disconnected before run completed',
  fetchChatRunStatus: (...args: unknown[]) => fetchChatRunStatus(...args),
  fetchVelaLoginStatus: (...args: unknown[]) => fetchVelaLoginStatus(...args),
  fetchAmrWalletSnapshot: (...args: unknown[]) => fetchAmrWalletSnapshot(...args),
  formatVelaBalanceUsd: (raw: string | null | undefined) => (raw == null ? null : `$${raw}`),
  launchAntigravityOauth: (...args: unknown[]) => launchAntigravityOauth(...args),
  listActiveChatRuns: (...args: unknown[]) => listActiveChatRuns(...args),
  listProjectRuns: (...args: unknown[]) => listProjectRuns(...args),
  publishDaemonRunFinishedEvent: (...args: unknown[]) => publishDaemonRunFinishedEvent(...args),
  reattachDaemonRun: (...args: unknown[]) => reattachDaemonRun(...args),
  streamViaDaemon: (...args: unknown[]) => streamViaDaemon(...args),
}));

vi.mock('../../src/providers/project-events', () => ({
  useProjectFileEvents: vi.fn(),
}));

// Only `playSound` is replaced — `showCompletionNotification` runs for real
// so the desktop cardinality assertions exercise the actual permission
// check in `src/utils/notifications.ts`, not a stand-in.
vi.mock('../../src/utils/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/notifications')>()),
  playSound: (...args: unknown[]) => playSound(...args),
}));

vi.mock('../../src/providers/registry', () => ({
  deletePreviewComment: vi.fn(),
  fetchPreviewComments: (...args: unknown[]) => fetchPreviewComments(...args),
  fetchDesignSystem: (...args: unknown[]) => fetchDesignSystem(...args),
  fetchLiveArtifacts: (...args: unknown[]) => fetchLiveArtifacts(...args),
  fetchProjectFiles: (...args: unknown[]) => fetchProjectFiles(...args),
  fetchSkill: (...args: unknown[]) => fetchSkill(...args),
  patchPreviewCommentStatus: (...args: unknown[]) => patchPreviewCommentStatus(...args),
  upsertPreviewComment: vi.fn(),
  writeProjectTextFile: vi.fn(),
}));

vi.mock('../../src/router', () => ({
  navigate: vi.fn(),
}));

// INV-7.13 F-02 fixture (wave 7, spec-audit-r2 disposition SC 7B): the fixed
// visibility/permission/replay case this suite's canonical background-success
// case and its replay-guard case are driven from, per the fixture's own
// `_comment` and the disposition doc. Reused verbatim, not restated inline.
const __dirname = dirname(fileURLToPath(import.meta.url));
const { webDecisionScenario } = JSON.parse(
  readFileSync(
    pathResolve(__dirname, '../../../daemon/tests/fixtures/w7-run/terminal-end-event.json'),
    'utf8',
  ),
) as {
  webDecisionScenario: {
    documentHidden: boolean;
    documentFocused: boolean;
    desktopPermission: NotificationPermission;
    replayDeliveryCount: number;
  };
};

vi.mock('../../src/state/projects', () => ({
  createConversation: (...args: unknown[]) => createConversation(...args),
  deleteConversation: vi.fn(),
  getTemplate: (...args: unknown[]) => getTemplate(...args),
  listConversations: (...args: unknown[]) => listConversations(...args),
  listMessages: (...args: unknown[]) => listMessages(...args),
  loadTabs: (...args: unknown[]) => loadTabs(...args),
  patchConversation: (...args: unknown[]) => patchConversation(...args),
  patchProject: (...args: unknown[]) => patchProject(...args),
  saveMessage: (...args: unknown[]) => saveMessage(...args),
  saveTabs: (...args: unknown[]) => saveTabs(...args),
  cacheTabsLocally: (_projectId: string, state: unknown) => state,
  persistTabsToDaemonNow: vi.fn(),
}));

vi.mock('../../src/components/AppChromeHeader', () => ({
  AppChromeHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));

vi.mock('../../src/components/AvatarMenu', () => ({
  AvatarMenu: () => null,
}));

vi.mock('../../src/components/FileWorkspace', () => ({
  DESIGN_SYSTEM_TAB: '__design_system__',
  FileWorkspace: ({ streaming }: { streaming: boolean }) => (
    <output data-testid="workspace-streaming-state">{streaming ? 'streaming' : 'idle'}</output>
  ),
}));

vi.mock('../../src/components/Loading', () => ({
  CenteredLoader: () => null,
}));

vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: ({
    activeConversationId,
    conversations,
    streaming,
    sendDisabled,
    onSelectConversation,
    onSend,
    onNewConversation,
    error,
  }: {
    activeConversationId: string | null;
    conversations: Conversation[];
    streaming: boolean;
    sendDisabled?: boolean;
    error: string | null;
    onSelectConversation: (id: string) => void;
    onSend: (prompt: string, attachments: unknown[], commentAttachments: unknown[]) => void;
    onNewConversation: () => void;
  }) => (
    <section>
      <output data-testid="active-conversation">{activeConversationId}</output>
      <output data-testid="streaming-state">{streaming ? 'streaming' : 'idle'}</output>
      <output data-testid="chat-error">{error}</output>
      {conversations.map((conversation) => (
        <button
          key={conversation.id}
          type="button"
          data-testid={`conversation-select-${conversation.id}`}
          onClick={() => onSelectConversation(conversation.id)}
        >
          {conversation.id}
        </button>
      ))}
      <button
        type="button"
        data-testid="send-message"
        onClick={() => onSend('hello', [], [])}
        disabled={sendDisabled}
      >
        send
      </button>
      <button type="button" data-testid="new-conversation" onClick={onNewConversation}>
        new
      </button>
    </section>
  ),
}));

const config: AppConfig = {
  mode: 'daemon',
  apiKey: '',
  baseUrl: '',
  model: '',
  agentId: 'agent-1',
  agentModels: {},
  skillId: null,
  designSystemId: null,
  notifications: {
    soundEnabled: true,
    successSoundId: 'success-sound',
    failureSoundId: 'failure-sound',
    desktopEnabled: false,
  },
};

const project: Project = {
  id: 'project-1',
  name: 'Project',
  skillId: null,
  designSystemId: null,
  createdAt: 1,
  updatedAt: 1,
};

const conversations: Conversation[] = [
  { id: 'conv-a', projectId: project.id, title: 'A', createdAt: 1, updatedAt: 1 },
  { id: 'conv-b', projectId: project.id, title: 'B', createdAt: 1, updatedAt: 1 },
];

const runningAssistant: ChatMessage = {
  id: 'assistant-a',
  role: 'assistant',
  content: 'still running',
  createdAt: 1,
  runId: 'run-a',
  runStatus: 'running',
};

const succeededAssistant: ChatMessage = {
  ...runningAssistant,
  content: 'done',
  runStatus: 'succeeded',
  endedAt: 2,
};

const failedAssistant: ChatMessage = {
  ...runningAssistant,
  content: 'went wrong',
  runStatus: 'failed',
  endedAt: 2,
};

/** Fake `Notification` global — jsdom ships none. Records every instance so
 * the desktop cardinality assertions can count real construction attempts
 * instead of a mocked call count. */
class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    public title: string,
    public options?: NotificationOptions,
  ) {
    FakeNotification.instances.push(this);
  }
  close(): void {}
}

function desktopShownCount(): number {
  return FakeNotification.instances.length;
}

describe('ProjectView completion notifications (INV-7.4)', () => {
  let resolveConversationBMessages: ((messages: ChatMessage[]) => void) | null = null;
  let conversationAMessages: ChatMessage[] = [runningAssistant];

  beforeEach(() => {
    window.localStorage.clear();
    resolveConversationBMessages = null;
    conversationAMessages = [runningAssistant];
    FakeNotification.instances = [];
    FakeNotification.permission = 'granted';
    vi.stubGlobal('Notification', FakeNotification);
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });

    listConversations.mockResolvedValue(conversations);
    listMessages.mockImplementation(async (_projectId: string, conversationId: string) => {
      if (conversationId === 'conv-a') return conversationAMessages;
      if (conversationId === 'conv-b') {
        return new Promise<ChatMessage[]>((resolve) => {
          resolveConversationBMessages = resolve;
        });
      }
      return new Promise<ChatMessage[]>(() => {});
    });
    createConversation.mockResolvedValue({
      id: 'conv-c',
      projectId: project.id,
      title: null,
      createdAt: 2,
      updatedAt: 2,
    });
    fetchPreviewComments.mockResolvedValue([] as PreviewComment[]);
    loadTabs.mockResolvedValue({ tabs: [], active: null });
    fetchProjectFiles.mockResolvedValue([]);
    fetchLiveArtifacts.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    listActiveChatRuns.mockResolvedValue([]);
    listProjectRuns.mockResolvedValue([]);
    fetchChatRunStatus.mockResolvedValue({
      id: 'run-a',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
      exitCode: null,
      signal: null,
    });
    reattachDaemonRun.mockImplementation(async () => new Promise<void>(() => {}));
    fetchVelaLoginStatus.mockResolvedValue({ loggedIn: false });
    fetchAmrWalletSnapshot.mockResolvedValue({
      status: 'available',
      profile: 'prod',
      user: null,
      balanceUsd: '10.00',
      updatedAt: null,
      fetchedAt: '2026-07-02T00:00:00.000Z',
      stale: false,
      source: 'vela_api',
    });
    launchAntigravityOauth.mockResolvedValue({ ok: true });
    streamViaDaemon.mockImplementation(async () => {});
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  function setVisibility(hidden: boolean, focused: boolean): void {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });
    vi.spyOn(document, 'hasFocus').mockReturnValue(focused);
  }

  /** Renders, then drives the conv-a -> conv-b -> conv-a cycle the existing
   * run-isolation suite uses to force a fresh `listMessages('conv-a')` load
   * carrying `terminalMessage` in place of the initial `runningAssistant` —
   * the "previously observed active, now terminal" transition INV-7.4 gates
   * on. Returns once the transition's re-render has settled. */
  async function deliverTerminalMessage(
    renderConfig: AppConfig,
    terminalMessage: ChatMessage,
  ): Promise<void> {
    render(
      <ProjectView
        project={project}
        routeFileName={null}
        config={renderConfig}
        agents={[{ id: 'agent-1', name: 'OpenCode', bin: 'opencode', available: true, models: [] }] as AgentInfo[]}
        skills={[]}
        designTemplates={[]}
        designSystems={[]}
        daemonLive
        onModeChange={() => {}}
        onAgentChange={() => {}}
        onAgentModelChange={() => {}}
        onRefreshAgents={() => {}}
        onOpenSettings={() => {}}
        onOpenAmrSettings={undefined}
        onBack={() => {}}
        onClearPendingPrompt={() => {}}
        onTouchProject={() => {}}
        onProjectChange={() => {}}
        onProjectsRefresh={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('active-conversation').textContent).toBe('conv-a'));
    await waitFor(() => expect(screen.getByTestId('streaming-state').textContent).toBe('streaming'));

    fireEvent.click(screen.getByTestId('conversation-select-conv-b'));
    await waitFor(() => expect(screen.getByTestId('active-conversation').textContent).toBe('conv-b'));
    if (!resolveConversationBMessages) throw new Error('Expected conv-b message load to be pending');
    resolveConversationBMessages([]);
    await waitFor(() => expect(screen.getByTestId('streaming-state').textContent).toBe('idle'));

    conversationAMessages = [terminalMessage];
    fireEvent.click(screen.getByTestId('conversation-select-conv-a'));
    await waitFor(() => expect(screen.getByTestId('active-conversation').textContent).toBe('conv-a'));
  }

function withNotifications(overrides: Partial<NotificationsConfig>): AppConfig {
  return {
    ...config,
    notifications: { ...(config.notifications as NotificationsConfig), ...overrides },
  };
}

  it('plays sound and shows a desktop notification exactly once for a background terminal success', async () => {
    FakeNotification.permission = webDecisionScenario.desktopPermission;
    setVisibility(webDecisionScenario.documentHidden, webDecisionScenario.documentFocused);
    await deliverTerminalMessage(
      withNotifications({ desktopEnabled: true }),
      succeededAssistant,
    );

    await waitFor(() => expect(playSound).toHaveBeenCalledWith('success-sound'));
    await waitFor(() => expect(desktopShownCount()).toBe(1));
  });

  it('does not show a second desktop notification when the same terminal message replays', async () => {
    FakeNotification.permission = webDecisionScenario.desktopPermission;
    setVisibility(webDecisionScenario.documentHidden, webDecisionScenario.documentFocused);
    const renderConfig = withNotifications({ desktopEnabled: true });
    await deliverTerminalMessage(renderConfig, succeededAssistant);
    await waitFor(() => expect(desktopShownCount()).toBe(1));

    // Redeliver the identical terminal message (same runId/message id) —
    // simulates the daemon or a reload replaying the same terminal frame.
    // `webDecisionScenario.replayDeliveryCount` counts the initial delivery
    // above plus every redelivery below, so a fixture value of 2 redelivers
    // once.
    for (let delivered = 1; delivered < webDecisionScenario.replayDeliveryCount; delivered += 1) {
      fireEvent.click(screen.getByTestId('conversation-select-conv-b'));
      await waitFor(() => expect(screen.getByTestId('active-conversation').textContent).toBe('conv-b'));
      conversationAMessages = [succeededAssistant];
      fireEvent.click(screen.getByTestId('conversation-select-conv-a'));
      await waitFor(() => expect(screen.getByTestId('active-conversation').textContent).toBe('conv-a'));
    }

    await act(async () => {
      await Promise.resolve();
    });
    expect(desktopShownCount()).toBe(1);
    expect(playSound).toHaveBeenCalledTimes(1);
  });

  it('does not show a desktop notification for a focused success', async () => {
    setVisibility(false, true);
    await deliverTerminalMessage(
      withNotifications({ desktopEnabled: true }),
      succeededAssistant,
    );

    await waitFor(() => expect(playSound).toHaveBeenCalledWith('success-sound'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(desktopShownCount()).toBe(0);
  });

  it('shows a desktop notification for a foreground failure (the deliberate clause)', async () => {
    setVisibility(false, true);
    await deliverTerminalMessage(
      withNotifications({ desktopEnabled: true }),
      failedAssistant,
    );

    await waitFor(() => expect(playSound).toHaveBeenCalledWith('failure-sound'));
    await waitFor(() => expect(desktopShownCount()).toBe(1));
  });

  it('does not show a desktop notification when permission is denied', async () => {
    FakeNotification.permission = 'denied';
    setVisibility(true, false);
    await deliverTerminalMessage(
      withNotifications({ desktopEnabled: true }),
      succeededAssistant,
    );

    await waitFor(() => expect(playSound).toHaveBeenCalledWith('success-sound'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(desktopShownCount()).toBe(0);
  });

  it('does not show a desktop notification when the desktop setting is disabled', async () => {
    setVisibility(true, false);
    await deliverTerminalMessage(
      withNotifications({ desktopEnabled: false }),
      succeededAssistant,
    );

    await waitFor(() => expect(playSound).toHaveBeenCalledWith('success-sound'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(desktopShownCount()).toBe(0);
  });
});
