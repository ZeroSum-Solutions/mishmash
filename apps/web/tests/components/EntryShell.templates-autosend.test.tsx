// @vitest-environment jsdom
//
// MM-001 #2: starting a project from the Templates gallery must land on
// canvas with the first message auto-sent — the daemon composes the actual
// prompt text server-side from the guided-create brief, so the client only
// needs to promise `autoSendFirstMessage: true`. Before this fix,
// `startProjectFromTemplate` (EntryShell.tsx) never set that flag at all, so
// App.tsx's create flow never armed auto-send no matter what the daemon
// composed.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryShell } from '../../src/components/EntryShell';
import { I18nProvider } from '../../src/i18n';
import type { AgentInfo, AppConfig, SkillSummary } from '../../src/types';

vi.mock('../../src/runtime/exports', () => ({
  openSandboxedUrlInNewTab: vi.fn(),
}));

// TemplateThumb gates its rendered preview behind an IntersectionObserver so
// off-screen cards never spin up dozens of iframes at once. Report every
// observed node as intersecting immediately, matching TemplatesSection's own
// test harness (tests/components/TemplatesSection.test.tsx).
type IntersectionCallback = (entries: Pick<IntersectionObserverEntry, 'target' | 'isIntersecting'>[]) => void;

class EagerIntersectionObserver {
  #callback: IntersectionCallback;
  constructor(callback: IntersectionCallback) {
    this.#callback = callback;
  }
  observe(target: Element) {
    this.#callback([{ target, isIntersecting: true }]);
  }
  unobserve() {}
  disconnect() {}
}

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

const originalFetch = globalThis.fetch;
const originalResizeObserver = globalThis.ResizeObserver;
const originalIntersectionObserver = globalThis.IntersectionObserver;

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

function skill(overrides: Partial<SkillSummary> & Pick<SkillSummary, 'id' | 'name'>): SkillSummary {
  return {
    id: overrides.id,
    name: overrides.name,
    description: overrides.description ?? `${overrides.name} example`,
    triggers: overrides.triggers ?? [],
    mode: overrides.mode ?? 'prototype',
    surface: overrides.surface ?? 'web',
    platform: overrides.platform ?? 'desktop',
    scenario: overrides.scenario ?? 'general',
    category: overrides.category ?? null,
    previewType: overrides.previewType ?? 'html',
    designSystemRequired: overrides.designSystemRequired ?? false,
    defaultFor: overrides.defaultFor ?? [],
    upstream: overrides.upstream ?? null,
    featured: overrides.featured ?? null,
    fidelity: overrides.fidelity ?? null,
    speakerNotes: overrides.speakerNotes ?? null,
    animations: overrides.animations ?? null,
    craftRequires: overrides.craftRequires ?? [],
    hasBody: overrides.hasBody ?? true,
    examplePrompt: overrides.examplePrompt ?? `Build ${overrides.name}.`,
    aggregatesExamples: overrides.aggregatesExamples ?? false,
  };
}

function renderTemplatesView(onCreateProject: (input: unknown) => void) {
  window.history.replaceState(null, '', '/templates');
  const template = skill({ id: 'landing-hero', name: 'Landing Hero' });
  const props: React.ComponentProps<typeof EntryShell> = {
    skills: [],
    designTemplates: [template],
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
    onCreateProject,
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
  render(
    <I18nProvider initial="en">
      <EntryShell {...props} />
    </I18nProvider>,
  );
  return template;
}

beforeEach(() => {
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  globalThis.IntersectionObserver = EagerIntersectionObserver as unknown as typeof IntersectionObserver;
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));
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

describe('EntryShell Templates gallery auto-send wiring (MM-001 #2)', () => {
  it('creates from a template with autoSendFirstMessage set, even with no brief answered', async () => {
    const onCreateProject = vi.fn<(input: unknown) => void>();
    renderTemplatesView(onCreateProject);

    fireEvent.click(screen.getByTestId('templates-card'));
    const viewer = await screen.findByTestId('templates-viewer');
    fireEvent.click(within(viewer).getByTestId('templates-use'));

    const dialog = await screen.findByTestId('guided-create-dialog');
    fireEvent.click(within(dialog).getByTestId('guided-create-skip'));

    expect(onCreateProject).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: 'landing-hero',
        autoSendFirstMessage: true,
      }),
    );
    // Skip-all sends no brief, matching the empty-brief invariant
    // (GuidedCreateDialog.tsx:7-11) — `brief` must be entirely absent.
    const call = onCreateProject.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect('brief' in call).toBe(false);
  });

  it('forwards guided create answers as brief alongside autoSendFirstMessage', async () => {
    const onCreateProject = vi.fn<(input: unknown) => void>();
    renderTemplatesView(onCreateProject);

    fireEvent.click(screen.getByTestId('templates-card'));
    const viewer = await screen.findByTestId('templates-viewer');
    fireEvent.click(within(viewer).getByTestId('templates-use'));

    const dialog = await screen.findByTestId('guided-create-dialog');
    const screensPresets = within(dialog).getAllByTestId('guided-create-screens-preset');
    fireEvent.click(screensPresets.find((el) => el.getAttribute('data-value') === '5')!);
    fireEvent.click(within(dialog).getByTestId('guided-create-start'));

    expect(onCreateProject).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: 'landing-hero',
        autoSendFirstMessage: true,
        brief: { screens: 5 },
      }),
    );
  });
});
