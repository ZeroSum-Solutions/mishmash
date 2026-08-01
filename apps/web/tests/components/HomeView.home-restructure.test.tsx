// @vitest-environment jsdom
//
// Home "studio entrance" restructure (docs/plans/2026-08-01-home-studio-
// entrance-restructure.md, phase 1): the Workflows & Assets gallery grid
// (PluginsHomeSection) leaves the Home view entirely, replaced by a single
// quiet link-out row that routes to the Plugins view via the existing
// `onBrowseRegistry` callback. The gallery itself remains available on
// PluginsView — this spec pins its absence from Home only. The Featured
// starters row's new "Clone + rebrand" tool card must drive the existing
// `web-clone` chip path (the same one the HomeHero rail uses), observable as
// the Website-clone text prompt-example cards appearing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { HomeView } from '../../src/components/HomeView';
import { I18nProvider } from '../../src/i18n';
import { writeHomeGuideStage } from '../../src/components/home-hero/firstRunGuide';

// The Website-clone chip's base scenario (its action.pluginId) — must exist so
// clicking the Clone + rebrand card binds the chip instead of erroring.
const WEB_CLONE_BASE = {
  id: 'example-web-clone',
  title: 'Website clone',
  version: '0.1.0',
  trust: 'bundled' as const,
  sourceKind: 'bundled' as const,
  source: '/tmp/web-clone',
  capabilitiesGranted: ['prompt:inject'],
  fsPath: '/tmp/web-clone',
  installedAt: 0,
  updatedAt: 0,
  manifest: {
    name: 'example-web-clone',
    title: 'Website clone',
    version: '0.1.0',
    description: 'Recreate an existing website.',
    tags: ['web-clone', 'website-clone'],
    od: {
      kind: 'scenario',
      taskKind: 'new-generation',
      useCase: { query: 'Recreate the website at {{targetUrl}}.' },
    },
  },
};

function stubPlugins() {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href === '/api/plugins') {
      return new Response(JSON.stringify({ plugins: [WEB_CLONE_BASE] }), {
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

function renderHome(onBrowseRegistry?: () => void) {
  return render(
    <I18nProvider initial="en">
      <HomeView
        projects={[]}
        onSubmit={() => undefined}
        onOpenProject={() => undefined}
        onViewAllProjects={() => undefined}
        {...(onBrowseRegistry ? { onBrowseRegistry } : {})}
      />
    </I18nProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  window.localStorage.clear();
});

describe('Home studio-entrance restructure', () => {
  it('renders no Workflows & Assets gallery on Home; the link-out row routes to the Plugins view', async () => {
    writeHomeGuideStage('done');
    stubPlugins();
    const onBrowseRegistry = vi.fn();
    renderHome(onBrowseRegistry);

    // The featured row is Home's template surface now; the gallery grid is gone.
    await screen.findByTestId('featured-templates-row');
    expect(screen.queryByTestId('plugins-home-section')).toBeNull();
    expect(screen.queryByText('Workflows and Assets')).toBeNull();

    fireEvent.click(screen.getByTestId('home-workflows-linkrow'));
    expect(onBrowseRegistry).toHaveBeenCalledTimes(1);
  });

  it('hides the link-out row when the shell provides no onBrowseRegistry', async () => {
    writeHomeGuideStage('done');
    stubPlugins();
    renderHome();

    await screen.findByTestId('featured-templates-row');
    expect(screen.queryByTestId('home-workflows-linkrow')).toBeNull();
  });

  it('Clone + rebrand featured card drives the web-clone chip path', async () => {
    writeHomeGuideStage('done');
    stubPlugins();
    renderHome();

    const cloneCard = await screen.findByText('Clone + rebrand');
    fireEvent.click(cloneCard.closest('button')!);

    // Same observable the HomeHero rail's web-clone click produces: the
    // Website-clone text prompt-example cards. No error alert.
    const textCards = await screen.findAllByTestId('home-hero-prompt-example');
    expect(textCards.length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
