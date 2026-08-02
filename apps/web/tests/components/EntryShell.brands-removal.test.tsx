// @vitest-environment jsdom

/**
 * BUG-7: brands were merged into Design systems — `parseRoute` rewrites
 * `/brands` (and `/brands/:id`) to the design-systems view at parse time, so
 * the `brands` EntryHomeView could never render. Yet `BrandsTab` stayed
 * mounted inside EntryShell, running its effects (config fetches, list
 * loads) on every home view forever. The surface is gone now; these specs
 * pin both halves: the legacy deep-links keep redirecting, and the dead tab
 * no longer mounts.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryShell } from '../../src/components/EntryShell';
import { parseRoute } from '../../src/router';
import { I18nProvider } from '../../src/i18n';
import type { AgentInfo, AppConfig } from '../../src/types';

const originalFetch = globalThis.fetch;
const originalResizeObserver = globalThis.ResizeObserver;

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cliAgent(): AgentInfo {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    bin: 'claude',
    available: true,
    version: '1.0.0',
    models: [{ id: 'sonnet', label: 'Sonnet' }],
  };
}

function baseConfig(): AppConfig {
  return {
    mode: 'daemon',
    agentId: 'claude-code',
    agentModels: { 'claude-code': { model: 'sonnet' } },
    apiProtocol: 'anthropic',
    apiProtocolConfigs: {},
    apiKey: '',
    baseUrl: '',
    model: '',
    theme: 'system',
    onboardedAt: 1,
    skillId: '',
    designSystemId: null,
  } as AppConfig;
}

describe('brands surface removal (BUG-7)', () => {
  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({})),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    globalThis.ResizeObserver = originalResizeObserver;
    window.history.replaceState(null, '', '/');
  });

  it('keeps redirecting the legacy /brands deep-links onto design systems', () => {
    expect(parseRoute('/brands')).toEqual({ kind: 'home', view: 'design-systems' });
    expect(parseRoute('/brands/user%3Aabc')).toEqual({ kind: 'home', view: 'design-systems' });
  });

  it('no longer mounts the unreachable BrandsTab', () => {
    window.history.replaceState(null, '', '/design-systems');
    const props: React.ComponentProps<typeof EntryShell> = {
      skills: [],
      designTemplates: [],
      designSystems: [],
      projects: [],
      templates: [],
      promptTemplates: [],
      defaultDesignSystemId: null,
      connectors: [],
      connectorsLoading: false,
      config: baseConfig(),
      agents: [cliAgent()],
      daemonLive: true,
      onModeChange: vi.fn(),
      onAgentChange: vi.fn(),
      onAgentModelChange: vi.fn(),
      onApiProtocolChange: vi.fn(),
      onApiModelChange: vi.fn(),
      onConfigPersist: vi.fn(),
      onRefreshAgents: vi.fn(() => [cliAgent()]),
      onThemeChange: vi.fn(),
      onCreateProject: vi.fn(),
      onCreatePluginShareProject: vi.fn(),
      onImportClaudeDesign: vi.fn(),
      onOpenProject: vi.fn(),
      onOpenLiveArtifact: vi.fn(),
      onDeleteProject: vi.fn(),
      onRenameProject: vi.fn(),
      onChangeDefaultDesignSystem: vi.fn(),
      onPersistComposioKey: vi.fn(),
      onOpenSettings: vi.fn(),
      onCompleteOnboarding: vi.fn(),
    };

    const { container } = render(
      <I18nProvider initial="en">
        <EntryShell {...props} />
      </I18nProvider>,
    );

    expect(container.querySelector('[data-testid="entry-view-brands"]')).toBeNull();
  });
});
