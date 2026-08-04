// @vitest-environment jsdom
//
// Red spec for production-note E (Figma URL import fidelity): pasting a Figma
// URL into the Import-from-Figma modal on Home must route through the real
// od-figma-migration scenario — the same flow the "From Figma" chip and
// `od figma import --figma-url` use — and start the run. The buggy behavior
// created a bare project whose pendingPrompt merely *mentioned* the URL, so
// the agent (with no Figma access) hallucinated the design from the URL text
// and the composer sat prefilled without ever sending.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { HomeView } from '../../src/components/HomeView';
import { I18nProvider } from '../../src/i18n';
import { writeHomeGuideStage } from '../../src/components/home-hero/firstRunGuide';

const analyticsMocks = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../../src/analytics/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/provider')>();
  return {
    ...actual,
    useAnalytics: () => ({
      track: analyticsMocks.track,
      newRequestId: () => 'request-1',
      setConfigureGlobals: vi.fn(),
      setConsent: vi.fn(),
      setIdentity: vi.fn(),
    }),
  };
});

const FIGMA_MIGRATION_PLUGIN = {
  id: 'od-figma-migration',
  title: 'Figma migration',
  version: '0.1.0',
  trust: 'bundled' as const,
  sourceKind: 'bundled' as const,
  source: '/tmp/od-figma-migration',
  capabilitiesGranted: ['prompt:inject'],
  fsPath: '/tmp/od-figma-migration',
  installedAt: 0,
  updatedAt: 0,
  manifest: {
    name: 'od-figma-migration',
    title: 'Figma migration',
    version: '0.1.0',
    description: 'Migrate a Figma file into a webpage.',
    tags: ['figma'],
    od: {
      kind: 'scenario',
      taskKind: 'figma-migration',
      useCase: { query: 'Migrate the Figma file at {{figmaUrl}}.' },
    },
  },
};

function stubPlugins() {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href === '/api/plugins') {
      return new Response(JSON.stringify({ plugins: [FIGMA_MIGRATION_PLUGIN] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  analyticsMocks.track.mockClear();
  cleanup();
  window.localStorage.clear();
});

type HomeSubmit = (payload: import('../../src/components/PluginLoopHome').PluginLoopSubmit) => void;

async function submitFigmaUrl(onSubmit: HomeSubmit, url: string, notes?: string) {
  writeHomeGuideStage('done');
  stubPlugins();
  render(
    <I18nProvider initial="en">
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
        onViewAllProjects={() => undefined}
      />
    </I18nProvider>,
  );

  fireEvent.click(await screen.findByTestId('home-hero-plus-trigger'));
  fireEvent.click(await screen.findByTestId('composer-plus-figma'));
  fireEvent.click(await screen.findByRole('tab', { name: 'Figma URL' }));
  fireEvent.change(screen.getByPlaceholderText('https://figma.com/design/…'), {
    target: { value: url },
  });
  if (notes) {
    fireEvent.change(screen.getByPlaceholderText(/Optional: notes for the build/), {
      target: { value: notes },
    });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Import & build' }));
}

describe('HomeView Figma URL import', () => {
  it('routes a pasted Figma URL through the od-figma-migration scenario and starts the run', async () => {
    const onSubmit = vi.fn<HomeSubmit>();
    const url = 'https://www.figma.com/design/AbC123xYz/My-App?node-id=12-345';
    await submitFigmaUrl(onSubmit, url, 'make it a landing page');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]![0];
    expect(payload.pluginId).toBe('od-figma-migration');
    // The full URL — node-id scoping query included — must reach the
    // pipeline inputs verbatim, not just the prompt text.
    expect(payload.pluginInputs?.figmaUrl).toBe(url);
    expect(payload.pluginInputs?.notes).toBe('make it a landing page');
    expect(payload.prompt).toContain(url);
    expect(payload.projectKind).toBe('prototype');
  });

  it('surfaces the reinstall error instead of a silent no-op when the scenario plugin is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const href = typeof input === 'string' ? input : input.toString();
      if (href === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));
    writeHomeGuideStage('done');
    const onSubmit = vi.fn();
    render(
      <I18nProvider initial="en">
        <HomeView
          projects={[]}
          onSubmit={onSubmit}
          onOpenProject={() => undefined}
          onViewAllProjects={() => undefined}
        />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByTestId('home-hero-plus-trigger'));
    fireEvent.click(await screen.findByTestId('composer-plus-figma'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Figma URL' }));
    fireEvent.change(screen.getByPlaceholderText('https://figma.com/design/…'), {
      target: { value: 'https://figma.com/design/AbC123xYz/My-App' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import & build' }));

    await waitFor(() => {
      expect(screen.getByText(/is not installed/)).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
