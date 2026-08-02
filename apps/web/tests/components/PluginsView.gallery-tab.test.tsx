// @vitest-environment jsdom
//
// Studio-entrance restructure phase 1 (docs/plans/2026-08-01-home-studio-
// entrance-restructure.md): the Workflows & Assets gallery grid left the Home
// view, and the Plugins view is its new home. The installed tab filters to
// user-imported plugins only, so WITHOUT a dedicated gallery tab the bundled
// catalog would have no surface anywhere — this spec pins the gallery tab as
// the Plugins view's default landing surface, rendering the full catalog in
// gallery card layout, with browse-registry switching to the Available tab.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledPluginRecord } from '@open-design/contracts';
import { PluginsView } from '../../src/components/PluginsView';
import { listPluginMarketplaces, listPlugins } from '../../src/state/projects';
import { I18nProvider } from '../../src/i18n';

vi.mock('../../src/router', () => ({
  navigate: vi.fn(),
}));

vi.mock('../../src/state/projects', () => ({
  addPluginMarketplace: vi.fn(),
  applyPlugin: vi.fn(),
  installPluginSource: vi.fn(),
  listPluginMarketplaces: vi.fn(),
  listPlugins: vi.fn(),
  refreshPluginMarketplace: vi.fn(),
  removePluginMarketplace: vi.fn(),
  setPluginMarketplaceTrust: vi.fn(),
  uninstallPlugin: vi.fn(),
  uploadPluginFolder: vi.fn(),
  uploadPluginZip: vi.fn(),
  upgradePlugin: vi.fn(),
}));

const BUNDLED_GALLERY_PLUGIN: InstalledPluginRecord = {
  id: 'bundled-gallery-plugin',
  title: 'Bundled Gallery Plugin',
  version: '1.0.0',
  sourceKind: 'bundled',
  source: '/tmp/bundled-gallery-plugin',
  trust: 'bundled',
  capabilitiesGranted: ['prompt:inject'],
  manifest: {
    name: 'bundled-gallery-plugin',
    version: '1.0.0',
    title: 'Bundled Gallery Plugin',
    description: 'Bundled catalog tile.',
    od: {
      kind: 'scenario',
      taskKind: 'new-generation',
      mode: 'prototype',
      useCase: { query: 'Build the bundled example.' },
    },
  },
} as InstalledPluginRecord;

beforeEach(() => {
  vi.mocked(listPlugins).mockResolvedValue([BUNDLED_GALLERY_PLUGIN]);
  vi.mocked(listPluginMarketplaces).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderView() {
  return render(
    <I18nProvider initial="en">
      <PluginsView onUsePlugin={vi.fn()} />
    </I18nProvider>,
  );
}

describe('PluginsView gallery tab', () => {
  it('lands on the gallery tab by default and renders the bundled catalog in gallery layout', async () => {
    renderView();

    // The bundled plugin appears as a gallery-layout card — the installed tab
    // (user plugins only) would render nothing for it.
    await waitFor(() => {
      expect(document.querySelector('article.plugins-home__card--gallery')).not.toBeNull();
    });
    expect(
      document.querySelector('article.plugins-home__card[data-plugin-id="bundled-gallery-plugin"]'),
    ).not.toBeNull();
    expect(screen.getByTestId('plugins-home-section')).toBeTruthy();
  });

  it('switches to the Available tab through the gallery browse-registry affordance', async () => {
    renderView();

    fireEvent.click(await screen.findByTestId('plugins-home-browse-registry'));
    await waitFor(() => {
      expect(screen.queryByTestId('plugins-home-section')).toBeNull();
    });
  });
});
