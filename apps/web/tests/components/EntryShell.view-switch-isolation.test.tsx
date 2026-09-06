// @vitest-environment jsdom
//
// Every home-route switch re-rendered EntryShell and, with it, every view it
// keeps mounted behind `display: none`: TasksView, PluginsView, HomeView,
// DesignSystemsTab and LibrarySection reconciled their whole trees (about
// 4 ms of the ~20 ms route-switch budget in production, see the 3P
// attribution) without a DOM change. The shell must stop its render at the
// boundary of any view whose inputs did not change.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryShell } from '../../src/components/EntryShell';
import { I18nProvider } from '../../src/i18n';
import type { AgentInfo, AppConfig } from '../../src/types';

const renders = vi.hoisted(() => ({ home: 0, projects: 0, tasks: 0, plugins: 0, designSystems: 0, library: 0 }));

vi.mock('../../src/runtime/exports', () => ({ openSandboxedUrlInNewTab: vi.fn() }));
vi.mock('../../src/components/HomeView', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/components/HomeView')>()),
  HomeView: () => { renders.home += 1; return <div data-testid="stub-home-view" />; },
}));
vi.mock('../../src/components/DesignsTab', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/components/DesignsTab')>()),
  DesignsTab: () => { renders.projects += 1; return <div data-testid="stub-designs-tab" />; },
}));
vi.mock('../../src/components/TasksView', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/components/TasksView')>()),
  TasksView: () => { renders.tasks += 1; return <div data-testid="tasks-view" />; },
}));
vi.mock('../../src/components/PluginsView', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/components/PluginsView')>()),
  PluginsView: () => { renders.plugins += 1; return <div data-testid="stub-plugins-view" />; },
}));
vi.mock('../../src/components/DesignSystemsTab', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/components/DesignSystemsTab')>()),
  DesignSystemsTab: () => { renders.designSystems += 1; return <div data-testid="stub-design-systems" />; },
}));
vi.mock('../../src/components/LibrarySection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/components/LibrarySection')>()),
  LibrarySection: () => { renders.library += 1; return <div data-testid="stub-library" />; },
}));

class ResizeObserverMock { observe() {} disconnect() {} unobserve() {} }
class IntersectionObserverMock { observe() {} disconnect() {} unobserve() {} }
const originalFetch = globalThis.fetch;
const originalResizeObserver = globalThis.ResizeObserver;
const originalIntersectionObserver = globalThis.IntersectionObserver;

function cliAgent(): AgentInfo {
  return { id: 'claude-code', name: 'Claude Code', bin: 'claude', available: true, version: '1.0.0', models: [{ id: 'sonnet', label: 'Sonnet' }] };
}
function baseConfig(): AppConfig {
  return {
    mode: 'daemon', agentId: 'claude-code', agentModels: { 'claude-code': { model: 'sonnet' } }, apiProtocol: 'anthropic',
    apiProtocolConfigs: {}, apiKey: '', baseUrl: '', model: '', theme: 'system', onboardedAt: 1, skillId: '', designSystemId: null,
  } as AppConfig;
}

// Data props keep their identity across a parent render (state and memos in
// App); every callback is a fresh function on each call, because App
// subscribes to the route and re-renders on every switch with inline
// handlers and useCallbacks that depend on the route. This is what
// EntryShell receives in production.
const DATA = { skills: [], designTemplates: [], designSystems: [], projects: [], templates: [], promptTemplates: [], connectors: [], config: baseConfig(), agents: [cliAgent()] };
function freshProps(): React.ComponentProps<typeof EntryShell> {
  return {
    ...DATA,
    defaultDesignSystemId: null, connectorsLoading: false, daemonLive: true,
    onModeChange: vi.fn(), onAgentChange: vi.fn(), onAgentModelChange: vi.fn(), onApiProtocolChange: vi.fn(), onApiModelChange: vi.fn(),
    onConfigPersist: vi.fn(), onRefreshAgents: vi.fn(() => [cliAgent()]), onThemeChange: vi.fn(), onCreateProject: vi.fn(),
    onCreatePluginShareProject: vi.fn(), onImportClaudeDesign: vi.fn(), onOpenProject: vi.fn(), onOpenLiveArtifact: vi.fn(),
    onDeleteProject: vi.fn(), onRenameProject: vi.fn(), onChangeDefaultDesignSystem: vi.fn(), onPersistComposioKey: vi.fn(),
    onOpenSettings: vi.fn(), onCompleteOnboarding: vi.fn(), onDuplicateProject: vi.fn(), onProjectsRefresh: vi.fn(),
    onCreateDesignSystem: vi.fn(), onOpenDesignSystem: vi.fn(), onDesignSystemsRefresh: vi.fn(), onOpenProjectFromDesignLibrary: vi.fn(),
  };
}

const shell = (props: React.ComponentProps<typeof EntryShell>) => (
  <I18nProvider initial="en">
    <EntryShell {...props} />
  </I18nProvider>
);

let rerenderShell: ((ui: React.ReactElement) => void) | null = null;

function renderShellAt(path: string) {
  window.history.replaceState(null, '', path);
  rerenderShell = render(shell(freshProps())).rerender;
}

// A route switch as production delivers it: the parent re-renders with new
// callback identities, then the URL changes.
function switchTo(path: string) {
  act(() => {
    rerenderShell?.(shell(freshProps()));
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(window.location.pathname).toBe(path);
}

beforeEach(() => {
  renders.home = renders.projects = renders.tasks = renders.plugins = renders.designSystems = renders.library = 0;
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  globalThis.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.IntersectionObserver = originalIntersectionObserver;
  window.history.replaceState(null, '', '/');
});

describe('EntryShell view-switch isolation', () => {
  it('does not re-render the views it keeps mounted when the route switches between two other views', () => {
    renderShellAt('/plugins');
    expect(screen.getByTestId('entry-view-plugins').getAttribute('data-active')).toBe('true');
    const afterMount = { ...renders };
    expect(afterMount.tasks).toBeGreaterThan(0);
    expect(afterMount.projects).toBeGreaterThan(0);

    switchTo('/automations');
    expect(screen.getByTestId('entry-view-tasks').getAttribute('data-active')).toBe('true');
    switchTo('/plugins');
    switchTo('/automations');

    // Three switches with fresh parent callbacks each time, none of which
    // changed a data input or an active flag of these views: the shell
    // re-rendered, they must not have.
    const extraRenders = Object.fromEntries(Object.entries(renders).map(([k, v]) => [k, v - afterMount[k as keyof typeof afterMount]]));
    expect(extraRenders).toEqual({ home: 0, projects: 0, tasks: 0, plugins: 0, designSystems: 0, library: 0 });
  });

  it('resets the scroll position on a view switch only when the outgoing view was scrolled', () => {
    renderShellAt('/projects');
    const main = document.querySelector('main.entry-main--scroll') as HTMLElement;
    expect(main).toBeTruthy();
    const setScrollTop = vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set');
    try {
      // Writing scrollTop forces a style and layout pass on the just-mutated
      // document; a switch from an unscrolled view must not pay for it.
      switchTo('/plugins');
      expect(setScrollTop).not.toHaveBeenCalled();

      const getScrollTop = vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockReturnValue(240);
      act(() => {
        main.dispatchEvent(new Event('scroll'));
      });
      switchTo('/automations');
      expect(setScrollTop).toHaveBeenCalledWith(0);
      getScrollTop.mockRestore();
    } finally {
      setScrollTop.mockRestore();
    }
  });
});
