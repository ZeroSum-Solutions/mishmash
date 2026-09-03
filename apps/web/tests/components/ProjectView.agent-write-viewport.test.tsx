// @vitest-environment jsdom
//
// Red spec for B-09 ("View jumps to a split page of gibberish while the agent
// works", ux-error-log 2026-08-27, two incidents).
//
// Three properties the project view must hold while an agent writes files:
//   1. An agent file write never changes which file the user is looking at.
//   2. A burst of `file-changed` events refreshes the file list once, when the
//      write settles — not once per intermediate unlink/add/change.
//   3. While a write is landing and the refreshed list is being fetched, the
//      workspace is told a preview update is in flight so it can show progress
//      instead of the user seeing an unexplained jump.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectView } from '../../src/components/ProjectView';
import { streamViaDaemon } from '../../src/providers/daemon';
import type { DaemonStreamOptions } from '../../src/providers/daemon';
import { useProjectFileEvents } from '../../src/providers/project-events';
import type { ProjectEvent } from '../../src/providers/project-events';
import { fetchProjectFiles } from '../../src/providers/registry';
import { listMessages, loadTabs } from '../../src/state/projects';
import type {
  AgentInfo,
  AppConfig,
  Conversation,
  DesignSystemSummary,
  Project,
  ProjectFile,
  SkillSummary,
} from '../../src/types';

vi.mock('../../src/router', () => ({
  navigate: vi.fn(),
}));

vi.mock('../../src/providers/anthropic', () => ({
  streamMessage: vi.fn(),
}));

vi.mock('../../src/providers/daemon', () => ({
  fetchChatRunStatus: vi.fn(),
  listActiveChatRuns: vi.fn().mockResolvedValue([]),
  listProjectRuns: vi.fn().mockResolvedValue([]),
  publishDaemonRunFinishedEvent: vi.fn(),
  reattachDaemonRun: vi.fn(),
  streamViaDaemon: vi.fn(),
}));

vi.mock('../../src/providers/project-events', () => ({
  useProjectFileEvents: vi.fn(),
}));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    deletePreviewComment: vi.fn(),
    fetchDesignSystem: vi.fn().mockResolvedValue(null),
    fetchLiveArtifacts: vi.fn().mockResolvedValue([]),
    fetchPreviewComments: vi.fn().mockResolvedValue([]),
    fetchProjectFilePreview: vi.fn().mockResolvedValue(null),
    fetchProjectFileText: vi.fn().mockResolvedValue(null),
    fetchProjectFiles: vi.fn().mockResolvedValue([]),
    fetchSkill: vi.fn().mockResolvedValue(null),
    patchPreviewCommentStatus: vi.fn(),
    upsertPreviewComment: vi.fn(),
    writeProjectTextFile: vi.fn(),
  };
});

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  const mockConversation = (projectId: string): Conversation => ({
    id: `conv-${projectId}`,
    projectId,
    title: null,
    createdAt: 1,
    updatedAt: 1,
  });
  return {
    ...actual,
    cacheTabsLocally: vi.fn(
      (_projectId: string, state: { tabs: string[]; active: string | null }) => state,
    ),
    createConversation: vi
      .fn()
      .mockImplementation(async (projectId: string) => mockConversation(projectId)),
    deleteConversation: vi.fn(),
    listConversations: vi
      .fn()
      .mockImplementation(async (projectId: string) => [mockConversation(projectId)]),
    listMessages: vi.fn().mockResolvedValue([]),
    loadTabs: vi.fn(),
    patchConversation: vi.fn(),
    patchProject: vi.fn(),
    persistTabsToDaemonNow: vi.fn(),
    saveMessage: vi.fn(),
    saveTabs: vi.fn(),
  };
});

vi.mock('../../src/components/AppChromeHeader', () => ({
  AppChromeHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));

vi.mock('../../src/components/AvatarMenu', () => ({
  AvatarMenu: () => null,
}));

// Stands in for the real workspace: it applies an open request exactly the way
// FileWorkspace does (add the tab, focus it) so `workspace-active-tab` is the
// file the user is actually looking at.
vi.mock('../../src/components/FileWorkspace', () => ({
  DESIGN_SYSTEM_TAB: '__design_system__',
  FileWorkspace: ({
    tabsState,
    onTabsStateChange,
    openRequest,
    previewUpdating,
  }: {
    tabsState: { tabs: string[]; active: string | null };
    onTabsStateChange: (state: { tabs: string[]; active: string | null }) => void;
    openRequest?: { name: string; nonce: number } | null;
    previewUpdating?: boolean;
  }) => {
    useEffect(() => {
      if (!openRequest?.name) return;
      if (tabsState.active === openRequest.name && tabsState.tabs.includes(openRequest.name)) return;
      const tabs = tabsState.tabs.includes(openRequest.name)
        ? tabsState.tabs
        : [...tabsState.tabs, openRequest.name];
      onTabsStateChange({ tabs, active: openRequest.name });
    }, [onTabsStateChange, openRequest?.name, openRequest?.nonce, tabsState.tabs]);
    return (
      <div data-testid="file-workspace">
        <output data-testid="workspace-active-tab">{tabsState.active ?? ''}</output>
        <output data-testid="workspace-open-request">{openRequest?.name ?? ''}</output>
        <output data-testid="workspace-preview-updating">{previewUpdating ? 'true' : 'false'}</output>
      </div>
    );
  },
}));

vi.mock('../../src/components/Loading', () => ({
  CenteredLoader: () => <div data-testid="loader" />,
}));

vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: ({ onSend }: { onSend: (prompt: string, a: never[], c: never[]) => void }) => (
    <button type="button" onClick={() => onSend('Update the brand spec', [], [])}>
      send
    </button>
  ),
}));

const mockedStreamViaDaemon = vi.mocked(streamViaDaemon);
const mockedUseProjectFileEvents = vi.mocked(useProjectFileEvents);
const mockedFetchProjectFiles = vi.mocked(fetchProjectFiles);
const mockedListMessages = vi.mocked(listMessages);
const mockedLoadTabs = vi.mocked(loadTabs);

const config: AppConfig = {
  mode: 'api',
  apiProtocol: 'openai',
  apiKey: 'sk-test',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  agentId: null,
  skillId: null,
  designSystemId: null,
};

const project: Project = {
  id: 'project-1',
  name: 'Project',
  skillId: null,
  designSystemId: null,
  createdAt: 1,
  updatedAt: 1,
};

const gallery: ProjectFile = {
  name: 'gallery.html',
  path: 'gallery.html',
  type: 'file',
  size: 10,
  mtime: 1_000,
  mime: 'text/html',
  kind: 'html',
};

const brandSpec: ProjectFile = {
  name: 'brand-spec.md',
  path: 'brand-spec.md',
  type: 'file',
  size: 10,
  mtime: 2_000,
  mime: 'text/markdown',
  kind: 'text',
};

function renderProjectView() {
  return render(
    <ProjectView
      project={project}
      routeFileName={null}
      config={config}
      agents={[
        {
          id: 'byok-opencode',
          name: 'BYOK OpenCode',
          bin: 'opencode',
          available: true,
          models: [],
        } as AgentInfo,
      ]}
      skills={[] as SkillSummary[]}
      designTemplates={[] as SkillSummary[]}
      designSystems={[] as DesignSystemSummary[]}
      daemonLive
      onModeChange={vi.fn()}
      onAgentChange={vi.fn()}
      onAgentModelChange={vi.fn()}
      onRefreshAgents={vi.fn()}
      onOpenSettings={vi.fn()}
      onBack={vi.fn()}
      onClearPendingPrompt={vi.fn()}
      onTouchProject={vi.fn()}
      onProjectChange={vi.fn()}
      onProjectsRefresh={vi.fn()}
    />,
  );
}

/** The `onChange` callback ProjectView handed to the SSE hook this render. */
function latestProjectEventHandler(): (evt: ProjectEvent) => void {
  const call = mockedUseProjectFileEvents.mock.calls.at(-1);
  if (!call) throw new Error('useProjectFileEvents was never called');
  return call[2];
}

async function waitForProjectViewReady() {
  await waitFor(() => {
    expect(mockedListMessages).toHaveBeenCalledWith(project.id, 'conv-project-1');
  });
  await waitFor(() =>
    expect(screen.getByTestId('workspace-active-tab').textContent).toBe('gallery.html'),
  );
}

async function settle(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe('agent file writes and the user viewport (B-09)', () => {
  beforeEach(() => {
    mockedStreamViaDaemon.mockReset();
    mockedFetchProjectFiles.mockReset();
    mockedFetchProjectFiles.mockResolvedValue([gallery, brandSpec]);
    mockedLoadTabs.mockResolvedValue({
      tabs: ['gallery.html'],
      active: 'gallery.html',
      hasSavedState: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps the user on their file when the agent writes a different one', async () => {
    mockedStreamViaDaemon.mockImplementation(async (options: DaemonStreamOptions) => {
      const { handlers } = options;
      handlers.onAgentEvent({
        kind: 'tool_use',
        id: 'tool-1',
        name: 'Edit',
        input: { file_path: 'brand-spec.md' },
      });
      handlers.onAgentEvent({
        kind: 'tool_result',
        toolUseId: 'tool-1',
        content: 'ok',
        isError: false,
      });
    });

    renderProjectView();
    await waitForProjectViewReady();

    const refreshesBefore = mockedFetchProjectFiles.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'send' }));

    // The write path refetches the file list before it decides what to focus;
    // waiting on that refetch means the decision has been made by the time we
    // assert, so a passing assertion is not just a race we won.
    await waitFor(() =>
      expect(mockedFetchProjectFiles.mock.calls.length).toBeGreaterThan(refreshesBefore),
    );
    await settle(0);

    expect(screen.getByTestId('workspace-open-request').textContent).toBe('');
    expect(screen.getByTestId('workspace-active-tab').textContent).toBe('gallery.html');
  });

  it('refreshes the file list once when a write settles, not per intermediate event', async () => {
    renderProjectView();
    await waitForProjectViewReady();

    const onProjectEvent = latestProjectEventHandler();
    const refreshesBefore = mockedFetchProjectFiles.mock.calls.length;

    // A turn that rewrites several files. The daemon's watcher de-bounces per
    // file (`awaitWriteFinish`), so each settled write arrives as its own
    // unlink + add (+ change) burst, and a turn's bursts overlap into one run
    // of events.
    const burst: ProjectEvent[] = [
      { type: 'file-changed', path: 'brand-spec.md', kind: 'unlink' },
      { type: 'file-changed', path: 'brand-spec.md', kind: 'add' },
      ...Array.from({ length: 18 }, () => ({
        type: 'file-changed' as const,
        path: 'brand-spec.md',
        kind: 'change' as const,
      })),
    ];
    for (const evt of burst) {
      act(() => onProjectEvent(evt));
      await settle(40);
    }
    // Quiet: the write has settled.
    await settle(600);

    expect(mockedFetchProjectFiles.mock.calls.length - refreshesBefore).toBe(1);
  });

  it('tells the workspace a preview update is in flight while the write lands', async () => {
    renderProjectView();
    await waitForProjectViewReady();

    const onProjectEvent = latestProjectEventHandler();
    act(() =>
      onProjectEvent({ type: 'file-changed', path: 'brand-spec.md', kind: 'change' }),
    );
    await settle(0);

    expect(screen.getByTestId('workspace-preview-updating').textContent).toBe('true');

    await settle(600);
    await waitFor(() =>
      expect(screen.getByTestId('workspace-preview-updating').textContent).toBe('false'),
    );
  });
});
