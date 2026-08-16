// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectView } from '../../src/components/ProjectView';
import { useIframeKeepAlivePool } from '../../src/components/IframeKeepAlivePool';
import type {
  AgentInfo,
  AppConfig,
  Conversation,
  DesignSystemSummary,
  Project,
  SkillSummary,
} from '../../src/types';
import {
  createConversation,
  listConversations,
  listMessages,
  loadTabs,
} from '../../src/state/projects';
import { fetchPreviewComments } from '../../src/providers/registry';

vi.mock('../../src/i18n', () => ({
  useT: () => (key: string) => key,
  useI18n: () => ({
    t: (key: string) => key,
    locale: 'en',
    setLocale: () => {},
  }),
}));

vi.mock('../../src/router', () => ({
  navigate: vi.fn(),
}));

vi.mock('../../src/components/IframeKeepAlivePool', async () => {
  const actual = await vi.importActual<typeof import('../../src/components/IframeKeepAlivePool')>(
    '../../src/components/IframeKeepAlivePool',
  );
  return {
    ...actual,
    useIframeKeepAlivePool: vi.fn(),
  };
});

vi.mock('../../src/providers/anthropic', () => ({
  streamMessage: vi.fn(),
}));

vi.mock('../../src/providers/daemon', () => ({
  fetchChatRunStatus: vi.fn(),
  listActiveChatRuns: vi.fn().mockResolvedValue([]),
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
    fetchDesignSystem: vi.fn(),
    fetchLiveArtifacts: vi.fn().mockResolvedValue([]),
    fetchPreviewComments: vi.fn(),
    fetchProjectFiles: vi.fn().mockResolvedValue([]),
    fetchSkill: vi.fn(),
    getTemplate: vi.fn(),
    patchPreviewCommentStatus: vi.fn(),
    upsertPreviewComment: vi.fn(),
    writeProjectTextFile: vi.fn(),
  };
});

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  return {
    ...actual,
    createConversation: vi.fn(),
    listConversations: vi.fn(),
    listMessages: vi.fn(),
    loadTabs: vi.fn(),
    patchConversation: vi.fn(),
    patchProject: vi.fn(),
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

// Exposes the `onCommentModeChange` callback ProjectView wires into
// FileWorkspace as a plain test button, instead of driving the real
// (heavyweight) FileWorkspace UI just to flip that one boolean. The divider
// swap under test lives entirely in ProjectView's own JSX, as a sibling of
// FileWorkspace, so this is sufficient to observe it.
vi.mock('../../src/components/FileWorkspace', () => ({
  DESIGN_SYSTEM_TAB: '__design_system__',
  FileWorkspace: ({ onCommentModeChange }: { onCommentModeChange?: (active: boolean) => void }) => (
    <div data-testid="file-workspace">
      <button type="button" data-testid="toggle-comment-mode-on" onClick={() => onCommentModeChange?.(true)}>
        on
      </button>
      <button type="button" data-testid="toggle-comment-mode-off" onClick={() => onCommentModeChange?.(false)}>
        off
      </button>
    </div>
  ),
}));

vi.mock('../../src/components/Loading', () => ({
  CenteredLoader: () => <div data-testid="loader" />,
}));

vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: () => <div data-testid="chat-pane" />,
}));

const mockedUseIframeKeepAlivePool = vi.mocked(useIframeKeepAlivePool);
const mockedListConversations = vi.mocked(listConversations);
const mockedCreateConversation = vi.mocked(createConversation);
const mockedListMessages = vi.mocked(listMessages);
const mockedLoadTabs = vi.mocked(loadTabs);
const mockedFetchPreviewComments = vi.mocked(fetchPreviewComments);

const config: AppConfig = {
  mode: 'api',
  apiKey: '',
  baseUrl: '',
  model: '',
  agentId: null,
  skillId: null,
  designSystemId: null,
};

const project: Project = {
  id: 'project-1',
  name: 'Project 1',
  skillId: 'skill-1',
  designSystemId: 'ds-1',
  createdAt: 1,
  updatedAt: 1,
};

const conversation: Conversation = {
  id: 'conv-1',
  projectId: project.id,
  title: null,
  createdAt: 1,
  updatedAt: 1,
};

const skill: SkillSummary = {
  id: 'skill-1',
  name: 'Prompt skill',
  description: 'Prompt context',
  triggers: ['prompt'],
  mode: 'prototype',
  previewType: 'html',
  designSystemRequired: false,
  defaultFor: [],
  upstream: null,
  hasBody: true,
  examplePrompt: 'Create a prototype.',
  aggregatesExamples: false,
};

const designSystem: DesignSystemSummary = {
  id: 'ds-1',
  title: 'Design System',
  category: 'product',
  summary: 'System context',
};

function renderProjectView() {
  return render(
    <ProjectView
      project={project}
      routeFileName={null}
      config={config}
      agents={[] as AgentInfo[]}
      skills={[skill]}
      designTemplates={[] as SkillSummary[]}
      designSystems={[designSystem]}
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

describe('ProjectView manual-edit split divider', () => {
  beforeEach(() => {
    mockedUseIframeKeepAlivePool.mockReturnValue({
      attach: vi.fn(),
      release: vi.fn(),
      evict: vi.fn(),
      evictProject: vi.fn(),
      evictMatching: vi.fn(),
    });
    mockedListConversations.mockResolvedValue([conversation]);
    mockedCreateConversation.mockResolvedValue(conversation);
    mockedListMessages.mockResolvedValue([]);
    mockedLoadTabs.mockResolvedValue({ tabs: [], active: null });
    mockedFetchPreviewComments.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the draggable resize handle (not the fixed divider) before comment/manual-edit mode activates', async () => {
    const { container } = renderProjectView();

    await waitFor(() => {
      expect(container.querySelector('.split-resize-handle')).toBeTruthy();
    });
    expect(container.querySelector('.split-edit-divider')).toBeNull();
    expect(container.querySelector('.split-resize-handle')?.getAttribute('role')).toBe('separator');
    expect(container.querySelector('.split')?.className).not.toContain('split-manual-edit');
  });

  it('swaps the resize handle for a fixed, non-interactive divider when the left inspector activates', async () => {
    const { container, getByTestId } = renderProjectView();

    await waitFor(() => {
      expect(container.querySelector('.split-resize-handle')).toBeTruthy();
    });

    fireEvent.click(getByTestId('toggle-comment-mode-on'));

    await waitFor(() => {
      expect(container.querySelector('.split-resize-handle')).toBeNull();
    });
    const divider = container.querySelector('.split-edit-divider');
    expect(divider).toBeTruthy();
    // Fixed, not a resize affordance: no separator role, no drag handlers.
    expect(divider?.getAttribute('role')).not.toBe('separator');
    expect(divider?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.split')?.className).toContain('split-manual-edit');
  });

  it('restores the draggable resize handle when the left inspector deactivates again', async () => {
    const { container, getByTestId } = renderProjectView();

    await waitFor(() => {
      expect(container.querySelector('.split-resize-handle')).toBeTruthy();
    });

    fireEvent.click(getByTestId('toggle-comment-mode-on'));
    await waitFor(() => {
      expect(container.querySelector('.split-edit-divider')).toBeTruthy();
    });

    fireEvent.click(getByTestId('toggle-comment-mode-off'));
    await waitFor(() => {
      expect(container.querySelector('.split-resize-handle')).toBeTruthy();
    });
    expect(container.querySelector('.split-edit-divider')).toBeNull();
    expect(container.querySelector('.split')?.className).not.toContain('split-manual-edit');
  });
});
