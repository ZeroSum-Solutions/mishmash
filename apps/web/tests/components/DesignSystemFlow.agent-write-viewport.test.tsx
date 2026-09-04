// @vitest-environment jsdom
//
// Red spec for B-09 on the design-system surface ("View jumps to a split page
// of gibberish while the agent works", ux-error-log 2026-08-27).
//
// `ProjectView` routes every agent-driven open through
// `agentWriteMayFocusFile` (`ProjectView.tsx`, `requestAgentWriteOpenFile`).
// `DesignSystemFlow` owns a second copy of the same streaming handler, so the
// invariant has to hold here too: while the user reads one workspace file, a
// successful file-write `tool_result` for a different file must not move them.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesignSystemDetailView } from '../../src/components/DesignSystemFlow';
import type {
  AppConfig,
  DesignSystemDetail,
  OpenTabsState,
  Project,
  ProjectFile,
} from '../../src/types';

const mocks = vi.hoisted(() => ({
  ensureDesignSystemWorkspace: vi.fn(),
  fetchConnectorStatuses: vi.fn(),
  fetchDesignSystem: vi.fn(),
  fetchDesignSystemRevisions: vi.fn(),
  fetchProjectDesignSystemPackageAudit: vi.fn(),
  fetchProjectFiles: vi.fn(),
  createConversation: vi.fn(),
  getProject: vi.fn(),
  getProjectDetail: vi.fn(),
  listConversations: vi.fn(),
  listMessages: vi.fn(),
  loadTabs: vi.fn(),
  patchConversation: vi.fn(),
  patchProject: vi.fn(),
  saveMessage: vi.fn(),
  saveTabs: vi.fn(),
  streamViaDaemon: vi.fn(),
}));

vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: ({
    onSend,
    onRequestOpenFile,
  }: {
    onSend: (prompt: string, attachments: unknown[], commentAttachments: unknown[]) => void;
    onRequestOpenFile?: (name: string) => void;
  }) => (
    <>
      <button
        type="button"
        data-testid="chat-open-file"
        onClick={() => onRequestOpenFile?.('index.html')}
      >
        open file
      </button>
      <button
        type="button"
        data-testid="design-system-chat-send"
        onClick={() => onSend('Update the design tokens', [], [])}
      >
        send
      </button>
    </>
  ),
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
  }: {
    tabsState: OpenTabsState;
    onTabsStateChange: (state: OpenTabsState) => void;
    openRequest?: { name: string; nonce: number } | null;
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
      <div data-testid="design-system-files">
        <output data-testid="workspace-active-tab">{tabsState.active ?? ''}</output>
        <output data-testid="workspace-open-request">{openRequest?.name ?? ''}</output>
      </div>
    );
  },
}));

vi.mock('../../src/providers/daemon', () => ({
  streamViaDaemon: (...args: unknown[]) => mocks.streamViaDaemon(...args),
}));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    ensureDesignSystemWorkspace: mocks.ensureDesignSystemWorkspace,
    fetchConnectorStatuses: mocks.fetchConnectorStatuses,
    fetchDesignSystem: mocks.fetchDesignSystem,
    fetchDesignSystemRevisions: mocks.fetchDesignSystemRevisions,
    fetchProjectDesignSystemPackageAudit: mocks.fetchProjectDesignSystemPackageAudit,
    fetchProjectFiles: mocks.fetchProjectFiles,
  };
});

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  return {
    ...actual,
    createConversation: mocks.createConversation,
    getProject: mocks.getProject,
    getProjectDetail: mocks.getProjectDetail,
    listConversations: mocks.listConversations,
    listMessages: mocks.listMessages,
    loadTabs: mocks.loadTabs,
    patchConversation: mocks.patchConversation,
    patchProject: mocks.patchProject,
    saveMessage: mocks.saveMessage,
    saveTabs: mocks.saveTabs,
  };
});

const system: DesignSystemDetail = {
  id: 'user:acme-design-system',
  title: 'Acme Design System',
  category: 'Custom',
  summary: 'Acme product workspace.',
  swatches: [],
  surface: 'web',
  body: '# Acme Design System\n',
  source: 'user',
  status: 'draft',
  isEditable: true,
  projectId: 'ds-acme-design-system',
};

const project: Project = {
  id: 'ds-acme-design-system',
  name: 'Acme Design System',
  skillId: null,
  designSystemId: system.id,
  createdAt: 1,
  updatedAt: 1,
  metadata: {
    kind: 'other',
    importedFrom: 'design-system',
    entryFile: 'DESIGN.md',
    sourceFileName: system.id,
  },
};

const indexPage: ProjectFile = {
  name: 'index.html',
  path: 'index.html',
  type: 'file',
  size: 100,
  mtime: 1_000,
  kind: 'html',
  mime: 'text/html',
};

const brandSpec: ProjectFile = {
  name: 'brand-spec.md',
  path: 'brand-spec.md',
  type: 'file',
  size: 100,
  mtime: 2_000,
  kind: 'text',
  mime: 'text/markdown',
};

const config: AppConfig = {
  mode: 'daemon',
  apiKey: '',
  baseUrl: '',
  model: '',
  agentId: 'agent-1',
  agentModels: {},
  skillId: null,
  designSystemId: null,
};

function renderDetailView() {
  return render(
    <DesignSystemDetailView
      id={system.id}
      selectedId={system.id}
      config={config}
      agents={[{ id: 'agent-1', name: 'OpenCode', bin: 'opencode', available: true, models: [] }]}
      onBack={() => {}}
      onSetDefault={() => {}}
    />,
  );
}

describe('design-system agent file writes and the user viewport (B-09)', () => {
  beforeEach(() => {
    mocks.ensureDesignSystemWorkspace.mockResolvedValue({
      project,
      files: [indexPage, brandSpec],
    });
    mocks.fetchConnectorStatuses.mockResolvedValue({});
    mocks.fetchDesignSystem.mockResolvedValue(system);
    mocks.fetchDesignSystemRevisions.mockResolvedValue([]);
    mocks.fetchProjectDesignSystemPackageAudit.mockResolvedValue(null);
    mocks.fetchProjectFiles.mockResolvedValue([indexPage, brandSpec]);
    mocks.createConversation.mockResolvedValue(null);
    mocks.getProject.mockResolvedValue(project);
    mocks.getProjectDetail.mockResolvedValue(null);
    mocks.listConversations.mockResolvedValue([
      {
        id: 'conv-design-system',
        projectId: project.id,
        title: 'Design system',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    mocks.listMessages.mockResolvedValue([]);
    mocks.loadTabs.mockResolvedValue({ tabs: [], active: null });
    mocks.patchConversation.mockResolvedValue(null);
    mocks.patchProject.mockResolvedValue(null);
    mocks.saveMessage.mockResolvedValue(null);
    mocks.saveTabs.mockResolvedValue(null);
    mocks.streamViaDaemon.mockImplementation(async () => {});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it('keeps the user on their file when the agent writes a different one', async () => {
    mocks.streamViaDaemon.mockImplementation(
      async (options: {
        handlers: {
          onAgentEvent: (event: Record<string, unknown>) => void;
        };
      }) => {
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
      },
    );

    renderDetailView();
    await screen.findByText('Acme Design System');

    // The user opens a file for themselves and lands on the Files tab, so the
    // workspace they are looking at is `index.html`.
    fireEvent.click(await screen.findByTestId('chat-open-file'));
    await waitFor(() =>
      expect(screen.getByTestId('workspace-active-tab').textContent).toBe('index.html'),
    );

    const refreshesBefore = mocks.fetchProjectFiles.mock.calls.length;
    fireEvent.click(screen.getByTestId('design-system-chat-send'));

    // The write path refetches the file list before it decides what to focus;
    // waiting on that refetch means the decision has been made by the time we
    // assert, so a passing assertion is not just a race we won.
    await waitFor(() =>
      expect(mocks.fetchProjectFiles.mock.calls.length).toBeGreaterThan(refreshesBefore),
    );
    await waitFor(() => expect(mocks.saveMessage).toHaveBeenCalled());

    expect(screen.getByTestId('workspace-active-tab').textContent).toBe('index.html');
    expect(screen.getByTestId('workspace-open-request').textContent).not.toBe('brand-spec.md');
  });

  it('still opens an agent-written file when the user has no view of their own', async () => {
    mocks.streamViaDaemon.mockImplementation(
      async (options: {
        handlers: {
          onAgentEvent: (event: Record<string, unknown>) => void;
        };
      }) => {
        const { handlers } = options;
        handlers.onAgentEvent({
          kind: 'tool_use',
          id: 'tool-1',
          name: 'Write',
          input: { file_path: 'brand-spec.md' },
        });
        handlers.onAgentEvent({
          kind: 'tool_result',
          toolUseId: 'tool-1',
          content: 'ok',
          isError: false,
        });
      },
    );

    renderDetailView();
    await screen.findByText('Acme Design System');

    // Files tab, but nothing opened: the state a fresh design system sits in
    // before its first generation, where the agent's file has no view to steal.
    fireEvent.click(screen.getByRole('button', { name: 'Design Files' }));
    await waitFor(() =>
      expect(screen.getByTestId('workspace-active-tab').textContent).toBe(''),
    );

    fireEvent.click(screen.getByTestId('design-system-chat-send'));

    await waitFor(() =>
      expect(screen.getByTestId('workspace-open-request').textContent).toBe('brand-spec.md'),
    );
  });
});
