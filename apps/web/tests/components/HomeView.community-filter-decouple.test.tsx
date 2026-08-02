// @vitest-environment jsdom

// Duplicate-example flow on the restructured Home (docs/plans/2026-08-01-
// home-studio-entrance-restructure.md): the Community gallery left the Home
// view, so the chip↔filter decoupling spec that lived here is obsolete —
// the gallery's own facet behavior stays covered by
// plugins-home-section.test.tsx on its surviving surface (PluginsView).
// What remains Home's own is `duplicateExamplePlugin`: remixing an example
// must open the copied project at its entry file. That flow's surviving
// Home surface is the preset-card remix button under an active type chip.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HomeView } from '../../src/components/HomeView';
import { I18nProvider } from '../../src/i18n';

function makeHomePlugin(
  id: string,
  mode: string,
  preview?: Record<string, unknown>,
) {
  return {
    id,
    title: id,
    version: '1.0.0',
    trust: 'bundled' as const,
    sourceKind: 'bundled' as const,
    source: `/tmp/${id}`,
    capabilitiesGranted: ['prompt:inject'],
    fsPath: `/tmp/${id}`,
    installedAt: 0,
    updatedAt: 0,
    manifest: {
      name: id,
      title: id,
      version: '1.0.0',
      description: `${id} fixture`,
      od: {
        kind: 'scenario',
        taskKind: 'new-generation',
        mode,
        ...(preview ? { preview } : {}),
      },
    },
  };
}

const DUPLICABLE_PLUGINS = [
  // The Prototype chip's own default plugin — pickChip aborts (with the
  // "bundled scenario not installed" error) if the chip's action.pluginId is
  // missing from the catalog, and no preset tiles render without an active chip.
  makeHomePlugin('example-web-prototype', 'prototype'),
  makeHomePlugin('example-html-prototype', 'prototype', {
    type: 'html',
    entry: './example.html',
  }),
];
// Preset tiles require a seedable query (`pluginPresetQuery`); without one the
// example never renders on the rail and the remix button cannot exist.
for (const plugin of DUPLICABLE_PLUGINS) {
  (plugin.manifest.od as Record<string, unknown>).useCase = { query: 'Recreate this example.' };
}

describe('HomeView duplicate example flow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it('opens duplicated gallery examples at the copied entry file', async () => {
    const onOpenProject = vi.fn();
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: DUPLICABLE_PLUGINS }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (
        typeof url === 'string' &&
        url === '/api/plugins/example-html-prototype/duplicate-project' &&
        init?.method === 'POST'
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            projectId: 'duplicated-project',
            conversationId: 'duplicated-conversation',
            relPath: 'index.html',
            project: { id: 'duplicated-project', name: 'Duplicated' },
            sourcePluginId: 'example-html-prototype',
            sourceEntry: 'example.html',
            copiedFiles: 1,
            skippedFiles: 0,
            warnings: [],
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <I18nProvider initial="en">
        <HomeView
          projects={[]}
          onSubmit={() => undefined}
          onOpenProject={onOpenProject}
          onViewAllProjects={() => undefined}
        />
      </I18nProvider>,
    );

    // Preset cards render under the active type chip; the fixture's
    // mode: 'prototype' + html preview places it on the Prototype rail. The
    // rail disables its chips until the plugin list loads, and a disabled
    // button swallows the click — wait for enablement first.
    const prototypeChip = (await screen.findByTestId('home-hero-rail-prototype')) as HTMLButtonElement;
    await waitFor(() => expect(prototypeChip.disabled).toBe(false));
    fireEvent.click(prototypeChip);
    fireEvent.click(
      await screen.findByTestId(
        'home-hero-plugin-preset-duplicate-example-html-prototype',
        undefined,
        // The preset tiles mount behind the chip's deferred bind + entrance
        // transition; the default 1s findBy window races that settle.
        { timeout: 5_000 },
      ),
    );

    await waitFor(() => {
      expect(onOpenProject).toHaveBeenCalledWith('duplicated-project', 'index.html');
    });
  });
});
